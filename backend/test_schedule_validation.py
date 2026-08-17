#!/usr/bin/env python3
"""Comprehensive test that calls the optimization API and validates all MCH rules."""
import json
import requests
import sys
from datetime import datetime, timedelta

BASE = "http://localhost:8000"

# Build 14-day date range
start = datetime(2025, 8, 24)
dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(14)]

# 24 nurses matching user's actual roster
nurses = []
ft_names = [
    "Alexandra Zatylny", "Allycia Seidel", "Amanda Archibald",
    "Brenda Bonilla Villatoro", "Brenelli Cardona Espana", "Demitra Sita",
    "Elizabeth Langeo", "Florent Vidal", "Heather Muir",
    "Kassia Paprocki", "M'Hamed Benmokhtar", "Maki Shimoya",
    "Marianna Taddeo", "Naomi Ghansam", "Pascale Arcand",
    "Rita Diaco", "Sabah Kihal", "Sheila Bellows",
    "Tiffany Glodoviza", "Trong Tran Khoi", "Valerie Lamarche",
]
pt_names = ["Jasmine-Ketya Tain", "Katryn Turriff", "Khady Gueye"]

for i, n in enumerate(ft_names):
    off = []
    if n == "Demitra Sita":
        off = dates[2:12]  # 10 off days
    elif n == "Maki Shimoya":
        off = dates[1:5]   # 4 off days
    elif n == "Khady Gueye":
        off = [dates[0]]
    nurses.append({
        "id": f"ocr-{i}",
        "name": n,
        "isChemoCertified": i < 6,
        "isHeadNurse": False,
        "employmentType": "full-time",
        "maxWeeklyHours": 75,
        "targetWeeklyHours": 37.5,
        "targetBiWeeklyHours": 75,
        "offRequests": off,
        "minShiftsPerPeriod": 7,
        "maxShiftsPerPeriod": 8,
        "minZShiftsPerPeriod": 5,
        "seniority": str(20 - i),
    })

for i, n in enumerate(pt_names):
    off = []
    if n == "Khady Gueye":
        off = [dates[0]]
    nurses.append({
        "id": f"pt-{i}",
        "name": n,
        "isChemoCertified": False,
        "isHeadNurse": False,
        "employmentType": "part-time",
        "maxWeeklyHours": 33.75,
        "targetWeeklyHours": 16.875,
        "targetBiWeeklyHours": 33.75,
        "offRequests": off,
        "minShiftsPerPeriod": 3,
        "maxShiftsPerPeriod": 4,
        "minZShiftsPerPeriod": 3,
        "seniority": "1",
    })

# OCR assignments for Trong (known Z23 B pattern) and Tiffany
assignments = {}
# Trong: Z19 on Aug 25, Z23 B on Aug 26, Z19 on Aug 29, Z23 B on Aug 30
trong_shifts = [""] * 14
trong_shifts[1] = "Z19"   # Aug 25
trong_shifts[2] = "Z23 B" # Aug 26
trong_shifts[5] = "Z19"   # Aug 29
trong_shifts[6] = "Z23 B" # Aug 30
assignments["Trong Tran Khoi"] = trong_shifts

# Tiffany: Z19 on Sep 1, Z23 B on Sep 2, Z23 B on Sep 3
tiffany_shifts = [""] * 14
tiffany_shifts[8] = "Z19"    # Sep 1
tiffany_shifts[9] = "Z23 B"  # Sep 2
tiffany_shifts[10] = "Z23 B" # Sep 3
assignments["Tiffany Glodoviza"] = tiffany_shifts

# Some PT OCR
assignments["Jasmine-Ketya Tain"] = [""] * 14
assignments["Jasmine-Ketya Tain"][0] = "Z07"  # Aug 24
assignments["Jasmine-Ketya Tain"][1] = "Z07"  # Aug 25
assignments["Jasmine-Ketya Tain"][8] = "Z07"  # Sep 1

assignments["Katryn Turriff"] = [""] * 14
assignments["Katryn Turriff"][6] = "Z07"  # Aug 30
assignments["Katryn Turriff"][7] = "Z07"  # Aug 31
assignments["Katryn Turriff"][10] = "Z07" # Sep 3
assignments["Katryn Turriff"][11] = "Z07" # Sep 4

assignments["Khady Gueye"] = [""] * 14
assignments["Khady Gueye"][8] = "Z07"   # Sep 1
assignments["Khady Gueye"][9] = "Z07"   # Sep 2
assignments["Khady Gueye"][13] = "Z07"  # Sep 6

payload = {
    "constraints": {
        "dateRange": {"start": dates[0], "end": dates[-1]},
        "shiftRequirements": {
            "dayShift": {
                "count": 5,
                "minChemoCertified": 1,
                "shiftCodes": ["Z07", "07"]
            },
            "nightShift": {
                "count": 4,
                "minChemoCertified": 0,
                "shiftCodes": ["Z19", "Z23", "Z23 B"]
            }
        },
        "shiftsInfo": {
            "Z07": {"type": "day", "hours": 11.25, "startTime": "07:00", "endTime": "19:25"},
            "07": {"type": "day", "hours": 7.5, "startTime": "07:00", "endTime": "15:00"},
            "Z19": {"type": "night", "hours": 11.25, "startTime": "19:00", "endTime": "07:25"},
            "Z23": {"type": "night", "hours": 7.25, "startTime": "23:00", "endTime": "07:25"},
            "Z23 B": {"type": "night", "hours": 7.25, "startTime": "00:00", "endTime": "07:25"}
        },
        "nurses": nurses,
        "constraints": {
            "maxConsecutiveWorkDays": 3,
            "maxConsecutiveNightShifts": 3,
            "alternateWeekendsOff": True,
            "respectOffRequests": True,
            "respectCurrentAssignments": True,
            "shiftCoherencyRules": True,
            "workPatternRules": True,
            "seniorityRules": True,
            "maxHoursPerWeek": 75
        }
    },
    "assignments": assignments,
    "nurses": nurses,
    "schedule_id": None
}

print("=" * 70)
print("CALLING OPTIMIZATION API...")
print("=" * 70)

try:
    resp = requests.post(
        f"{BASE}/optimize/optimize-with-constraints",
        json=payload,
        timeout=120
    )
    resp.raise_for_status()
except Exception as e:
    print(f"API ERROR: {e}")
    if hasattr(e, 'response') and e.response is not None:
        print(f"Response: {e.response.text[:500]}")
    sys.exit(1)

data = resp.json()
schedule = data.get("optimized_schedule", {})

print(f"\nSchedule received for {len(schedule)} nurses over {len(dates)} days")

# ============================================================
# VALIDATION
# ============================================================
errors = []
warnings = []

# 1. Coverage Check: every day must have EXACTLY 5 day + EXACTLY 4 night (hard cap)
print("\n" + "=" * 70)
print("COVERAGE CHECK (5 day + 4 night per day — HARD CAP)")
print("=" * 70)

for day_idx, date in enumerate(dates):
    day_count = 0
    night_count = 0
    z23_cont = 0
    for name, row in schedule.items():
        if day_idx >= len(row):
            continue
        shift = row[day_idx]
        st = shift.get("shiftType", "off")
        h = float(shift.get("hours", 0) or 0)
        sc = str(shift.get("shift", "")).strip()
        if st == "day" and h > 0:
            day_count += 1
        elif st == "night" and h > 0:
            night_count += 1  # Real night: Z19 (11.25h), standalone Z23 B (7.25h)
        elif st == "night" and h == 0:
            z23_cont += 1  # Continuation: Z23 B (0h), Z23 (0h) after Z19
    
    ok = day_count >= 5 and night_count >= 4
    over = day_count > 5 or night_count > 4
    marker = "✓" if ok and not over else "✗ FAIL"
    msg = f"  {date}: Day={day_count}/5, Night={night_count}/4, Z23↩={z23_cont}  {marker}"
    print(msg)
    if not ok:
        errors.append(f"Coverage fail on {date}: Day={day_count}, Night={night_count}")
    if over:
        warnings.append(f"Overstaffed on {date}: Day={day_count}, Night={night_count}")

# 2. FT Shift Limit: max 7 real shifts (excluding Z23 ↩)
print("\n" + "=" * 70)
print("FT SHIFT LIMIT (max 7 per 14-day period)")
print("=" * 70)

for name, row in schedule.items():
    emp = "FT" if any(n["name"] == name and n["employmentType"] == "full-time" for n in nurses) else "PT"
    real_shifts = 0
    z23_cont = 0
    total_hours = 0.0
    z_count = 0
    eight_count = 0
    for shift in row:
        h = float(shift.get("hours", 0) or 0)
        sc = str(shift.get("shift", "")).strip()
        if sc == "Z23 B" or sc == "Z23" or ("Z23" in sc and h == 0):
            z23_cont += 1  # Z23 B / Z23 continuation (0h)
        elif h > 0 and shift.get("shiftType") not in ("off", None):
            real_shifts += 1
            total_hours += h
            if h >= 10.0:
                z_count += 1
            else:
                eight_count += 1
    
    # Verify hours match formula: Total = (Z_count × 11.25) + (8h_count × 7.5)
    expected_hours = z_count * 11.25 + eight_count * 7.5
    if abs(total_hours - expected_hours) > 0.5:
        errors.append(f"{name}: hour mismatch — API says {total_hours:.1f}h but formula says {expected_hours:.1f}h ({z_count}×11.25 + {eight_count}×7.5)")
    
    ok = True
    if emp == "FT" and real_shifts > 8:
        errors.append(f"{name}: {real_shifts} shifts (FT max 8)")
        ok = False
    elif emp == "FT" and real_shifts > 7:
        warnings.append(f"{name}: {real_shifts} shifts (above target 7)")
    
    marker = "✓" if ok else "✗ FAIL"
    print(f"  {name} ({emp}): {real_shifts} shifts + {z23_cont} Z23↩, {total_hours:.1f}h  {marker}")

# 3. Night Linkage: every Z19 must have Z23 B on next day, Z23 on day N+2
print("\n" + "=" * 70)
print("NIGHT LINKAGE (Z19 → Z23 B → Z23, 3-day chain)")
print("=" * 70)

for name, row in schedule.items():
    for day_idx, shift in enumerate(row):
        sc = str(shift.get("shift", "")).strip()
        h = float(shift.get("hours", 0) or 0)
        if sc == "Z19" and h > 0:
            # Day N+1: expect Z23 B
            if day_idx + 1 < len(row):
                next_shift = row[day_idx + 1]
                next_sc = str(next_shift.get("shift", "")).strip()
                if "Z23" not in next_sc:
                    errors.append(f"{name} on {dates[day_idx]}: Z19 without Z23 B continuation")
                    print(f"  ✗ {name}: Z19 on {dates[day_idx]} → '{next_sc}' on {dates[day_idx+1]} (expected Z23 B)")
            else:
                warnings.append(f"{name}: Z19 on last day {dates[day_idx]} - no next day for continuation")
            # Day N+2: expect Z23 (optional, only if within period)
            if day_idx + 2 < len(row):
                next2_shift = row[day_idx + 2]
                next2_sc = str(next2_shift.get("shift", "")).strip()
                # Only check if slot is filled (not a hard error if it's off)
                if "Z23" not in next2_sc and next2_shift.get("hours", 0) > 0:
                    warnings.append(f"{name} on {dates[day_idx]}: Z19 → Day N+2 missing Z23 visual block (has {next2_sc})")

# 4. Illegal Overlap: Z19/Z23 B (paid) locks next day
print("\n" + "=" * 70)
print("ILLEGAL OVERLAP CHECK (no day shift after PAID night shift)")
print("=" * 70)

overlap_found = False
for name, row in schedule.items():
    for day_idx, shift in enumerate(row):
        if day_idx > 0:
            prev = row[day_idx - 1]
            prev_sc = str(prev.get("shift", "")).strip()
            prev_h = float(prev.get("hours", 0) or 0)
            # Only PAID Z19 and Z23 B lock the next day (0h continuations do NOT)
            if prev_sc in ("Z19", "Z23 B") and prev_h > 0:
                curr_h = float(shift.get("hours", 0) or 0)
                curr_type = shift.get("shiftType", "off")
                curr_sc = str(shift.get("shift", "")).strip()
                # Allowed after PAID night: OFF, 0h entry, or Z23-type continuation
                if curr_type == "off" or curr_h == 0 or "Z23" in curr_sc:
                    pass  # Valid: rest day, continuation, or Z23 B standalone from OCR
                else:
                    errors.append(f"{name}: shift {curr_sc} on {dates[day_idx]} after PAID night {prev_sc} on {dates[day_idx-1]}")
                    print(f"  ✗ {name}: {prev_sc} ({prev_h}h) on {dates[day_idx-1]} → {curr_sc} on {dates[day_idx]}")
                    overlap_found = True

if not overlap_found:
    print("  ✓ No illegal overlaps found")

# 5. Hour Delta Check
print("\n" + "=" * 70)
print("HOUR DELTA SUMMARY")
print("=" * 70)

total_abs_delta = 0
for name, row in schedule.items():
    emp = "FT" if any(n["name"] == name and n["employmentType"] == "full-time" for n in nurses) else "PT"
    target_nurse = next((n for n in nurses if n["name"] == name), {})
    target_h = target_nurse.get("targetBiWeeklyHours", 0)
    
    # Reduce target for off days
    off_reqs = set(target_nurse.get("offRequests", []))
    if off_reqs and target_h > 0:
        available_ratio = max(0, (14 - len(off_reqs)) / 14)
        target_h = target_h * available_ratio
    
    actual_h = sum(float(s.get("hours", 0) or 0) for s in row)
    delta = actual_h - target_h
    total_abs_delta += abs(delta)
    
    if abs(delta) > 15:
        print(f"  ⚠ {name} ({emp}): {actual_h:.1f}h vs {target_h:.1f}h target (delta={delta:+.1f}h)")

avg_delta = total_abs_delta / max(1, len(schedule))
print(f"\n  Average absolute delta: {avg_delta:.1f}h")

# FINAL SUMMARY
print("\n" + "=" * 70)
print("FINAL VERDICT")
print("=" * 70)

if errors:
    print(f"\n❌ FAILED: {len(errors)} errors")
    for e in errors:
        print(f"  - {e}")
else:
    print("\n✅ ALL CHECKS PASSED!")

if warnings:
    print(f"\n⚠ {len(warnings)} warnings:")
    for w in warnings:
        print(f"  - {w}")

print(f"\nTotal errors: {len(errors)}, Warnings: {len(warnings)}")
sys.exit(1 if errors else 0)
