#!/usr/bin/env python3
"""Test that OFF requests are properly respected"""
import requests
import json

payload = {
    "nurses": [
        {"id": "1", "name": "Imoya", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": ["2025-08-24", "2025-08-25", "2025-08-26", "2025-08-27"]},
        {"id": "2", "name": "Demitra Sita", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": ["2025-08-25", "2025-08-26", "2025-08-27", "2025-08-28"]},
        {"id": "3", "name": "Test Nurse A", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "4", "name": "Test Nurse B", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "5", "name": "Test Nurse C", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "6", "name": "Test Nurse D", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "7", "name": "Test Nurse E", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "8", "name": "Test Nurse F", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "9", "name": "Test Nurse G", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
        {"id": "10", "name": "Test Nurse H", "isChemoCertified": False, "employmentType": "full-time", "maxWeeklyHours": 60, "offRequests": []},
    ],
    "dates": ["2025-08-24", "2025-08-25", "2025-08-26", "2025-08-27", "2025-08-28"],
    "assignments": {},
    "comments": {},
    "rules": {},
    "notes": "",
    "staffRequirements": {"minDayStaff": 5, "minNightStaff": 3}
}

print("Testing OFF requests...")
print("Imoya should be OFF on: 2025-08-24, 2025-08-25, 2025-08-26, 2025-08-27")
print("Demitra Sita should be OFF on: 2025-08-25, 2025-08-26, 2025-08-27, 2025-08-28")
print()

try:
    resp = requests.post("http://localhost:8000/optimize/optimize-with-constraints", json=payload, timeout=60)
    data = resp.json()
    
    if "optimized_schedule" in data:
        for nurse_name in ["Imoya", "Demitra Sita"]:
            shifts = data["optimized_schedule"].get(nurse_name, [])
            print(f"\n{nurse_name}:")
            for shift in shifts:
                date = shift.get("date")
                shift_type = shift.get("shiftType")
                print(f"  {date}: {shift_type}")
                if shift_type != "off":
                    # Check if this was an OFF request date
                    off_dates = [n["offRequests"] for n in payload["nurses"] if n["name"] == nurse_name][0]
                    if date in off_dates:
                        print(f"    ❌ ERROR: Should be OFF on this date!")
    else:
        print("Error:", data)
except Exception as e:
    print(f"Error: {e}")
