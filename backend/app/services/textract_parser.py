# textract_parser.py
import boto3
from typing import List, Dict, Tuple
from datetime import date, timedelta
from difflib import get_close_matches
from app.core.config import settings


def parse_schedule_from_image(image_bytes: bytes, start_date: date, end_date: date) -> Dict:
    """
    Extracts nurse schedule from image using Amazon Textract,
    aligning table headers to known date range.
    """
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

    # Extract OCR headers (weekday + day)
    ocr_headers = []
    for col in range(2, max_col + 1):
        weekday = get_text(cell_map.get((1, col), '')).strip()
        day = get_text(cell_map.get((2, col), '')).strip()
        if weekday or day:
            ocr_headers.append(f"{weekday} {day}".strip())
        else:
            ocr_headers.append("")

    # Build actual expected date labels
    def generate_expected_labels(start: date, end: date) -> List[str]:
        labels = []
        current = start
        while current <= end:
            labels.append(current.strftime("%a %d").lstrip("0"))  # e.g., "Mon 25"
            current += timedelta(days=1)
        return labels

    expected_labels = generate_expected_labels(start_date, end_date)

    # Try to align OCR headers with expected date labels using close match
    aligned_dates = []
    for ocr_label in ocr_headers:
        match = get_close_matches(ocr_label, expected_labels, n=1, cutoff=0.6)
        aligned_dates.append(match[0] if match else ocr_label)

    # Extract grid data from row 3 onward
    ocrGrid = []
    for row in range(3, max_row + 1):
        nurse_cell = cell_map.get((row, 1), {})
        nurse_info = get_text(nurse_cell).strip()
        if not nurse_info:
            continue

        shifts = []
        for col in range(2, max_col + 1):
            shift_text = get_text(cell_map.get((row, col), {})).strip()
            shifts.append(shift_text)

        ocrGrid.append({
            "nurse": nurse_info,
            "shifts": shifts
        })

    return {
        "dates": aligned_dates,
        "grid": ocrGrid
    }
