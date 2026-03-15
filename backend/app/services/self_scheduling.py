"""
Self-Scheduling "Preferred-First" Optimization Engine  v2
==========================================================

MCH Heme-Oncology Self-Scheduling System

Professional-grade scheduling engine using:
- **Timestamp-based Validation** (not calendar-date math)
- **Credit-based Reconciliation** (paid duration, not wall-clock)

Algorithm Stages:
-----------------
0. PRE-OPTIMIZATION: Build ShiftLibrary, compute virtual credits for OFF/VAC/STAT
1. LOCKED PASS: Assign uncontested slots (only one nurse wants that shift)
2. SENIORITY + EQUITY RESOLVER: Resolve conflicts using seniority + fulfillment equity
3. INTELLIGENT GAP FILLER: Fill remaining slots by capacity, rest, and FTE delta

Hard Constraints (FIQ Collective Agreement — "The Border"):
------------------------------------------------------------
- 50% Day Shift Guarantee (unless permanent night waiver)
- 11-hour minimum rest between shifts (timestamp-based)
- Max 3 consecutive 12-hour shifts (Z-codes)
- Weekend Toggle: if worked weekend N → locked off weekend N+1

Credit Rules:
--------------
- Z-Codes (12h): Paid_Duration = 11.25 (12h minus 0.75h break)
- Standard (8h): Paid_Duration = 7.5 (8h minus 0.5h break)
- CF (Holiday): Paid_Duration = 7.5, Premium_Multiplier = 1.5
- OFF/VAC/STAT days: Virtual_Credit = 7.5h each
- Tolerance Band: +/- 4h from target = "100% Compliant"
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Set, Tuple, Optional, Any
from datetime import datetime, timedelta
import uuid
import logging

logger = logging.getLogger(__name__)


# ============================================================================
# ENUMS & CONSTANTS
# ============================================================================

class PreferenceReasonCode(Enum):
    """Reason codes explaining why a preference was not honored"""
    ASSIGNED = "ASSIGNED"
    CONFLICT_SENIORITY = "CONFLICT_SENIORITY"
    CONFLICT_EQUITY = "CONFLICT_EQUITY"
    MIN_STAFFING_GAP = "MIN_STAFFING_GAP"
    REST_VIOLATION = "REST_VIOLATION"
    CONSECUTIVE_LIMIT = "CONSECUTIVE_LIMIT"
    OVERTIME_CAP = "OVERTIME_CAP"
    OFF_REQUEST = "OFF_REQUEST"
    WEEKEND_BALANCE = "WEEKEND_BALANCE"
    DAY_SHIFT_RULE = "DAY_SHIFT_RULE"
    ALREADY_ASSIGNED = "ALREADY_ASSIGNED"
    SLOT_FILLED = "SLOT_FILLED"
    UNMET_REQUIREMENT = "UNMET_REQUIREMENT"


class RotationPreference(Enum):
    """How nurse prefers shifts to be distributed"""
    BLOCK = "block"
    SPACED = "spaced"
    NONE = "none"


class ShiftTypeChoice(Enum):
    """Preferred shift length"""
    EIGHT_HOUR = "8h"
    TWELVE_HOUR = "12h"
    MIXED = "mixed"


# ============================================================================
# SHIFT LIBRARY — "The Paid Value Map"
# ============================================================================

@dataclass(frozen=True)
class ShiftDefinition:
    """Immutable shift code definition with paid credit."""
    code: str
    shift_type: str                   # "day", "night", "off"
    wall_clock_hours: float           # Total on-site time
    paid_duration: float              # Credit after subtracting unpaid break
    start_hour: float                 # Decimal hours from midnight (07:00 = 7.0)
    end_hour: float                   # Decimal hours (>24 = next day)
    premium_multiplier: float = 1.0   # 1.0 normal, 1.5 holiday
    is_off: bool = False
    label: str = ""


def _build_shift_library() -> Dict[str, ShiftDefinition]:
    """Build the canonical ShiftLibrary lookup table."""
    lib: Dict[str, ShiftDefinition] = {}

    def _add(code, stype, wall, paid, start, end, label="", premium=1.0, is_off=False):
        lib[code.upper()] = ShiftDefinition(
            code=code, shift_type=stype, wall_clock_hours=wall,
            paid_duration=paid, start_hour=start, end_hour=end,
            premium_multiplier=premium, is_off=is_off, label=label,
        )

    # 12-hour Z-codes: 12h on-site, 0.75h break -> 11.25h paid
    _add("Z07",   "day",   12.0, 11.25,  7.0, 19.417, "Day 12hr")
    _add("Z11",   "day",   12.0, 11.25, 11.0, 23.417, "Mid 12hr")
    _add("Z19",   "night", 12.0, 11.25, 19.0, 31.417, "Night 12hr")
    _add("Z23",   "night", 12.0, 11.25, 23.0, 35.417, "Night 12hr")
    _add("Z23 B", "night", 12.0, 11.25, 23.0, 35.417, "Night 12hr Balance")

    # 8-hour standard: 8h on-site, 0.5h break -> 7.5h paid
    _add("07",    "day",    8.0,  7.5,   7.0, 15.25,  "Day 8hr")
    _add("11",    "day",    8.0,  7.5,  11.0, 19.25,  "Mid 8hr")
    _add("E15",   "day",    8.0,  7.5,  15.0, 23.25,  "Evening 8hr")
    _add("23",    "night",  8.0,  7.5,  23.0, 31.25,  "Night 8hr")

    # Off codes
    _add("C",    "off", 0, 0, 0, 0, "Conge (Off)",         is_off=True)
    _add("OFF",  "off", 0, 0, 0, 0, "Off Day",             is_off=True)
    _add("VAC",  "off", 0, 0, 0, 0, "Vacation",            is_off=True)
    _add("STAT", "off", 0, 0, 0, 0, "Statutory Holiday",   is_off=True)

    # CF (Conge Ferie) codes: 7.5h paid, 1.5x premium
    cf_labels = {
        "CF":    "Conge Ferie (Holiday)",
        "CF-1":  "Canada Day",      "CF-2":  "Labour Day",
        "CF-3":  "Thanksgiving",    "CF-4":  "Christmas Day",
        "CF-5":  "Boxing Day",      "CF-6":  "New Year's Day",
        "CF-7":  "Day after New Year's", "CF-8":  "Good Friday",
        "CF-9":  "Victoria Day",    "CF-10": "Fete Nationale",
        "CF-11": "Easter Monday",   "CF-12": "Mobile Holiday 1",
        "CF-13": "Mobile Holiday 2",
    }
    for cf_code, cf_label in cf_labels.items():
        _add(cf_code, "off", 0, 7.5, 0, 0, cf_label, premium=1.5, is_off=True)

    return lib


SHIFT_LIBRARY: Dict[str, ShiftDefinition] = _build_shift_library()
VIRTUAL_CREDIT_PER_OFF_DAY = 7.5
COMPLIANCE_TOLERANCE_HOURS = 4.0


def lookup_shift(code: str) -> ShiftDefinition:
    """Look up a shift code. Falls back to 12h day if unknown."""
    upper = code.upper().strip()
    if upper in SHIFT_LIBRARY:
        return SHIFT_LIBRARY[upper]
    cleaned = upper.replace("*", "").strip()
    if cleaned in SHIFT_LIBRARY:
        return SHIFT_LIBRARY[cleaned]
    logger.warning(f"Unknown shift code '{code}', defaulting to 12h day")
    return ShiftDefinition(
        code=code, shift_type="day", wall_clock_hours=12.0,
        paid_duration=11.25, start_hour=7.0, end_hour=19.417,
        label=f"Unknown ({code})",
    )


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class ShiftPreference:
    """A single shift preference from a nurse."""
    date: str
    shift_code: str
    rank: int
    is_off_request: bool = False
    off_code: str = ""
    comment: str = ""


@dataclass
class NurseSubmission:
    """Complete submission from a nurse for the scheduling period."""
    nurse_id: str
    nurse_name: str
    seniority: float
    employment_type: str
    fte_target_hours: float
    preferences: List[ShiftPreference] = field(default_factory=list)
    rotation_preference: RotationPreference = RotationPreference.NONE
    shift_type_choice: ShiftTypeChoice = ShiftTypeChoice.MIXED
    is_permanent_night: bool = False
    max_weekly_hours: float = 40.0
    certifications: Set[str] = field(default_factory=set)


@dataclass
class PreferenceResult:
    """Result of processing a single preference."""
    date: str
    shift_code: str
    status: PreferenceReasonCode
    assigned: bool
    reason_detail: str = ""
    conflicting_nurse: str = ""


@dataclass
class NurseOptimizationResult:
    """Complete optimization result for one nurse."""
    nurse_id: str
    nurse_name: str
    assigned_shifts: List[Dict]
    preference_results: List[PreferenceResult]
    total_hours: float
    virtual_credit_hours: float
    compliance_hours: float
    target_hours: float
    target_delta: float
    is_compliant: bool
    day_shift_percentage: float
    weekend_shifts: int
    stats: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OptimizationConfig:
    """Configuration for the optimization engine."""
    pay_period_days: int = 14
    ft_biweekly_target: float = 75.0
    pt_biweekly_target: float = 63.75
    min_rest_hours: float = 11.0
    max_consecutive_12h: int = 3
    max_consecutive_any: int = 6
    day_shift_min_percentage: float = 50.0
    weekend_max_ratio: float = 0.5
    balance_window_days: int = 28
    use_seniority_for_conflicts: bool = True
    allow_overtime: bool = False
    overtime_cap_hours: float = 0.0
    compliance_tolerance: float = COMPLIANCE_TOLERANCE_HOURS


@dataclass
class StaffingSlot:
    """A single staffing slot that needs to be filled."""
    date: str
    shift_code: str
    shift_type: str
    start_time: str
    end_time: str
    hours: float
    required_certifications: Set[str] = field(default_factory=set)
    is_charge: bool = False
    is_filled: bool = False
    assigned_nurse: str = ""
    priority: int = 1


@dataclass
class UnmetSlot:
    """An unfilled staffing slot with reason."""
    date: str
    shift_code: str
    shift_type: str
    reason: str


# ============================================================================
# SELF-SCHEDULING ENGINE v2
# ============================================================================

class SelfSchedulingEngine:
    """
    Preferred-First Optimization Engine v2.

    Uses timestamp-based validation and credit-based reconciliation.
    """

    def __init__(
        self,
        submissions: List[NurseSubmission],
        date_list: List[str],
        shifts_info: Dict[str, Dict],
        staffing_requirements: Dict[str, Dict[str, int]],
        config: OptimizationConfig = None,
    ):
        self.submissions = submissions
        self.nurse_by_name = {s.nurse_name: s for s in submissions}
        self.nurse_by_id = {s.nurse_id: s for s in submissions}
        self.date_list = date_list
        self.shifts_info = shifts_info
        self.staffing_requirements = staffing_requirements
        self.config = config or OptimizationConfig()

        # Dynamic period length
        period_days = len(date_list)
        if period_days != self.config.pay_period_days:
            self.config.pay_period_days = period_days

        self.date_to_index = {d: i for i, d in enumerate(date_list)}

        # Pre-parse dates
        self._parsed_dates: Dict[str, datetime] = {}
        for d in date_list:
            self._parsed_dates[d] = datetime.strptime(d, "%Y-%m-%d")

        # Schedule and tracking
        self.schedule: Dict[str, List[Optional[Dict]]] = {
            s.nurse_name: [None] * len(date_list) for s in submissions
        }
        self.nurse_paid_hours: Dict[str, float] = {s.nurse_name: 0.0 for s in submissions}
        self.nurse_virtual_credit: Dict[str, float] = {s.nurse_name: 0.0 for s in submissions}
        self.nurse_day_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_night_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_weekend_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_worked_weekends: Dict[str, Set[int]] = {s.nurse_name: set() for s in submissions}
        self.preference_results: Dict[str, List[PreferenceResult]] = {
            s.nurse_name: [] for s in submissions
        }

        # Equity tracking (Rule 4)
        self.nurse_preferences_submitted: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_preferences_granted: Dict[str, int] = {s.nurse_name: 0 for s in submissions}

        # Error reporting (Rule 8)
        self.unmet_slots: List[UnmetSlot] = []

        # Slots
        self.slots_by_date: Dict[str, List[StaffingSlot]] = {}
        self.filled_slots: Dict[Tuple[str, str], Set[str]] = {}

        # Compute dynamic FTE targets (Rule 6)
        self._compute_dynamic_targets()
        self._initialize_staffing_slots()

        for sub in submissions:
            self.nurse_preferences_submitted[sub.nurse_name] = len(
                [p for p in sub.preferences if not p.is_off_request]
            )

        logger.info("=" * 80)
        logger.info("SELF-SCHEDULING ENGINE v2 INITIALIZED")
        logger.info(f"  Nurses: {len(submissions)}")
        logger.info(f"  Period: {date_list[0]} to {date_list[-1]} ({period_days} days)")
        logger.info(f"  Constraints: rest={self.config.min_rest_hours}h, "
                     f"max_12h={self.config.max_consecutive_12h}, "
                     f"tolerance=+/-{self.config.compliance_tolerance}h")
        logger.info("=" * 80)

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _compute_dynamic_targets(self):
        """Rule 6: Target_Hours = (Period_Days / 7) * Weekly_FTE."""
        period_days = len(self.date_list)
        weeks = period_days / 7.0

        for sub in self.submissions:
            if sub.employment_type == "FT":
                weekly = self.config.ft_biweekly_target / 2.0
            elif sub.employment_type == "PT":
                weekly = self.config.pt_biweekly_target / 2.0
            else:
                weekly = 20.0
            sub.fte_target_hours = round(weeks * weekly, 2)

        self.config.ft_biweekly_target = round(weeks * (self.config.ft_biweekly_target / 2.0), 2)
        self.config.pt_biweekly_target = round(weeks * (self.config.pt_biweekly_target / 2.0), 2)

    def _initialize_staffing_slots(self):
        """Create staffing slots using ShiftLibrary paid durations."""
        for d in self.date_list:
            self.slots_by_date[d] = []
            reqs = self.staffing_requirements.get(d, {"day": 5, "night": 5})

            day_def = lookup_shift("Z07")
            for i in range(reqs.get("day", 5)):
                self.slots_by_date[d].append(StaffingSlot(
                    date=d, shift_code="Z07", shift_type="day",
                    start_time="07:00", end_time="19:25",
                    hours=day_def.paid_duration,
                    priority=1 if i == 0 else 2,
                ))

            night_def = lookup_shift("Z19")
            for i in range(reqs.get("night", 5)):
                self.slots_by_date[d].append(StaffingSlot(
                    date=d, shift_code="Z19", shift_type="night",
                    start_time="19:00", end_time="07:25",
                    hours=night_def.paid_duration,
                    priority=1 if i == 0 else 2,
                ))

            self.filled_slots[(d, "day")] = set()
            self.filled_slots[(d, "night")] = set()

    # ------------------------------------------------------------------
    # Timestamp helpers (Rule 3)
    # ------------------------------------------------------------------

    def _shift_start_ts(self, date_str: str, shift_def: ShiftDefinition) -> datetime:
        base = self._parsed_dates[date_str]
        h = int(shift_def.start_hour)
        m = int((shift_def.start_hour - h) * 60)
        return base.replace(hour=0, minute=0, second=0) + timedelta(hours=h, minutes=m)

    def _shift_end_ts(self, date_str: str, shift_def: ShiftDefinition) -> datetime:
        base = self._parsed_dates[date_str]
        h = int(shift_def.end_hour)
        m = int((shift_def.end_hour - h) * 60)
        return base.replace(hour=0, minute=0, second=0) + timedelta(hours=h, minutes=m)

    # ------------------------------------------------------------------
    # Main orchestrator
    # ------------------------------------------------------------------

    def optimize(self) -> Dict[str, NurseOptimizationResult]:
        """Run the 3-stage optimization. Returns {nurse_name: result}."""
        logger.info("=" * 80)
        logger.info("STARTING PREFERRED-FIRST OPTIMIZATION v2")
        logger.info("=" * 80)

        self._apply_off_requests()
        self._stage1_locked_pass()
        self._stage2_seniority_resolver()
        self._stage3_gap_filler()

        return self._build_results()

    # ------------------------------------------------------------------
    # Pre-Optimization: Off-requests & Virtual Credits (Rule 2)
    # ------------------------------------------------------------------

    def _apply_off_requests(self):
        """Apply off-day requests. OFF/VAC/STAT earn 7.5h virtual credit each."""
        logger.info("\n  APPLYING OFF-REQUESTS & VIRTUAL CREDITS")

        for sub in self.submissions:
            for pref in sub.preferences:
                if not pref.is_off_request:
                    continue
                day_idx = self.date_to_index.get(pref.date)
                if day_idx is None:
                    continue

                off_code = pref.off_code or "OFF"
                off_def = lookup_shift(off_code)

                self.schedule[sub.nurse_name][day_idx] = {
                    "id": str(uuid.uuid4()),
                    "date": pref.date,
                    "shift": off_code,
                    "shiftType": "off",
                    "hours": 0,
                    "paidDuration": off_def.paid_duration,
                    "startTime": None,
                    "endTime": None,
                    "isOffRequest": True,
                }

                credit = off_def.paid_duration if off_def.paid_duration > 0 else VIRTUAL_CREDIT_PER_OFF_DAY
                self.nurse_virtual_credit[sub.nurse_name] += credit

                self.preference_results[sub.nurse_name].append(PreferenceResult(
                    date=pref.date, shift_code=off_code,
                    status=PreferenceReasonCode.ASSIGNED, assigned=True,
                    reason_detail=f"Off request honored (+{credit}h virtual credit)",
                ))
                logger.info(f"  {sub.nurse_name}: {off_code} on {pref.date} "
                           f"(credit: {self.nurse_virtual_credit[sub.nurse_name]:.1f}h)")

    # ------------------------------------------------------------------
    # Stage 1: LOCKED PASS
    # ------------------------------------------------------------------

    def _stage1_locked_pass(self):
        """Assign uncontested preferences (only one nurse wants that slot)."""
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 1: LOCKED PASS")
        logger.info("=" * 60)

        pref_map: Dict[Tuple[str, str], List[Tuple[str, int]]] = {}
        for sub in self.submissions:
            for pref in sub.preferences:
                if pref.is_off_request:
                    continue
                key = (pref.date, pref.shift_code)
                pref_map.setdefault(key, []).append((sub.nurse_name, pref.rank))

        locked = 0
        for (d, code), cands in pref_map.items():
            if len(cands) != 1:
                continue
            name, _ = cands[0]
            ok, reason = self._can_assign(name, d, code)
            if ok:
                self._assign_shift(name, d, code)
                self.nurse_preferences_granted[name] += 1
                locked += 1
                logger.info(f"  LOCKED: {name} -> {code} on {d}")
                self.preference_results[name].append(PreferenceResult(
                    date=d, shift_code=code,
                    status=PreferenceReasonCode.ASSIGNED, assigned=True,
                    reason_detail="Uncontested preference - locked",
                ))
            else:
                logger.info(f"  Cannot lock {name} -> {code} on {d}: {reason.value}")
                self.preference_results[name].append(PreferenceResult(
                    date=d, shift_code=code, status=reason, assigned=False,
                    reason_detail=f"Constraint: {reason.value}",
                ))

        logger.info(f"\nStage 1 complete: {locked} shifts locked")

    # ------------------------------------------------------------------
    # Stage 2: SENIORITY + EQUITY RESOLVER (Rule 4)
    # ------------------------------------------------------------------

    def _stage2_seniority_resolver(self):
        """
        Resolve multi-nurse conflicts with equity-aware seniority.

        Equity Rule: If Senior.Fulfillment > 80% AND Junior.Fulfillment < 20%
        then Junior wins. Otherwise seniority wins.
        """
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 2: SENIORITY + EQUITY RESOLVER")
        logger.info("=" * 60)

        pref_map: Dict[Tuple[str, str], List[Tuple[str, int, float]]] = {}
        for sub in self.submissions:
            for pref in sub.preferences:
                if pref.is_off_request:
                    continue
                key = (pref.date, pref.shift_code)
                day_idx = self.date_to_index.get(pref.date)
                if day_idx is not None and self.schedule[sub.nurse_name][day_idx]:
                    continue
                pref_map.setdefault(key, []).append((sub.nurse_name, pref.rank, sub.seniority))

        resolved = 0
        for (d, code), cands in pref_map.items():
            if len(cands) <= 1:
                continue

            logger.info(f"\n  CONFLICT: {code} on {d} ({[c[0] for c in cands]})")

            scored: List[Tuple[str, Tuple]] = []
            for name, rank, seniority in cands:
                fr = self._fulfillment_rate(name)
                delta = self._compliance_delta(name)
                equity_mod = 100.0 if fr > 0.8 else (-100.0 if fr < 0.2 else 0.0)
                scored.append((name, (rank, equity_mod, -seniority, -delta)))

            scored.sort(key=lambda x: x[1])

            winner = None
            for name, score in scored:
                ok, reason = self._can_assign(name, d, code)
                if ok:
                    self._assign_shift(name, d, code)
                    self.nurse_preferences_granted[name] += 1
                    resolved += 1
                    winner = name
                    fr = self._fulfillment_rate(name)
                    logger.info(f"    Winner: {name} (rank={score[0]}, "
                               f"seniority={-score[2]:.1f}, fulfillment={fr:.0%})")
                    self.preference_results[name].append(PreferenceResult(
                        date=d, shift_code=code,
                        status=PreferenceReasonCode.ASSIGNED, assigned=True,
                        reason_detail="Won conflict by seniority/equity",
                    ))
                    break

            if winner:
                for name, _ in scored:
                    if name != winner:
                        w_fr = self._fulfillment_rate(winner)
                        l_fr = self._fulfillment_rate(name)
                        was_equity = l_fr > 0.8 and w_fr < 0.2
                        status = (PreferenceReasonCode.CONFLICT_EQUITY if was_equity
                                  else PreferenceReasonCode.CONFLICT_SENIORITY)
                        self.preference_results[name].append(PreferenceResult(
                            date=d, shift_code=code, status=status, assigned=False,
                            reason_detail=f"Lost to {winner}" + (" (equity)" if was_equity else ""),
                            conflicting_nurse=winner,
                        ))

        logger.info(f"\nStage 2 complete: {resolved} conflicts resolved")

    # ------------------------------------------------------------------
    # Stage 3: INTELLIGENT GAP FILLER (Rule 5)
    # ------------------------------------------------------------------

    def _stage3_gap_filler(self):
        """
        Fill gaps. Candidate ranking:
        1. Not on OFF  2. Passes 11h rest  3. Below FTE target
        4. B-Shift Rule: if <=8h from target, only 8h shifts allowed
        """
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 3: INTELLIGENT GAP FILLER")
        logger.info("=" * 60)

        filled = 0
        for d in self.date_list:
            for slot in self.slots_by_date.get(d, []):
                if slot.is_filled:
                    continue
                best = self._find_best_nurse(slot)
                if best:
                    self._assign_shift(best, d, slot.shift_code)
                    slot.is_filled = True
                    slot.assigned_nurse = best
                    filled += 1
                    logger.debug(f"  GAP: {best} -> {slot.shift_code} on {d}")
                else:
                    reason = self._diagnose_unmet(slot)
                    self.unmet_slots.append(UnmetSlot(
                        date=d, shift_code=slot.shift_code,
                        shift_type=slot.shift_type, reason=reason,
                    ))
                    logger.warning(f"  UNMET: {slot.shift_code} on {d} - {reason}")

        logger.info(f"\nStage 3 complete: {filled} filled, {len(self.unmet_slots)} unmet")

    def _find_best_nurse(self, slot: StaffingSlot) -> Optional[str]:
        shift_def = lookup_shift(slot.shift_code)
        candidates: List[Tuple[str, Tuple]] = []

        for sub in self.submissions:
            name = sub.nurse_name
            day_idx = self.date_to_index.get(slot.date)
            if day_idx is not None and self.schedule[name][day_idx]:
                continue

            ok, _ = self._can_assign(name, slot.date, slot.shift_code)
            if not ok:
                continue

            if slot.required_certifications and not slot.required_certifications.issubset(sub.certifications):
                continue

            compliance = self._compliance_hours(name)
            target = sub.fte_target_hours
            if compliance >= target + self.config.overtime_cap_hours:
                continue

            remaining = target - compliance
            if remaining <= 8.0 and shift_def.paid_duration > 8.0:
                continue  # B-Shift Rule

            pref_rank = 999
            for p in sub.preferences:
                if p.date == slot.date and p.shift_code == slot.shift_code:
                    pref_rank = p.rank
                    break

            rot = self._calc_rotation_fit(name, slot.date, sub.rotation_preference)
            candidates.append((name, (pref_rank, -(target - compliance), rot)))

        if not candidates:
            return None
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]

    def _diagnose_unmet(self, slot: StaffingSlot) -> str:
        """Rule 8: Error reporting for unfilled slots."""
        reasons: Dict[str, int] = {
            "on_off": 0, "assigned": 0, "rest": 0, "consecutive": 0,
            "overtime": 0, "b_shift": 0, "day_rule": 0, "weekend": 0,
        }
        shift_def = lookup_shift(slot.shift_code)

        for sub in self.submissions:
            name = sub.nurse_name
            day_idx = self.date_to_index.get(slot.date)
            if day_idx is not None:
                ex = self.schedule[name][day_idx]
                if ex:
                    reasons["on_off" if ex.get("isOffRequest") else "assigned"] += 1
                    continue

            ok, reason = self._can_assign(name, slot.date, slot.shift_code)
            if ok:
                comp = self._compliance_hours(name)
                tgt = sub.fte_target_hours
                if comp >= tgt + self.config.overtime_cap_hours:
                    reasons["overtime"] += 1
                elif (tgt - comp) <= 8.0 and shift_def.paid_duration > 8.0:
                    reasons["b_shift"] += 1
            else:
                mapping = {
                    PreferenceReasonCode.REST_VIOLATION: "rest",
                    PreferenceReasonCode.CONSECUTIVE_LIMIT: "consecutive",
                    PreferenceReasonCode.OVERTIME_CAP: "overtime",
                    PreferenceReasonCode.DAY_SHIFT_RULE: "day_rule",
                    PreferenceReasonCode.WEEKEND_BALANCE: "weekend",
                    PreferenceReasonCode.ALREADY_ASSIGNED: "assigned",
                }
                reasons[mapping.get(reason, "assigned")] += 1

        parts = []
        labels = {
            "on_off": "on leave", "rest": "violate 11h rest",
            "consecutive": "at consecutive limit", "overtime": "at/over target",
            "b_shift": "restricted to 8h (B-shift rule)", "assigned": "already assigned",
            "day_rule": "blocked by 50% day rule", "weekend": "blocked by weekend balance",
        }
        for k, lbl in labels.items():
            if reasons.get(k, 0):
                parts.append(f"{reasons[k]} {lbl}")

        return ("Insufficient staffing: " + "; ".join(parts)) if parts else "All nurses unavailable"

    # ------------------------------------------------------------------
    # Constraint checks (Rules 3, 7)
    # ------------------------------------------------------------------

    def _can_assign(self, nurse_name: str, date: str, shift_code: str) -> Tuple[bool, PreferenceReasonCode]:
        sub = self.nurse_by_name.get(nurse_name)
        if not sub:
            return False, PreferenceReasonCode.MIN_STAFFING_GAP

        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return False, PreferenceReasonCode.MIN_STAFFING_GAP

        if self.schedule[nurse_name][day_idx]:
            return False, PreferenceReasonCode.ALREADY_ASSIGNED

        shift_def = lookup_shift(shift_code)

        # Hours cap (credit-based)
        comp = self._compliance_hours(nurse_name)
        if comp + shift_def.paid_duration > sub.fte_target_hours + self.config.overtime_cap_hours:
            return False, PreferenceReasonCode.OVERTIME_CAP

        # 11h rest - TIMESTAMP based (Rule 3)
        if not self._check_rest_ts(nurse_name, date, shift_def):
            return False, PreferenceReasonCode.REST_VIOLATION

        # Consecutive limit (Rule 7)
        if not self._check_consecutive(nurse_name, date, shift_def):
            return False, PreferenceReasonCode.CONSECUTIVE_LIMIT

        # 50% day rule (Rule 7)
        if not sub.is_permanent_night and not self._check_day_rule(nurse_name, shift_def.shift_type):
            return False, PreferenceReasonCode.DAY_SHIFT_RULE

        # Weekend toggle (Rule 7)
        if self._is_weekend(date) and not self._check_weekend_toggle(nurse_name, date):
            return False, PreferenceReasonCode.WEEKEND_BALANCE

        return True, PreferenceReasonCode.ASSIGNED

    def _check_rest_ts(self, nurse_name: str, date: str, shift_def: ShiftDefinition) -> bool:
        """Rule 3: Timestamp-based 11h rest gate."""
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return True

        schedule = self.schedule[nurse_name]
        new_start = self._shift_start_ts(date, shift_def)
        new_end = self._shift_end_ts(date, shift_def)

        # Check previous shifts (look back up to 2 days for overnight wraps)
        for lb in range(1, min(3, day_idx + 1)):
            prev = schedule[day_idx - lb]
            if not prev or prev.get("hours", 0) == 0:
                if lb == 1:
                    break
                continue
            prev_def = lookup_shift(prev.get("shift", ""))
            prev_end = self._shift_end_ts(self.date_list[day_idx - lb], prev_def)
            rest = (new_start - prev_end).total_seconds() / 3600.0
            if rest < self.config.min_rest_hours:
                return False
            break

        # Check next shifts
        for la in range(1, min(3, len(schedule) - day_idx)):
            nxt = schedule[day_idx + la]
            if not nxt or nxt.get("hours", 0) == 0:
                if la == 1:
                    break
                continue
            nxt_def = lookup_shift(nxt.get("shift", ""))
            nxt_start = self._shift_start_ts(self.date_list[day_idx + la], nxt_def)
            rest = (nxt_start - new_end).total_seconds() / 3600.0
            if rest < self.config.min_rest_hours:
                return False
            break

        return True

    def _check_consecutive(self, nurse_name: str, date: str, shift_def: ShiftDefinition) -> bool:
        """Rule 7: Max 3 consecutive 12h, max 6 consecutive any."""
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return True

        schedule = self.schedule[nurse_name]
        is_12h = shift_def.paid_duration >= 11.0

        if is_12h:
            c = 0
            for i in range(day_idx - 1, -1, -1):
                s = schedule[i]
                if s and s.get("hours", 0) > 0 and lookup_shift(s.get("shift", "")).paid_duration >= 11.0:
                    c += 1
                else:
                    break
            for i in range(day_idx + 1, len(schedule)):
                s = schedule[i]
                if s and s.get("hours", 0) > 0 and lookup_shift(s.get("shift", "")).paid_duration >= 11.0:
                    c += 1
                else:
                    break
            if c + 1 > self.config.max_consecutive_12h:
                return False

        c_any = 0
        for i in range(day_idx - 1, -1, -1):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                c_any += 1
            else:
                break
        for i in range(day_idx + 1, len(schedule)):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                c_any += 1
            else:
                break
        if c_any + 1 > self.config.max_consecutive_any:
            return False

        return True

    def _check_day_rule(self, nurse_name: str, new_type: str) -> bool:
        """Rule 7: 50% Day Guarantee (10% buffer)."""
        total = self.nurse_day_shifts[nurse_name] + self.nurse_night_shifts[nurse_name]
        if total < 2:
            return True
        new_day = self.nurse_day_shifts[nurse_name] + (1 if new_type == "day" else 0)
        pct = (new_day / (total + 1)) * 100
        return pct >= (self.config.day_shift_min_percentage - 10)

    def _check_weekend_toggle(self, nurse_name: str, date: str) -> bool:
        """Rule 7: Weekend Toggle - worked weekend N -> off weekend N+1."""
        dt = self._parsed_dates[date]
        week = dt.isocalendar()[1]
        worked = self.nurse_worked_weekends[nurse_name]

        if (week - 1) in worked:
            return False

        total_weekends = set()
        for d in self.date_list:
            ddt = self._parsed_dates[d]
            if ddt.weekday() >= 5:
                total_weekends.add(ddt.isocalendar()[1])

        if not total_weekends:
            return True
        return len(worked) < int(len(total_weekends) * self.config.weekend_max_ratio) + 1

    def _is_weekend(self, date: str) -> bool:
        return self._parsed_dates[date].weekday() >= 5

    # ------------------------------------------------------------------
    # Credit & Equity
    # ------------------------------------------------------------------

    def _compliance_hours(self, name: str) -> float:
        """Rule 2: Paid hours + virtual credit."""
        return self.nurse_paid_hours[name] + self.nurse_virtual_credit[name]

    def _compliance_delta(self, name: str) -> float:
        return self._compliance_hours(name) - self.nurse_by_name[name].fte_target_hours

    def _fulfillment_rate(self, name: str) -> float:
        """Rule 4: Granted / Submitted preferences."""
        sub = self.nurse_preferences_submitted.get(name, 0)
        return (self.nurse_preferences_granted.get(name, 0) / sub) if sub > 0 else 0.5

    def _calc_rotation_fit(self, name: str, date: str, pref: RotationPreference) -> float:
        if pref == RotationPreference.NONE:
            return 0.0
        day_idx = self.date_to_index.get(date, 0)
        schedule = self.schedule[name]
        before = 0
        for i in range(day_idx - 1, -1, -1):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                before += 1
            else:
                break
        after = 0
        for i in range(day_idx + 1, len(schedule)):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                after += 1
            else:
                break
        total = before + 1 + after
        return -total if pref == RotationPreference.BLOCK else total

    # ------------------------------------------------------------------
    # Shift assignment
    # ------------------------------------------------------------------

    def _assign_shift(self, nurse_name: str, date: str, shift_code: str):
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return

        sdef = lookup_shift(shift_code)
        eh = sdef.end_hour
        if eh >= 24:
            eh -= 24
        end_str = f"{int(eh):02d}:{int((eh - int(eh)) * 60):02d}"

        self.schedule[nurse_name][day_idx] = {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": shift_code,
            "shiftType": sdef.shift_type,
            "hours": sdef.paid_duration,
            "paidDuration": sdef.paid_duration,
            "wallClockHours": sdef.wall_clock_hours,
            "startTime": f"{int(sdef.start_hour):02d}:{int((sdef.start_hour % 1) * 60):02d}",
            "endTime": end_str,
            "isPreferenceAssigned": True,
            "premiumMultiplier": sdef.premium_multiplier,
        }

        self.nurse_paid_hours[nurse_name] += sdef.paid_duration

        if sdef.shift_type == "day":
            self.nurse_day_shifts[nurse_name] += 1
        elif sdef.shift_type == "night":
            self.nurse_night_shifts[nurse_name] += 1

        if self._is_weekend(date):
            self.nurse_weekend_shifts[nurse_name] += 1
            self.nurse_worked_weekends[nurse_name].add(self._parsed_dates[date].isocalendar()[1])

        key = (date, sdef.shift_type)
        if key in self.filled_slots:
            self.filled_slots[key].add(nurse_name)

    # ------------------------------------------------------------------
    # Build results
    # ------------------------------------------------------------------

    def _build_results(self) -> Dict[str, NurseOptimizationResult]:
        results = {}
        for sub in self.submissions:
            name = sub.nurse_name
            assigned = [s for s in self.schedule[name] if s is not None]
            paid = self.nurse_paid_hours[name]
            vc = self.nurse_virtual_credit[name]
            comp = paid + vc
            target = sub.fte_target_hours
            delta = comp - target

            ds = self.nurse_day_shifts[name]
            ns = self.nurse_night_shifts[name]
            total_worked = ds + ns
            day_pct = (ds / total_worked * 100) if total_worked > 0 else 0
            compliant = abs(delta) <= self.config.compliance_tolerance

            ps = self.nurse_preferences_submitted[name]
            pg = self.nurse_preferences_granted[name]

            results[name] = NurseOptimizationResult(
                nurse_id=sub.nurse_id,
                nurse_name=name,
                assigned_shifts=assigned,
                preference_results=self.preference_results[name],
                total_hours=paid,
                virtual_credit_hours=vc,
                compliance_hours=comp,
                target_hours=target,
                target_delta=delta,
                is_compliant=compliant,
                day_shift_percentage=day_pct,
                weekend_shifts=self.nurse_weekend_shifts[name],
                stats={
                    "preferences_submitted": ps,
                    "preferences_honored": pg,
                    "fulfillment_rate": (pg / ps) if ps > 0 else 0,
                    "conflicts_lost": len([r for r in self.preference_results[name]
                                           if r.status in (PreferenceReasonCode.CONFLICT_SENIORITY,
                                                           PreferenceReasonCode.CONFLICT_EQUITY)]),
                    "day_shifts": ds, "night_shifts": ns,
                    "virtual_credit_hours": vc,
                    "paid_hours": paid,
                    "compliance_hours": comp,
                    "is_compliant": compliant,
                    "unmet_slots": len(self.unmet_slots),
                },
            )

        total_nurses = len(results)
        compliant_count = sum(1 for r in results.values() if r.is_compliant)
        logger.info("\n" + "=" * 80)
        logger.info("OPTIMIZATION COMPLETE")
        logger.info(f"  Compliant: {compliant_count}/{total_nurses} "
                     f"(+/-{self.config.compliance_tolerance}h)")
        logger.info(f"  Unmet slots: {len(self.unmet_slots)}")
        for us in self.unmet_slots[:10]:
            logger.info(f"    UNMET: {us.shift_code} on {us.date}: {us.reason}")
        logger.info("=" * 80)

        return results


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def convert_legacy_preferences_to_submissions(
    nurses: List[Dict],
    preferences: Dict[str, List[str]],
    date_list: List[str],
    shifts_info: Dict,
) -> List[NurseSubmission]:
    """Convert legacy OCR-based preferences to NurseSubmission objects."""
    submissions = []

    for nurse in nurses:
        name = nurse.get("name", "")
        nurse_prefs = preferences.get(name, [])

        emp_type = nurse.get("employmentType", "FT")
        fte_target = 75.0 if emp_type == "FT" else (63.75 if emp_type == "PT" else 40.0)

        shift_preferences = []
        for day_idx, shift_code in enumerate(nurse_prefs):
            if day_idx >= len(date_list):
                break
            d = date_list[day_idx]
            if not shift_code or not shift_code.strip():
                continue

            code = shift_code.strip().upper()
            sdef = lookup_shift(code)
            is_off = sdef.is_off or code in ("C", "OFF", "*") or code.startswith("CF") or code in ("VAC", "STAT")

            shift_preferences.append(ShiftPreference(
                date=d, shift_code=shift_code, rank=1,
                is_off_request=is_off, off_code=shift_code if is_off else "",
            ))

        certs = set()
        for key, cert in [
            ("isChemoCertified", "chemo"), ("is_chemo_certified", "chemo"),
            ("isTransplantCertified", "transplant"), ("is_transplant_certified", "transplant"),
            ("isRenalCertified", "renal"), ("is_renal_certified", "renal"),
            ("isChargeCertified", "charge"), ("is_charge_certified", "charge"),
        ]:
            if nurse.get(key):
                certs.add(cert)

        submissions.append(NurseSubmission(
            nurse_id=str(nurse.get("id", name)),
            nurse_name=name,
            seniority=_parse_seniority(nurse.get("seniority", 0)),
            employment_type=emp_type,
            fte_target_hours=fte_target,
            preferences=shift_preferences,
            max_weekly_hours=nurse.get("maxWeeklyHours", 40.0),
            certifications=certs,
        ))

    return submissions


def _parse_seniority(raw_value) -> float:
    """Parse seniority value from various formats."""
    import re
    if raw_value is None:
        return 0.0
    if isinstance(raw_value, (int, float)):
        return float(raw_value)
    text = str(raw_value).strip()
    if not text:
        return 0.0
    matches = re.findall(r"\d+(?:\.\d+)?", text)
    return float(matches[-1]) if matches else 0.0