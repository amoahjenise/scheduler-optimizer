"""Integration check against the real Aug 16 - Sep 12 schedule.

Reproduces the reported bug: a nurse switched to maternity leave was still
kept in the schedule when it was re-optimized.
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.disable(logging.CRITICAL)  # keep output readable

from app.db.database import SessionLocal
from app.models.nurse import Nurse
from app.models.optimized_schedule import OptimizedSchedule
from app.api.routes.optimized_schedule import (
    RobustScheduler,
    apply_org_leave_status,
)

SCHEDULE_ID = "aadf8080-ab58-4230-9c5f-5c1a740222d6"


def load_schedule(db):
    row = db.query(OptimizedSchedule).filter(
        OptimizedSchedule.id == SCHEDULE_ID
    ).first()
    assert row is not None, "test schedule not found"
    sd = (row.result or {}).get("schedule_data") or {}
    if isinstance(sd, str):
        sd = json.loads(sd)
    return row, sd


def main():
    db = SessionLocal()
    try:
        row, sd = load_schedule(db)
        org_id = row.organization_id
        dates = sd.get("dates") or []
        grid = sd.get("grid") or sd.get("schedule") or []

        # Rebuild the "existing assignments" exactly as a re-optimize would.
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
        print(f"Schedule: {dates[0]} .. {dates[-1]} ({len(dates)} days), {len(grid)} nurses")
        print(f"Nurses on leave in DB: {on_leave_names or 'none'}")
        assert on_leave_names, "no nurse is on leave; set one to reproduce"

        target = on_leave_names[0]
        for name in on_leave_names:
            before_n = sum(
                1 for c in assignments.get(name, [])
                if c and c.upper() not in ("", "OFF", "C") and not c.upper().startswith("CF")
            )
            print(f"  '{name}' shifts in the SAVED schedule: {before_n}")

        # Payload as the frontend sends it (leave flags intentionally absent,
        # which is exactly what caused the bug).
        nurses_payload = [
            {
                "name": n.name,
                "employmentType": n.employment_type,
                "maxWeeklyHours": n.bi_weekly_target_hours or 75,
            }
            for n in db_nurses
            if n.name in assignments
        ]

        apply_org_leave_status(nurses_payload, assignments, org_id, db)

        scheduler = RobustScheduler(
            nurses=nurses_payload,
            date_list=dates,
            day_shift_codes=["Z07", "07"],
            night_shift_codes=["Z19", "Z23 B", "Z23"],
            shifts_info={},
            day_req=5,
            night_req=3,
            max_consecutive=3,
            preferences=assignments,
        )
        schedule = scheduler.build_schedule()

        failures = []
        for name in on_leave_names:
            after = [s for s in schedule.get(name, []) if s and s.get("hours", 0) > 0]
            print(f"  '{name}' shifts AFTER re-optimization: {len(after)}")
            if after:
                failures.append((name, after[:3]))

        covered = sum(
            1
            for name, r in schedule.items()
            if name not in on_leave_names
            for s in r
            if s and s.get("hours", 0) > 0
        )
        print(f"Shifts covered by available nurses: {covered}")

        assert not failures, f"FAIL: nurses on leave still scheduled: {failures}"
        assert covered > 0, "FAIL: no coverage produced"
        print(
            f"\nPASS: all {len(on_leave_names)} nurse(s) on leave removed "
            f"and their work redistributed."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
