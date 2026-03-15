#!/usr/bin/env python3
"""Test RobustScheduler directly"""

import sys
sys.path.insert(0, '.')

from app.api.routes.optimized_schedule import RobustScheduler

# Test with minimal data
nurses = [
    {'name': 'Nurse A', 'offRequests': []},
    {'name': 'Nurse B', 'offRequests': []},
    {'name': 'Nurse C', 'offRequests': []},
    {'name': 'Nurse D', 'offRequests': []},
    {'name': 'Nurse E', 'offRequests': []},
    {'name': 'Nurse F', 'offRequests': []},
    {'name': 'Nurse G', 'offRequests': []},
    {'name': 'Nurse H', 'offRequests': []},
]
dates = ['2025-08-24', '2025-08-25', '2025-08-26']
day_codes = ['ZD12-', 'D8-']
night_codes = ['ZN-', 'N8-']
shifts_info = {
    'ZD12-': {'hours': 12, 'startTime': '07:00', 'endTime': '19:00', 'type': 'day'},
    'ZN-': {'hours': 12, 'startTime': '23:00', 'endTime': '07:00', 'type': 'night'},
}

scheduler = RobustScheduler(
    nurses=nurses,
    date_list=dates,
    day_shift_codes=day_codes,
    night_shift_codes=night_codes,
    shifts_info=shifts_info,
    day_req=5,
    night_req=3,
)

schedule = scheduler.build_schedule()

print('\n=== OUTPUT ===')
for date in dates:
    day_nurses = []
    night_nurses = []
    for nurse, shifts in schedule.items():
        for s in shifts:
            if s['date'] == date:
                if s['shiftType'] == 'day':
                    day_nurses.append(f"{nurse}: {s['shift']}")
                elif s['shiftType'] == 'night':
                    night_nurses.append(f"{nurse}: {s['shift']}")
    print(f"\n{date}:")
    print(f"  DAY ({len(day_nurses)}): {day_nurses}")
    print(f"  NIGHT ({len(night_nurses)}): {night_nurses}")
