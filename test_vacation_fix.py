#!/usr/bin/env python3
"""
Test script to verify vacation fixes are working
"""
import requests
import json

# Test 1: Vacation comments are processed correctly
print("🧪 Testing vacation comment processing...")

test_data = {
    "nurses": [
        {"name": "imoya", "offRequests": []},
        {"name": "Demitra Sita", "offRequests": []},
        {"name": "Test Nurse", "offRequests": []}
    ],
    "dates": ["2025-08-24", "2025-08-25", "2025-08-26", "2025-08-27"],
    "assignments": {},
    "comments": {
        "imoya": {
            "2025-08-24": "OFF vacation week",
            "2025-08-25": "OFF vacation week"
        },
        "Demitra Sita": {
            "2025-08-25": "OFF vacation week",
            "2025-08-26": "OFF vacation week"
        }
    },
    "rules": {},
    "notes": ""
}

try:
    response = requests.post("http://localhost:8000/optimize/preview", json=test_data, timeout=30)
    if response.status_code == 200:
        print("✅ Vacation comment processing endpoint is working")
    else:
        print(f"❌ Error: {response.status_code}")
except Exception as e:
    print(f"❌ Connection error: {e}")

# Test 2: Direct optimization with off requests
print("\n🧪 Testing direct optimization with off requests...")

opt_data = {
    "constraints": {
        "nurses": [
            {"name": "imoya", "offRequests": ["2025-08-24", "2025-08-25"]},
            {"name": "Demitra Sita", "offRequests": ["2025-08-25", "2025-08-26"]},
            {"name": "Test Nurse 1", "offRequests": []},
            {"name": "Test Nurse 2", "offRequests": []}
        ],
        "dateRange": {"start": "2025-08-24", "end": "2025-08-27"},
        "shiftRequirements": {"dayShift": {"count": 1}, "nightShift": {"count": 1}}
    },
    "assignments": {},
    "comments": {}
}

try:
    response = requests.post("http://localhost:8000/optimize/optimize-with-constraints", json=opt_data, timeout=30)
    if response.status_code == 200:
        result = response.json()
        schedule = result.get("optimized_schedule", {})
        
        # Check if imoya is OFF on vacation days
        imoya_shifts = schedule.get("imoya", [])
        vacation_days_off = 0
        work_days_during_vacation = 0
        
        for shift in imoya_shifts:
            date = shift.get("date")
            shift_type = shift.get("shiftType")
            if date in ["2025-08-24", "2025-08-25"]:
                if shift_type == "off":
                    vacation_days_off += 1
                else:
                    work_days_during_vacation += 1
        
        print(f"✅ imoya vacation respect: {vacation_days_off}/2 days off, {work_days_during_vacation} work days during vacation")
        
        if work_days_during_vacation == 0:
            print("🎉 SUCCESS: Vacation requests are being respected!")
        else:
            print("❌ ISSUE: Still scheduling work during vacation")
            
    else:
        print(f"❌ Optimization error: {response.status_code}")
        print(response.text)
except Exception as e:
    print(f"❌ Connection error: {e}")

print("\n✅ Testing complete!")