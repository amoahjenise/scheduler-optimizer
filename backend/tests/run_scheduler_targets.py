import sys
from app.api.routes.optimized_schedule import RobustScheduler


def make_dates(n):
    from datetime import datetime, timedelta
    start = datetime(2026, 3, 1)
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def run():
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

    try:
        assert abs(rs.get_max_hours("Alice") - 38.0) < 1e-6
        assert abs(rs.get_target_weekly_hours("Alice") - 37.5) < 1e-6
        assert abs(rs.get_target_biweekly_hours("Alice") - 75.0) < 1e-6
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(2)

    print("TEST PASSED")
    sys.exit(0)

if __name__ == '__main__':
    run()
