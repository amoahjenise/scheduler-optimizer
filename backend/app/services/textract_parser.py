# textract_parser.py
import boto3
import re
from typing import List, Dict
from datetime import date, timedelta
from difflib import get_close_matches
from app.core.config import settings


def parse_schedule_from_image(image_bytes: bytes, start_date: date, end_date: date) -> Dict:
    textract = boto3.client(
        'textract',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_DEFAULT_REGION
    )

    response = textract.analyze_document(
        Document={'Bytes': image_bytes},
        FeatureTypes=['TABLES']
    )

    blocks = response['Blocks']
    cell_map = {
        (block['RowIndex'], block['ColumnIndex']): block
        for block in blocks if block['BlockType'] == 'CELL'
    }

    def get_text(cell):
        if not cell or 'Relationships' not in cell:
            return ''
        text = []
        for rel in cell['Relationships']:
            if rel['Type'] == 'CHILD':
                for child_id in rel['Ids']:
                    word = next((b for b in blocks if b['Id'] == child_id), None)
                    if word and word['BlockType'] == 'WORD':
                        text.append(word['Text'])
        return ' '.join(text)

    max_row = max(row for row, _ in cell_map)
    max_col = max(col for _, col in cell_map)

    # Step 1: Build expected date labels (like "Mon 02")
    def generate_expected_labels(start: date, end: date) -> Dict[str, date]:
        date_labels = {}
        current = start
        while current <= end:
            label = current.strftime("%a %d").lstrip("0")
            date_labels[label] = current
            current += timedelta(days=1)
        return date_labels

    expected_labels = generate_expected_labels(start_date, end_date)

    # Step 2: Match OCR headers to real dates with confidence
    col_date_map = {}
    for col in range(2, max_col + 1):
        weekday = get_text(cell_map.get((1, col), '')).strip()
        day = get_text(cell_map.get((2, col), '')).strip()
        ocr_label = f"{weekday} {day}".strip()
        ocr_label = re.sub(r'\s+', ' ', ocr_label)

        match = get_close_matches(ocr_label, expected_labels.keys(), n=1, cutoff=0.6)
        if match:
            real_date = expected_labels[match[0]]
            col_date_map[col] = real_date  # map textract column to real date

    # Step 3: Sort columns by matched date
    sorted_cols = sorted(col_date_map.items(), key=lambda x: x[1])  # [(col_idx, date), ...]

    # Step 4: Extract grid
    ocrGrid = []
    for row in range(3, max_row + 1):
        nurse_cell = cell_map.get((row, 1), {})
        nurse_info = get_text(nurse_cell).strip()
        if not nurse_info:
            continue

        shifts = []
        for col, _ in sorted_cols:
            shift_text = get_text(cell_map.get((row, col), {})).strip()
            shifts.append(shift_text)

        ocrGrid.append({
            "nurse": nurse_info,
            "shifts": shifts
        })

    # Step 5: Return dates and data
    sorted_dates = [dt.isoformat() for _, dt in sorted_cols]

    return {
        "dates": sorted_dates,
        "grid": ocrGrid
    }
