"""Verify seniority accrues over time and survives unrelated edits."""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.routes.nurse import _compute_live_seniority


def test_accrues_one_day():
    anchor = datetime.now(timezone.utc) - timedelta(days=1)
    assert _compute_live_seniority("3Y-283.95D", anchor) == "3Y-284.95D"
    print("PASS: +1 day accrues")


def test_accrues_fractional_day():
    anchor = datetime.now(timezone.utc) - timedelta(hours=12)
    result = _compute_live_seniority("2Y-10D", anchor)
    assert result == "2Y-10.5D", result
    print(f"PASS: half a day accrues -> {result}")


def test_days_roll_into_years():
    """283.95 + 200 days must become 4 years, not '3Y-483.95D'."""
    anchor = datetime.now(timezone.utc) - timedelta(days=200)
    result = _compute_live_seniority("3Y-283.95D", anchor)
    years = int(result.split("Y-")[0])
    days = float(result.split("Y-")[1].rstrip("D"))
    assert years == 4, result
    assert days < 365.25, result
    print(f"PASS: days roll into years -> {result}")


def test_unknown_format_untouched():
    anchor = datetime.now(timezone.utc) - timedelta(days=30)
    assert _compute_live_seniority("senior", anchor) == "senior"
    assert _compute_live_seniority("", anchor) == ""
    assert _compute_live_seniority(None, anchor) is None
    print("PASS: non-standard values left alone")


def test_no_time_travel_backwards():
    """A future anchor must not shrink seniority."""
    anchor = datetime.now(timezone.utc) + timedelta(days=5)
    assert _compute_live_seniority("1Y-5D", anchor) == "1Y-5D"
    print("PASS: future anchor does not reduce seniority")


def test_accrued_value_is_banked_on_unrelated_edit():
    """Simulates the update endpoint banking accrued time before updated_at moves."""
    stored = "3Y-100D"
    anchor = datetime.now(timezone.utc) - timedelta(days=50)

    # Unrelated edit (e.g. toggling leave) -> bank accrued value first.
    banked = _compute_live_seniority(stored, anchor)
    assert banked == "3Y-150D", banked

    # updated_at is now "now"; nothing further has accrued yet.
    assert _compute_live_seniority(banked, datetime.now(timezone.utc)) == "3Y-150D"
    print("PASS: accrued time is banked, not lost, on an unrelated edit")


if __name__ == "__main__":
    test_accrues_one_day()
    test_accrues_fractional_day()
    test_days_roll_into_years()
    test_unknown_format_untouched()
    test_no_time_travel_backwards()
    test_accrued_value_is_banked_on_unrelated_edit()
    print("\nAll seniority tests passed.")
