import pytest
from app.api.routes.optimized_schedule import RobustScheduler


def make_dates(n):
    from datetime import datetime, timedelta
    start = datetime(2026, 3, 1)
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def test_targets_and_max_hours():
    nurses = [
        {
            "name": "Alice",
            # maxWeeklyHours is expected to be a WEEKLY cap in the backend
            "maxWeeklyHours": 38.0,
            # provide bi-weekly explicit target
            "targetBiWeeklyHours": 75.0,
            "employmentType": "FT",
        }
    ]
    dates = make_dates(14)
    # minimal shifts_info
    shifts_info = {"Z07": {"hours": 11.25}, "07": {"hours": 7.5}}

    rs = RobustScheduler(
        nurses=nurses,
        date_list=dates,
        day_shift_codes=["Z07", "07"],
        night_shift_codes=["Z19", "23"],
        shifts_info=shifts_info,
        day_req=2,
        night_req=1,
    )

    # get_max_hours should return the provided weekly cap
    assert rs.get_max_hours("Alice") == pytest.approx(38.0)

    # get_target_weekly_hours should derive weekly from bi-weekly target (75/2=37.5)
    assert rs.get_target_weekly_hours("Alice") == pytest.approx(37.5)

    # get_target_biweekly_hours should return the explicit bi-weekly value
    assert rs.get_target_biweekly_hours("Alice") == pytest.approx(75.0)
