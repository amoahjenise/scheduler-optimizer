import sys
import types
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Lightweight mock modules so we can import RobustScheduler in CI without
# installing heavy third-party packages (ortools, openai …) or standing up
# a real database.
# ---------------------------------------------------------------------------


def _mock_module(name: str, **attrs):
    """Register a fake module in sys.modules with the given attributes."""
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


# -- Third-party stubs -----------------------------------------------------

_EXTERNAL = [
    "fastapi", "fastapi.responses",
    "pydantic",
    "sqlalchemy", "sqlalchemy.orm",
    "tenacity",
    "openai",
    "ortools", "ortools.sat", "ortools.sat.python", "ortools.sat.python.cp_model",
    "jose", "jose.jwt",
    "passlib", "passlib.context",
    "dotenv",
]
for mod in _EXTERNAL:
    if mod not in sys.modules:
        _mock_module(mod)

# Attributes referenced at import time
sys.modules["fastapi"].APIRouter = lambda **kw: type("R", (), {"get": lambda *a, **k: (lambda f: f), "post": lambda *a, **k: (lambda f: f), "put": lambda *a, **k: (lambda f: f), "delete": lambda *a, **k: (lambda f: f), "patch": lambda *a, **k: (lambda f: f)})()
sys.modules["fastapi"].Depends = lambda x=None: None
sys.modules["fastapi"].Header = lambda *a, **k: None
sys.modules["fastapi"].Query = lambda *a, **k: None
sys.modules["fastapi"].Body = lambda *a, **k: None
sys.modules["fastapi"].Path = lambda *a, **k: None
sys.modules["fastapi"].Request = MagicMock
sys.modules["fastapi"].UploadFile = MagicMock
sys.modules["fastapi"].File = lambda *a, **k: None
sys.modules["fastapi"].Form = lambda *a, **k: None
sys.modules["fastapi"].BackgroundTasks = MagicMock


class _HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        self.status_code = status_code
        self.detail = detail


sys.modules["fastapi"].HTTPException = _HTTPException
sys.modules["fastapi.responses"].JSONResponse = MagicMock

# Pydantic
_pydantic = sys.modules["pydantic"]
_pydantic.UUID4 = object


class _FakeBaseModel:
    """Minimal stand-in for pydantic.BaseModel so class definitions work."""
    model_config: dict = {}

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


_pydantic.BaseModel = _FakeBaseModel
_pydantic.Field = lambda *a, **k: None
_pydantic.validator = lambda *a, **k: (lambda f: f)
_pydantic.model_validator = lambda *a, **k: (lambda f: f)

# SQLAlchemy
_sa = sys.modules["sqlalchemy"]
_sa.or_ = lambda *a, **k: None
_sa.Column = MagicMock
_sa.String = MagicMock
_sa.Integer = MagicMock
_sa.Float = MagicMock
_sa.Boolean = MagicMock
_sa.DateTime = MagicMock
_sa.Text = MagicMock
_sa.ForeignKey = MagicMock
_sa.Enum = MagicMock
_sa.JSON = MagicMock
_sa.func = MagicMock()
_sa.create_engine = MagicMock
_sa_orm = sys.modules["sqlalchemy.orm"]
_sa_orm.Session = MagicMock
_sa_orm.relationship = lambda *a, **k: None
_sa_orm.joinedload = lambda *a, **k: None
_sa_orm.sessionmaker = MagicMock
_sa_orm.declarative_base = lambda: type("Base", (), {"metadata": MagicMock()})

# Tenacity
_ten = sys.modules["tenacity"]
_ten.retry = lambda *a, **k: (lambda f: f)
_ten.stop_after_attempt = lambda n: None
_ten.wait_exponential = lambda *a, **k: None

# OpenAI
sys.modules["openai"].OpenAI = lambda **kw: MagicMock()

# OR-Tools CP-SAT
_cp = sys.modules["ortools.sat.python.cp_model"]
_cp.CpModel = MagicMock
_cp.CpSolver = MagicMock
_cp.OPTIMAL = 4
_cp.FEASIBLE = 2

# jose / passlib / dotenv
sys.modules["jose"].jwt = MagicMock()
sys.modules["jose.jwt"].decode = MagicMock()
sys.modules["passlib.context"].CryptContext = MagicMock
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

# -- Internal app package scaffolding --------------------------------------
# We must register the package hierarchy in sys.modules so Python knows
# about it, BUT we point __path__ at the real filesystem so that the
# *real* optimized_schedule.py can be discovered as a sub-module.

import os as _os
_BACKEND = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

_APP_PACKAGES = {
    "app": _os.path.join(_BACKEND, "app"),
    "app.db": _os.path.join(_BACKEND, "app", "db"),
    "app.core": _os.path.join(_BACKEND, "app", "core"),
    "app.api": _os.path.join(_BACKEND, "app", "api"),
    "app.api.routes": _os.path.join(_BACKEND, "app", "api", "routes"),
    "app.models": _os.path.join(_BACKEND, "app", "models"),
    "app.schemas": _os.path.join(_BACKEND, "app", "schemas"),
    "app.services": _os.path.join(_BACKEND, "app", "services"),
    "app.utils": _os.path.join(_BACKEND, "app", "utils"),
}
for pkg, path in _APP_PACKAGES.items():
    if pkg not in sys.modules:
        m = _mock_module(pkg)
        m.__path__ = [path]
        m.__package__ = pkg

# -- Internal app leaf modules ---------------------------------------------

# Database
_mock_module("app.db.database", Base=MagicMock(), SessionLocal=MagicMock(), engine=MagicMock())
_mock_module("app.db.deps", get_db=MagicMock())

# Core
_mock_module("app.core.config", settings=MagicMock())
_mock_module("app.core.auth",
             get_optional_auth=MagicMock(), AuthContext=MagicMock,
             get_current_user=MagicMock(), verify_token=MagicMock())

# Models
_mock_module("app.models.optimized_schedule", OptimizedSchedule=MagicMock())
_mock_module("app.models.system_prompt", SystemPrompt=MagicMock())
_mock_module("app.models.organization",
             Organization=MagicMock(), OrganizationMember=MagicMock(), MemberRole=MagicMock())
_mock_module("app.models.deletion_activity", DeletionActivity=MagicMock())
_mock_module("app.models.shift_code",
             ShiftCode=MagicMock(), TimeSlot=MagicMock(), ShiftType=MagicMock())
_mock_module("app.models.nurse", Nurse=MagicMock())
_mock_module("app.models.patient", Patient=MagicMock())
_mock_module("app.models.handover", Handover=MagicMock())
_mock_module("app.models.user", User=MagicMock())

# Schemas
_mock_module("app.schemas.optimized_schedule",
             OptimizeRequest=MagicMock(), OptimizeResponse=MagicMock(),
             RefineRequest=MagicMock(), InsightsRequest=MagicMock())
_mock_module("app.schemas.system_prompt",
             SystemPrompt=MagicMock(), SystemPromptUpdate=MagicMock())

# Routes (imported by optimized_schedule)
_mock_module("app.api.routes.system_prompts",
             get_system_prompt=MagicMock(), DEFAULT_PROMPT_CONTENT="",
             build_default_prompt_content=MagicMock(), router=MagicMock())

# Services
_mock_module("app.services.deletion_activity", record_deletion_activity=MagicMock())
_mock_module("app.services.self_scheduling",
             SelfSchedulingEngine=MagicMock(), NurseSubmission=MagicMock(),
             ShiftPreference=MagicMock(), RotationPreference=MagicMock(),
             ShiftTypeChoice=MagicMock(), OptimizationConfig=MagicMock(),
             convert_legacy_preferences_to_submissions=MagicMock())

# Utils (may be imported transitively)
_mock_module("app.utils.audit", log_audit=MagicMock())

# ---------------------------------------------------------------------------
# NOW safe to import the scheduler class
# ---------------------------------------------------------------------------
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
