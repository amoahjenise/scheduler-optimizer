"""Verify that nurses on leave are removed from schedules on (re)optimization."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.routes.optimized_schedule import apply_org_leave_status, RobustScheduler


class FakeNurseRow:
    def __init__(self, name, maternity=False, sick=False, sabbatical=False):
        self.name = name
        self.is_on_maternity_leave = maternity
        self.is_on_sick_leave = sick
        self.is_on_sabbatical = sabbatical


class FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows


class FakeDB:
    def __init__(self, rows):
        self._rows = rows

    def query(self, *args, **kwargs):
        return FakeQuery(self._rows)


def test_stale_payload_is_corrected_from_db():
    """Frontend sent no leave flag for Tiffany, DB says maternity leave."""
    db = FakeDB([
        FakeNurseRow("Tiffany Glodoviza", maternity=True),
        FakeNurseRow("Katryn Turriff"),
    ])
    nurses = [
        {"name": "Tiffany Glodoviza"},          # no leave flags at all
        {"name": "Katryn Turriff", "isOnSickLeave": False},
    ]
    assignments = {
        "Tiffany Glodoviza": ["Z07", "Z07", "Z19"],
        "Katryn Turriff": ["Z07", "", "Z07"],
    }

    on_leave = apply_org_leave_status(nurses, assignments, "org-1", db)

    assert on_leave == {"tiffany glodoviza"}, on_leave
    assert nurses[0]["isOnMaternityLeave"] is True
    assert nurses[1]["isOnMaternityLeave"] is False
    # Carried-over shifts must be wiped so re-optimization cannot keep them
    assert assignments["Tiffany Glodoviza"] == ["", "", ""], assignments
    assert assignments["Katryn Turriff"] == ["Z07", "", "Z07"]
    print("PASS: stale frontend payload corrected from DB")


def test_accent_and_case_insensitive_match():
    db = FakeDB([FakeNurseRow("Renée O'Brien", sick=True)])
    nurses = [{"name": "renee o'brien"}]
    assignments = {"renee o'brien": ["Z07", "Z07"]}

    on_leave = apply_org_leave_status(nurses, assignments, "org-1", db)

    assert len(on_leave) == 1, on_leave
    assert nurses[0]["isOnSickLeave"] is True
    assert assignments["renee o'brien"] == ["", ""]
    print("PASS: accent/case-insensitive name matching")


def test_returned_to_work_clears_leave():
    """DB says available; a stale 'true' flag from the client must not stick."""
    db = FakeDB([FakeNurseRow("Sabah Kihal", maternity=False)])
    nurses = [{"name": "Sabah Kihal", "isOnMaternityLeave": True}]

    on_leave = apply_org_leave_status(nurses, None, "org-1", db)

    assert on_leave == set(), on_leave
    assert nurses[0]["isOnMaternityLeave"] is False
    print("PASS: returning from leave re-enables scheduling")


def test_scheduler_gives_on_leave_nurse_all_off():
    """End-to-end: RobustScheduler must produce zero worked shifts."""
    dates = ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]
    nurses = [
        {"name": "Tiffany Glodoviza", "employmentType": "full-time",
         "maxWeeklyHours": 75, "isOnMaternityLeave": True},
        {"name": "Katryn Turriff", "employmentType": "full-time", "maxWeeklyHours": 75},
        {"name": "Sabah Kihal", "employmentType": "full-time", "maxWeeklyHours": 75},
        {"name": "Rita Diaco", "employmentType": "full-time", "maxWeeklyHours": 75},
    ]

    scheduler = RobustScheduler(
        nurses=nurses,
        date_list=dates,
        day_shift_codes=["Z07"],
        night_shift_codes=["Z19", "Z23 B", "Z23"],
        shifts_info={},
        day_req=1,
        night_req=1,
        max_consecutive=3,
        preferences={"Tiffany Glodoviza": ["Z07", "Z07", "Z07", "Z07"]},
    )
    schedule = scheduler.build_schedule()

    tiffany = schedule["Tiffany Glodoviza"]
    worked = [s for s in tiffany if s and s.get("hours", 0) > 0]
    assert not worked, f"on-leave nurse still scheduled: {worked}"

    others = sum(
        1
        for name, row in schedule.items()
        if name != "Tiffany Glodoviza"
        for s in row
        if s and s.get("hours", 0) > 0
    )
    assert others > 0, "available nurses should still be scheduled"
    print(f"PASS: on-leave nurse all-OFF, {others} shifts covered by available nurses")


if __name__ == "__main__":
    test_stale_payload_is_corrected_from_db()
    test_accent_and_case_insensitive_match()
    test_returned_to_work_clears_leave()
    test_scheduler_gives_on_leave_nurse_all_off()
    print("\nAll leave-enforcement tests passed.")
