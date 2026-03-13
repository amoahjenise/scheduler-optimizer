#!/usr/bin/env python3
"""
Test script to verify the scheduler generates proper day AND night shifts.
Tests with realistic data similar to the user's failing case.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.api.routes.optimized_schedule import RobustScheduler
from datetime import datetime, timedelta

# Simulate user's data - 23 nurses for 14 days
nurses = [
    {"name": "Tiffany Glodoviza", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Khoi", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Simoya", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 52, "offRequests": ["2024-08-28"]},
    {"name": "Katryn Turriff", "isChemoCertified": False, "employmentType": "part-time", "maxWeeklyHours": 45, "offRequests": []},
    {"name": "Khady Gueye", "isChemoCertified": False, "employmentType": "part-time", "maxWeeklyHours": 33, "offRequests": []},
    # Add more nurses to reach 23
    {"name": "Nurse 6", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 7", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 8", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 9", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 10", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 11", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 12", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 13", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 14", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 15", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 16", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 17", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 18", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 19", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 20", "isChemoCertified": True, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 21", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 22", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
    {"name": "Nurse 23", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 75, "offRequests": []},
]

# Date range: Aug 24 - Sep 6 (14 days)
start_date = datetime(2024, 8, 24)
date_list = [(start_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(14)]

# Shift codes (no CF codes!)
day_shift_codes = ["ZD12-", "D8-", "Z07"]
night_shift_codes = ["ZN-", "N8-", "Z19", "Z23"]

shifts_info = {
    "ZD12-": {"hours": 12, "startTime": "07:00", "endTime": "19:00", "type": "day"},
    "D8-": {"hours": 8, "startTime": "07:00", "endTime": "15:00", "type": "day"},
    "Z07": {"hours": 8, "startTime": "07:00", "endTime": "15:00", "type": "day"},
    "ZN-": {"hours": 8, "startTime": "23:00", "endTime": "07:00", "type": "night"},
    "N8-": {"hours": 8, "startTime": "23:00", "endTime": "07:00", "type": "night"},
    "Z19": {"hours": 8, "startTime": "19:00", "endTime": "03:00", "type": "night"},
    "Z23": {"hours": 8, "startTime": "23:00", "endTime": "07:00", "type": "night"},
}

# Some OCR preferences (including CF codes to test filtering)
preferences = {
    "Tiffany Glodoviza": ["Z07", "Z19", "Z23 B", "Z07", "", "Z19", "Z07", "Z07", "Z19", "Z23 B", "Z07", "Z23 B", "CF-4 07", ""],
    "Khoi": ["Z23", "Z19", "Z23 B", "Z23", "", "Z19", "Z23 B", "Z23 B", "Z23", "Z07", "Z19", "Z23", "CF-11 07", ""],
    "Simoya": ["Z07", "Z07", "Z07", "Z07", "CF-3 07", "Z07", "Z07", "Z07", "Z07", "Z07", "Z07", "Z07", "Z07", "Z07"],
}

print("=" * 80)
print("TESTING ROBUST SCHEDULER")
print("=" * 80)
print(f"Nurses: {len(nurses)}")
print(f"Days: {len(date_list)} ({date_list[0]} to {date_list[-1]})")
print(f"Day shift codes: {day_shift_codes}")
print(f"Night shift codes: {night_shift_codes}")
print(f"Requirements: 5 day / 3 night per day")
print("=" * 80)

scheduler = RobustScheduler(
    nurses=nurses,
    date_list=date_list,
    day_shift_codes=day_shift_codes,
    night_shift_codes=night_shift_codes,
    shifts_info=shifts_info,
    day_req=5,
    night_req=3,
    max_consecutive=5,
    preferences=preferences
)

schedule = scheduler.build_schedule()

# Validate the results
print("\n" + "=" * 80)
print("VALIDATION RESULTS")
print("=" * 80)

nurses_used = set()
total_issues = 0

for day_idx, date in enumerate(date_list):
    day_count = 0
    night_count = 0
    day_nurses = []
    night_nurses = []
    
    for nurse_name in schedule.keys():
        if day_idx < len(schedule[nurse_name]):
            shift = schedule[nurse_name][day_idx]
            if shift["shiftType"] == "day":
                day_count += 1
                day_nurses.append(nurse_name)
                nurses_used.add(nurse_name)
            elif shift["shiftType"] == "night":
                night_count += 1
                night_nurses.append(nurse_name)
                nurses_used.add(nurse_name)
            
            # Check for CF codes in actual shifts
            if shift["shift"] and shift["shift"].upper().startswith("CF"):
                print(f"❌ ERROR: {date} - {nurse_name} assigned CF code as shift: {shift['shift']}")
                total_issues += 1
    
    status = "✓" if day_count >= 5 and night_count >= 3 else "✗"
    print(f"{status} {date}: Day={day_count}/5 (req 5), Night={night_count}/3 (req 3)")
    
    if day_count < 5:
        print(f"   ⚠️  Day shift understaffed: {day_nurses}")
        total_issues += 1
    if night_count < 3:
        print(f"   ⚠️  Night shift understaffed: {night_nurses}")
        total_issues += 1
    if night_count == 0:
        print(f"   ❌ CRITICAL: NO NIGHT SHIFTS on {date}!")
        total_issues += 1

print("\n" + "=" * 80)
print(f"Unique nurses used: {len(nurses_used)} / {len(nurses)}")
print(f"Nurses used: {sorted(list(nurses_used))[:10]}...")  # Show first 10
print("=" * 80)

if total_issues == 0:
    print("✅ ALL TESTS PASSED!")
    print("✅ Every day has proper day AND night coverage")
    print("✅ No CF codes used as shifts")
    sys.exit(0)
else:
    print(f"❌ FAILED: {total_issues} issues found")
    sys.exit(1)
