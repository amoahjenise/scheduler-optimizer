#!/usr/bin/env python3
import requests
import json

# Simple test with minimal data
test_payload = {
    'schedule': {
        'Alexandra Zatylny': [
            {'date': '2025-08-24', 'shiftType': 'day', 'shift': 'D', 'hours': 12, 'startTime': '07:00', 'endTime': '19:00'},
            {'date': '2025-08-25', 'shiftType': 'night', 'shift': 'N', 'hours': 12, 'startTime': '19:00', 'endTime': '07:00'}
        ]
    },
    'refinement_request': 'remove Alexandra shifts on 2025-08-24',
    'dates': ['2025-08-24', '2025-08-25']
}

print('Sending test request...')
resp = requests.post('http://localhost:8000/optimize/refine', json=test_payload, timeout=60)
print(f'Status: {resp.status_code}')
data = resp.json()
print(f'Changes applied: {data.get("changes_applied")}')
print(f'Refined schedule nurses: {list(data.get("refined_schedule", {}).keys())}')
for nurse, shifts in data.get('refined_schedule', {}).items():
    print(f'  {nurse}: {len(shifts)} shifts')
    for s in shifts:
        print(f'    - {s.get("date")}: {s.get("shiftType")}')
print(f'\nSuggestions:')
print(json.dumps(data.get("suggestions"), indent=2))
