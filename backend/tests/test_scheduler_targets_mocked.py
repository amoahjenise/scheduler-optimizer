import sys
import types

# Insert lightweight mock modules to avoid heavy runtime deps during test import
for mod in [
    "fastapi",
    "pydantic",
    "sqlalchemy",
    "tenacity",
    "openai",
    "ortools",
    "ortools.sat",
    "ortools.sat.python",
    "ortools.sat.python.cp_model",
]:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

# Minimal attributes used at import time
fastapi = sys.modules["fastapi"]
fastapi.APIRouter = lambda **kwargs: None
fastapi.Depends = lambda x=None: None
class HTTPException(Exception):
    pass
fastapi.HTTPException = HTTPException
fastapi.Header = lambda *args, **kwargs: None

pydantic = sys.modules["pydantic"]
setattr(pydantic, "UUID4", object)

sqlalchemy = sys.modules["sqlalchemy"]
setattr(sqlalchemy, "or_", lambda *args, **kwargs: None)

tenacity = sys.modules["tenacity"]
setattr(tenacity, "retry", lambda *args, **kwargs: (lambda f: f))
setattr(tenacity, "stop_after_attempt", lambda n: None)
setattr(tenacity, "wait_exponential", lambda *args, **kwargs: None)

openai = sys.modules["openai"]
setattr(openai, "OpenAI", lambda **kwargs: None)

# CP-SAT mock
cp_model_mod = sys.modules["ortools.sat.python.cp_model"]
setattr(cp_model_mod, "CpModel", object)
setattr(cp_model_mod, "CpSolver", object)

# Now import the scheduler module under test
from app.api.routes.optimized_schedule import RobustScheduler


def make_dates(n):
    from datetime import datetime, timedelta
    start = datetime(2026, 3, 1)
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def test_mocked_scheduler_targets():
    nurses = [
        {
            "name": "Alice",
            # Provide weekly max (backend expects weekly cap in `maxWeeklyHours`)
            "maxWeeklyHours": 38.0,
            # Provide explicit bi-weekly target
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

    assert abs(rs.get_max_hours("Alice") - 38.0) < 1e-6
    assert abs(rs.get_target_weekly_hours("Alice") - 37.5) < 1e-6
    assert abs(rs.get_target_biweekly_hours("Alice") - 75.0) < 1e-6
