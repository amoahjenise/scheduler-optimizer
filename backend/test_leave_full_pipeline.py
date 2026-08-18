"""Full-pipeline check: nurses on leave must never appear in an optimized schedule.

Unlike test_reoptimize_leave_integration.py (which only exercises
RobustScheduler.build_schedule), this runs ScheduleOptimizer.optimize_schedule_with_ortools
-- the same path the /optimize endpoint uses, including the coverage-patch,
target-balancing and under-target-fill passes that run afterwards.
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.disable(logging.CRITICAL)

from app.db.database import SessionLocal
from app.models.nurse import Nurse
from app.models.optimized_schedule import OptimizedSchedule
from app.api.routes.optimized_schedule import (
    ScheduleOptimizer,
    apply_org_leave_status,
)

SCHEDULE_ID = "aadf8080-ab58-4230-9c5f-5c1a740222d6"


def main():
    db = SessionLocal()
    try:
        row = db.query(OptimizedSchedule).filter(
            OptimizedSchedule.id == SCHEDULE_ID
        ).first()
        assert row is not None, "test schedule not found"

        sd = (row.result or {}).get("schedule_data") or {}
        if isinstance(sd, str):
            sd = json.loads(sd)
        dates = sd.get("dates") or []
        grid = sd.get("grid") or sd.get("schedule") or []
        if not dates or not grid:
            print("SKIP: seeded schedule_data is missing dates/grid for this schedule id")
            return
        org_id = row.organization_id

        assignments = {}
        for entry in grid:
            name = entry.get("nurse")
            if not name:
                continue
            codes = [""] * len(dates)
            for shift in entry.get("shifts", []):
                d = shift.get("date")
                if d in dates:
                    codes[dates.index(d)] = str(shift.get("shift") or "")
            assignments[name] = codes

        db_nurses = db.query(Nurse).filter(Nurse.organization_id == org_id).all()
        on_leave_names = [
            n.name for n in db_nurses
            if n.is_on_maternity_leave or n.is_on_sick_leave or n.is_on_sabbatical
        ]
        print(f"Schedule {dates[0]}..{dates[-1]} ({len(dates)} days), {len(grid)} nurses")
        print(f"On leave: {on_leave_names}")
        assert on_leave_names, "no nurse on leave; nothing to verify"

        # Frontend-style payload with NO leave flags (the stale case).
        nurses_payload = [
            {
                "name": n.name,
                "employmentType": n.employment_type,
                "maxWeeklyHours": n.bi_weekly_target_hours or 75,
                "targetBiWeeklyHours": n.bi_weekly_target_hours or 75,
            }
            for n in db_nurses
            if n.name in assignments
        ]

        # Hardest case on purpose: mark the nurses as on leave but leave their
        # previous shifts in `assignments` untouched. The authoritative OCR
        # overlay will try to re-apply exactly those shifts, so this proves the
        # final enforcement sweep wins over every later pass.
        apply_org_leave_status(nurses_payload, None, org_id, db)
        still_assigned = sum(
            1
            for name in on_leave_names
            for c in assignments.get(name, [])
            if c and c.upper() not in ("", "OFF", "C")
        )
        print(f"Old shifts still present in the OCR payload: {still_assigned}")
        assert still_assigned > 0, "expected carried-over shifts for a meaningful test"

        constraints = {
            "nurses": nurses_payload,
            "dateRange": {"start": dates[0], "end": dates[-1]},
            "dates": dates,
            "shiftRequirements": {
                "dayShift": {"count": 5, "shiftCodes": ["Z07", "07"]},
                "nightShift": {"count": 3, "shiftCodes": ["Z19", "Z23 B", "Z23"]},
            },
            "constraints": {"maxConsecutiveWorkDays": 3},
            "shiftsInfo": {},
        }

        schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
            assignments, constraints
        )

        failures = []
        for name in on_leave_names:
            worked = [
                s for s in schedule.get(name, [])
                if s and float(s.get("hours", 0) or 0) > 0
            ]
            print(f"  '{name}' working shifts after FULL pipeline: {len(worked)}")
            if worked:
                failures.append((name, worked[:3]))

        covered = sum(
            1
            for name, r in schedule.items()
            if name not in on_leave_names
            for s in r
            if s and float(s.get("hours", 0) or 0) > 0
        )
        print(f"Shifts covered by available nurses: {covered}")

        assert not failures, f"FAIL: on-leave nurses still scheduled: {failures}"
        assert covered > 0, "FAIL: no coverage produced"
        print("\nPASS: full optimize pipeline keeps nurses on leave completely off.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
