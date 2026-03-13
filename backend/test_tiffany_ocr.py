#!/usr/bin/env python3
"""
Test script to verify Tiffany's OCR shifts are preserved correctly.
Tests the fix for de-peaking logic removing OCR assignments.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.api.routes.optimized_schedule import RobustScheduler
from datetime import datetime, timedelta

# Test with 25 nurses for Aug 24 - Sep 6 (14 days)
nurses = [
    {"name": "Tiffany Glodoviza", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Trong Tran Khoi", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Demitra Sita", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": ["2025-08-25", "2025-08-26", "2025-08-27", "2025-08-28", "2025-08-29", "2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05"]},
    {"name": "Maky Shimoya", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": ["2025-08-24", "2025-08-25", "2025-08-26", "2025-08-27"]},
] + [
    {"name": f"Nurse {i}", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []}
    for i in range(1, 22)
]

# Date range: Aug 24 - Sep 6 (14 days)
start_date = datetime(2025, 8, 24)
date_list = [(start_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(14)]

print(f"Date list: {date_list}")

# Tiffany's OCR schedule from the user's input:
# Aug 24-26: Z07, Z07, Z07
# Aug 27-30: Z19, Z23 B, Z23 B, Z23
# Sept 1: CF-4 07 (off code)
tiffany_ocr = [
    "Z07", "Z07", "Z07",  # Aug 24-26
    "Z19", "Z23 B", "Z23 B", "Z23",  # Aug 27-30
    "CF-4 07",  # Sept 1
    "", "", "", "", "", "",  # Sept 2-6
]

# Verify the lengths match
print(f"Date list length: {len(date_list)}")
print(f"Tiffany OCR length: {len(tiffany_ocr)}")
assert len(tiffany_ocr) == len(date_list), "OCR list length mismatch"

# OCR assignments (preferences)
assignments = {
    "Tiffany Glodoviza": tiffany_ocr,
    "Trong Tran Khoi": ["Z19", "Z23 B", "Z23 B", "Z23", "Z19", "Z23 B", "Z23 B", "Z23", "", "", "", "", "", ""],
}

# Shift codes
day_shift_codes = ["ZD12-", "D8-", "E8-", "Z11", "11", "07", "Z07", "E15"]
night_shift_codes = ["ZN-", "N8-", "ZE2-", "Z19", "Z23", "Z23 B", "23"]

shifts_info = {
    "Z07": {"hours": 11.25, "startTime": "07:00", "endTime": "19:00", "type": "day"},
    "Z19": {"hours": 3.75, "startTime": "19:00", "endTime": "23:00", "type": "night"},
    "Z23 B": {"hours": 7.5, "startTime": "23:00", "endTime": "07:00", "type": "night"},
    "Z23": {"hours": 7.5, "startTime": "23:00", "endTime": "07:00", "type": "night"},
    "CF-4 07": {"hours": 0, "startTime": "", "endTime": "", "type": "off"},
}

# Create scheduler
scheduler = RobustScheduler(
    nurses=nurses,
    date_list=date_list,
    day_shift_codes=day_shift_codes,
    night_shift_codes=night_shift_codes,
    shifts_info=shifts_info,
    day_req=5,
    night_req=3,
    max_consecutive=3,
    preferences=assignments
)

# Build schedule
schedule = scheduler.build_schedule()

# Check Tiffany's schedule
print("\n" + "="*80)
print("TIFFANY'S SCHEDULE OUTPUT:")
print("="*80)
tiffany_schedule = schedule.get("Tiffany Glodoviza", [])
for day_idx, date in enumerate(date_list):
    shift = tiffany_schedule[day_idx] if day_idx < len(tiffany_schedule) else None
    expected_ocr = tiffany_ocr[day_idx]
    
    if shift:
        actual_shift = shift.get("shift", "OFF")
        hours = shift.get("hours", 0)
        shift_type = shift.get("shiftType", "off")
        print(f"{date}: Expected OCR: {expected_ocr:10s} | Got: {actual_shift:10s} ({shift_type:6s}, {hours:5.2f}h)")
        
        # Validate OCR is preserved
        if expected_ocr and not expected_ocr.upper().startswith("CF") and expected_ocr.upper() != "C" and expected_ocr != "":
            if actual_shift.upper() != expected_ocr.upper():
                print(f"  ❌ MISMATCH! Expected {expected_ocr}, got {actual_shift}")
            else:
                print(f"  ✓ OCR PRESERVED")
    else:
        print(f"{date}: Expected OCR: {expected_ocr:10s} | Got: None (ERROR)")

print("\n" + "="*80)
print("TRONG'S SCHEDULE OUTPUT (should match his OCR):")
print("="*80)
trong_schedule = schedule.get("Trong Tran Khoi", [])
for day_idx, date in enumerate(date_list):
    shift = trong_schedule[day_idx] if day_idx < len(trong_schedule) else None
    if shift:
        actual_shift = shift.get("shift", "OFF")
        hours = shift.get("hours", 0)
        shift_type = shift.get("shiftType", "off")
        print(f"{date}: {actual_shift:10s} ({shift_type:6s}, {hours:5.2f}h)")

print("\n" + "="*80)
print("SUMMARY:")
print("="*80)

# Count Tiffany's hours
tiffany_total = sum(shift.get("hours", 0) for shift in tiffany_schedule if shift)
print(f"Tiffany total hours: {tiffany_total:.2f}h")
print(f"Tiffany shifts: {sum(1 for shift in tiffany_schedule if shift and shift.get('hours', 0) > 0)}")

# Verify key days
key_dates = ["2025-08-24", "2025-08-27", "2025-08-28", "2025-08-29"]
print(f"\nKey dates verification:")
for key_date in key_dates:
    idx = date_list.index(key_date)
    shift = tiffany_schedule[idx]
    expected = tiffany_ocr[idx]
    actual = shift.get("shift", "OFF") if shift else "OFF"
    status = "✓" if actual.upper() == expected.upper() else "❌"
    print(f"  {key_date}: Expected {expected:10s}, Got {actual:10s} {status}")
