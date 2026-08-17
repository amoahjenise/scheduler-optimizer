#!/usr/bin/env python3
"""End-to-end test of CF shift processing via actual OCR parsing."""
import sys
import os
sys.path.insert(0, '.')

from app.api.routes.optimized_schedule import RobustScheduler, SHIFT_CODES

# Dates from the CSV
dates = [
    "2025-08-24", "2025-08-25", "2025-08-26", "2025-08-27", 
    "2025-08-28", "2025-08-29", "2025-08-30", "2025-08-31",
    "2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04",
    "2025-09-05", "2025-09-06"
]

# Test nurses with composite CF
test_nurses = [
    {
        "name": "Tiffany Glodoviza",
        "employmentType": "FT",
        "targetHours": 75.0,
        "preferredShifts": {
            "2025-08-24": "Z07",
            "2025-08-27": "Z07",
            "2025-08-28": "Z07",
            "2025-09-01": "Z19",
            "2025-09-02": "Z23 B",
            "2025-09-03": "Z23 B",
            "2025-09-05": "CF-4 07",  # Composite CF
        }
    },
    {
        "name": "Trong Tran Khoi",
        "employmentType": "FT",
        "targetHours": 75.0,
        "preferredShifts": {
            "2025-08-25": "Z19",
            "2025-08-26": "Z23 B",
            "2025-08-29": "Z19",
            "2025-08-30": "Z23 B",
            "2025-08-31": "Z23 B",
            "2025-09-03": "Z19",
            "2025-09-05": "CF-11 07",  # Composite CF
        }
    }
]

print("=" * 80)
print("END-TO-END CF PROCESSING TEST")
print("=" * 80)

for nurse_data in test_nurses:
    nurse_name = nurse_data["name"]
    pref_shifts = nurse_data["preferredShifts"]
    
    print(f"\n{'=' * 80}")
    print(f"{nurse_name}")
    print(f"{'=' * 80}")
    
    # Simulate OCR grid row
    ocr_row = []
    for date in dates:
        shift = pref_shifts.get(date, "—")
        ocr_row.append(shift)
    
    # Create scheduler instance
    scheduler = RobustScheduler(
        nurses=[nurse_data],
        date_list=dates,
        day_shift_codes=["07", "Z07", "11", "Z11", "E15"],
        night_shift_codes=["23", "Z19", "Z23", "Z23 B"],
        shifts_info=SHIFT_CODES,
        day_req=6,
        night_req=6
    )
    
    # Process OCR for this nurse
    print(f"\nProcessing OCR grid:")
    for i, date in enumerate(dates):
        shift_code = ocr_row[i]
        if shift_code != "—":
            print(f"  {date}: {shift_code}")
    
    # Simulate full OCR import
    # Build OCR_GRID in the format the backend expects
    ocr_grid = [{
        "nurse": nurse_name,
        "shifts": [ocr_row[i] for i in range(len(dates))]
    }]
    
    # Import OCR using the actual OCR import Step 1
    scheduler.ocr_step1_import_ocr_grid(ocr_grid, dates)
    
    # Get the final schedule
    if nurse_name in scheduler.schedule:
        shifts_list = scheduler.schedule[nurse_name]
        
        print(f"\n\nFINAL SCHEDULE ENTRIES:")
        print(f"{'Date':<15} {'Shift':<15} {'Hours':<8} {'Type':<10}")
        print("-" * 55)
        
        total_hours = 0
        total_shifts = 0
        count_12h = 0
        count_8h = 0
        
        for entry in shifts_list:
            if entry and isinstance(entry, dict) and entry.get('hours', 0) > 0:
                shift_code = entry.get('shift', '')
                hours = entry.get('hours', 0)
                shift_type = entry.get('shiftType', '')
                date = entry.get('date', '')
                
                print(f"{date:<15} {shift_code:<15} {hours:<8} {shift_type:<10}")
                
                total_hours += hours
                total_shifts += 1
                
                if hours >= 11:
                    count_12h += 1
                else:
                    count_8h += 1
        
        print("-" * 55)
        print(f"\nSUMMARY:")
        print(f"  Total shifts: {total_shifts}")
        print(f"  12h shifts: {count_12h}")
        print(f"  8h shifts: {count_8h}")
        print(f"  Total hours: {total_hours}h")
        print(f"  \nDisplay format: ", end="")
        
        parts = []
        if count_12h > 0:
            parts.append(f"{count_12h}×12h")
        if count_8h > 0:
            parts.append(f"{count_8h}×8h")
        
        display = " + ".join(parts) if parts else "0 shifts"
        print(display)
        
        target = nurse_data["targetHours"]
        delta = total_hours - target
        print(f"\n  Target hours: {target}h")
        print(f"  Delta: {delta:+.2f}h")
        
    else:
        print(f"\n❌ ERROR: {nurse_name} not found in final schedule!")

print("\n" + "=" * 80)
print("TEST COMPLETE")
print("=" * 80)
