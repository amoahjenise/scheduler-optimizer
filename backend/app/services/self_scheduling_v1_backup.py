"""
Self-Scheduling "Preferred-First" Optimization Engine
======================================================

MCH Heme-Oncology Self-Scheduling System

This module implements a nurse-preference-first scheduling algorithm that:
1. Treats nurse submissions as primary weights (what they WANT)
2. Uses clinical requirements as hard constraints (what we MUST have)
3. Provides clear reason codes when preferences cannot be honored

Algorithm Stages:
-----------------
1. LOCKED PASS: Assign uncontested slots (only one nurse wants that shift)
2. SENIORITY RESOLVER: Resolve conflicts using seniority + equity score
3. GAP FILLER: Fill remaining slots prioritizing nurses under FTE target

Hard Constraints (FIQ Collective Agreement):
--------------------------------------------
- 50% Day Shift Guarantee (unless permanent night waiver)
- 11-hour minimum rest between shifts
- Max 3-4 consecutive 12h shifts
- Weekend fairness (1:2 rotation)
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
    ASSIGNED = "ASSIGNED"                     # Preference honored
    CONFLICT_SENIORITY = "CONFLICT_SENIORITY" # Lost to more senior nurse
    MIN_STAFFING_GAP = "MIN_STAFFING_GAP"     # Needed elsewhere for coverage
    REST_VIOLATION = "REST_VIOLATION"         # Would violate 11h rest rule
    CONSECUTIVE_LIMIT = "CONSECUTIVE_LIMIT"   # Would exceed max consecutive shifts
    OVERTIME_CAP = "OVERTIME_CAP"             # Would exceed FTE/OT cap
    OFF_REQUEST = "OFF_REQUEST"               # Nurse requested off
    WEEKEND_BALANCE = "WEEKEND_BALANCE"       # Weekend fairness constraint
    DAY_SHIFT_RULE = "DAY_SHIFT_RULE"        # 50% day shift requirement
    ALREADY_ASSIGNED = "ALREADY_ASSIGNED"     # Nurse already assigned that day
    SLOT_FILLED = "SLOT_FILLED"              # Slot already at capacity


class RotationPreference(Enum):
    """How nurse prefers shifts to be distributed"""
    BLOCK = "block"    # Consecutive days (e.g., 3 on, 4 off)
    SPACED = "spaced"  # Distributed throughout period
    NONE = "none"      # No preference


class ShiftTypeChoice(Enum):
    """Preferred shift length"""
    EIGHT_HOUR = "8h"
    TWELVE_HOUR = "12h"
    MIXED = "mixed"


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class ShiftPreference:
    """A single shift preference from a nurse"""
    date: str                    # YYYY-MM-DD
    shift_code: str              # e.g., "Z07", "Z19", "ZD12-"
    rank: int                    # 1 = most wanted, higher = less priority
    is_off_request: bool = False # True if this is a day-off request
    off_code: str = ""           # e.g., "CF-1" for Christmas, "VAC" for vacation
    comment: str = ""            # Optional nurse comment


@dataclass
class NurseSubmission:
    """Complete submission from a nurse for the scheduling period"""
    nurse_id: str
    nurse_name: str
    seniority: float                                    # Years of service
    employment_type: str                                # "FT", "PT", "Casual"
    fte_target_hours: float                             # 75 for FT, 63.75 for PT
    preferences: List[ShiftPreference] = field(default_factory=list)
    rotation_preference: RotationPreference = RotationPreference.NONE
    shift_type_choice: ShiftTypeChoice = ShiftTypeChoice.MIXED
    is_permanent_night: bool = False                    # Waived 50% day rule
    max_weekly_hours: float = 40.0
    certifications: Set[str] = field(default_factory=set)  # "chemo", "transplant", etc.


@dataclass
class PreferenceResult:
    """Result of processing a single preference"""
    date: str
    shift_code: str
    status: PreferenceReasonCode
    assigned: bool
    reason_detail: str = ""
    conflicting_nurse: str = ""  # Who won the conflict (if applicable)


@dataclass
class NurseOptimizationResult:
    """Complete optimization result for one nurse"""
    nurse_id: str
    nurse_name: str
    assigned_shifts: List[Dict]          # Final schedule
    preference_results: List[PreferenceResult]
    total_hours: float
    target_hours: float
    target_delta: float                  # +/- from target
    day_shift_percentage: float          # % of shifts that are day shifts
    weekend_shifts: int
    stats: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OptimizationConfig:
    """Configuration for the optimization engine"""
    pay_period_days: int = 14
    ft_biweekly_target: float = 75.0
    pt_biweekly_target: float = 63.75
    min_rest_hours: float = 11.0
    max_consecutive_12h: int = 3
    max_consecutive_any: int = 6
    day_shift_min_percentage: float = 50.0
    weekend_max_ratio: float = 0.5       # Max 50% of weekends worked
    balance_window_days: int = 28
    use_seniority_for_conflicts: bool = True
    allow_overtime: bool = False
    overtime_cap_hours: float = 0.0


@dataclass
class StaffingSlot:
    """A single staffing slot that needs to be filled"""
    date: str
    shift_code: str
    shift_type: str              # "day" or "night"
    start_time: str
    end_time: str
    hours: float
    required_certifications: Set[str] = field(default_factory=set)
    is_charge: bool = False
    is_filled: bool = False
    assigned_nurse: str = ""
    priority: int = 1            # 1 = must fill, 2 = nice to have


# ============================================================================
# SELF-SCHEDULING ENGINE
# ============================================================================

class SelfSchedulingEngine:
    """
    Preferred-First Optimization Engine
    
    Processes nurse preference submissions and creates an optimized schedule
    that maximizes preference fulfillment while respecting hard constraints.
    """
    
    def __init__(
        self,
        submissions: List[NurseSubmission],
        date_list: List[str],
        shifts_info: Dict[str, Dict],
        staffing_requirements: Dict[str, Dict[str, int]],  # {date: {shift_type: count}}
        config: OptimizationConfig = None
    ):
        self.submissions = submissions
        self.nurse_by_name = {s.nurse_name: s for s in submissions}
        self.nurse_by_id = {s.nurse_id: s for s in submissions}
        self.date_list = date_list
        self.shifts_info = shifts_info
        self.staffing_requirements = staffing_requirements
        self.config = config or OptimizationConfig()
        
        # Build date indices
        self.date_to_index = {d: i for i, d in enumerate(date_list)}
        
        # Initialize tracking structures
        self.schedule: Dict[str, List[Optional[Dict]]] = {
            s.nurse_name: [None] * len(date_list) for s in submissions
        }
        self.nurse_hours: Dict[str, float] = {s.nurse_name: 0.0 for s in submissions}
        self.nurse_day_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_night_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.nurse_weekend_shifts: Dict[str, int] = {s.nurse_name: 0 for s in submissions}
        self.preference_results: Dict[str, List[PreferenceResult]] = {
            s.nurse_name: [] for s in submissions
        }
        
        # Slots tracking
        self.slots_by_date: Dict[str, List[StaffingSlot]] = {}
        self.filled_slots: Dict[Tuple[str, str], Set[str]] = {}  # (date, shift_type) -> nurses
        
        # Build staffing slots
        self._initialize_staffing_slots()
        
        logger.info("=" * 80)
        logger.info("SELF-SCHEDULING ENGINE INITIALIZED")
        logger.info(f"  Nurses: {len(submissions)}")
        logger.info(f"  Date range: {date_list[0]} to {date_list[-1]}")
        logger.info(f"  Config: FT={self.config.ft_biweekly_target}h, PT={self.config.pt_biweekly_target}h")
        logger.info(f"  Constraints: min_rest={self.config.min_rest_hours}h, max_consecutive={self.config.max_consecutive_12h}")
        logger.info("=" * 80)

    def _initialize_staffing_slots(self):
        """Create staffing slots based on requirements"""
        for date in self.date_list:
            self.slots_by_date[date] = []
            reqs = self.staffing_requirements.get(date, {"day": 5, "night": 5})
            
            # Day slots
            for i in range(reqs.get("day", 5)):
                slot = StaffingSlot(
                    date=date,
                    shift_code="Z07",  # Default day code
                    shift_type="day",
                    start_time="07:00",
                    end_time="19:00",
                    hours=12.0,
                    priority=1 if i == 0 else 2  # First slot is charge
                )
                self.slots_by_date[date].append(slot)
            
            # Night slots
            for i in range(reqs.get("night", 5)):
                slot = StaffingSlot(
                    date=date,
                    shift_code="Z19",  # Default night code
                    shift_type="night",
                    start_time="19:00",
                    end_time="07:00",
                    hours=12.0,
                    priority=1 if i == 0 else 2
                )
                self.slots_by_date[date].append(slot)
            
            self.filled_slots[(date, "day")] = set()
            self.filled_slots[(date, "night")] = set()

    def optimize(self) -> Dict[str, NurseOptimizationResult]:
        """
        Run the 3-stage optimization algorithm.
        
        Returns dict of {nurse_name: NurseOptimizationResult}
        """
        logger.info("=" * 80)
        logger.info("STARTING PREFERRED-FIRST OPTIMIZATION")
        logger.info("=" * 80)
        
        # Pre-process: Apply off-requests first
        self._apply_off_requests()
        
        # Stage 1: Locked Pass - Assign uncontested preferences
        self._stage1_locked_pass()
        
        # Stage 2: Seniority Resolver - Handle conflicts
        self._stage2_seniority_resolver()
        
        # Stage 3: Gap Filler - Fill remaining slots
        self._stage3_gap_filler()
        
        # Build results
        return self._build_results()

    def _apply_off_requests(self):
        """Apply all off-day requests before scheduling"""
        logger.info("\n📅 APPLYING OFF-REQUESTS")
        
        for submission in self.submissions:
            for pref in submission.preferences:
                if pref.is_off_request:
                    day_idx = self.date_to_index.get(pref.date)
                    if day_idx is not None:
                        off_shift = {
                            "id": str(uuid.uuid4()),
                            "date": pref.date,
                            "shift": pref.off_code or "OFF",
                            "shiftType": "off",
                            "hours": 0,
                            "startTime": None,
                            "endTime": None,
                            "isOffRequest": True
                        }
                        self.schedule[submission.nurse_name][day_idx] = off_shift
                        
                        result = PreferenceResult(
                            date=pref.date,
                            shift_code=pref.off_code or "OFF",
                            status=PreferenceReasonCode.ASSIGNED,
                            assigned=True,
                            reason_detail="Off request honored"
                        )
                        self.preference_results[submission.nurse_name].append(result)
                        
                        logger.info(f"  ✓ {submission.nurse_name}: OFF on {pref.date} ({pref.off_code})")

    def _stage1_locked_pass(self):
        """
        Stage 1: LOCKED PASS
        
        Identify and assign uncontested preferences - slots where only one nurse
        has expressed interest.
        """
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 1: LOCKED PASS - Assigning Uncontested Preferences")
        logger.info("=" * 60)
        
        # Build preference map: {(date, shift_code): [nurse_names]}
        preference_map: Dict[Tuple[str, str], List[Tuple[str, int]]] = {}
        
        for submission in self.submissions:
            for pref in submission.preferences:
                if pref.is_off_request:
                    continue
                    
                key = (pref.date, pref.shift_code)
                if key not in preference_map:
                    preference_map[key] = []
                preference_map[key].append((submission.nurse_name, pref.rank))
        
        # Find and assign uncontested slots
        locked_count = 0
        
        for (date, shift_code), candidates in preference_map.items():
            if len(candidates) == 1:
                nurse_name, rank = candidates[0]
                
                # Validate assignment
                can_assign, reason = self._can_assign(nurse_name, date, shift_code)
                
                if can_assign:
                    self._assign_shift(nurse_name, date, shift_code)
                    locked_count += 1
                    logger.info(f"  🔒 LOCKED: {nurse_name} → {shift_code} on {date}")
                    
                    result = PreferenceResult(
                        date=date,
                        shift_code=shift_code,
                        status=PreferenceReasonCode.ASSIGNED,
                        assigned=True,
                        reason_detail="Uncontested preference - locked"
                    )
                    self.preference_results[nurse_name].append(result)
                else:
                    logger.info(f"  ⚠ Cannot lock {nurse_name} → {shift_code} on {date}: {reason}")
                    
                    result = PreferenceResult(
                        date=date,
                        shift_code=shift_code,
                        status=reason,
                        assigned=False,
                        reason_detail=f"Constraint violation: {reason.value}"
                    )
                    self.preference_results[nurse_name].append(result)
        
        logger.info(f"\nStage 1 complete: {locked_count} shifts locked")

    def _stage2_seniority_resolver(self):
        """
        Stage 2: SENIORITY RESOLVER
        
        Resolve conflicts where multiple nurses want the same shift.
        Uses seniority + equity score (how far nurse is from target hours).
        """
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 2: SENIORITY RESOLVER - Resolving Conflicts")
        logger.info("=" * 60)
        
        # Build conflict map: {(date, shift_code): [nurse_names]} where len > 1
        preference_map: Dict[Tuple[str, str], List[Tuple[str, int, float]]] = {}
        
        for submission in self.submissions:
            for pref in submission.preferences:
                if pref.is_off_request:
                    continue
                    
                key = (pref.date, pref.shift_code)
                day_idx = self.date_to_index.get(pref.date)
                
                # Skip if already assigned
                if day_idx is not None and self.schedule[submission.nurse_name][day_idx]:
                    continue
                
                if key not in preference_map:
                    preference_map[key] = []
                preference_map[key].append((submission.nurse_name, pref.rank, submission.seniority))
        
        # Resolve conflicts
        resolved_count = 0
        
        for (date, shift_code), candidates in preference_map.items():
            if len(candidates) <= 1:
                continue
            
            logger.info(f"\n  🔄 CONFLICT: {shift_code} on {date}")
            logger.info(f"     Candidates: {[c[0] for c in candidates]}")
            
            # Sort by: rank ASC (lower is better), then seniority DESC, then hours deficit
            candidates_with_scores = []
            for nurse_name, rank, seniority in candidates:
                submission = self.nurse_by_name[nurse_name]
                hours_deficit = submission.fte_target_hours - self.nurse_hours[nurse_name]
                
                # Score: lower rank is better, higher seniority is better, higher deficit is better
                score = (rank, -seniority, -hours_deficit)
                candidates_with_scores.append((nurse_name, score))
            
            # Sort by score (natural tuple ordering)
            candidates_with_scores.sort(key=lambda x: x[1])
            
            # Try to assign to highest priority candidate
            assigned = False
            winner = None
            
            for nurse_name, score in candidates_with_scores:
                can_assign, reason = self._can_assign(nurse_name, date, shift_code)
                
                if can_assign:
                    self._assign_shift(nurse_name, date, shift_code)
                    resolved_count += 1
                    winner = nurse_name
                    assigned = True
                    logger.info(f"     ✓ Winner: {nurse_name} (rank={score[0]}, seniority={-score[1]:.1f})")
                    
                    result = PreferenceResult(
                        date=date,
                        shift_code=shift_code,
                        status=PreferenceReasonCode.ASSIGNED,
                        assigned=True,
                        reason_detail="Won conflict by seniority/rank"
                    )
                    self.preference_results[nurse_name].append(result)
                    break
            
            # Record losses for other candidates
            if winner:
                for nurse_name, score in candidates_with_scores:
                    if nurse_name != winner:
                        result = PreferenceResult(
                            date=date,
                            shift_code=shift_code,
                            status=PreferenceReasonCode.CONFLICT_SENIORITY,
                            assigned=False,
                            reason_detail=f"Lost conflict to {winner}",
                            conflicting_nurse=winner
                        )
                        self.preference_results[nurse_name].append(result)
        
        logger.info(f"\nStage 2 complete: {resolved_count} conflicts resolved")

    def _stage3_gap_filler(self):
        """
        Stage 3: GAP FILLER
        
        Fill remaining staffing gaps, prioritizing nurses who are under their
        FTE target. Respects rotation preferences and clinical constraints.
        """
        logger.info("\n" + "=" * 60)
        logger.info("STAGE 3: GAP FILLER - Filling Remaining Slots")
        logger.info("=" * 60)
        
        filled_count = 0
        
        for date in self.date_list:
            slots = self.slots_by_date.get(date, [])
            
            for slot in slots:
                if slot.is_filled:
                    continue
                
                # Find best nurse to fill this slot
                best_nurse = self._find_best_nurse_for_slot(slot)
                
                if best_nurse:
                    self._assign_shift(best_nurse, date, slot.shift_code)
                    slot.is_filled = True
                    slot.assigned_nurse = best_nurse
                    filled_count += 1
                    logger.debug(f"  📥 GAP FILL: {best_nurse} → {slot.shift_code} on {date}")
                else:
                    logger.warning(f"  ⚠ Could not fill slot: {slot.shift_code} on {date}")
        
        logger.info(f"\nStage 3 complete: {filled_count} slots filled")

    def _find_best_nurse_for_slot(self, slot: StaffingSlot) -> Optional[str]:
        """
        Find the best available nurse to fill a staffing slot.
        
        Priority:
        1. Nurse has this as a lower-ranked preference (they wanted it but didn't get it)
        2. Nurse is furthest below FTE target
        3. Respects rotation preference (block vs spaced)
        4. Meets certification requirements
        """
        candidates: List[Tuple[str, float]] = []
        
        for submission in self.submissions:
            nurse_name = submission.nurse_name
            
            # Check if can assign
            can_assign, reason = self._can_assign(nurse_name, slot.date, slot.shift_code)
            if not can_assign:
                continue
            
            # Check certifications
            if slot.required_certifications:
                if not slot.required_certifications.issubset(submission.certifications):
                    continue
            
            # Calculate priority score (lower is better)
            hours_deficit = submission.fte_target_hours - self.nurse_hours[nurse_name]
            
            # Check if this was a preference
            preference_rank = 999
            for pref in submission.preferences:
                if pref.date == slot.date and pref.shift_code == slot.shift_code:
                    preference_rank = pref.rank
                    break
            
            # Rotation fit score
            rotation_fit = self._calculate_rotation_fit(nurse_name, slot.date, submission.rotation_preference)
            
            # Score: preference rank, hours deficit (negative means under target), rotation fit
            score = (preference_rank, -hours_deficit, rotation_fit)
            candidates.append((nurse_name, score))
        
        if not candidates:
            return None
        
        # Sort by score and return best
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]

    def _calculate_rotation_fit(self, nurse_name: str, date: str, preference: RotationPreference) -> float:
        """Calculate how well this assignment fits the nurse's rotation preference"""
        if preference == RotationPreference.NONE:
            return 0.0
        
        day_idx = self.date_to_index.get(date, 0)
        schedule = self.schedule[nurse_name]
        
        # Count consecutive work days before and after
        consecutive_before = 0
        for i in range(day_idx - 1, -1, -1):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                consecutive_before += 1
            else:
                break
        
        consecutive_after = 0
        for i in range(day_idx + 1, len(schedule)):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                consecutive_after += 1
            else:
                break
        
        total_consecutive = consecutive_before + 1 + consecutive_after
        
        if preference == RotationPreference.BLOCK:
            # Prefer assignments that extend blocks
            return -total_consecutive  # More consecutive = better (lower score)
        else:  # SPACED
            # Prefer assignments that are isolated
            return total_consecutive  # Less consecutive = better (lower score)

    def _can_assign(self, nurse_name: str, date: str, shift_code: str) -> Tuple[bool, PreferenceReasonCode]:
        """
        Check if a nurse can be assigned to a shift, respecting all constraints.
        
        Returns (can_assign, reason_if_not)
        """
        submission = self.nurse_by_name.get(nurse_name)
        if not submission:
            return False, PreferenceReasonCode.MIN_STAFFING_GAP
        
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return False, PreferenceReasonCode.MIN_STAFFING_GAP
        
        # Check if already assigned
        if self.schedule[nurse_name][day_idx]:
            return False, PreferenceReasonCode.ALREADY_ASSIGNED
        
        shift_info = self._get_shift_info(shift_code)
        shift_hours = shift_info.get("hours", 12.0)
        shift_type = shift_info.get("type", "day")
        
        # Check hours cap
        if self.nurse_hours[nurse_name] + shift_hours > submission.fte_target_hours + self.config.overtime_cap_hours:
            return False, PreferenceReasonCode.OVERTIME_CAP
        
        # Check 11-hour rest rule
        if not self._check_rest_rule(nurse_name, date, shift_info):
            return False, PreferenceReasonCode.REST_VIOLATION
        
        # Check consecutive limit
        if not self._check_consecutive_limit(nurse_name, date, shift_hours):
            return False, PreferenceReasonCode.CONSECUTIVE_LIMIT
        
        # Check 50% day shift rule (if not permanent night)
        if not submission.is_permanent_night:
            if not self._check_day_shift_rule(nurse_name, shift_type):
                return False, PreferenceReasonCode.DAY_SHIFT_RULE
        
        # Check weekend balance
        if self._is_weekend(date):
            if not self._check_weekend_balance(nurse_name):
                return False, PreferenceReasonCode.WEEKEND_BALANCE
        
        return True, PreferenceReasonCode.ASSIGNED

    def _check_rest_rule(self, nurse_name: str, date: str, shift_info: Dict) -> bool:
        """Check 11-hour minimum rest between shifts"""
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return True
        
        schedule = self.schedule[nurse_name]
        new_start = self._parse_time(shift_info.get("start", "07:00"))
        new_end = self._parse_time(shift_info.get("end", "19:00"))
        
        # Check previous day
        if day_idx > 0:
            prev_shift = schedule[day_idx - 1]
            if prev_shift and prev_shift.get("hours", 0) > 0:
                prev_end = self._parse_time(prev_shift.get("endTime", "19:00"))
                
                # Calculate rest hours (handle overnight)
                if prev_end > new_start:
                    # Previous shift ends after midnight
                    rest_hours = (24 - prev_end.hour) + new_start.hour
                else:
                    rest_hours = new_start.hour - prev_end.hour + (new_start.minute - prev_end.minute) / 60
                
                if rest_hours < self.config.min_rest_hours:
                    return False
        
        # Check next day
        if day_idx < len(schedule) - 1:
            next_shift = schedule[day_idx + 1]
            if next_shift and next_shift.get("hours", 0) > 0:
                next_start = self._parse_time(next_shift.get("startTime", "07:00"))
                
                if new_end > next_start:
                    rest_hours = (24 - new_end.hour) + next_start.hour
                else:
                    rest_hours = next_start.hour - new_end.hour + (next_start.minute - new_end.minute) / 60
                
                if rest_hours < self.config.min_rest_hours:
                    return False
        
        return True

    def _check_consecutive_limit(self, nurse_name: str, date: str, shift_hours: float) -> bool:
        """Check max consecutive shifts constraint"""
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return True
        
        schedule = self.schedule[nurse_name]
        max_allowed = self.config.max_consecutive_12h if shift_hours >= 12 else self.config.max_consecutive_any
        
        # Count consecutive before
        consecutive = 0
        for i in range(day_idx - 1, -1, -1):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                consecutive += 1
            else:
                break
        
        # Count consecutive after
        for i in range(day_idx + 1, len(schedule)):
            if schedule[i] and schedule[i].get("hours", 0) > 0:
                consecutive += 1
            else:
                break
        
        return consecutive + 1 <= max_allowed

    def _check_day_shift_rule(self, nurse_name: str, new_shift_type: str) -> bool:
        """Check 50% day shift requirement"""
        total_shifts = self.nurse_day_shifts[nurse_name] + self.nurse_night_shifts[nurse_name]
        
        if total_shifts < 2:
            return True  # Not enough data yet
        
        if new_shift_type == "day":
            new_day = self.nurse_day_shifts[nurse_name] + 1
            new_total = total_shifts + 1
        else:
            new_day = self.nurse_day_shifts[nurse_name]
            new_total = total_shifts + 1
        
        percentage = (new_day / new_total) * 100
        
        # Allow some flexibility - check if adding this shift would make it impossible
        # to reach 50% by end of period
        return percentage >= (self.config.day_shift_min_percentage - 10)  # Allow 10% buffer

    def _check_weekend_balance(self, nurse_name: str) -> bool:
        """Check weekend fairness constraint"""
        # Count total weekends in period
        total_weekends = sum(1 for d in self.date_list if self._is_weekend(d))
        total_weekends = total_weekends // 2  # Sat+Sun = 1 weekend
        
        if total_weekends == 0:
            return True
        
        max_allowed = int(total_weekends * self.config.weekend_max_ratio) + 1
        return self.nurse_weekend_shifts[nurse_name] < max_allowed

    def _is_weekend(self, date: str) -> bool:
        """Check if date is a weekend (Sat or Sun)"""
        dt = datetime.strptime(date, "%Y-%m-%d")
        return dt.weekday() >= 5

    def _parse_time(self, time_str: str) -> datetime:
        """Parse time string to datetime"""
        if not time_str:
            return datetime.strptime("07:00", "%H:%M")
        try:
            return datetime.strptime(time_str, "%H:%M")
        except ValueError:
            return datetime.strptime("07:00", "%H:%M")

    def _get_shift_info(self, shift_code: str) -> Dict:
        """Get shift metadata from code"""
        code_upper = shift_code.upper().strip()
        
        # Check shifts_info first
        if code_upper in self.shifts_info:
            return self.shifts_info[code_upper]
        
        # Default logic based on code patterns
        if code_upper.startswith("Z07") or code_upper.startswith("ZD"):
            return {"type": "day", "hours": 12.0, "start": "07:00", "end": "19:00"}
        elif code_upper.startswith("Z19") or code_upper.startswith("ZN"):
            return {"type": "night", "hours": 12.0, "start": "19:00", "end": "07:00"}
        elif code_upper.startswith("Z23"):
            return {"type": "night", "hours": 8.0, "start": "23:00", "end": "07:00"}
        elif code_upper.startswith("Z15"):
            return {"type": "day", "hours": 8.0, "start": "15:00", "end": "23:00"}
        elif code_upper.startswith("D8"):
            return {"type": "day", "hours": 8.0, "start": "07:00", "end": "15:00"}
        else:
            return {"type": "day", "hours": 12.0, "start": "07:00", "end": "19:00"}

    def _assign_shift(self, nurse_name: str, date: str, shift_code: str):
        """Assign a shift to a nurse"""
        day_idx = self.date_to_index.get(date)
        if day_idx is None:
            return
        
        shift_info = self._get_shift_info(shift_code)
        
        shift_entry = {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": shift_code,
            "shiftType": shift_info.get("type", "day"),
            "hours": shift_info.get("hours", 12.0),
            "startTime": shift_info.get("start", "07:00"),
            "endTime": shift_info.get("end", "19:00"),
            "isPreferenceAssigned": True
        }
        
        self.schedule[nurse_name][day_idx] = shift_entry
        self.nurse_hours[nurse_name] += shift_info.get("hours", 12.0)
        
        if shift_info.get("type") == "day":
            self.nurse_day_shifts[nurse_name] += 1
        else:
            self.nurse_night_shifts[nurse_name] += 1
        
        if self._is_weekend(date):
            self.nurse_weekend_shifts[nurse_name] += 1
        
        # Update filled slots
        key = (date, shift_info.get("type", "day"))
        if key in self.filled_slots:
            self.filled_slots[key].add(nurse_name)

    def _build_results(self) -> Dict[str, NurseOptimizationResult]:
        """Build final optimization results"""
        results = {}
        
        for submission in self.submissions:
            nurse_name = submission.nurse_name
            
            # Filter out None entries
            assigned_shifts = [s for s in self.schedule[nurse_name] if s is not None]
            
            total_hours = self.nurse_hours[nurse_name]
            target = submission.fte_target_hours
            
            day_shifts = self.nurse_day_shifts[nurse_name]
            night_shifts = self.nurse_night_shifts[nurse_name]
            total_shifts = day_shifts + night_shifts
            
            day_percentage = (day_shifts / total_shifts * 100) if total_shifts > 0 else 0
            
            result = NurseOptimizationResult(
                nurse_id=submission.nurse_id,
                nurse_name=nurse_name,
                assigned_shifts=assigned_shifts,
                preference_results=self.preference_results[nurse_name],
                total_hours=total_hours,
                target_hours=target,
                target_delta=total_hours - target,
                day_shift_percentage=day_percentage,
                weekend_shifts=self.nurse_weekend_shifts[nurse_name],
                stats={
                    "preferences_submitted": len([p for p in submission.preferences if not p.is_off_request]),
                    "preferences_honored": len([r for r in self.preference_results[nurse_name] if r.assigned]),
                    "conflicts_lost": len([r for r in self.preference_results[nurse_name] if r.status == PreferenceReasonCode.CONFLICT_SENIORITY]),
                    "day_shifts": day_shifts,
                    "night_shifts": night_shifts
                }
            )
            
            results[nurse_name] = result
        
        return results


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def convert_legacy_preferences_to_submissions(
    nurses: List[Dict],
    preferences: Dict[str, List[str]],
    date_list: List[str],
    shifts_info: Dict
) -> List[NurseSubmission]:
    """
    Convert legacy OCR-based preferences to NurseSubmission objects.
    
    This allows the existing OCR workflow to use the new self-scheduling engine.
    """
    submissions = []
    
    for nurse in nurses:
        name = nurse.get("name", "")
        nurse_prefs = preferences.get(name, [])
        
        # Determine FTE target
        emp_type = nurse.get("employmentType", "FT")
        if emp_type == "FT":
            fte_target = 75.0
        elif emp_type == "PT":
            fte_target = 63.75
        else:
            fte_target = 40.0
        
        # Convert preferences
        shift_preferences = []
        for day_idx, shift_code in enumerate(nurse_prefs):
            if day_idx >= len(date_list):
                break
            
            date = date_list[day_idx]
            
            if not shift_code or not shift_code.strip():
                continue
            
            code = shift_code.strip().upper()
            
            # Check for off codes
            is_off = code in ["C", "OFF"] or code.startswith("CF")
            
            pref = ShiftPreference(
                date=date,
                shift_code=shift_code,
                rank=1,  # Legacy: all preferences equal priority
                is_off_request=is_off,
                off_code=shift_code if is_off else ""
            )
            shift_preferences.append(pref)
        
        # Build certifications set
        certs = set()
        if nurse.get("isChemoCertified") or nurse.get("is_chemo_certified"):
            certs.add("chemo")
        if nurse.get("isTransplantCertified") or nurse.get("is_transplant_certified"):
            certs.add("transplant")
        if nurse.get("isRenalCertified") or nurse.get("is_renal_certified"):
            certs.add("renal")
        if nurse.get("isChargeCertified") or nurse.get("is_charge_certified"):
            certs.add("charge")
        
        submission = NurseSubmission(
            nurse_id=str(nurse.get("id", name)),
            nurse_name=name,
            seniority=_parse_seniority(nurse.get("seniority", 0)),
            employment_type=emp_type,
            fte_target_hours=fte_target,
            preferences=shift_preferences,
            max_weekly_hours=nurse.get("maxWeeklyHours", 40.0),
            certifications=certs
        )
        
        submissions.append(submission)
    
    return submissions


def _parse_seniority(raw_value) -> float:
    """Parse seniority value from various formats"""
    import re
    
    if raw_value is None:
        return 0.0
    if isinstance(raw_value, (int, float)):
        return float(raw_value)
    
    text = str(raw_value).strip()
    if not text:
        return 0.0
    
    matches = re.findall(r"\d+(?:\.\d+)?", text)
    if not matches:
        return 0.0
    
    return float(matches[-1])
