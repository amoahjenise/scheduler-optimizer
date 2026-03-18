# /backend/app/api/routes/optimized_schedule.py
import uuid
import re
import json
import ast
import logging
import difflib
import unicodedata
from datetime import datetime, timedelta
from typing import Dict, List, Union, Set, Tuple, Any, Optional
import math
from collections import defaultdict

from fastapi import APIRouter, Body, Depends, HTTPException, Header
from pydantic import UUID4, BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential
from ortools.sat.python import cp_model
from openai import OpenAI

from app.db.deps import get_db
from app.core.config import settings
from app.core.auth import get_optional_auth, AuthContext
from app.models.optimized_schedule import OptimizedSchedule
from app.models.system_prompt import SystemPrompt
from app.models.nurse import Nurse
from app.schemas.optimized_schedule import OptimizeRequest, OptimizeResponse, RefineRequest, InsightsRequest
from app.api.routes.system_prompts import get_system_prompt, DEFAULT_PROMPT_CONTENT, build_default_prompt_content
from app.services.deletion_activity import record_deletion_activity
from app.services.self_scheduling import (
    SelfSchedulingEngine, 
    NurseSubmission, 
    ShiftPreference,
    RotationPreference,
    ShiftTypeChoice,
    OptimizationConfig,
    convert_legacy_preferences_to_submissions
)

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logger.addHandler(handler)

router = APIRouter(redirect_slashes=False)
client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=360.0)

# Complete shift codes lookup with all properties (actual codes used on schedules)
SHIFT_CODES = {
    "07": {"label": "Day 8hr", "type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"},
    "Z07": {"label": "Day 12hr", "type": "day", "hours": 11.25, "start": "07:00", "end": "19:25"},
    "11": {"label": "Mid 8hr", "type": "day", "hours": 7.5, "start": "11:00", "end": "19:15"},
    "Z11": {"label": "Mid 12hr", "type": "day", "hours": 11.25, "start": "11:00", "end": "23:25"},
    "E15": {"label": "Evening 8hr", "type": "day", "hours": 7.5, "start": "15:00", "end": "23:15"},
    "23": {"label": "Night 8hr", "type": "night", "hours": 7.5, "start": "23:00", "end": "07:15"},
    "Z19": {"label": "Night 12hr", "type": "night", "hours": 11.25, "start": "19:00", "end": "07:25"},
    "Z23": {"label": "Night Finish", "type": "night", "hours": 7.5, "start": "23:00", "end": "07:25"},
    "Z23 B": {"label": "Night Finish + Back at 19:00", "type": "combined", "hours": 7.5, "start": "23:00", "end": "07:25"},
    "OFF": {"label": "Off", "type": "off", "hours": 0, "start": "", "end": ""},
}


# ============================================================================
# SELF-SCHEDULING PYDANTIC MODELS
# ============================================================================

class ShiftPreferenceInput(BaseModel):
    """A single shift preference from a nurse"""
    date: str
    shift_code: str
    rank: int = 1
    is_off_request: bool = False
    off_code: str = ""
    comment: str = ""


class NurseSubmissionInput(BaseModel):
    """Complete submission from a nurse for the scheduling period"""
    nurse_id: str
    nurse_name: str
    seniority: float = 0.0
    employment_type: str = "FT"
    fte_target_hours: float = 75.0
    preferences: List[ShiftPreferenceInput] = Field(default_factory=list)
    rotation_preference: str = "none"  # "block", "spaced", "none"
    shift_type_choice: str = "mixed"   # "8h", "12h", "mixed"
    is_permanent_night: bool = False
    max_weekly_hours: float = 40.0
    certifications: List[str] = Field(default_factory=list)


class OptimizationConfigInput(BaseModel):
    """Configuration for the optimization engine"""
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


class SelfScheduleRequest(BaseModel):
    """Request payload for self-scheduling optimization"""
    submissions: List[NurseSubmissionInput]
    dates: List[str]
    staffing_requirements: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    config: Optional[OptimizationConfigInput] = None
    use_legacy_preferences: bool = False  # If true, use OCR-style preferences
    schedule_id: Optional[str] = None


class SelfScheduleResponse(BaseModel):
    """Response from self-scheduling optimization"""
    schedule_id: str
    results: Dict[str, Any]  # {nurse_name: NurseOptimizationResult as dict}
    summary: Dict[str, Any]
    grid: List[Dict[str, Any]]  # Format matching existing grid structure


def get_shift_info(shift_code: str) -> Optional[Dict]:
    """Get shift info by code, case-insensitive"""
    # Try exact match first
    if shift_code in SHIFT_CODES:
        return SHIFT_CODES[shift_code]
    # Try case-insensitive match
    for code, info in SHIFT_CODES.items():
        if code.upper() == shift_code.upper():
            return {**info, "code": code}  # Return with correct code casing
    return None


def _normalize_schedule_payload(result_data: Any) -> Dict[str, Any]:
    """Normalize schedule payload across legacy and canonical storage shapes."""
    schedule_data = result_data.get("schedule_data") if isinstance(result_data, dict) else None
    if not schedule_data:
        # Legacy rows store schedule directly in result
        schedule_data = result_data if isinstance(result_data, dict) else {}

    # Legacy finalize payload may be nurse->shifts dictionary.
    # Convert it into canonical shape: {dates, schedule, grid, dateRange}.
    if isinstance(schedule_data, dict):
        has_canonical_shape = any(
            k in schedule_data for k in ["schedule", "grid", "dates", "dateRange", "start_date", "end_date"]
        )
        if not has_canonical_shape:
            nurse_rows = []
            all_dates = set()
            for nurse_name, shifts in schedule_data.items():
                if isinstance(shifts, list):
                    nurse_rows.append({"nurse": nurse_name, "shifts": shifts})
                    for shift in shifts:
                        if isinstance(shift, dict) and shift.get("date"):
                            all_dates.add(shift.get("date"))

            sorted_dates = sorted([d for d in all_dates if isinstance(d, str)])
            schedule_data = {
                "schedule": nurse_rows,
                "grid": nurse_rows,
                "dates": sorted_dates,
                "dateRange": {
                    "start": sorted_dates[0] if sorted_dates else "",
                    "end": sorted_dates[-1] if sorted_dates else "",
                },
            }

    return schedule_data if isinstance(schedule_data, dict) else {}


def _resolve_schedule_date_range(result_data: Any, schedule_data: Dict[str, Any]) -> Tuple[str, str]:
    """Resolve schedule date range from result payload with legacy fallbacks."""
    start_date = ""
    end_date = ""
    if isinstance(result_data, dict):
        start_date = result_data.get("start_date") or result_data.get("dateRange", {}).get("start") or ""
        end_date = result_data.get("end_date") or result_data.get("dateRange", {}).get("end") or ""

    # Final fallback: derive from explicit dates array
    if not start_date or not end_date:
        dates = schedule_data.get("dates", []) if isinstance(schedule_data, dict) else []
        if isinstance(dates, list) and dates:
            start_date = start_date or dates[0]
            end_date = end_date or dates[-1]

    return start_date, end_date


def _scoped_schedule_query(
    db: Session,
    auth: AuthContext,
    schedule_id: Optional[str] = None,
):
    """Build a schedule query scoped to the authenticated organization when present."""
    query = db.query(OptimizedSchedule)
    if schedule_id:
        query = query.filter(OptimizedSchedule.id == schedule_id)

    if auth.is_authenticated and auth.organization_id:
        # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
        query = query.filter(OptimizedSchedule.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> ensure no data is returned
        # Use an impossible filter to guarantee empty result
        query = query.filter(OptimizedSchedule.id == "no-access-without-org")

    return query


def _get_scoped_schedule_or_404(
    db: Session,
    auth: AuthContext,
    schedule_id: str,
) -> OptimizedSchedule:
    schedule = _scoped_schedule_query(db, auth, schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


def _get_mutable_schedule_or_404(
    db: Session,
    auth: AuthContext,
    schedule_id: str,
) -> OptimizedSchedule:
    """Fetch a schedule for mutation - requires matching organization."""
    schedule = db.query(OptimizedSchedule).filter(OptimizedSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Require authenticated user with organization membership
    if not auth.is_authenticated or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this draft")
    
    # Only allow access to schedules belonging to user's organization
    if schedule.organization_id != auth.organization_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this draft")

    return schedule


class RobustScheduler:
    """
    A guaranteed-to-work scheduler that ALWAYS produces a valid schedule.
    Uses greedy assignment with constraint validation.
    """
    
    def __init__(self, nurses: List[Dict], date_list: List[str], 
                 day_shift_codes: List[str], night_shift_codes: List[str],
                 shifts_info: Dict, day_req: int, night_req: int,
                 max_consecutive: int = 3, preferences: Dict = None,
                 nurse_defaults: Dict[str, Dict] = None):
        # Initialize shift code rotation indices
        self._day_code_index = 0
        self._night_code_index = 0
        # Track consecutive nights per nurse for B suffix (Z23, Z23 B, Z23 B pattern)
        self._nurse_consecutive_nights: Dict[str, int] = {}
        
        # ── PRE-CLEAN OCR PREFERENCES ──────────────────────────────────
        # Remove ghost tails (plain Z23 after night-start codes) from the
        # raw OCR data BEFORE it enters the pipeline. This is the definitive
        # fix for "Date Stacking": we count hours in a timeline, not words
        # on a page.
        if preferences:
            logger.info("=" * 80)
            logger.info("PRE-CLEANING OCR PREFERENCES (removing ghost tails at source)")
            preferences = RobustScheduler._preprocess_ocr_preferences(preferences, shifts_info)
            logger.info("=" * 80)

        # CRITICAL FIX: Ensure all nurses from preferences are included in the nurses array.
        # This fixes the bug where nurses with empty OCR cells were excluded from scheduling
        # because they weren't being sent in the nurses array from the frontend.
        self.nurse_defaults = nurse_defaults or {}
        nurse_names_in_array = {n.get("name", "").strip().lower() for n in nurses if n.get("name")}
        if preferences:
            for pref_nurse_name in preferences.keys():
                if pref_nurse_name.strip().lower() not in nurse_names_in_array:
                    # Look up nurse defaults from database config
                    db_defaults = self.nurse_defaults.get(pref_nurse_name.strip().lower(), {})
                    logger.warning(f"Adding missing nurse from preferences: {pref_nurse_name} (db config found: {bool(db_defaults)})")
                    
                    # Build nurse dict - only include fields we have from DB
                    # Let get_max_hours() and get_target_biweekly_hours() use their built-in defaults
                    nurse_entry = {
                        "name": pref_nurse_name,
                        "employmentType": db_defaults.get("employmentType", "full-time"),
                        "offRequests": db_defaults.get("offRequests", []),
                        "isChemoCertified": db_defaults.get("isChemoCertified", False),
                        "isTransplantCertified": db_defaults.get("isTransplantCertified", False),
                        "isRenalCertified": db_defaults.get("isRenalCertified", False),
                        "isChargeCertified": db_defaults.get("isChargeCertified", False),
                    }
                    # Only include bi-weekly target if we have it from DB (this is the key scheduling parameter)
                    if "targetBiWeeklyHours" in db_defaults:
                        nurse_entry["targetBiWeeklyHours"] = db_defaults["targetBiWeeklyHours"]
                    
                    nurses.append(nurse_entry)
                    nurse_names_in_array.add(pref_nurse_name.strip().lower())

        # ── LEAVE STATUS FILTER ─────────────────────────────────────
        # Track nurses who are on maternity leave, sick leave, or
        # sabbatical.  They should not be assigned any shifts by the
        # scheduling steps (gap-fill, force-fill, balance).  They remain
        # in the nurses array so they appear in the output (all OFF).
        self.nurses_on_leave: Set[str] = set()
        for nurse in nurses:
            on_leave = (
                bool(nurse.get("isOnMaternityLeave"))
                or bool(nurse.get("isOnSickLeave"))
                or bool(nurse.get("isOnSabbatical"))
            )
            if on_leave:
                self.nurses_on_leave.add(nurse["name"])
                logger.info(f"  LEAVE FILTER: '{nurse['name']}' will be all-OFF "
                            f"(maternity={nurse.get('isOnMaternityLeave')}, "
                            f"sick={nurse.get('isOnSickLeave')}, "
                            f"sabbatical={nurse.get('isOnSabbatical')})")
        if self.nurses_on_leave:
            logger.info(f"  LEAVE FILTER: {len(self.nurses_on_leave)} nurses on leave")

        # Track which (nurse, date) tuples have OCR shifts - these are BINDING and should NEVER be removed
        self.ocr_assignments: Set[Tuple[str, str]] = set()
        date_to_idx = {d: i for i, d in enumerate(date_list)}  # Temporary for logging
        if preferences:
            for nurse_name, shifts in preferences.items():
                for day_idx, shift_code in enumerate(shifts):
                    if shift_code and shift_code.strip() and shift_code.upper() not in ["C", "OFF"] and not shift_code.upper().startswith("CF"):
                        if day_idx < len(date_list):
                            date = date_list[day_idx]
                            self.ocr_assignments.add((nurse_name, date))
        
        logger.info("=" * 80)
        logger.info(f"OCR ASSIGNMENTS TRACKING: {len(self.ocr_assignments)} binding OCR shifts")
        for nurse_name, date in sorted(self.ocr_assignments):
            day_idx = date_to_idx.get(date, -1)
            shift_code = preferences.get(nurse_name, [])[day_idx] if nurse_name in preferences and day_idx >= 0 and day_idx < len(preferences[nurse_name]) else "???"
            logger.info(f"  BINDING OCR: {nurse_name} on {date} -> {shift_code}")
        logger.info("=" * 80)
        
        self.nurses = nurses
        self.date_list = date_list
        self.date_to_index = {d: i for i, d in enumerate(date_list)}
        # Use provided codes or defaults with variety
        self.day_shift_codes = day_shift_codes if day_shift_codes else ["Z07", "07"]
        self.night_shift_codes = night_shift_codes if night_shift_codes else ["Z23", "Z23 B", "23"]
        self.shifts_info = shifts_info
        self.reference_shift_hours = self._resolve_reference_shift_hours()
        self.day_req = max(day_req, 1)  # At least 1
        self.night_req = max(night_req, 1)  # At least 1
        self.max_consecutive = max_consecutive
        self.preferences = preferences or {}
        
        # Build nurse name index
        self.nurse_by_name = {n["name"]: n for n in nurses}
        self.nurse_names = [n["name"] for n in nurses]
        self.nurse_seniority: Dict[str, float] = {
            n["name"]: self._parse_seniority_value(n.get("seniority", 0))
            for n in nurses
        }
        
        # Build ISO week mapping for dates
        from datetime import datetime
        self.date_to_week = {}
        for date_str in date_list:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            # Get ISO week (year, week_number)
            iso_year, iso_week, _ = dt.isocalendar()
            week_key = f"{iso_year}-W{iso_week:02d}"
            self.date_to_week[date_str] = week_key

        # Build 14-day pay-period mapping (reconciliation window)
        self.date_to_period: Dict[str, str] = {}
        self.period_to_dates: Dict[str, List[str]] = defaultdict(list)
        for i, date_str in enumerate(date_list):
            period_key = f"P{(i // 14) + 1:02d}"
            self.date_to_period[date_str] = period_key
            self.period_to_dates[period_key].append(date_str)
        
        logger.debug(f"Date to week mapping: {self.date_to_week}")
        
        # COMPREHENSIVE LOGGING
        logger.info("=" * 80)
        logger.info("ROBUSTSCHEDULER INITIALIZATION")
        logger.info("=" * 80)
        logger.info(f"Received {len(nurses)} nurses:")
        for i, nurse in enumerate(nurses, 1):
            off_reqs = nurse.get('offRequests', [])
            logger.info(f"  {i}. {nurse.get('name', 'UNNAMED')} | Type: {nurse.get('employmentType', 'N/A')} | Max Hours: {nurse.get('maxWeeklyHours', 'N/A')} | OFF Requests: {off_reqs if off_reqs else 'none'}")
        logger.info(f"Date range: {date_list[0]} to {date_list[-1]} ({len(date_list)} days)")
        logger.info(f"Staffing requirements: {day_req} day, {night_req} night")
        logger.info(f"Shift codes: Day={self.day_shift_codes}, Night={self.night_shift_codes}")
        logger.info(f"Preferences/OCR data: {len(preferences) if preferences else 0} nurses have existing shifts")
        if preferences:
            logger.info("  OCR nurses: " + ", ".join(preferences.keys()))
        logger.info("=" * 80)
        
        # Track state
        self.schedule: Dict[str, List[Dict]] = {n["name"]: [] for n in nurses}
        self.nurse_consecutive: Dict[str, int] = {n["name"]: 0 for n in nurses}
        # Track hours per nurse per week: {nurse_name: {week_key: hours}}
        self.nurse_weekly_hours: Dict[str, Dict[str, float]] = {n["name"]: {} for n in nurses}
        # Track hours per nurse per 14-day pay period: {nurse_name: {period_key: hours}}
        self.nurse_period_hours: Dict[str, Dict[str, float]] = {n["name"]: {} for n in nurses}
        self.nurse_total_shifts: Dict[str, int] = {n["name"]: 0 for n in nurses}
        
    def get_off_requests(self, nurse_name: str) -> Set[str]:
        """Get off request dates for a nurse"""
        nurse = self.nurse_by_name.get(nurse_name, {})
        return set(nurse.get("offRequests", []))

    def get_certification_score(self, nurse_name: str) -> int:
        """Higher score means nurse has broader certifications."""
        nurse = self.nurse_by_name.get(nurse_name, {})
        cert_fields = [
            "isChemoCertified",
            "isTransplantCertified",
            "isRenalCertified",
            "isChargeCertified",
            # tolerate snake_case payloads if present
            "is_chemo_certified",
            "is_transplant_certified",
            "is_renal_certified",
            "is_charge_certified",
        ]
        return sum(1 for field in cert_fields if bool(nurse.get(field, False)))

    @staticmethod
    def _parse_seniority_value(raw_value: Any) -> float:
        """Parse seniority values robustly from numeric or mixed string formats."""
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

        # Prefer the most specific numeric suffix (e.g., "3Y-283.95D" -> 283.95)
        return float(matches[-1])
    
    def get_max_hours(self, nurse_name: str) -> float:
        """Get max weekly hours for a nurse - respects PT vs FT"""
        nurse = self.nurse_by_name.get(nurse_name, {})
        # Check explicit maxWeeklyHours first
        max_hours = nurse.get("maxWeeklyHours")
        if max_hours is not None:
            try:
                return float(max_hours)
            except (TypeError, ValueError):
                pass
        # Check employment type
        emp_type = str(nurse.get("employmentType", "")).lower()
        if emp_type in ["pt", "part-time"]:
            return 40.0
        return 60.0

    def _resolve_reference_shift_hours(self) -> float:
        """Estimate a realistic paid-hours-per-shift baseline from configured shift codes."""
        configured_codes = set(self.day_shift_codes + self.night_shift_codes)
        collected_hours: List[float] = []

        for code in configured_codes:
            normalized_code = str(code or "").replace("*", "").strip().upper()
            shift_info = get_shift_info(normalized_code)
            hours = None

            if shift_info and shift_info.get("hours") is not None:
                hours = shift_info.get("hours")
            elif isinstance(self.shifts_info, dict):
                fallback = self.shifts_info.get(normalized_code)
                if isinstance(fallback, dict):
                    hours = fallback.get("hours")

            try:
                hours_val = float(hours) if hours is not None else None
            except (TypeError, ValueError):
                hours_val = None

            if hours_val is not None and hours_val > 0:
                collected_hours.append(hours_val)

        if not collected_hours:
            return 7.5

        # Clamp to a realistic hospital paid-hours range for one assignment slot.
        avg_hours = sum(collected_hours) / len(collected_hours)
        return max(7.5, min(11.25, avg_hours))
    
    def has_reached_hours_limit(self, nurse_name: str, date: str) -> bool:
        """Check if nurse has reached their hours limit for the week containing this date."""
        raw_max = self.get_max_hours(nurse_name)
        week_key = self.date_to_week.get(date, "unknown")
        current_hours = self.nurse_weekly_hours.get(nurse_name, {}).get(week_key, 0)
        return current_hours >= raw_max
    
    def get_remaining_hours(self, nurse_name: str, date: str) -> float:
        """Get remaining hours a nurse can work in the week containing this date"""
        raw_max = self.get_max_hours(nurse_name)
        week_key = self.date_to_week.get(date, "unknown")
        current_hours = self.nurse_weekly_hours.get(nurse_name, {}).get(week_key, 0)
        return max(0, raw_max - current_hours)

    def get_target_weekly_hours(self, nurse_name: str) -> float:
        """Get weekly target hours used for delta balancing (not hard max capacity)."""
        nurse = self.nurse_by_name.get(nurse_name, {})

        # Optional FTE-based mapping (when provided by client data):
        # 1.0 -> 37.5, 0.7 -> 26.25, 0.6 -> 22.5
        fte = nurse.get("fte")
        if fte is not None:
            try:
                fte_val = float(fte)
                if fte_val >= 0.95:
                    return 37.5
                if fte_val >= 0.65:
                    return 26.25
                if fte_val > 0:
                    return 22.5
            except (TypeError, ValueError):
                pass

        explicit_target = nurse.get("targetWeeklyHours")
        if explicit_target is not None:
            try:
                return float(explicit_target)
            except (TypeError, ValueError):
                pass

        # If bi-weekly target is provided, derive weekly target from it.
        explicit_biweekly = nurse.get("targetBiWeeklyHours")
        if explicit_biweekly is not None:
            try:
                return float(explicit_biweekly) / 2.0
            except (TypeError, ValueError):
                pass

        emp_type = str(nurse.get("employmentType", "")).lower()
        if emp_type in ["pt", "part-time"]:
            # MCH/FIQ default PT line is typically 0.7 FTE (52.5h/2w => 26.25h/week).
            # 0.6 FTE (45h/2w => 22.5h/week) remains supported via nurse-specific
            # targetWeeklyHours/targetBiWeeklyHours/fte overrides.
            return 26.25
        return 37.5

    def get_target_biweekly_hours(self, nurse_name: str) -> float:
        """Get 14-day target hours used for reconciliation-friendly balancing."""
        nurse = self.nurse_by_name.get(nurse_name, {})

        explicit_target = nurse.get("targetBiWeeklyHours")
        if explicit_target is not None:
            try:
                return float(explicit_target)
            except (TypeError, ValueError):
                pass

        # Default to 2x weekly target (FT=75, PT=52.5 unless overridden).
        return self.get_target_weekly_hours(nurse_name) * 2.0

    def _count_scheduled_off_days(self, nurse_name: str, period_key: str) -> int:
        """Count ALL off days for a nurse in a period from the actual schedule.

        This includes: explicit offRequests, OCR OFF codes (C, CF, *), and any
        day that was set to OFF during scheduling.  Using the schedule as the
        source of truth ensures vacation days from OCR data reduce the target
        correctly (fixes the Demitra bug where 10 OCR off days still showed
        as -30h delta).
        """
        period_dates = self.period_to_dates.get(period_key, [])
        off_count = 0
        off_requests = self.get_off_requests(nurse_name)
        for d in period_dates:
            # Count explicit off requests
            if d in off_requests:
                off_count += 1
                continue
            # Count OCR OFF codes that were processed in Step 1
            day_idx = self.date_to_index.get(d)
            if day_idx is not None and day_idx < len(self.schedule.get(nurse_name, [])):
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("shiftType") == "off" and shift.get("hours", 0) <= 0:
                    # Check if this was an explicit OCR off (C, CF, *) or offRequest
                    ocr_shift = self._get_raw_ocr_shift(nurse_name, day_idx)
                    if ocr_shift:
                        ocr_upper = ocr_shift.upper().strip()
                        if (ocr_upper in ["C", "OFF", "*"] or
                            ocr_upper.startswith("CF")):
                            off_count += 1
        return off_count

    def get_period_target_hours(self, nurse_name: str, period_key: str) -> float:
        """Target hours for one period, scaled by period length and reduced for ALL off days.

        Counts both explicit offRequests AND OCR-sourced off days (C, CF, *)
        so that nurses with vacation days from OCR have their target correctly
        reduced.  Each off day also contributes a virtual 7.5h credit toward
        scheduled hours (handled separately in _inject_vacation_credits).
        """
        period_dates = self.period_to_dates.get(period_key, [])
        total_days = len(period_dates)
        if total_days <= 0:
            return 0.0

        base_target = self.get_target_biweekly_hours(nurse_name) * (total_days / 14.0)

        # Count ALL off days (offRequests + OCR OFF codes) from the schedule
        off_requests = self.get_off_requests(nurse_name)
        off_days_in_period = sum(1 for d in period_dates if d in off_requests)

        # Also count OCR-sourced OFF days that aren't in offRequests
        scheduled_off = self._count_scheduled_off_days(nurse_name, period_key)
        total_off = max(off_days_in_period, scheduled_off)

        available_days = max(0, total_days - total_off)
        availability_ratio = available_days / total_days

        return base_target * availability_ratio

    def get_period_target_delta(self, nurse_name: str, date: str) -> float:
        """Current 14-day period delta = scheduled - target (negative means under-target)."""
        period_key = self.date_to_period.get(date, "unknown")
        scheduled = self.nurse_period_hours.get(nurse_name, {}).get(period_key, 0)
        target = self.get_period_target_hours(nurse_name, period_key)
        return scheduled - target

    def get_target_delta(self, nurse_name: str, date: str) -> float:
        """Primary balancing delta (pay-period based to support 12h reconciliation)."""
        return self.get_period_target_delta(nurse_name, date)

    def get_weekly_target_delta(self, nurse_name: str, date: str) -> float:
        """Current week delta = scheduled - target (negative means under-target)."""
        week_key = self.date_to_week.get(date, "unknown")
        scheduled = self.nurse_weekly_hours.get(nurse_name, {}).get(week_key, 0)
        target = self.get_target_weekly_hours(nurse_name)
        return scheduled - target

    def get_target_remaining_hours(self, nurse_name: str, date: str) -> float:
        """How many hours nurse can still take before reaching pay-period target."""
        delta = self.get_target_delta(nurse_name, date)
        return max(0.0, -delta)

    def get_period_total_scheduled_hours(self, date: str) -> float:
        period_key = self.date_to_period.get(date, "unknown")
        return sum(self.nurse_period_hours.get(n, {}).get(period_key, 0) for n in self.nurse_names)

    def get_period_total_target_hours(self, period_key: Optional[str] = None) -> float:
        if period_key:
            return sum(
                self.get_period_target_hours(nurse_name, period_key)
                for nurse_name in self.nurse_names
            )
        return sum(self.get_target_biweekly_hours(n) for n in self.nurse_names)

    def _is_weekend_date(self, date: str) -> bool:
        dt = datetime.strptime(date, "%Y-%m-%d")
        return dt.weekday() >= 5

    # Night shift codes whose end time extends into the next calendar day,
    # making it unsafe to schedule a day/mid shift the following morning.
    _NIGHT_CODES = {"Z19", "Z23", "Z23 B", "23", "N8-", "ZN-", "ZN8-", "ZN+ZE2-", "N8+ZE2-"}

    def _worked_night_previous_day(self, nurse_name: str, day_idx: int) -> bool:
        """Return True if the nurse worked a night shift on the previous day.
        
        Used as a minimum-rest guard: a nurse finishing a night shift at
        07:00-07:25 must NOT be assigned a day/mid shift (07, Z07, 11, Z11,
        E15, D8-) on the same calendar day.
        """
        if day_idx <= 0:
            return False
        prev_shift = self.schedule[nurse_name][day_idx - 1]
        if not prev_shift or prev_shift.get("hours", 0) <= 0:
            return False
        prev_code = str(prev_shift.get("shift", "")).strip().upper()
        prev_type = str(prev_shift.get("shiftType", "")).strip().lower()
        return prev_code in self._NIGHT_CODES or prev_type == "night"

    def _is_full_time(self, nurse_name: str) -> bool:
        nurse = self.nurse_by_name.get(nurse_name, {})
        emp_type = str(nurse.get("employmentType", "")).lower()
        return emp_type in ["ft", "full-time", "full_time"]

    def _has_weekend_in_period(self, nurse_name: str, period_key: str) -> bool:
        for d in self.period_to_dates.get(period_key, []):
            if not self._is_weekend_date(d):
                continue
            day_idx = self.date_to_index.get(d)
            if day_idx is None:
                continue
            shift = self.schedule.get(nurse_name, [])[day_idx] if day_idx < len(self.schedule.get(nurse_name, [])) else None
            if shift and shift.get("hours", 0) > 0:
                return True
        return False

    def _weekend_commitment_missing(self, nurse_name: str, date: str) -> bool:
        """Weekend 1:2 policy: work at least 1 out of every 2 weekends (per 14-day period).
        
        This is a configurable rule — applies to all nurses (FT and PT) since
        weekend coverage is a unit-wide requirement.  Nurses with explicit
        off-requests on ALL weekend dates in a period are exempt.
        """
        period_key = self.date_to_period.get(date, "unknown")
        off_requests = self.get_off_requests(nurse_name)
        
        # Check if nurse has off-requests on ALL weekend dates in this period
        weekend_dates = [d for d in self.period_to_dates.get(period_key, []) if self._is_weekend_date(d)]
        if weekend_dates and all(d in off_requests for d in weekend_dates):
            return False  # Exempt — all weekends are off-requests
        
        return not self._has_weekend_in_period(nurse_name, period_key)

    def _is_weekend_commitment_protected(self, nurse_name: str, date: str) -> bool:
        """Avoid removing the only weekend assignment in a period for FT nurses."""
        if not self._is_weekend_date(date):
            return False
        if not self._is_full_time(nurse_name):
            return False

        period_key = self.date_to_period.get(date, "unknown")
        weekend_work_days = 0
        for d in self.period_to_dates.get(period_key, []):
            if not self._is_weekend_date(d):
                continue
            day_idx = self.date_to_index.get(d)
            if day_idx is None:
                continue
            shift = self.schedule.get(nurse_name, [])[day_idx] if day_idx < len(self.schedule.get(nurse_name, [])) else None
            if shift and shift.get("hours", 0) > 0:
                weekend_work_days += 1
        return weekend_work_days <= 1

    def _is_on_vacation_around_weekend(self, nurse_name: str, date: str) -> bool:
        """Return True if the nurse has off days adjacent to this weekend date.

        A nurse taking time off before/after a weekend should not be scheduled
        on that weekend — it would break their vacation block.  Also returns
        True when the nurse has already met (or exceeded) their reduced target
        so there is no reason to schedule additional shifts.
        """
        if not self._is_weekend_date(date):
            return False

        off_requests = self.get_off_requests(nurse_name)
        if not off_requests:
            return False

        dt = datetime.strptime(date, "%Y-%m-%d")
        # Check the 3 weekdays before Saturday (Wed/Thu/Fri) and
        # 3 weekdays after Sunday (Mon/Tue/Wed) for off requests.
        check_offsets = range(-3, 4)  # -3..+3 days around the weekend date
        adjacent_off_count = 0
        for offset in check_offsets:
            check_date = (dt + timedelta(days=offset)).strftime("%Y-%m-%d")
            if check_date in off_requests:
                adjacent_off_count += 1

        # If the nurse has 2+ off days around this weekend, protect the weekend
        if adjacent_off_count >= 2:
            logger.debug(
                f"  {nurse_name} {date}: vacation-adjacent weekend guard "
                f"({adjacent_off_count} off days nearby)"
            )
            return True

        # Also protect weekends when the nurse has already met their reduced target
        period_key = self.date_to_period.get(date, "unknown")
        scheduled = self.nurse_period_hours.get(nurse_name, {}).get(period_key, 0)
        target = self.get_period_target_hours(nurse_name, period_key)
        if target <= 0 or scheduled >= target:
            logger.debug(
                f"  {nurse_name} {date}: already at/above target "
                f"({scheduled:.1f}h / {target:.1f}h), skipping weekend"
            )
            return True

        return False

    def _select_candidate_for_assignment(self, candidates: List[str], date: str, hours: float = 12) -> Optional[str]:
        """Select best candidate preferring nurses under their period target and
        who have remaining target capacity for the requested hours.
        Returns None if no suitable candidate found.
        """
        if not candidates:
            return None

        # Prefer nurses who are under their target (negative delta) AND have
        # room under their pay-period target remaining for this shift.
        under_with_capacity = [
            n for n in candidates if self.get_target_delta(n, date) < 0 and self.get_target_remaining_hours(n, date) >= hours
        ]
        if under_with_capacity:
            # Prefer FT before PT, then choose most under-target.
            return min(
                under_with_capacity,
                key=lambda n: (not self._is_full_time(n), self.get_target_delta(n, date)),
            )

        # Next prefer any under-target nurse (even if remaining < hours)
        under = [n for n in candidates if self.get_target_delta(n, date) < 0]
        if under:
            return min(
                under,
                key=lambda n: (not self._is_full_time(n), self.get_target_delta(n, date)),
            )

        # Otherwise fall back to any candidate who has weekly capacity remaining
        with_capacity = [n for n in candidates if self.get_remaining_hours(n, date) >= hours]
        if with_capacity:
            # Prefer those closest to target (smaller positive delta)
            return min(with_capacity, key=lambda n: (self.get_target_delta(n, date), sum(self.nurse_period_hours.get(n, {}).values())))

        # Last resort: return the candidate with the smallest positive delta
        return min(candidates, key=lambda n: (max(0.0, self.get_target_delta(n, date)), sum(self.nurse_period_hours.get(n, {}).values())))

    def _track_hours(self, nurse_name: str, date: str, hours_delta: float) -> None:
        """Track both weekly and 14-day period hours with a signed delta."""
        week_key = self.date_to_week.get(date, "unknown")
        period_key = self.date_to_period.get(date, "unknown")

        if nurse_name not in self.nurse_weekly_hours:
            self.nurse_weekly_hours[nurse_name] = {}
        if week_key not in self.nurse_weekly_hours[nurse_name]:
            self.nurse_weekly_hours[nurse_name][week_key] = 0.0
        self.nurse_weekly_hours[nurse_name][week_key] = max(
            0.0, self.nurse_weekly_hours[nurse_name][week_key] + float(hours_delta)
        )

        if nurse_name not in self.nurse_period_hours:
            self.nurse_period_hours[nurse_name] = {}
        if period_key not in self.nurse_period_hours[nurse_name]:
            self.nurse_period_hours[nurse_name][period_key] = 0.0
        self.nurse_period_hours[nurse_name][period_key] = max(
            0.0, self.nurse_period_hours[nurse_name][period_key] + float(hours_delta)
        )

    def _get_scaled_period_target_hours(self, period_key: str) -> float:
        """Get total target for a period with boundary scaling and off-request reductions."""
        return self.get_period_total_target_hours(period_key)

    def _get_dynamic_daily_staff_cap(self, date: str) -> int:
        """
        Compute adaptive cap using reconciliation gap for the current 14-day period.
        - If period is already at/above target, keep coverage close to minimum.
        - If period is below target, allow only the extra staff needed to catch up.
                - Prevent end-of-period catch-up spikes by capping extras with a
                    period-average envelope.
        """
        min_required = self.day_req + self.night_req
        period_key = self.date_to_period.get(date, "unknown")
        period_dates = self.period_to_dates.get(period_key, [])
        if not period_dates:
            return min_required

        period_target = self._get_scaled_period_target_hours(period_key)
        period_scheduled = self.get_period_total_scheduled_hours(date)

        current_idx = self.date_to_index.get(date, 0)
        remaining_days = sum(1 for d in period_dates if self.date_to_index.get(d, -1) >= current_idx)
        remaining_days = max(1, remaining_days)

        remaining_gap = max(0.0, period_target - period_scheduled)

        # Baseline minimum coverage already contributes substantial hours.
        # Only add extra headcount for gap ABOVE that minimum baseline.
        baseline_shift_hours = self.reference_shift_hours
        baseline_remaining_hours = remaining_days * (self.day_req + self.night_req) * baseline_shift_hours
        extra_hours_gap = max(0.0, remaining_gap - baseline_remaining_hours)
        extra_needed_per_day = math.ceil((extra_hours_gap / remaining_days) / max(7.5, baseline_shift_hours))

        # Keep a minimal feasibility buffer while biasing toward the average.
        buffer = 0
        cap = min_required + extra_needed_per_day + buffer

        # Smooth daily staffing by limiting extra headcount relative to the
        # period-average target requirement. This avoids highly front/back
        # loaded weeks (e.g., 8 staff on some days and 16-18 on others)
        # unless constraints make it unavoidable.
        days_in_period = max(1, len(period_dates))
        avg_daily_staff_target = period_target / (baseline_shift_hours * days_in_period)
        avg_extra_needed = max(0, math.ceil(avg_daily_staff_target - min_required))

        # Allow flexibility above average to absorb vacations/off requests
        # AND to let FT nurses pick up their 7th shift.  The old +1 buffer
        # was too tight and caused the "6-shift trap" where every FT nurse
        # was capped at 6 shifts (67.5h) instead of 7 (78.75h).
        max_extra_envelope = max(2, avg_extra_needed + 2)
        envelope_cap = min_required + max_extra_envelope

        # Guardrail: do not exceed rounded average by more than 3 headcount.
        # The old +2 was still too tight for units with many FT nurses all
        # needing their 7th shift spread across the same 14 days.
        average_anchor_cap = max(min_required, int(round(avg_daily_staff_target)) + 3)

        cap = min(cap, envelope_cap, average_anchor_cap)
        return max(min_required, min(len(self.nurse_names), cap))

    def get_week_total_scheduled_hours(self, date: str) -> float:
        week_key = self.date_to_week.get(date, "unknown")
        return sum(self.nurse_weekly_hours.get(n, {}).get(week_key, 0) for n in self.nurse_names)

    def get_week_total_target_hours(self) -> float:
        return sum(self.get_target_weekly_hours(n) for n in self.nurse_names)
        
    def _get_consecutive_stretch(self, nurse_name: str, day_idx: int) -> int:
        """Compute how long a consecutive work-day run would be if we assign a
        shift on day_idx.  Scans backward (before day_idx) and forward (after
        day_idx) through the schedule, counting existing work shifts.

        Returns backward_count + 1 (this day) + forward_count.
        """
        stretch = 1  # count day_idx itself
        schedule_row = self.schedule.get(nurse_name, [])
        # Backward
        for i in range(day_idx - 1, -1, -1):
            if i >= len(schedule_row):
                break
            shift = schedule_row[i]
            if shift and shift.get("shiftType") not in ("off", None) and shift.get("hours", 0) > 0:
                stretch += 1
            else:
                break
        # Forward
        for i in range(day_idx + 1, len(self.date_list)):
            if i >= len(schedule_row):
                break
            shift = schedule_row[i]
            if shift and shift.get("shiftType") not in ("off", None) and shift.get("hours", 0) > 0:
                stretch += 1
            else:
                break
        return stretch

    def can_work(self, nurse_name: str, date: str, is_night: bool = False, hours: int = 12) -> bool:
        """Check if a nurse can work on a given date"""
        # Minimum-rest guard: after a night shift, only night shifts allowed
        day_idx = self.date_list.index(date) if date in self.date_list else -1
        if not is_night and day_idx >= 0 and self._worked_night_previous_day(nurse_name, day_idx):
            logger.debug(f"  {nurse_name} blocked for day shift on {date}: worked night yesterday (min rest)")
            return False

        # Check hours limit FIRST - most important constraint
        remaining_hours = self.get_remaining_hours(nurse_name, date)
        if remaining_hours < hours:
            week_key = self.date_to_week.get(date, "unknown")
            logger.debug(f"  {nurse_name} has only {remaining_hours}h remaining in week {week_key} (need {hours}h)")
            return False
        
        # Check off requests
        if date in self.get_off_requests(nurse_name):
            return False
        
        # Check if nurse has CF (congé férié) or C (off) in their OCR preference for this date
        day_idx = self.date_list.index(date) if date in self.date_list else -1
        if day_idx >= 0:
            pref = self.get_preferred_shift(nurse_name, day_idx)
            if pref:
                pref_upper = pref.upper().strip()
                # Handle CF variations: CF, CF-, CF 01, CF-01, C, OFF
                if (pref_upper in ["C", "OFF"] or 
                    pref_upper.startswith("CF") or 
                    pref_upper.startswith("CF-") or
                    "CF " in pref_upper):
                    return False
        
        # Check consecutive days — compute from the actual schedule to catch
        # both backward AND forward stretches.  If assigning a shift here
        # would create a run longer than max_consecutive, block it.
        if day_idx >= 0:
            consecutive_stretch = self._get_consecutive_stretch(nurse_name, day_idx)
            if consecutive_stretch > self.max_consecutive:
                logger.debug(
                    f"  {nurse_name} blocked on {date}: would create {consecutive_stretch} "
                    f"consecutive days (max {self.max_consecutive})"
                )
                return False
        
        return True
        
    def assign_shift(self, nurse_name: str, date: str, shift_type: str, hours: int = 12) -> Dict:
        """Create a shift assignment - uses proper shift codes from the MUHC shift library.
        
        Standard shift codes:
        - Day 12h:   Z07 (07:00-19:25, 11.25h paid)
        - Day 8h:    07  (07:00-15:15, 7.5h paid)
        - Night 12h: Z23 / Z23 B (23:00-11:25, 11.25h paid) — B suffix for 2nd+ consecutive night
        - Night 8h:  23  (23:00-07:15, 7.5h paid)
        """
        if shift_type == "day":
            if hours == 8:
                shift_code = "07"  # Standard 8h day shift
            else:
                shift_code = "Z07"  # Standard 12h day shift
            # Reset consecutive nights counter for day shifts
            self._nurse_consecutive_nights[nurse_name] = 0
        elif shift_type == "night":
            if hours == 8:
                shift_code = "23"  # Standard 8h night shift
                # Reset consecutive nights counter for 8h shifts
                self._nurse_consecutive_nights[nurse_name] = 0
            else:
                # Track consecutive nights for this nurse
                consecutive_nights = self._nurse_consecutive_nights.get(nurse_name, 0)
                
                # For Z23 pattern: Z23, Z23 B, Z23 B, then reset
                if consecutive_nights == 0:
                    shift_code = "Z23"  # First night
                elif consecutive_nights >= 1:
                    shift_code = "Z23 B"  # Second and subsequent nights get B suffix
                else:
                    shift_code = "Z23"
                
                # Increment consecutive nights counter
                self._nurse_consecutive_nights[nurse_name] = consecutive_nights + 1
        elif shift_type == "day_8h":
            shift_code = "07"
            shift_type = "day"
            hours = 8
            # Reset consecutive nights counter
            self._nurse_consecutive_nights[nurse_name] = 0
        elif shift_type == "night_8h":
            shift_code = "23"
            shift_type = "night"
            hours = 8
            # Reset consecutive nights counter
            self._nurse_consecutive_nights[nurse_name] = 0
        else:
            shift_code = ""
        
        # CRITICAL: Final safety check - NEVER allow CF codes
        if shift_code.upper().startswith("CF") or "CF-" in shift_code.upper():
            logger.error(f"BLOCKED CF CODE in assign_shift: {shift_code} - using default")
            shift_code = "Z07" if shift_type == "day" else "Z23"
            
        meta = self.shifts_info.get(shift_code, {})
        
        # Get hours from metadata if available
        if meta and "hours" in meta:
            hours = meta["hours"]
        
        # Calculate start/end times based on shift code metadata or defaults
        if meta:
            start_time = meta.get("startTime", "07:00" if shift_type == "day" else "19:00")
            end_time = meta.get("endTime", "19:00" if shift_type == "day" else "07:00")
        elif hours == 8:
            if shift_type == "day":
                start_time = "07:00"
                end_time = "15:00"
            else:  # night
                start_time = "23:00"
                end_time = "07:00"
        else:  # 12h default
            start_time = "07:00" if shift_type == "day" else "19:00"
            end_time = "19:00" if shift_type == "day" else "07:00"
        
        logger.debug(f"  Assigning {nurse_name}: {shift_code} ({shift_type}, {hours}h) on {date}")
        
        # Track hours for week + 14-day period containing this date
        self._track_hours(nurse_name, date, float(hours))
        self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
        
        return {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": shift_code,
            "shiftType": shift_type,
            "hours": hours,
            "startTime": start_time,
            "endTime": end_time
        }
    
    def assign_off(self, nurse_name: str, date: str, off_code: str = "") -> Dict:
        """Create an off day assignment.
        
        Args:
            nurse_name: Name of the nurse
            date: The date of the off day
            off_code: Optional code to preserve (e.g., "CF-1", "C", "OFF")
                     If empty, defaults to "" (generic off day)
        """
        # Normalize off codes to uppercase so frontend recognizes them
        # (e.g. OCR lowercase 'c' → 'C', 'off' → 'OFF')
        normalized_code = off_code.strip().upper() if off_code else ""
        # Keep CF casing consistent: CF-1, CF-2, etc.
        # Keep '*' as-is (it's a comment marker, not an off code)
        if normalized_code == "*":
            normalized_code = "*"
        return {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": normalized_code,
            "shiftType": "off",
            "hours": 0,
            "startTime": "",
            "endTime": ""
        }
    
    def get_preferred_shift(self, nurse_name: str, day_idx: int) -> str:
        """Get nurse's preferred shift from OCR data"""
        if nurse_name in self.preferences:
            shifts = self.preferences[nurse_name]
            if day_idx < len(shifts):
                shift = shifts[day_idx]
                # CRITICAL: Filter out CF codes - they should be OFF days, not shifts
                if shift:
                    shift_upper = shift.upper()
                    # A lone "*" is a comment marker, not a shift code.
                    # Strip trailing asterisks first, then filter invalid codes.
                    cleaned = shift.replace("*", "").strip()
                    if not cleaned:
                        return ""  # Bare asterisk(s) → no preference
                    shift_upper = cleaned.upper()
                    # BLOCK all invalid codes
                    if (shift_upper.startswith("CF") or 
                        shift_upper.startswith("C-") or
                        shift_upper in ["C", "OFF", ""] or
                        "CF-" in shift_upper):
                        logger.debug(f"  Filtered CF/OFF code: {shift} for {nurse_name}")
                        return ""  # Treat as no preference
                    return cleaned
        return ""
    
    # ── Pre-processing: Clean ghost entries from OCR BEFORE pipeline ─────
    # Night codes whose next-day "tail" in the OCR grid is just a visual
    # artefact of the overnight shift, NOT a separate worked shift.
    _NIGHT_START_CODES = {"Z19", "Z23", "Z23 B", "23"}

    # Only plain Z23 (WITHOUT "B") is ever a ghost tail.
    # Z23 B is ALWAYS a real separate shift.
    _GHOST_TAIL_CODES = {"Z23"}

    # Maximum paid hours a single nurse can accumulate in one calendar day.
    # Any entry that would push a day beyond this is clearly a ghost.
    MAX_HOURS_PER_DAY = 12.5

    @staticmethod
    def _preprocess_ocr_preferences(
        preferences: Dict[str, List[str]],
        shifts_info: Dict[str, Any],
    ) -> Dict[str, List[str]]:
        """De-Duplication Command — clean OCR preferences BEFORE the pipeline.

        For every nurse, scan left→right through the OCR shift array.
        When a night-start code appears on day N, check day N+1:
        if it is a plain Z23 (no B), NULL it out — it is just the visual
        tail of the overnight shift and NOT a separate assignment.

        Also enforces MAX_HOURS_PER_DAY per calendar day by removing any
        shift that would exceed the cap.

        Returns a NEW dict (does not mutate the original).
        """
        if not preferences:
            return {}

        MAX_H = RobustScheduler.MAX_HOURS_PER_DAY
        NIGHT_STARTS = RobustScheduler._NIGHT_START_CODES
        GHOST_TAILS = RobustScheduler._GHOST_TAIL_CODES

        def _norm(code: str) -> str:
            return str(code or "").replace("↩", "").strip().upper()

        def _hours_for(code: str) -> float:
            """Resolve paid hours for a shift code."""
            c = _norm(code)
            if not c or c in ("C", "OFF", "*") or c.startswith("CF"):
                return 0.0
            if c in shifts_info:
                return float(shifts_info[c].get("hours", 0))
            # Fallback heuristics
            if c.startswith("Z") or len(c) >= 3:
                return 11.25
            return 7.5

        cleaned: Dict[str, List[str]] = {}
        total_ghosts = 0

        for nurse_name, shifts in preferences.items():
            new_shifts = list(shifts)  # shallow copy
            num_days = len(new_shifts)

            # --- Pass 1: NULL out ghost tails ---
            for i in range(num_days - 1):
                code_i = _norm(new_shifts[i] or "")
                if not code_i:
                    continue
                if code_i not in NIGHT_STARTS:
                    continue

                # Day i has a night-start code → check day i+1
                next_code = _norm(new_shifts[i + 1] or "")
                if next_code in GHOST_TAILS:
                    logger.info(
                        f"  PRE-CLEAN GHOST: {nurse_name} day {i+1}: "
                        f"'{new_shifts[i+1]}' after '{new_shifts[i]}' → removed (ghost tail)"
                    )
                    new_shifts[i + 1] = ""  # NULL out the ghost
                    total_ghosts += 1

            # --- Pass 2: Enforce MAX_HOURS_PER_DAY per calendar day ---
            for i in range(num_days):
                code = _norm(new_shifts[i] or "")
                if not code:
                    continue
                h = _hours_for(new_shifts[i])
                if h > MAX_H:
                    logger.warning(
                        f"  PRE-CLEAN CAP: {nurse_name} day {i}: "
                        f"'{new_shifts[i]}' = {h}h exceeds {MAX_H}h cap → removed"
                    )
                    new_shifts[i] = ""

            cleaned[nurse_name] = new_shifts

        logger.info(f"PRE-CLEAN COMPLETE: {total_ghosts} ghost tails removed from OCR data")
        return cleaned

    def build_schedule(self) -> Dict[str, List[Dict]]:
        """
        OCR-FIRST APPROACH (BINDING):
        Priority 1: Preserve ALL OCR nurse assignments EXACTLY - they are the source of truth
        Priority 2: Respect offRequests (vacation/CF) - only remove OCR if nurse is unavailable
        Priority 3: Fill gaps left by unscheduled/off nurses to meet minimum coverage
        Priority 4: Enforce consecutive day limits and hour caps
        
        Key: OCR assignments are FIXED unless there is an explicit constraint violation.
        We do NOT optimize away from OCR lightly - preserve nurse preferences.
        """
        logger.info("=" * 80)
        logger.info("OCR-FIRST SCHEDULER: Preserve OCR assignments as binding baseline")
        logger.info(f"  Nurses: {len(self.nurses)}")
        logger.info(f"  Days: {len(self.date_list)}")
        logger.info(f"  Day requirement: {self.day_req}")
        logger.info(f"  Night requirement: {self.night_req}")
        logger.info(f"  Max consecutive days: {self.max_consecutive}")
        logger.info(f"  Nurses with OCR data (WILL BE PRESERVED): {list(self.preferences.keys())}")
        
        # Log off requests for debugging
        logger.info("=" * 60)
        logger.info("🚫 OFF REQUESTS FROM NURSES:")
        for nurse in self.nurses:
            off_reqs = nurse.get("offRequests", [])
            logger.info(f"  {nurse['name']}: offRequests = {off_reqs}")
        logger.info("=" * 60)
        
        # Track consecutive work days per nurse
        nurse_consecutive_count = {n["name"]: 0 for n in self.nurses}
        
        # STEP 1: Process OCR data for each nurse
        for nurse_name in self.nurse_names:
            self.schedule[nurse_name] = []

            # Nurses on leave get ALL days as OFF — no shifts assigned
            if nurse_name in self.nurses_on_leave:
                for day_idx, date in enumerate(self.date_list):
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date))
                logger.info(f"  {nurse_name}: ALL OFF (on leave)")
                continue
            
            for day_idx, date in enumerate(self.date_list):
                # CRITICAL: Check off requests FIRST (vacation days)
                if date in self.get_off_requests(nurse_name):
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date))
                    nurse_consecutive_count[nurse_name] = 0  # Reset consecutive
                    logger.info(f"  {nurse_name} {date}: OFF (offRequest - vacation)")
                    continue
                
                ocr_shift = self._get_raw_ocr_shift(nurse_name, day_idx)
                
                if not ocr_shift or not ocr_shift.strip():
                    # No OCR data - placeholder (will fill later)
                    self.schedule[nurse_name].append(None)
                    continue
                
                # Strip any wrap-around tail markers from frontend dedup
                ocr_shift = ocr_shift.replace("↩", "").strip()
                if not ocr_shift:
                    self.schedule[nurse_name].append(None)
                    continue
                
                shift_upper = ocr_shift.upper().strip()
                
                # Check for explicit OFF codes (NOT '*')
                # Handle CF variations: CF, CF-, CF 01, CF-01, C, OFF
                is_off_code = (shift_upper in ["C", "OFF"] or 
                              shift_upper.startswith("CF") or
                              shift_upper.startswith("CF-") or
                              "CF " in shift_upper)
                
                if is_off_code:
                    # PRESERVE the original off-day code (e.g., CF-1, C, CF)
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date, ocr_shift))
                    nurse_consecutive_count[nurse_name] = 0
                    logger.debug(f"  {nurse_name} {date}: OFF (code: {ocr_shift})")
                elif shift_upper == "*":
                    # '*' means OFF in nurse preferred schedules (asterisk = day off)
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date, "*"))
                    nurse_consecutive_count[nurse_name] = 0
                    logger.info(f"  {nurse_name} {date}: OFF (asterisk * = day off)")
                else:
                    # Valid shift code - PRESERVE EXACTLY (OCR is binding, not flexible)
                    shift_info = self._get_shift_metadata(ocr_shift)
                    shift_entry = {
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": ocr_shift,  # PRESERVE ORIGINAL CODE - DO NOT MODIFY
                        "shiftType": shift_info["type"],
                        "hours": shift_info["hours"],
                        "startTime": shift_info["start"],
                        "endTime": shift_info["end"]
                    }
                    self.schedule[nurse_name].append(shift_entry)
                    # Track hours for week + 14-day period
                    self._track_hours(nurse_name, date, float(shift_info["hours"]))
                    self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                    nurse_consecutive_count[nurse_name] += 1
                    logger.info(f"✓ {nurse_name} {date}: OCR PRESERVED {ocr_shift} ({shift_info['type']}, {shift_info['hours']}h)")
        
        # ============================================================
        # STEP 1.5: NIGHT SHIFT WRAP-AROUND DEDUPLICATION
        # Hospital schedules visually split overnight shifts across two
        # calendar days.  When a night-start code (Z19, Z23, Z23 B) appears
        # on day N and a plain Z23 (WITHOUT "B") appears on day N+1, the
        # day N+1 entry is just the visual tail of the same shift — NOT a
        # separate worked shift.
        #
        # Key rule:  ONLY plain Z23 (without "B") is ever a ghost tail.
        #            Z23 B is ALWAYS a real separate shift.
        #
        # • Z23 B after Z19   = NEW shift  (16h rest gap)
        # • Z23 B after Z23 B = NEW shift  (consecutive night assignment)
        # • Z23   after ANY night code = GHOST (visual tail, zero it out)
        #
        # Example: Z19, Z23 B, Z23 B, Z23  →  3 real shifts + 1 ghost (last Z23)
        # ============================================================
        NIGHT_DEDUP_PAIRS = {
            "Z19":   {"Z23"},
            "Z23":   {"Z23"},
            "Z23 B": {"Z23"},
        }
        
        logger.info("=" * 60)
        logger.info("STEP 1.5: NIGHT SHIFT WRAP-AROUND DEDUPLICATION")
        dedup_count = 0
        
        for nurse_name in self.nurse_names:
            schedule_row = self.schedule[nurse_name]
            for day_idx in range(1, len(schedule_row)):
                prev_shift = schedule_row[day_idx - 1]
                curr_shift = schedule_row[day_idx]
                
                if not prev_shift or not curr_shift:
                    continue
                if prev_shift.get("hours", 0) <= 0:
                    continue
                if curr_shift.get("hours", 0) <= 0:
                    continue
                
                prev_code = str(prev_shift.get("shift", "")).strip().upper()
                curr_code = str(curr_shift.get("shift", "")).strip().upper()
                
                # Strip any ↩ markers that might have leaked from frontend
                prev_code = prev_code.replace("↩", "").strip()
                curr_code = curr_code.replace("↩", "").strip()
                
                valid_tails = NIGHT_DEDUP_PAIRS.get(prev_code)
                if valid_tails and curr_code in valid_tails:
                    date = self.date_list[day_idx]
                    old_hours = curr_shift.get("hours", 0)
                    
                    logger.info(
                        f"  ↩ TAIL DEDUP: {nurse_name} on {date}: "
                        f"'{curr_code}' after '{prev_code}' → zeroed ({old_hours}h removed)"
                    )
                    
                    # Untrack the tail's hours
                    if old_hours > 0:
                        self._track_hours(nurse_name, date, -float(old_hours))
                    self.nurse_total_shifts[nurse_name] = max(
                        0, self.nurse_total_shifts.get(nurse_name, 0) - 1
                    )
                    
                    # Convert tail to off/rest day (nurse is recovering from overnight)
                    schedule_row[day_idx] = self.assign_off(nurse_name, date)
                    
                    # Also remove from OCR binding set — tail is not a real assignment
                    self.ocr_assignments.discard((nurse_name, date))
                    
                    dedup_count += 1
        
        logger.info(f"NIGHT DEDUP COMPLETE: {dedup_count} wrap-around tails zeroed")
        logger.info("=" * 60)
        
        # STEP 2: Fill gaps to meet coverage requirements
        # PRE-STEP: De-peak overstaffed OCR-heavy days to avoid large daily spikes
        # while preserving minimum staffing and pay-period reconciliation.
        logger.info(
            "DAILY DE-PEAK TARGET: adaptive cap by day using 14-day reconciliation gap "
            f"(minimum required/day: {self.day_req + self.night_req})"
        )

        for day_idx, date in enumerate(self.date_list):
            daily_staff_cap = self._get_dynamic_daily_staff_cap(date)
            period_key = self.date_to_period.get(date, "unknown")
            logger.debug(
                f"  {date}: adaptive cap={daily_staff_cap}, "
                f"period={period_key}, scheduled={self.get_period_total_scheduled_hours(date):.2f}h, "
                f"target={self._get_scaled_period_target_hours(period_key):.2f}h"
            )
            day_workers: List[str] = []
            night_workers: List[str] = []

            for nurse_name in self.nurse_names:
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("hours", 0) > 0:
                    if shift.get("shiftType") == "day":
                        day_workers.append(nurse_name)
                    elif shift.get("shiftType") == "night":
                        night_workers.append(nurse_name)

            total_workers = len(day_workers) + len(night_workers)
            if total_workers <= daily_staff_cap:
                continue

            to_remove = total_workers - daily_staff_cap
            logger.info(
                f"  {date}: de-peaking {to_remove} shifts (from {total_workers} down to cap {daily_staff_cap})"
            )

            for _ in range(to_remove):
                day_slack = len(day_workers) - self.day_req
                night_slack = len(night_workers) - self.night_req

                # Remove from the more overstaffed side first, never below minimums.
                if day_slack <= 0 and night_slack <= 0:
                    break

                remove_from_day = day_slack >= night_slack and day_slack > 0
                if not remove_from_day and night_slack <= 0 and day_slack > 0:
                    remove_from_day = True

                pool = day_workers if remove_from_day else night_workers
                if not pool:
                    break

                # CRITICAL: Filter out OCR shifts - these are BINDING and must NEVER be removed
                non_ocr_pool = [n for n in pool if (n, date) not in self.ocr_assignments]
                
                # Log which nurses are OCR-protected on this date
                ocr_protected = [n for n in pool if (n, date) in self.ocr_assignments]
                if ocr_protected:
                    logger.info(f"    OCR-PROTECTED on {date}: {ocr_protected} (cannot de-peak)")
                
                if not non_ocr_pool:
                    # All remaining shifts in this pool are OCR - cannot remove
                    logger.info(
                        f"    Cannot de-peak {pool} on {date}: all are OCR-assigned (binding). Skipping."
                    )
                    break

                candidate = max(
                    non_ocr_pool,
                    key=lambda n: (
                        # Prefer removing from over-target nurses first.
                        1 if not self._is_weekend_commitment_protected(n, date) else 0,
                        self.get_target_delta(n, date),
                        self.nurse_period_hours.get(n, {}).get(self.date_to_period.get(date, "unknown"), 0),
                        # Prefer preserving highly certified/senior nurses.
                        -self.get_certification_score(n),
                        -self.nurse_seniority.get(n, 0),
                    ),
                )
                
                logger.info(f"    De-peaking: removing {candidate} from {date}")

                current_shift = self.schedule[candidate][day_idx]
                removed_hours = current_shift.get("hours", 0) if current_shift else 0

                if removed_hours > 0:
                    self._track_hours(candidate, date, -float(removed_hours))

                self.schedule[candidate][day_idx] = self.assign_off(candidate, date)
                self.nurse_total_shifts[candidate] = max(0, self.nurse_total_shifts.get(candidate, 0) - 1)
                pool.remove(candidate)

        # Reset consecutive counts and recalculate based on Step 1 assignments
        for nurse_name in self.nurse_names:
            nurse_consecutive_count[nurse_name] = 0
            # Recalculate consecutive from beginning
            for day_idx in range(len(self.date_list)):
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("shiftType") not in ["off", None] and shift.get("hours", 0) > 0:
                    nurse_consecutive_count[nurse_name] += 1
                else:
                    break  # Stop at first non-work day
        
        for day_idx, date in enumerate(self.date_list):
            daily_staff_cap = self._get_dynamic_daily_staff_cap(date)
            day_count = 0
            night_count = 0
            available_nurses = []
            blocked_by_consecutive = set()
            blocked_by_hours = set()
            
            # Recalculate consecutive work days for each nurse up to (but not including) this day
            for nurse_name in self.nurse_names:
                count = 0
                # Count backwards from day_idx-1 to find consecutive work days
                for i in range(day_idx - 1, -1, -1):
                    prev_shift = self.schedule[nurse_name][i]
                    if prev_shift and prev_shift.get("shiftType") not in ["off", None] and prev_shift.get("hours", 0) > 0:
                        count += 1
                    else:
                        break  # Non-work day breaks the streak
                nurse_consecutive_count[nurse_name] = count
            
            for nurse_name in self.nurse_names:
                shift = self.schedule[nurse_name][day_idx]
                if shift is None:
                    # Skip nurses on leave — they should never be assigned
                    if nurse_name in self.nurses_on_leave:
                        self.schedule[nurse_name][day_idx] = self.assign_off(nurse_name, date)
                        continue

                    # For OCR baseline nurses: skip blank days UNLESS the nurse
                    # is significantly under their period target (needs more shifts
                    # to reach FTE). This ensures preferred schedules are preserved
                    # while still allowing the 7th shift for FT nurses with 0 OFF.
                    if self._nurse_has_ocr_baseline(nurse_name):
                        # Allow gap-fill if nurse is at least one 8h shift under target.
                        # Using 7.0h threshold (below minimum 7.5h paid shift) so that
                        # FT nurses at 67.5h / 75h target (remaining=7.5h) still qualify
                        # for a 7th shift.  This breaks the "6-shift trap".
                        period_remaining = self.get_target_remaining_hours(nurse_name, date)
                        if period_remaining < 7.0:
                            continue  # Near/at target — preserve blank day as rest

                    # Unassigned - check if available
                    # Check hours limit for this week
                    remaining = self.get_remaining_hours(nurse_name, date)
                    # Check consecutive days limit (STRICTLY enforce max_consecutive)
                    consecutive = nurse_consecutive_count[nurse_name]
                    at_max_consecutive = consecutive >= self.max_consecutive
                    # Check off requests
                    is_off_request = date in self.get_off_requests(nurse_name)
                    
                    if at_max_consecutive:
                        # Keep unassigned for now; may still be used as emergency
                        # coverage to satisfy strict minimum staffing.
                        blocked_by_consecutive.add(nurse_name)
                    elif is_off_request:
                        # Force OFF for this nurse
                        self.schedule[nurse_name][day_idx] = self.assign_off(nurse_name, date)
                        nurse_consecutive_count[nurse_name] = 0
                    elif self._is_on_vacation_around_weekend(nurse_name, date):
                        # Nurse is on vacation adjacent to this weekend — don't
                        # schedule them.  Force OFF so they aren't picked up
                        # by later passes.
                        self.schedule[nurse_name][day_idx] = self.assign_off(nurse_name, date)
                        nurse_consecutive_count[nurse_name] = 0
                    elif remaining >= 8:
                        available_nurses.append(nurse_name)
                    else:
                        blocked_by_hours.add(nurse_name)
                elif shift["shiftType"] == "day":
                    day_count += 1
                elif shift["shiftType"] == "night":
                    night_count += 1
                # Don't increment consecutive here - we recalculate at start of each day
            
            # Sort by least hours worked first (fair distribution), then by certification
            # breadth and seniority so complex slots are less likely to be junior-only.
            available_nurses.sort(
                key=lambda n: (
                    0 if (self._is_weekend_date(date) and self._weekend_commitment_missing(n, date)) else 1,
                    self.get_target_delta(n, date) >= 0,
                    self.get_target_delta(n, date),
                    sum(self.nurse_period_hours.get(n, {}).values()),
                    -self.get_certification_score(n),
                    -self.nurse_seniority.get(n, 0),
                )
            )
            
            nurses_for_day = []
            nurses_for_night = []

            # ── Minimum-rest guard ──
            # Partition available nurses into those who can work any shift
            # and those restricted to night-only (worked night yesterday).
            night_only_nurses = []
            any_shift_nurses = []
            for n in available_nurses:
                if self._worked_night_previous_day(n, day_idx):
                    night_only_nurses.append(n)
                else:
                    any_shift_nurses.append(n)

            # Fill day shifts first (only from any_shift pool)
            while day_count < self.day_req and any_shift_nurses:
                candidate = self._select_candidate_for_assignment(any_shift_nurses, date, self.reference_shift_hours)
                if not candidate:
                    break
                # remove candidate from the available list
                try:
                    any_shift_nurses.remove(candidate)
                except ValueError:
                    pass
                nurses_for_day.append(candidate)
                day_count += 1
            
            # Fill night shifts (prefer night-only nurses first, then any remaining)
            night_candidates = night_only_nurses + any_shift_nurses
            while night_count < self.night_req and night_candidates:
                candidate = self._select_candidate_for_assignment(night_candidates, date, self.reference_shift_hours)
                if not candidate:
                    break
                try:
                    night_candidates.remove(candidate)
                except ValueError:
                    pass
                nurses_for_night.append(candidate)
                night_count += 1
            
            # Update available_nurses for OPTIONAL EXTRA COVERAGE below
            available_nurses = [n for n in any_shift_nurses if n not in nurses_for_day and n not in nurses_for_night] + \
                               [n for n in night_only_nurses if n not in nurses_for_night]

            # COVERAGE OVERRIDE: if strict hour checks leave gaps, relax only the
            # weekly-hours cap to guarantee minimum daily staffing.
            if day_count < self.day_req or night_count < self.night_req:
                already_assigned = set(nurses_for_day + nurses_for_night)
                relaxed_pool = []

                for nurse_name in self.nurse_names:
                    if nurse_name in already_assigned:
                        continue
                    if self._nurse_has_ocr_baseline(nurse_name):
                        continue
                    if self.schedule[nurse_name][day_idx] is not None:
                        continue
                    if date in self.get_off_requests(nurse_name):
                        continue
                    if nurse_consecutive_count[nurse_name] >= self.max_consecutive:
                        continue
                    relaxed_pool.append(nurse_name)

                relaxed_pool.sort(
                    key=lambda n: (
                        0 if (self._is_weekend_date(date) and self._weekend_commitment_missing(n, date)) else 1,
                        self.get_target_delta(n, date) >= 0,
                        self.get_target_delta(n, date),
                        sum(self.nurse_period_hours.get(n, {}).values()),
                        -self.get_certification_score(n),
                        -self.nurse_seniority.get(n, 0),
                    )
                )

                while day_count < self.day_req and relaxed_pool:
                    candidate = self._select_candidate_for_assignment(relaxed_pool, date, self.reference_shift_hours)
                    if not candidate:
                        break
                    # Minimum-rest guard: skip post-night nurses for day slots
                    if self._worked_night_previous_day(candidate, day_idx):
                        # Re-add to end for potential night assignment
                        try:
                            relaxed_pool.remove(candidate)
                        except ValueError:
                            pass
                        relaxed_pool.append(candidate)
                        continue
                    try:
                        relaxed_pool.remove(candidate)
                    except ValueError:
                        pass
                    nurses_for_day.append(candidate)
                    already_assigned.add(candidate)
                    day_count += 1

                while night_count < self.night_req and relaxed_pool:
                    candidate = self._select_candidate_for_assignment(relaxed_pool, date, self.reference_shift_hours)
                    if not candidate:
                        break
                    try:
                        relaxed_pool.remove(candidate)
                    except ValueError:
                        pass
                    if candidate in already_assigned:
                        continue
                    nurses_for_night.append(candidate)
                    already_assigned.add(candidate)
                    night_count += 1

            # EMERGENCY COVERAGE OVERRIDE: if still below minimum coverage,
            # temporarily relax soft constraints (hours + consecutive days)
            # while keeping explicit off requests intact.
            if day_count < self.day_req or night_count < self.night_req:
                already_assigned = set(nurses_for_day + nurses_for_night)
                emergency_pool = []

                for nurse_name in self.nurse_names:
                    if nurse_name in already_assigned:
                        continue
                    if self._nurse_has_ocr_baseline(nurse_name):
                        continue
                    if self.schedule[nurse_name][day_idx] is not None:
                        continue
                    if date in self.get_off_requests(nurse_name):
                        continue
                    emergency_pool.append(nurse_name)

                emergency_pool.sort(
                    key=lambda n: (
                        0 if (self._is_weekend_date(date) and self._weekend_commitment_missing(n, date)) else 1,
                        self.get_target_delta(n, date) >= 0,
                        self.get_target_delta(n, date),
                        sum(self.nurse_period_hours.get(n, {}).values()),
                        -self.get_certification_score(n),
                        -self.nurse_seniority.get(n, 0),
                    )
                )

                while day_count < self.day_req and emergency_pool:
                    candidate = self._select_candidate_for_assignment(emergency_pool, date, self.reference_shift_hours)
                    if not candidate:
                        break
                    # Minimum-rest guard: skip post-night nurses for day slots
                    if self._worked_night_previous_day(candidate, day_idx):
                        try:
                            emergency_pool.remove(candidate)
                        except ValueError:
                            pass
                        emergency_pool.append(candidate)
                        continue
                    try:
                        emergency_pool.remove(candidate)
                    except ValueError:
                        pass
                    nurses_for_day.append(candidate)
                    already_assigned.add(candidate)
                    day_count += 1

                while night_count < self.night_req and emergency_pool:
                    candidate = self._select_candidate_for_assignment(emergency_pool, date, self.reference_shift_hours)
                    if not candidate:
                        break
                    try:
                        emergency_pool.remove(candidate)
                    except ValueError:
                        pass
                    if candidate in already_assigned:
                        continue
                    nurses_for_night.append(candidate)
                    already_assigned.add(candidate)
                    night_count += 1

            # OPTIONAL EXTRA COVERAGE: assign additional shifts to nurses who are
            # still under target hours, while preserving minimum requirements.
            # This prevents schedules from stopping at the absolute minimum only.
            extra_assignments: Dict[str, Tuple[str, int]] = {}
            period_total_scheduled = self.get_period_total_scheduled_hours(date)
            period_key = self.date_to_period.get(date, "unknown")
            period_total_target = self.get_period_total_target_hours(period_key)

            # Re-sort available nurses by target delta so the most under-target
            # nurses get priority for the limited extra slots.  Without this,
            # the same nurses that happen to be early in the list grab all the
            # extra slots on every day, leaving others (Allycia, Brenda, Kassia)
            # permanently one shift short.
            available_nurses.sort(
                key=lambda n: (
                    self.get_target_delta(n, date),  # most negative (under-target) first
                    not self._is_full_time(n),      # FT before PT when deltas are similar
                    sum(self.nurse_period_hours.get(n, {}).values()),
                )
            )

            for nurse in list(available_nurses):
                # FT-first policy: while any FT nurse is still meaningfully
                # under target, do not consume optional extra slots on PT nurses.
                ft_under_target_exists = any(
                    self._is_full_time(n)
                    and self.get_target_remaining_hours(n, date) >= 7.0
                    for n in self.nurse_names
                )
                if ft_under_target_exists and not self._is_full_time(nurse):
                    continue

                # Soft-stop once aggregate period target is exceeded by 10%.
                # We no longer hard-stop at 100% because individual nurses may
                # still be significantly under target even when the aggregate
                # looks met (fixes coverage compliance 0% issue).
                if period_total_scheduled >= period_total_target * 1.10:
                    break

                target_remaining = self.get_target_remaining_hours(nurse, date)

                # Avoid daily front-loading spikes; keep day totals near cap.
                # BUT: exempt nurses who are significantly under target (≥ one
                # full shift behind).  Without this exemption, the cap blocks
                # the last few nurses every single day, and they permanently
                # end up one shift short (-7.5h).
                if (day_count + night_count) >= daily_staff_cap:
                    if target_remaining < self.reference_shift_hours:
                        break  # Only break if no one left who really needs hours

                if target_remaining < 7.0:
                    continue

                remaining_hours = self.get_remaining_hours(nurse, date)
                if remaining_hours < 7.5:
                    continue

                # Prefer 12h where possible, otherwise use 8h to progress toward target.
                candidate_hours = 12 if (remaining_hours >= 12 and target_remaining >= 12) else 8

                # Keep day/night distribution reasonably balanced relative to minimums.
                day_ratio = day_count / max(self.day_req, 1)
                night_ratio = night_count / max(self.night_req, 1)
                prefer_night = night_ratio < day_ratio

                # Minimum-rest guard: post-night nurses can only take night shifts.
                came_off_night = self._worked_night_previous_day(nurse, day_idx)

                chosen_shift = None
                if (prefer_night or came_off_night) and self.can_work(nurse, date, is_night=True, hours=candidate_hours):
                    chosen_shift = "night"
                    night_count += 1
                elif not came_off_night and self.can_work(nurse, date, is_night=False, hours=candidate_hours):
                    chosen_shift = "day"
                    day_count += 1
                elif self.can_work(nurse, date, is_night=True, hours=candidate_hours):
                    chosen_shift = "night"
                    night_count += 1

                if chosen_shift:
                    extra_assignments[nurse] = (chosen_shift, candidate_hours)
                    period_total_scheduled += candidate_hours
            
            # Apply assignments
            for nurse_name in self.nurse_names:
                if self.schedule[nurse_name][day_idx] is None:
                    if nurse_name in nurses_for_day:
                        shift = self.assign_shift(nurse_name, date, "day")
                        self.schedule[nurse_name][day_idx] = shift
                        nurse_consecutive_count[nurse_name] += 1
                    elif nurse_name in nurses_for_night:
                        shift = self.assign_shift(nurse_name, date, "night")
                        self.schedule[nurse_name][day_idx] = shift
                        nurse_consecutive_count[nurse_name] += 1
                    elif nurse_name in extra_assignments:
                        shift_type, shift_hours = extra_assignments[nurse_name]
                        shift = self.assign_shift(
                            nurse_name,
                            date,
                            shift_type,
                            hours=shift_hours,
                        )
                        self.schedule[nurse_name][day_idx] = shift
                        nurse_consecutive_count[nurse_name] += 1
                    else:
                        self.schedule[nurse_name][day_idx] = self.assign_off(nurse_name, date)
                        nurse_consecutive_count[nurse_name] = 0

            # POST-ASSIGNMENT DE-PEAK: enforce daily cap on the final day plan,
            # keeping minimum day/night staffing intact.
            final_day_workers: List[str] = []
            final_night_workers: List[str] = []
            for nurse_name in self.nurse_names:
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("hours", 0) > 0:
                    if shift.get("shiftType") == "day":
                        final_day_workers.append(nurse_name)
                    elif shift.get("shiftType") == "night":
                        final_night_workers.append(nurse_name)

            final_total = len(final_day_workers) + len(final_night_workers)
            if final_total > daily_staff_cap:
                to_remove = final_total - daily_staff_cap
                for _ in range(to_remove):
                    day_slack = len(final_day_workers) - self.day_req
                    night_slack = len(final_night_workers) - self.night_req

                    if day_slack <= 0 and night_slack <= 0:
                        break

                    remove_from_day = day_slack >= night_slack and day_slack > 0
                    if not remove_from_day and night_slack <= 0 and day_slack > 0:
                        remove_from_day = True

                    pool = final_day_workers if remove_from_day else final_night_workers
                    if not pool:
                        break

                    # CRITICAL: Filter out OCR-assigned nurses - they are BINDING
                    non_ocr_pool = [n for n in pool if (n, date) not in self.ocr_assignments]
                    ocr_protected_post = [n for n in pool if (n, date) in self.ocr_assignments]
                    if ocr_protected_post:
                        logger.info(f"    POST-DEPEAKING OCR-PROTECTED on {date}: {ocr_protected_post} (cannot remove)")
                    if not non_ocr_pool:
                        logger.info(f"    POST-DEPEAKING: all remaining in pool are OCR on {date}. Skipping.")
                        break

                    # PROTECT UNDER-TARGET NURSES: Never de-peak a nurse
                    # whose worked hours are still below their FTE target.
                    # Only consider over-target nurses for removal.
                    over_target_pool = [
                        n for n in non_ocr_pool
                        if self.get_target_delta(n, date) > 0
                    ]
                    selection_pool = over_target_pool if over_target_pool else non_ocr_pool

                    candidate = max(
                        selection_pool,
                        key=lambda n: (
                            # Primary: prefer removing nurses who are OVER target
                            1 if self.get_target_delta(n, date) > 0 else 0,
                            1 if not self._is_weekend_commitment_protected(n, date) else 0,
                            self.get_target_delta(n, date),
                            self.nurse_period_hours.get(n, {}).get(self.date_to_period.get(date, "unknown"), 0),
                            -self.get_certification_score(n),
                            -self.nurse_seniority.get(n, 0),
                        ),
                    )

                    current_shift = self.schedule[candidate][day_idx]
                    removed_hours = current_shift.get("hours", 0) if current_shift else 0
                    if removed_hours > 0:
                        self._track_hours(candidate, date, -float(removed_hours))

                    self.schedule[candidate][day_idx] = self.assign_off(candidate, date)
                    self.nurse_total_shifts[candidate] = max(0, self.nurse_total_shifts.get(candidate, 0) - 1)
                    pool.remove(candidate)

                # Refresh counts after de-peak
                day_count = len(final_day_workers)
                night_count = len(final_night_workers)
            
            logger.info(f"  {date}: Day={day_count}/{self.day_req}, Night={night_count}/{self.night_req}")
            if blocked_by_consecutive and (day_count < self.day_req or night_count < self.night_req):
                logger.warning(
                    f"  {date}: Understaffed even after emergency pass. Consecutive-blocked candidates: {sorted(blocked_by_consecutive)}"
                )
            if blocked_by_hours and (day_count < self.day_req or night_count < self.night_req):
                logger.warning(
                    f"  {date}: Understaffed even after emergency pass. Hours-blocked candidates: {sorted(blocked_by_hours)}"
                )
        
        # ============================================================
        # STEP 2.5: FORCE-FILL FOR UNDER-TARGET NURSES
        # After the initial gap-filling pass, many FT nurses may still be
        # short by 1 shift (the "6-shift trap").  This pass specifically
        # targets nurses who are under their period target and assigns them
        # an additional shift on days where they are OFF and the unit can
        # use more coverage.
        #
        # Priority: FT nurses first (they have the bigger gap), then PT.
        # This also injects vacation credits: for each OCR-sourced OFF day,
        # 7.5h of virtual paid hours are credited so the delta display in
        # the UI correctly reflects that vacation days are "paid".
        # ============================================================
        logger.info("=" * 80)
        logger.info("STEP 2.5: FORCE-FILL FOR UNDER-TARGET NURSES")
        force_fill_count = 0

        # Inject vacation credits: for each scheduled OFF day that came from
        # OCR (C, CF) or offRequests, credit 7.5h toward the nurse's
        # period hours.  This makes the delta display correct (Demitra fix).
        # NOTE: * is NOT an off code — it's a comment marker indicating the
        # nurse has an entry in Employee Notes & Time-Off Requests.
        logger.info("  Injecting vacation credits (7.5h per off day)...")
        vacation_credits_total = 0
        for nurse_name in self.nurse_names:
            for period_key in self.period_to_dates:
                period_dates = self.period_to_dates[period_key]
                off_requests = self.get_off_requests(nurse_name)
                for d in period_dates:
                    day_idx = self.date_to_index.get(d)
                    if day_idx is None:
                        continue
                    shift = self.schedule[nurse_name][day_idx] if day_idx < len(self.schedule.get(nurse_name, [])) else None
                    if not shift or shift.get("shiftType") != "off" or shift.get("hours", 0) > 0:
                        continue

                    # Check if this is a "paid" off day (offRequest, C, CF)
                    is_paid_off = d in off_requests
                    if not is_paid_off:
                        ocr_shift = self._get_raw_ocr_shift(nurse_name, day_idx)
                        if ocr_shift:
                            ocr_upper = ocr_shift.upper().strip()
                            is_paid_off = (
                                ocr_upper in ["C", "OFF"] or
                                ocr_upper.startswith("CF")
                            )

                    if is_paid_off:
                        # Credit 7.5h (one standard shift equivalent) as virtual hours
                        self._track_hours(nurse_name, d, 7.5)
                        vacation_credits_total += 1

        logger.info(f"  Vacation credits injected: {vacation_credits_total} off-day credits (7.5h each)")

        # Build sorted list of under-target nurses (FT first, then PT, by delta)
        # Exclude nurses on leave — they should not receive additional shifts.
        under_target_nurses = []
        for nurse_name in self.nurse_names:
            if nurse_name in self.nurses_on_leave:
                continue
            delta = self.get_target_delta(nurse_name, self.date_list[0]) if self.date_list else 0
            if delta < -3.0:  # At least 3h under target
                is_ft = self._is_full_time(nurse_name)
                under_target_nurses.append((nurse_name, delta, is_ft))

        # Sort: FT first (True > False when negated), then most under-target
        under_target_nurses.sort(key=lambda x: (not x[2], x[1]))

        logger.info(f"  Under-target nurses to force-fill: {len(under_target_nurses)}")
        for name, delta, is_ft in under_target_nurses:
            logger.info(f"    {name} ({'FT' if is_ft else 'PT'}): {delta:+.1f}h")

        for nurse_name, delta, is_ft in under_target_nurses:
            # STRICT FT-FIRST: do not force-fill PT while any FT nurse is
            # still materially under target in the current schedule state.
            if not is_ft:
                ft_still_under = any(
                    self._is_full_time(n)
                    and self.get_target_delta(n, self.date_list[0]) < -3.0
                    for n in self.nurse_names
                ) if self.date_list else False
                if ft_still_under:
                    logger.info(
                        f"    {nurse_name}: PT force-fill deferred (FT nurses still under target)"
                    )
                    continue

            # How many more shifts does this nurse need?
            shifts_needed = max(1, int(abs(delta) / self.reference_shift_hours + 0.5))

            for _ in range(shifts_needed):
                # Re-check delta each iteration (it changes after each assignment)
                current_delta = self.get_target_delta(nurse_name, self.date_list[0]) if self.date_list else 0
                if current_delta >= -3.0:
                    break  # Close enough to target

                # Find the best day to assign (prefer understaffed days)
                best_day_idx = None
                best_score = float('inf')

                for day_idx, date in enumerate(self.date_list):
                    shift = self.schedule[nurse_name][day_idx]
                    # Only consider days where nurse is currently OFF and not from OCR/offRequest
                    if shift is None or (shift.get("shiftType") == "off" and shift.get("hours", 0) <= 0):
                        pass
                    else:
                        continue

                    # Skip off-request days
                    if date in self.get_off_requests(nurse_name):
                        continue

                    # Skip if this was an OCR OFF code (C, CF)
                    # NOTE: * is a comment marker, not an off code
                    ocr_shift = self._get_raw_ocr_shift(nurse_name, day_idx)
                    if ocr_shift:
                        ocr_upper = ocr_shift.upper().strip()
                        if (ocr_upper in ["C", "OFF"] or
                            ocr_upper.startswith("CF")):
                            continue

                    # Skip weekends adjacent to vacation blocks
                    if self._is_on_vacation_around_weekend(nurse_name, date):
                        continue

                    # Check consecutive stretch
                    stretch = self._get_consecutive_stretch(nurse_name, day_idx)
                    if stretch > self.max_consecutive:
                        continue

                    # Minimum-rest guard
                    came_off_night = self._worked_night_previous_day(nurse_name, day_idx)

                    # Count current staffing for this day
                    day_staff = 0
                    night_staff = 0
                    for n in self.nurse_names:
                        s = self.schedule[n][day_idx]
                        if s and s.get("hours", 0) > 0:
                            if s.get("shiftType") == "day":
                                day_staff += 1
                            elif s.get("shiftType") == "night":
                                night_staff += 1

                    # STRICT ANTI-OVERSTAFF GUARD:
                    # Force-fill is for closing true coverage gaps, not for
                    # inflating headcount on already-covered days.
                    day_deficit = max(0, self.day_req - day_staff)
                    night_deficit = max(0, self.night_req - night_staff)
                    if day_deficit <= 0 and night_deficit <= 0:
                        continue

                    # Also respect adaptive daily cap during force-fill.
                    daily_staff_cap = self._get_dynamic_daily_staff_cap(date)
                    if (day_staff + night_staff) >= daily_staff_cap:
                        continue

                    # Score: prefer days with less total coverage (understaffed days first)
                    total_staff = day_staff + night_staff
                    # Prefer the type that's most understaffed

                    if came_off_night:
                        # Can only work night
                        if night_deficit > 0:
                            score = -night_deficit  # More deficit = lower (better) score
                        else:
                            continue  # Can't help coverage on this day
                    else:
                        # Prefer the side with the bigger deficit
                        score = -(day_deficit + night_deficit) if (day_deficit + night_deficit) > 0 else total_staff

                    if score < best_score:
                        best_score = score
                        best_day_idx = day_idx

                # ---------------------------------------------------------
                # SHIFT-SLIDE: If no day is available because of the
                # consecutive-work-days constraint, try to swap one
                # existing shift to an adjacent day to open a gap.
                # ---------------------------------------------------------
                if best_day_idx is None:
                    slid = False
                    for di, dt in enumerate(self.date_list):
                        s = self.schedule[nurse_name][di]
                        if not s or s.get("hours", 0) <= 0:
                            continue  # Not a work shift
                        if (nurse_name, dt) in self.ocr_assignments:
                            continue  # Can't move OCR-locked shifts
                        # Try sliding this shift to a neighbour to break the streak
                        for neighbour_offset in (-1, 1):
                            ni = di + neighbour_offset
                            if ni < 0 or ni >= len(self.date_list):
                                continue
                            ns = self.schedule[nurse_name][ni]
                            if ns and ns.get("hours", 0) > 0:
                                continue  # Neighbour already has a shift
                            nd = self.date_list[ni]
                            if nd in self.get_off_requests(nurse_name):
                                continue
                            ocr_n = self._get_raw_ocr_shift(nurse_name, ni)
                            if ocr_n:
                                ocr_u = ocr_n.upper().strip()
                                if ocr_u in ["C", "OFF"] or ocr_u.startswith("CF"):
                                    continue
                            # Tentatively slide: move shift di→ni, leave di empty
                            moved_shift = {**s, "date": nd}
                            self.schedule[nurse_name][ni] = moved_shift
                            self.schedule[nurse_name][di] = self.assign_off(nurse_name, dt)
                            # Re-check if the original day now has room
                            stretch_at_di = self._get_consecutive_stretch(nurse_name, di)
                            if stretch_at_di <= self.max_consecutive:
                                # The slide opened a valid slot at di
                                best_day_idx = di
                                self._track_hours(nurse_name, dt, -float(s.get("hours", 0)))
                                self._track_hours(nurse_name, nd, float(moved_shift.get("hours", 0)))
                                logger.info(
                                    f"    SHIFT-SLIDE: moved {nurse_name} shift from {dt} to {nd} to open a slot"
                                )
                                slid = True
                                break
                            else:
                                # Revert the slide
                                self.schedule[nurse_name][di] = s
                                self.schedule[nurse_name][ni] = ns
                        if slid:
                            break

                if best_day_idx is None:
                    logger.info(f"    {nurse_name}: no available day for force-fill (even after shift-slide attempt)")
                    break

                date = self.date_list[best_day_idx]
                came_off_night = self._worked_night_previous_day(nurse_name, best_day_idx)

                # Count current staffing to decide shift type
                day_staff = sum(1 for n in self.nurse_names
                                if self.schedule[n][best_day_idx] and
                                self.schedule[n][best_day_idx].get("shiftType") == "day" and
                                self.schedule[n][best_day_idx].get("hours", 0) > 0)
                night_staff = sum(1 for n in self.nurse_names
                                  if self.schedule[n][best_day_idx] and
                                  self.schedule[n][best_day_idx].get("shiftType") == "night" and
                                  self.schedule[n][best_day_idx].get("hours", 0) > 0)

                day_deficit = max(0, self.day_req - day_staff)
                night_deficit = max(0, self.night_req - night_staff)
                if day_deficit <= 0 and night_deficit <= 0:
                    logger.info(
                        f"    {nurse_name}: selected day {date} no longer has coverage deficit; skipping"
                    )
                    break

                if came_off_night:
                    if night_deficit <= 0:
                        logger.info(
                            f"    {nurse_name}: cannot place day-after-night and no night deficit on {date}; skipping"
                        )
                        break
                    shift_type = "night"
                elif night_deficit > day_deficit:
                    shift_type = "night"
                else:
                    shift_type = "day"

                # 8h TOP-UP: If the nurse only needs ≤ 8h to reach target,
                # use an 8h shift instead of 12h. Easier to schedule and
                # avoids overshooting the target.
                fill_hours = 12
                if abs(current_delta) <= self.reference_shift_hours + 0.5:
                    fill_hours = 8
                    logger.info(f"    8h TOP-UP for {nurse_name}: delta={current_delta:+.1f}h, using 8h shift")

                new_shift = self.assign_shift(nurse_name, date, shift_type, hours=fill_hours)
                self.schedule[nurse_name][best_day_idx] = new_shift
                force_fill_count += 1
                logger.info(
                    f"    FORCE-FILL: {nurse_name} on {date} -> {new_shift.get('shift', '')} "
                    f"({shift_type} {fill_hours}h, delta was {current_delta:+.1f}h)"
                )

        logger.info(f"FORCE-FILL COMPLETE: {force_fill_count} additional shifts assigned")
        logger.info("=" * 80)

        # ============================================================
        # STEP 3: FINAL OCR ENFORCEMENT
        # Safety net: after all gap-filling and de-peaking, scan every
        # nurse's OCR data and force-correct any shift that was dropped
        # or overwritten.  This GUARANTEES OCR assignments survive.
        # ============================================================
        logger.info("=" * 80)
        logger.info("STEP 3: FINAL OCR ENFORCEMENT (authoritative overlay)")
        ocr_corrections = 0
        ocr_already_correct = 0
        schedule_name_by_norm = {
            self._normalize_nurse_name_key(n): n for n in self.nurse_names
        }

        for pref_name, pref_shifts in (self.preferences or {}).items():
            schedule_name = schedule_name_by_norm.get(self._normalize_nurse_name_key(pref_name))
            if not schedule_name:
                logger.warning(f"  OCR OVERLAY SKIP: nurse '{pref_name}' not found in active schedule")
                continue

            for day_idx, raw_ocr in enumerate(pref_shifts or []):
                if day_idx >= len(self.date_list):
                    break
                if not raw_ocr or not str(raw_ocr).strip():
                    continue

                raw_ocr = str(raw_ocr).strip()
                shift_upper = raw_ocr.upper()
                date = self.date_list[day_idx]

                is_off_code = (
                    shift_upper in ["C", "OFF"]
                    or shift_upper.startswith("CF")
                    or "CF " in shift_upper
                )

                current = (
                    self.schedule[schedule_name][day_idx]
                    if day_idx < len(self.schedule.get(schedule_name, []))
                    else None
                )

                # Explicit OFF sources: offRequest or OCR off code
                if date in self.get_off_requests(schedule_name) or is_off_code:
                    if current and current.get("hours", 0) > 0:
                        self._track_hours(schedule_name, date, -float(current["hours"]))
                    if day_idx >= len(self.schedule.get(schedule_name, [])):
                        while len(self.schedule[schedule_name]) <= day_idx:
                            self.schedule[schedule_name].append(None)
                    self.schedule[schedule_name][day_idx] = self.assign_off(schedule_name, date)
                    if current and current.get("shiftType") == "off":
                        ocr_already_correct += 1
                    else:
                        ocr_corrections += 1
                        logger.warning(
                            f"  ⚠️ OCR OFF ENFORCED: {schedule_name} on {date}: '{raw_ocr}'"
                        )
                    continue

                # Marker-only cells are intentionally fillable
                if shift_upper == "*":
                    continue

                # NIGHT TAIL DEDUP: Skip Z23 (plain, no B) that follows a night-start code.
                # Z23 B is always a real shift. Only plain Z23 is a wrap-around tail.
                if shift_upper == "Z23" and day_idx > 0:
                    prev_raw = (pref_shifts[day_idx - 1] or "") if day_idx - 1 < len(pref_shifts) else ""
                    prev_upper = str(prev_raw).strip().upper()
                    if prev_upper in ("Z19", "Z23", "Z23 B"):
                        # This is a wrap-around tail — keep current assignment (OFF from dedup)
                        ocr_already_correct += 1
                        continue

                if current and current.get("shift") == raw_ocr and current.get("shiftType") not in ("off", None):
                    ocr_already_correct += 1
                    continue

                shift_info = self._get_shift_metadata(raw_ocr)
                corrected_shift = {
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": raw_ocr,
                    "shiftType": shift_info["type"],
                    "hours": shift_info["hours"],
                    "startTime": shift_info["start"],
                    "endTime": shift_info["end"],
                }
                old_label = current.get("shift", "OFF/None") if current else "None"
                logger.warning(
                    f"  ⚠️ OCR CORRECTION: {schedule_name} on {date}: "
                    f"'{old_label}' -> '{raw_ocr}' ({shift_info['type']}, {shift_info['hours']}h)"
                )

                if current and current.get("hours", 0) > 0:
                    self._track_hours(schedule_name, date, -float(current["hours"]))
                self._track_hours(schedule_name, date, float(shift_info["hours"]))

                if day_idx < len(self.schedule.get(schedule_name, [])):
                    self.schedule[schedule_name][day_idx] = corrected_shift
                else:
                    while len(self.schedule[schedule_name]) <= day_idx:
                        self.schedule[schedule_name].append(None)
                    self.schedule[schedule_name][day_idx] = corrected_shift

                ocr_corrections += 1

        logger.info(
            f"FINAL OCR ENFORCEMENT COMPLETE: "
            f"{ocr_already_correct} shifts already correct, "
            f"{ocr_corrections} corrections applied"
        )
        logger.info("=" * 80)

        # ============================================================
        # STEP 4: WORKLOAD EQUALIZATION
        # Swap shifts from over-target nurses (+delta) to under-target
        # nurses (−delta) to reduce FTE variance.  Only NON-OCR shifts
        # are eligible for redistribution.
        # ============================================================
        self._equalize_workload()

        # ============================================================
        # STEP 5: FINAL SAFETY PASS
        # After all optimization, run a final sweep that:
        #   (a) Re-applies night ghost dedup (catches any Z23 re-added
        #       by STEP 3 / overlay / equalization).
        #   (b) Enforces 12.5h max per nurse per day (hard limit).
        #   (c) Enforces max 3 consecutive work days.
        # This is the absolute last word before the schedule is returned.
        # ============================================================
        self._final_safety_pass()

        self._validate_schedule()
        return self.schedule
    
    # ── Workload Equalization ──────────────────────────────────────────────
    def _equalize_workload(self) -> None:
        """STEP 4 — Redistribute shifts from overworked to underworked nurses.

        Strategy:
          1. Identify the *donor* (positive delta) and *recipient* (negative
             delta) pools.
          2. For each potential swap: pick the most-over-target nurse that has a
             non-OCR shift on a day where the most-under-target nurse is OFF
             *and* can legally work (rest rules, hours cap, off requests).
          3. Move the shift from donor → recipient, updating all hour tracking.
          4. Repeat until no swap improves variance or we hit max iterations.

        The algorithm respects:
          • OCR-assigned shifts (immutable)
          • Off-request days
          • Minimum rest after night shifts
          • Daily minimum staffing (day_req / night_req)
          • Maximum weekly hours
        """
        logger.info("=" * 80)
        logger.info("STEP 4: WORKLOAD EQUALIZATION")

        MAX_SWAPS = 120  # Safety cap to avoid runaway loops
        swaps_done = 0

        for iteration in range(MAX_SWAPS):
            # Recalculate deltas every iteration (they shift after each swap).
            nurse_deltas = []
            for nurse in self.nurse_names:
                # Use the first date's period as the reference period.
                delta = self.get_target_delta(nurse, self.date_list[0]) if self.date_list else 0
                nurse_deltas.append((nurse, delta))

            donors = sorted(
                [(n, d) for n, d in nurse_deltas if d > 3.75],
                key=lambda x: -x[1],  # most over first
            )
            recipients = sorted(
                [(n, d) for n, d in nurse_deltas if d < -3.75],
                key=lambda x: x[1],  # most under first
            )

            if not donors or not recipients:
                logger.info(f"  Equalization complete after {swaps_done} swaps (no more donors/recipients).")
                break

            swapped_this_round = False

            for donor_name, donor_delta in donors:
                if swapped_this_round:
                    break
                for recip_name, recip_delta in recipients:
                    if swapped_this_round:
                        break

                    # Find a movable shift from donor → recipient
                    for day_idx, date in enumerate(self.date_list):
                        donor_shift = self.schedule[donor_name][day_idx]
                        recip_shift = self.schedule[recip_name][day_idx]

                        # Donor must have a work shift on this day
                        if not donor_shift or donor_shift.get("hours", 0) <= 0:
                            continue

                        # Must NOT be OCR-assigned
                        if (donor_name, date) in self.ocr_assignments:
                            continue

                        # Recipient must be OFF on this day
                        if recip_shift and recip_shift.get("hours", 0) > 0:
                            continue

                        # Recipient must not have an off-request on this day
                        if date in self.get_off_requests(recip_name):
                            continue

                        shift_type = donor_shift.get("shiftType", "day")
                        shift_hours = donor_shift.get("hours", 12)
                        is_night = shift_type == "night"

                        # Recipient must pass can_work (includes rest rules + consecutive)
                        if not self.can_work(recip_name, date, is_night=is_night, hours=int(shift_hours)):
                            continue

                        # Extra consecutive guard: verify the swap doesn't create
                        # >max_consecutive for the recipient (can_work checks this
                        # but let's be explicit since we're inserting between
                        # existing schedule entries).
                        recip_stretch = self._get_consecutive_stretch(recip_name, day_idx)
                        if recip_stretch > self.max_consecutive:
                            continue

                        # Minimum rest: recipient can't work day after taking a night
                        if is_night and day_idx + 1 < len(self.date_list):
                            next_shift = self.schedule[recip_name][day_idx + 1]
                            if next_shift and next_shift.get("shiftType") == "day" and next_shift.get("hours", 0) > 0:
                                continue

                        # Daily minimum staffing: make sure removing donor doesn't
                        # break minimum coverage (the recipient takes over, so net
                        # is neutral UNLESS there's a type mismatch, which we avoid
                        # by keeping the same shift type).

                        # Don't overshoot: only swap if it actually improves both
                        new_donor_delta = donor_delta - shift_hours
                        new_recip_delta = recip_delta + shift_hours
                        old_variance = abs(donor_delta) + abs(recip_delta)
                        new_variance = abs(new_donor_delta) + abs(new_recip_delta)
                        if new_variance >= old_variance:
                            continue

                        # ── Execute the swap ──
                        # Remove shift from donor
                        self._track_hours(donor_name, date, -float(shift_hours))
                        self.nurse_total_shifts[donor_name] = max(0, self.nurse_total_shifts.get(donor_name, 0) - 1)
                        self.schedule[donor_name][day_idx] = self.assign_off(donor_name, date)

                        # Assign shift to recipient (preserving original code & times)
                        new_shift = {
                            "id": str(uuid.uuid4()),
                            "date": date,
                            "shift": donor_shift.get("shift", ""),
                            "shiftType": shift_type,
                            "hours": shift_hours,
                            "startTime": donor_shift.get("startTime", ""),
                            "endTime": donor_shift.get("endTime", ""),
                        }
                        self.schedule[recip_name][day_idx] = new_shift
                        self._track_hours(recip_name, date, float(shift_hours))
                        self.nurse_total_shifts[recip_name] = self.nurse_total_shifts.get(recip_name, 0) + 1

                        logger.info(
                            f"  SWAP #{swaps_done + 1}: {donor_shift.get('shift','')} on {date} "
                            f"{donor_name} ({donor_delta:+.1f}h) -> {recip_name} ({recip_delta:+.1f}h)"
                        )
                        swaps_done += 1
                        swapped_this_round = True
                        break  # restart from fresh deltas

            if not swapped_this_round:
                logger.info(f"  Equalization converged after {swaps_done} swaps.")
                break

        # Log final distribution
        logger.info(f"EQUALIZATION COMPLETE: {swaps_done} shifts redistributed")
        if swaps_done > 0:
            final_deltas = []
            for nurse in self.nurse_names:
                delta = self.get_target_delta(nurse, self.date_list[0]) if self.date_list else 0
                final_deltas.append((nurse, delta))
            final_deltas.sort(key=lambda x: x[1])
            for name, delta in final_deltas:
                marker = "⚠️" if abs(delta) > 11 else "✓"
                logger.info(f"  {marker} {name}: {delta:+.1f}h vs target")
        logger.info("=" * 80)

    def _final_safety_pass(self) -> None:
        """STEP 5 — Final safety sweep after all optimization.

        (a) Re-dedup night ghost tails (in case STEP 3/4 re-added them).
        (b) Enforce 12.5h max per nurse per day (hard limit).
        (c) Enforce max consecutive work days.
        """
        logger.info("=" * 80)
        logger.info("STEP 5: FINAL SAFETY PASS")

        NIGHT_DEDUP = {
            "Z19":   {"Z23"},
            "Z23":   {"Z23"},
            "Z23 B": {"Z23"},
        }

        # (a) Re-dedup night ghost tails
        ghost_fixes = 0
        for nurse_name in self.nurse_names:
            row = self.schedule.get(nurse_name, [])
            for day_idx in range(1, len(row)):
                prev = row[day_idx - 1]
                curr = row[day_idx]
                if not prev or not curr:
                    continue
                if prev.get("hours", 0) <= 0 or curr.get("hours", 0) <= 0:
                    continue
                prev_code = str(prev.get("shift", "")).replace("↩", "").strip().upper()
                curr_code = str(curr.get("shift", "")).replace("↩", "").strip().upper()
                tails = NIGHT_DEDUP.get(prev_code)
                if tails and curr_code in tails:
                    old_h = curr.get("hours", 0)
                    if old_h > 0:
                        self._track_hours(nurse_name, self.date_list[day_idx], -float(old_h))
                    self.nurse_total_shifts[nurse_name] = max(
                        0, self.nurse_total_shifts.get(nurse_name, 0) - 1
                    )
                    row[day_idx] = self.assign_off(nurse_name, self.date_list[day_idx])
                    self.ocr_assignments.discard((nurse_name, self.date_list[day_idx]))
                    ghost_fixes += 1
                    logger.info(
                        f"  GHOST FIX: {nurse_name} {self.date_list[day_idx]}: "
                        f"'{curr_code}' after '{prev_code}' → zeroed ({old_h}h)"
                    )

        # (b) 12.5h per-day max (prevent shift stacking — user hard limit)
        MAX_DAILY_H = self.MAX_HOURS_PER_DAY  # 12.5h
        stack_fixes = 0
        for nurse_name in self.nurse_names:
            row = self.schedule.get(nurse_name, [])
            for day_idx, shift in enumerate(row):
                if not shift or shift.get("hours", 0) <= 0:
                    continue
                if shift.get("hours", 0) > MAX_DAILY_H:
                    excess = shift["hours"] - MAX_DAILY_H
                    self._track_hours(nurse_name, self.date_list[day_idx], -excess)
                    shift["hours"] = MAX_DAILY_H
                    stack_fixes += 1
                    logger.warning(
                        f"  STACK CAP: {nurse_name} {self.date_list[day_idx]}: "
                        f"capped at {MAX_DAILY_H}h (removed {excess}h)"
                    )

        # (c) Max consecutive work days — remove non-OCR tail shifts that
        #     exceed self.max_consecutive (default 3).
        consec_fixes = 0
        for nurse_name in self.nurse_names:
            row = self.schedule.get(nurse_name, [])
            streak_start = None
            streak_len = 0
            for day_idx in range(len(row)):
                shift = row[day_idx]
                is_work = (
                    shift
                    and shift.get("shiftType") not in ("off", None)
                    and shift.get("hours", 0) > 0
                )
                if is_work:
                    if streak_start is None:
                        streak_start = day_idx
                    streak_len += 1
                else:
                    streak_start = None
                    streak_len = 0

                if streak_len > self.max_consecutive:
                    # Remove the excess shift (prefer removing non-OCR)
                    # Try removing from the tail of the streak first
                    remove_idx = day_idx
                    date = self.date_list[remove_idx]
                    if (nurse_name, date) in self.ocr_assignments:
                        # Can't remove OCR shift — try removing the one just before it
                        for try_idx in range(day_idx - 1, streak_start - 1, -1):
                            try_date = self.date_list[try_idx]
                            if (nurse_name, try_date) not in self.ocr_assignments:
                                remove_idx = try_idx
                                date = try_date
                                break
                        else:
                            # All OCR — can't fix, skip
                            continue

                    removed_shift = row[remove_idx]
                    removed_hours = removed_shift.get("hours", 0)
                    if removed_hours > 0:
                        self._track_hours(nurse_name, date, -float(removed_hours))
                    self.nurse_total_shifts[nurse_name] = max(
                        0, self.nurse_total_shifts.get(nurse_name, 0) - 1
                    )
                    row[remove_idx] = self.assign_off(nurse_name, date)
                    consec_fixes += 1
                    logger.info(
                        f"  CONSEC FIX: {nurse_name} {date}: removed "
                        f"{removed_shift.get('shift','')} to enforce max {self.max_consecutive} consecutive"
                    )
                    # Reset streak tracking from the break point
                    streak_start = None
                    streak_len = 0

        logger.info(
            f"SAFETY PASS COMPLETE: {ghost_fixes} ghost fixes, "
            f"{stack_fixes} stack caps, {consec_fixes} consecutive fixes"
        )
        logger.info("=" * 80)

    def _get_raw_ocr_shift(self, nurse_name: str, day_idx: int) -> str:
        """Get raw OCR shift without filtering (for build_schedule to handle).
        
        Tries exact match first, then normalized (strip/lowercase) fallback so
        minor whitespace/case differences between the OCR grid names and the
        scheduler nurse list do NOT cause OCR data to be silently ignored.
        """
        # 1. Exact match
        if nurse_name in self.preferences:
            shifts = self.preferences[nurse_name]
            if day_idx < len(shifts):
                return shifts[day_idx] or ""

        # 2. Normalized match (handles trailing spaces, casing differences)
        name_normalized = nurse_name.strip().lower()
        for pref_name, shifts in self.preferences.items():
            if pref_name.strip().lower() == name_normalized:
                if day_idx < len(shifts):
                    logger.debug(
                        f"  OCR name fuzzy-match: '{nurse_name}' -> '{pref_name}'"
                    )
                    return shifts[day_idx] or ""

        return ""

    def _normalize_nurse_name_key(self, name: str) -> str:
        """Normalize nurse names for robust matching across OCR/UI/backend variants."""
        if not name:
            return ""
        return re.sub(r"\s+", " ", str(name).strip().lower())

    def _nurse_has_ocr_baseline(self, nurse_name: str) -> bool:
        """True when nurse has at least one concrete OCR work shift.

        This is used to keep OCR nurses immutable during gap-filling.
        """
        if not self.preferences:
            return False

        def has_work_shift(shift_list: List[str]) -> bool:
            for shift_code in shift_list or []:
                if not shift_code or not str(shift_code).strip():
                    continue
                shift_upper = str(shift_code).upper().strip()
                if shift_upper in ["C", "OFF"] or shift_upper.startswith("CF"):
                    continue
                if shift_upper == "*":
                    continue
                return True
            return False

        # Exact key
        if nurse_name in self.preferences:
            return has_work_shift(self.preferences.get(nurse_name, []))

        # Normalized fallback
        target = nurse_name.strip().lower()
        for pref_name, pref_shifts in self.preferences.items():
            if pref_name.strip().lower() == target:
                return has_work_shift(pref_shifts)

        return False
    
    def _get_shift_metadata(self, shift_code: str) -> Dict:
        """Get metadata for a shift code."""
        if shift_code in self.shifts_info:
            info = self.shifts_info[shift_code]
            return {
                "type": info.get("type", "day"),
                "hours": info.get("hours", 12),
                "start": info.get("startTime", "07:00"),
                "end": info.get("endTime", "19:00"),
            }

        code_upper = shift_code.upper()
        if "N" in code_upper or "19" in code_upper or "23" in code_upper:
            if "Z19" in code_upper:
                return {"type": "night", "hours": 11.25, "start": "19:00", "end": "07:25"}
            if "Z23" in code_upper:
                # Z23 and Z23 B are both 12-hour night shifts (11.25 paid hours)
                return {"type": "night", "hours": 11.25, "start": "23:00", "end": "11:25"}
            # Plain 23 (no Z prefix) is an 8-hour night shift
            return {"type": "night", "hours": 7.5, "start": "23:00", "end": "07:15"}

        if "D" in code_upper or "07" in code_upper or "11" in code_upper:
            if "8" in code_upper:
                return {"type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"}
            return {"type": "day", "hours": 11.25, "start": "07:00", "end": "19:25"}

        return {"type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"}

    def _validate_schedule(self):
        """Validate and log schedule statistics"""
        logger.info("=" * 60)
        logger.info("SCHEDULE VALIDATION:")

        total_issues = 0
        for day_idx, date in enumerate(self.date_list):
            day_count = 0
            night_count = 0
            for nurse_name in self.nurse_names:
                if day_idx < len(self.schedule[nurse_name]):
                    shift = self.schedule[nurse_name][day_idx]
                    if shift["shiftType"] == "day":
                        day_count += 1
                    elif shift["shiftType"] == "night":
                        night_count += 1

            day_ok = "✓" if day_count >= self.day_req else "✗"
            night_ok = "✓" if night_count >= self.night_req else "✗"

            if day_count < self.day_req or night_count < self.night_req:
                total_issues += 1
                logger.error(f"  {date}: Day={day_count}/{self.day_req} {day_ok}, Night={night_count}/{self.night_req} {night_ok}")
            else:
                logger.info(f"  {date}: Day={day_count}/{self.day_req} {day_ok}, Night={night_count}/{self.night_req} {night_ok}")

        logger.info("-" * 40)
        logger.info("WORKLOAD DISTRIBUTION:")
        shifts_list = sorted(self.nurse_total_shifts.items(), key=lambda x: x[1], reverse=True)
        for name, count in shifts_list:
            logger.info(f"  {name}: {count} shifts")

        if total_issues == 0:
            logger.info("✓ ALL DAYS PROPERLY STAFFED!")
        else:
            logger.error(f"✗ {total_issues} DAYS WITH COVERAGE ISSUES")

        logger.info("=" * 60)

class ScheduleOptimizer:

    @staticmethod
    def _is_off_like_code(code: Any) -> bool:
        text = str(code or "").strip().upper()
        if not text:
            return True
        return text in {"C", "OFF", "*"} or text.startswith("CF") or "CF " in text

    @staticmethod
    def _sanitize_shift_codes(
        raw_codes: List[Any],
        shifts_info: Dict[str, Dict[str, Any]],
        target_kind: str,
    ) -> List[str]:
        cleaned: List[str] = []
        seen: Set[str] = set()

        for code in raw_codes or []:
            normalized = str(code or "").strip()
            if not normalized or ScheduleOptimizer._is_off_like_code(normalized):
                continue
            key = normalized.upper()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(normalized)

        if cleaned:
            return cleaned

        inferred: List[str] = []
        for code, meta in (shifts_info or {}).items():
            normalized = str(code or "").strip()
            if not normalized or ScheduleOptimizer._is_off_like_code(normalized):
                continue

            shift_type = str((meta or {}).get("type", "")).strip().lower()
            if target_kind == "day" and shift_type == "day":
                inferred.append(normalized)
            elif target_kind == "night" and shift_type in {"night", "combined"}:
                inferred.append(normalized)

        if inferred:
            return inferred

        fallback = [
            code
            for code, info in SHIFT_CODES.items()
            if (target_kind == "day" and info.get("type") == "day")
            or (target_kind == "night" and info.get("type") in {"night", "combined"})
        ]
        return fallback

    @staticmethod
    def _resolve_staff_requirement(ai_count: Any, requested_min: Optional[Any] = None) -> int:
        def to_int(value: Any) -> Optional[int]:
            try:
                parsed = int(value)
                return parsed if parsed > 0 else None
            except (TypeError, ValueError):
                return None

        ai = to_int(ai_count)
        req = to_int(requested_min)
        return max(1, req if req is not None else (ai if ai is not None else 1))

    @staticmethod
    def convert_to_dict(nurse: Union[Dict, object]) -> Dict:
        if isinstance(nurse, dict):
            return nurse.copy()
        elif hasattr(nurse, 'dict'):
            return nurse.dict()
        else:
            return vars(nurse) if hasattr(nurse, '__dict__') else {}

    @staticmethod
    def preprocess_nurse_data(nurses: List[Union[Dict, object]]) -> List[Dict]:
        processed_nurses = []
        for nurse in nurses:
            nurse_dict = ScheduleOptimizer.convert_to_dict(nurse)
            if not nurse_dict:
                continue
                
            processed = nurse_dict.copy()

            # Keep explicit seniority when provided; otherwise infer from ID.
            raw_seniority = nurse_dict.get('seniority')
            if raw_seniority is None:
                nurse_id = str(nurse_dict.get('id', ''))
                seniority_matches = re.findall(r'\d+(?:\.\d+)?', nurse_id)
                seniority = float(seniority_matches[-1]) if seniority_matches else 0
            else:
                seniority_matches = re.findall(r'\d+(?:\.\d+)?', str(raw_seniority))
                seniority = float(seniority_matches[-1]) if seniority_matches else 0

            # Preserve incoming employment type; infer only if missing/invalid.
            employment_type_raw = str(nurse_dict.get('employmentType', '')).strip().lower()
            if employment_type_raw in ['pt', 'part-time']:
                employment_type = 'part-time'
            elif employment_type_raw in ['ft', 'full-time']:
                employment_type = 'full-time'
            else:
                max_hours = nurse_dict.get('maxWeeklyHours')
                try:
                    max_hours_val = float(max_hours) if max_hours is not None else None
                except (TypeError, ValueError):
                    max_hours_val = None
                employment_type = 'part-time' if (max_hours_val is not None and max_hours_val <= 30) else 'full-time'

            # Ensure maxWeeklyHours remains numeric and reflects realistic FT/PT targets when absent.
            max_hours = nurse_dict.get('maxWeeklyHours')
            try:
                max_hours_val = float(max_hours) if max_hours is not None else None
            except (TypeError, ValueError):
                max_hours_val = None
            if max_hours_val is None:
                fte = nurse_dict.get('fte')
                fte_val = None
                if fte is not None:
                    try:
                        fte_val = float(fte)
                    except (TypeError, ValueError):
                        fte_val = None

                if fte_val is not None:
                    if fte_val >= 0.95:
                        max_hours_val = 37.5
                    elif fte_val >= 0.65:
                        max_hours_val = 26.25
                    elif fte_val > 0:
                        max_hours_val = 22.5
                    else:
                        max_hours_val = 26.25 if employment_type == 'part-time' else 37.5
                else:
                # Default PT to 0.7 FTE baseline; per-nurse overrides can set 22.5 for 0.6 FTE.
                    max_hours_val = 26.25 if employment_type == 'part-time' else 37.5

            processed['seniority'] = seniority
            processed['employmentType'] = employment_type
            processed['maxWeeklyHours'] = max_hours_val
            processed_nurses.append(processed)
        
        return processed_nurses

    @staticmethod
    def validate_input_data(req: OptimizeRequest):
        if not req.dates:
            raise HTTPException(status_code=400, detail="Dates list cannot be empty")
        if not req.nurses:
            raise HTTPException(status_code=400, detail="Nurses list cannot be empty")
        if req.assignments:        
            for nurse, shifts in req.assignments.items():
                if len(shifts) != len(req.dates):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Assignment length for nurse {nurse} doesn't match dates length"
                    )
                for shift in shifts:
                    if shift and not isinstance(shift, str):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid shift code {shift} for nurse {nurse}"
                        )

    @staticmethod
    def build_prompt_for_constraints_parsing(req: OptimizeRequest, db: Session) -> str:
        prompt_template = get_system_prompt(db).content
        nurses_json = json.dumps(
            [n.dict() if hasattr(n, "dict") else n for n in req.nurses],
            indent=2,
            ensure_ascii=False,
        )
        assignments_json = json.dumps(req.assignments or {}, indent=2, ensure_ascii=False)
        notes = req.notes or "No additional notes"
        comments_json = json.dumps(req.comments or {}, indent=2, ensure_ascii=False)

        formatted_prompt = prompt_template.format(
            start_date=req.dates[0],
            end_date=req.dates[-1],
            nurses_list=nurses_json,
            notes=notes,
            comments_json=comments_json,
            existing_assignments=assignments_json,
        )

        # Always append authoritative policy guidance so behavior remains consistent
        # even when a custom saved prompt is stale.
        policy_suffix = """

    NON-NEGOTIABLE SCHEDULING POLICY:
    - `dayShift.count` and `nightShift.count` are strict MINIMUM floors, not exact quotas.
    - Meeting or exceeding minimums is valid (e.g., 4 night nurses when minimum is 3 is acceptable).
    - Prioritize preserving OCR assignments as much as possible.
    - Ensure coverage across D/E/N timeslots (day/evening/night), not only aggregate totals.
    - Respect minimum certification requirements (chemo/renal when provided by input constraints).
    - Respect FT/PT targets using 14-day reconciliation (default FT=75h per 2 weeks, PT=45h per 2 weeks unless overridden) and nurse `maxWeeklyHours` from input data.
    - For 12h lines, allow week-to-week variation (e.g., 3 shifts one week, 4 the next) while balancing over the pay period.
    - For full-time nurses, prefer at least one worked weekend in each 14-day period when feasible.
    - Use pay-period staffing reality: average daily staff ≈ (sum of nurse 14-day target hours) / (11.25 * number_of_days).
    - Avoid unnecessary overstaffing spikes; keep daily totals close to this computed average while never dropping below minimums.
    - Prefer schedules with senior nurse presence in each timeslot and avoid junior-only slot coverage when possible.
    - Keep workload balanced across days and nurses while honoring off requests.
    """

        return f"{formatted_prompt.rstrip()}\n{policy_suffix}"

    @staticmethod
    def parse_ai_response(raw_response: str) -> Dict:
        try:
            text = str(raw_response or "").strip()
            if not text:
                raise ValueError("Empty AI response")

            def _clean_json_like(s: str) -> str:
                # Normalize smart quotes and remove common trailing commas
                s = s.replace("\u201c", '"').replace("\u201d", '"')
                s = s.replace("\u2018", "'").replace("\u2019", "'")
                s = re.sub(r",\s*([}\]])", r"\1", s)
                # Some models prefix with "json" after code fences
                if s.lower().startswith("json\n"):
                    s = s[5:]
                return s.strip()

            def _try_parse(s: str):
                cleaned = _clean_json_like(s)
                # Strict JSON first
                try:
                    return json.loads(cleaned)
                except Exception:
                    pass
                # Python-literal fallback (single quotes, True/False, etc.)
                try:
                    return ast.literal_eval(cleaned)
                except Exception:
                    return None

            # Candidate 1: fenced blocks (```json ... ``` or ``` ... ```)
            for block in re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
                parsed = _try_parse(block)
                if isinstance(parsed, dict):
                    return parsed

            # Candidate 2: full text
            parsed = _try_parse(text)
            if isinstance(parsed, dict):
                return parsed

            # Candidate 3: first balanced JSON object in text
            start = text.find("{")
            while start != -1:
                depth = 0
                in_string = False
                escape = False
                for i in range(start, len(text)):
                    ch = text[i]
                    if in_string:
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_string = False
                        continue

                    if ch == '"':
                        in_string = True
                    elif ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            candidate = text[start:i + 1]
                            parsed = _try_parse(candidate)
                            if isinstance(parsed, dict):
                                return parsed
                            break
                start = text.find("{", start + 1)

            raise ValueError("No valid JSON object could be parsed from AI response")

        except Exception as e:
            logger.error(f"Failed to parse AI response: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid JSON response from AI")

    @staticmethod
    def create_fallback_schedule(assignments, constraints, date_list, nurses, day_shift_codes, night_shift_codes, shift_code_to_idx) -> Dict:
        """
        GUARANTEED FALLBACK: Creates a schedule ensuring EVERY day has both day and night coverage.
        Uses round-robin assignment to distribute shifts fairly among nurses.
        """
        logger.warning("=" * 60)
        logger.warning("CREATING GUARANTEED FALLBACK SCHEDULE")
        logger.warning("=" * 60)
        
        num_days = len(date_list)
        num_nurses = len(nurses)
        
        # Get staffing requirements with MINIMUM FLOORS
        day_count = max(constraints["shiftRequirements"]["dayShift"]["count"], 3)
        night_count = max(constraints["shiftRequirements"]["nightShift"]["count"], 2)
        
        # If we don't have enough nurses, scale down but NEVER to 0
        total_needed_per_day = day_count + night_count
        if num_nurses < total_needed_per_day:
            # Scale proportionally but ensure at least 1 for each
            day_count = max(1, int(num_nurses * 0.6))  # 60% day
            night_count = max(1, num_nurses - day_count)  # Rest night
            logger.warning(f"Scaled requirements to {day_count} day / {night_count} night due to limited nurses ({num_nurses})")
        
        logger.info(f"Fallback targets: {day_count} day nurses, {night_count} night nurses per day")
        logger.info(f"Available nurses: {num_nurses}")
        
        shifts_info = constraints.get("shiftsInfo", {})
        
        # Initialize empty schedule
        fallback_schedule = {n["name"]: [] for n in nurses}
        
        # Track nurse workload for fair distribution
        nurse_shifts_count = {n["name"]: 0 for n in nurses}
        
        # Get off requests
        off_requests_map = {}
        for nurse in nurses:
            off_requests_map[nurse["name"]] = set(nurse.get("offRequests", []))
        
        # Process each day
        for d_idx, date in enumerate(date_list):
            # Get available nurses for this day (not on off request)
            available_day_nurses = []
            available_night_nurses = []
            
            for n_idx, nurse in enumerate(nurses):
                name = nurse["name"]
                if date in off_requests_map.get(name, set()):
                    continue  # Skip nurses with off requests
                available_day_nurses.append((n_idx, name, nurse_shifts_count[name]))
                available_night_nurses.append((n_idx, name, nurse_shifts_count[name]))
            
            # Sort by workload (assign to nurses with fewer shifts first)
            available_day_nurses.sort(key=lambda x: x[2])
            available_night_nurses.sort(key=lambda x: x[2])
            
            day_assigned = []
            night_assigned = []
            
            # Assign day shifts
            for n_idx, name, _ in available_day_nurses:
                if len(day_assigned) >= day_count:
                    break
                day_assigned.append((n_idx, name))
                nurse_shifts_count[name] += 1
            
            # Assign night shifts (from nurses not already on day shift)
            assigned_to_day = {name for _, name in day_assigned}
            for n_idx, name, _ in available_night_nurses:
                if len(night_assigned) >= night_count:
                    break
                if name not in assigned_to_day:
                    night_assigned.append((n_idx, name))
                    nurse_shifts_count[name] += 1
            
            # If we still need more night nurses, we may need to pull from anyone available
            if len(night_assigned) < night_count:
                for n_idx, nurse in enumerate(nurses):
                    name = nurse["name"]
                    if len(night_assigned) >= night_count:
                        break
                    if name not in assigned_to_day and name not in {n for _, n in night_assigned}:
                        if date not in off_requests_map.get(name, set()):
                            night_assigned.append((n_idx, name))
                            nurse_shifts_count[name] += 1
            
            # Build assignments for this day
            day_shift_code = day_shift_codes[0] if day_shift_codes else "7Y"
            night_shift_code = night_shift_codes[0] if night_shift_codes else "7N"
            
            assigned_nurses = set()
            
            for n_idx, name in day_assigned:
                assigned_nurses.add(name)
                meta = shifts_info.get(day_shift_code, {})
                fallback_schedule[name].append({
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": day_shift_code,
                    "shiftType": "day",
                    "hours": meta.get("hours", 12),
                    "startTime": meta.get("startTime", "07:00"),
                    "endTime": meta.get("endTime", "19:00")
                })
            
            for n_idx, name in night_assigned:
                assigned_nurses.add(name)
                meta = shifts_info.get(night_shift_code, {})
                fallback_schedule[name].append({
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": night_shift_code,
                    "shiftType": "night",
                    "hours": meta.get("hours", 12),
                    "startTime": meta.get("startTime", "19:00"),
                    "endTime": meta.get("endTime", "07:00")
                })
            
            # Remaining nurses get OFF for this day
            for nurse in nurses:
                name = nurse["name"]
                if name not in assigned_nurses:
                    fallback_schedule[name].append({
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": "",
                        "shiftType": "off",
                        "hours": 0,
                        "startTime": "",
                        "endTime": ""
                    })
            
            logger.info(f"  {date}: Day={len(day_assigned)}, Night={len(night_assigned)}")
        
        logger.info("=" * 60)
        logger.info("FALLBACK SCHEDULE CREATED SUCCESSFULLY")
        logger.info("=" * 60)
        
        return fallback_schedule

    @staticmethod
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    def call_openai_with_retry(messages, model="gpt-4.1-mini", max_tokens=4096):
        try:
            logger.info(f"Sending request to OpenAI with model {model}")
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            if not response.choices or not response.choices[0].message.content:
                raise ValueError("Empty response from OpenAI API")
            logger.info("Received response from OpenAI")
            return response
        except Exception as e:
            logger.error(f"OpenAI API call failed: {str(e)}")
            raise

    @staticmethod
    def optimize_schedule_with_ortools(assignments, constraints, nurse_defaults: Dict[str, Dict] = None):
        """
        Main scheduling method - uses RobustScheduler which GUARANTEES full coverage.
        OR-Tools is no longer used as it was too unreliable.
        
        Args:
            nurse_defaults: Dict mapping nurse names (lowercase) to their database config
                           (employmentType, maxWeeklyHours, targetBiWeeklyHours, etc.)
        """
        logging.info("=" * 60)
        logging.info("STARTING SCHEDULE OPTIMIZATION")
        logging.info("=" * 60)
        
        # Parse dates
        start_dt = datetime.strptime(constraints["dateRange"]["start"], "%Y-%m-%d")
        end_dt = datetime.strptime(constraints["dateRange"]["end"], "%Y-%m-%d")
        num_days = (end_dt - start_dt).days + 1
        date_list = [(start_dt + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(num_days)]
        
        # Get shift info with COMPLETE mapping of all possible shift codes
        shifts_info = constraints.get("shiftsInfo", {})
        
        # CRITICAL: Add missing shift codes with proper metadata
        DEFAULT_SHIFTS = {
            "D8-": {"hours": 7.5, "startTime": "07:00", "endTime": "15:15", "type": "day"},
            "E8-": {"hours": 7.5, "startTime": "15:00", "endTime": "23:15", "type": "day"},
            "N8-": {"hours": 7.5, "startTime": "23:00", "endTime": "07:15", "type": "night"},
            "N8+ZE2-": {"hours": 11.25, "startTime": "19:00", "endTime": "07:15", "type": "night"},
            "ZD12-": {"hours": 11.25, "startTime": "07:00", "endTime": "19:25", "type": "day"},
            "ZE2-": {"hours": 3.75, "startTime": "19:00", "endTime": "23:00", "type": "night"},
            "ZN-": {"hours": 11.25, "startTime": "19:00", "endTime": "07:25", "type": "night"},
            "ZN+ZE2-": {"hours": 11.25, "startTime": "19:00", "endTime": "07:25", "type": "night"},
            "Z11": {"hours": 11.25, "startTime": "11:00", "endTime": "23:25", "type": "day"},
            "11": {"hours": 7.5, "startTime": "11:00", "endTime": "19:15", "type": "day"},
            "07": {"hours": 7.5, "startTime": "07:00", "endTime": "15:15", "type": "day"},
            "E15": {"hours": 7.5, "startTime": "15:00", "endTime": "23:15", "type": "day"},
            "Z07": {"hours": 11.25, "startTime": "07:00", "endTime": "19:25", "type": "day"},
            "23": {"hours": 7.5, "startTime": "23:00", "endTime": "07:15", "type": "night"},
            "Z19": {"hours": 11.25, "startTime": "19:00", "endTime": "07:25", "type": "night"},
            "Z23": {"hours": 11.25, "startTime": "23:00", "endTime": "11:25", "type": "night"},
            "Z23 B": {"hours": 11.25, "startTime": "23:00", "endTime": "11:25", "type": "night"},
        }
        
        # Merge with AI-parsed shiftsInfo (defaults take precedence for missing codes)
        for code, meta in DEFAULT_SHIFTS.items():
            if code not in shifts_info:
                shifts_info[code] = meta
        
        # Update constraints with complete shiftsInfo
        constraints["shiftsInfo"] = shifts_info
        
        logging.info(f"Shift codes available: {list(shifts_info.keys())}")

        # ════════════════════════════════════════════════════════════════
        # PRE-CLEAN OCR DATA — De-Duplication Command
        # Remove ghost tails from OCR assignments BEFORE they enter any
        # pipeline step.  This is the definitive fix for "Date Stacking".
        # ════════════════════════════════════════════════════════════════
        if assignments:
            logging.info("=" * 80)
            logging.info("PRE-CLEANING OCR ASSIGNMENTS (removing ghost tails at API layer)")
            assignments = RobustScheduler._preprocess_ocr_preferences(assignments, shifts_info)
            logging.info("=" * 80)
        
        # Filter out OFF/CF markers while keeping hospital-specific code sets.
        raw_day_codes = constraints["shiftRequirements"]["dayShift"].get("shiftCodes", [])
        raw_night_codes = constraints["shiftRequirements"]["nightShift"].get("shiftCodes", [])

        day_shift_codes = ScheduleOptimizer._sanitize_shift_codes(
            raw_day_codes,
            shifts_info,
            target_kind="day",
        )
        night_shift_codes = ScheduleOptimizer._sanitize_shift_codes(
            raw_night_codes,
            shifts_info,
            target_kind="night",
        )
        
        logging.info(f"Filtered shift codes - Day: {raw_day_codes} -> {day_shift_codes}")
        logging.info(f"Filtered shift codes - Night: {raw_night_codes} -> {night_shift_codes}")
        
        # Fallback to default codes if filtering removed everything
        if not day_shift_codes:
            day_shift_codes = ["Z07", "07"]
            logging.warning(f"No valid day shift codes found, using defaults: {day_shift_codes}")
        if not night_shift_codes:
            night_shift_codes = ["Z23", "23"]
            logging.warning(f"No valid night shift codes found, using defaults: {night_shift_codes}")
        
        nurses = constraints["nurses"]
        
        # Get staffing requirements (frontend minimums are already merged into constraints)
        ai_day_req = constraints["shiftRequirements"]["dayShift"]["count"]
        ai_night_req = constraints["shiftRequirements"]["nightShift"]["count"]

        day_req = ScheduleOptimizer._resolve_staff_requirement(ai_day_req)
        night_req = ScheduleOptimizer._resolve_staff_requirement(ai_night_req)

        logging.info(f"Staffing requirements: Day={day_req} (AI: {ai_day_req}), Night={night_req} (AI: {ai_night_req})")
        
        # Get max consecutive from constraints
        max_consecutive = constraints.get("constraints", {}).get("maxConsecutiveWorkDays", 5)
        
        logging.info(f"Configuration:")
        logging.info(f"  Date range: {date_list[0]} to {date_list[-1]} ({num_days} days)")
        logging.info(f"  Total nurses: {len(nurses)}")
        logging.info(f"  Nurse names: {[n['name'] for n in nurses]}")
        logging.info(f"  Day requirement: {day_req} (AI suggested: {ai_day_req})")
        logging.info(f"  Night requirement: {night_req} (AI suggested: {ai_night_req})")
        logging.info(f"  Max consecutive days: {max_consecutive}")
        logging.info(f"  Day shift codes: {day_shift_codes}")
        logging.info(f"  Night shift codes: {night_shift_codes}")
        logging.info(f"  OCR assignments provided for: {list(assignments.keys()) if assignments else 'NONE'}")
        
        # Log detailed OCR assignments for debugging
        if assignments:
            logging.info("=" * 80)
            logging.info("DETAILED OCR ASSIGNMENTS:")
            for nurse_name in sorted(assignments.keys()):
                shifts = assignments[nurse_name]
                shifts_str = " | ".join(f"{date}:{shift}" for date, shift in zip(date_list, shifts) if shift and shift.strip())
                logging.info(f"  {nurse_name}: {shifts_str if shifts_str else 'NO SHIFTS'}")
            logging.info("=" * 80)
        
        # Use RobustScheduler which GUARANTEES coverage
        scheduler = RobustScheduler(
            nurses=nurses,
            date_list=date_list,
            day_shift_codes=day_shift_codes,
            night_shift_codes=night_shift_codes,
            shifts_info=shifts_info,
            day_req=day_req,
            night_req=night_req,
            max_consecutive=max_consecutive,
            preferences=assignments,  # OCR preferences
            nurse_defaults=nurse_defaults  # Database config for missing nurses
        )
        
        schedule = scheduler.build_schedule()
        
        # CRITICAL VALIDATION: Check that night shifts were actually assigned
        logging.info("=" * 60)
        logging.info("FINAL SCHEDULE VALIDATION")
        logging.info("=" * 60)
        for day_idx, date in enumerate(date_list):
            day_count = 0
            night_count = 0
            for nurse_name in schedule.keys():
                if day_idx < len(schedule[nurse_name]):
                    shift = schedule[nurse_name][day_idx]
                    if shift["shiftType"] == "day":
                        day_count += 1
                    elif shift["shiftType"] == "night":
                        night_count += 1
            logging.info(f"{date}: Day={day_count}, Night={night_count}")
            if night_count == 0:
                logging.error(f"CRITICAL: {date} has NO NIGHT SHIFTS!")
        logging.info("=" * 60)

        # FINAL API-LAYER SAFETY NET: enforce OCR assignments directly in response payload.
        # This guarantees OCR conservation even if any internal scheduler pass mutates them.
        schedule = ScheduleOptimizer.apply_authoritative_ocr_overlay(
            schedule=schedule,
            assignments=assignments or {},
            date_list=date_list,
            shifts_info=shifts_info,
        )

        # POST-OVERLAY GHOST SWEEP: the overlay may have re-added a plain Z23
        # entry that is actually a ghost tail.  One final pass to catch these.
        GHOST_PAIRS_FINAL = {"Z19": {"Z23"}, "Z23": {"Z23"}, "Z23 B": {"Z23"}}
        post_ghost_fixes = 0
        for nurse_name, row in schedule.items():
            for i in range(1, len(row)):
                prev = row[i - 1]
                curr = row[i]
                if not prev or not curr:
                    continue
                prev_h = prev.get("hours", 0)
                curr_h = curr.get("hours", 0)
                if prev_h <= 0 or curr_h <= 0:
                    continue
                prev_code = str(prev.get("shift", "")).replace("↩", "").strip().upper()
                curr_code = str(curr.get("shift", "")).replace("↩", "").strip().upper()
                tails = GHOST_PAIRS_FINAL.get(prev_code)
                if tails and curr_code in tails:
                    row[i] = {
                        "id": str(uuid.uuid4()),
                        "date": date_list[i] if i < len(date_list) else "",
                        "shift": "",
                        "shiftType": "off",
                        "hours": 0,
                        "startTime": "",
                        "endTime": "",
                    }
                    post_ghost_fixes += 1
        if post_ghost_fixes:
            logging.info(f"POST-OVERLAY GHOST SWEEP: {post_ghost_fixes} ghost tails zeroed")

        # Attempt to balance nurse period targets to reduce deltas to zero.
        # Pass the original OCR assignments so the balancer can protect them.
        try:
            schedule = ScheduleOptimizer.balance_targets(schedule, date_list, nurses, shifts_info, assignments or {})
        except Exception as e:
            logging.warning(f"Target balancing failed: {e}")

        return schedule

    @staticmethod
    def apply_authoritative_ocr_overlay(
        schedule: Dict[str, List[Dict]],
        assignments: Dict[str, List[str]],
        date_list: List[str],
        shifts_info: Dict[str, Dict[str, Any]],
    ) -> Dict[str, List[Dict]]:
        """Force OCR values into the returned schedule (authoritative overlay)."""
        if not assignments:
            return schedule

        def norm(name: str) -> str:
            return re.sub(r"\s+", " ", str(name or "").strip().lower())

        def meta_for(code: str) -> Dict[str, Any]:
            if code in shifts_info:
                m = shifts_info[code]
                return {
                    "shiftType": m.get("type", "day"),
                    "hours": m.get("hours", 12),
                    "startTime": m.get("startTime", "07:00"),
                    "endTime": m.get("endTime", "19:00"),
                }
            code_u = code.upper()
            if "N" in code_u or "19" in code_u or "23" in code_u:
                if "Z19" in code_u:
                    return {"shiftType": "night", "hours": 11.25, "startTime": "19:00", "endTime": "07:25"}
                if "Z23" in code_u:
                    # Z23 and Z23 B are both 12-hour night shifts (11.25 paid hours)
                    return {"shiftType": "night", "hours": 11.25, "startTime": "23:00", "endTime": "11:25"}
                # Plain 23 (no Z prefix) is 8-hour night
                return {"shiftType": "night", "hours": 7.5, "startTime": "23:00", "endTime": "07:15"}
            return {"shiftType": "day", "hours": 11.25, "startTime": "07:00", "endTime": "19:25"}

        by_norm = {norm(n): n for n in schedule.keys()}
        fixes = 0

        for pref_name, pref_shifts in assignments.items():
            nurse_name = by_norm.get(norm(pref_name))
            if not nurse_name:
                continue
            if nurse_name not in schedule:
                continue

            for day_idx, raw in enumerate(pref_shifts or []):
                if day_idx >= len(date_list):
                    break
                if not raw or not str(raw).strip():
                    continue

                raw = str(raw).strip()
                raw_u = raw.upper()
                is_off = raw_u in ["C", "OFF"] or raw_u.startswith("CF") or "CF " in raw_u

                # Ensure row length
                while len(schedule[nurse_name]) <= day_idx:
                    schedule[nurse_name].append(
                        {
                            "id": str(uuid.uuid4()),
                            "date": date_list[len(schedule[nurse_name])],
                            "shift": "",
                            "shiftType": "off",
                            "hours": 0,
                            "startTime": "",
                            "endTime": "",
                        }
                    )

                current = schedule[nurse_name][day_idx]

                if is_off:
                    if current.get("shiftType") != "off" or current.get("hours", 0) != 0:
                        schedule[nurse_name][day_idx] = {
                            "id": str(uuid.uuid4()),
                            "date": date_list[day_idx],
                            "shift": "",
                            "shiftType": "off",
                            "hours": 0,
                            "startTime": "",
                            "endTime": "",
                        }
                        fixes += 1
                    continue

                if raw_u == "*":
                    continue

                # NIGHT TAIL DEDUP: Skip Z23 (plain, no B) wrap-around tails.
                # Z23 B is always a real shift. Only plain Z23 after a night-start is a tail.
                if raw_u == "Z23" and day_idx > 0:
                    prev_raw_overlay = (pref_shifts[day_idx - 1] or "") if day_idx - 1 < len(pref_shifts) else ""
                    prev_u_overlay = str(prev_raw_overlay).strip().upper()
                    if prev_u_overlay in ("Z19", "Z23", "Z23 B"):
                        # Wrap-around tail — do not force-restore
                        continue

                meta = meta_for(raw)
                if current.get("shift") != raw or current.get("shiftType") != meta["shiftType"]:
                    schedule[nurse_name][day_idx] = {
                        "id": str(uuid.uuid4()),
                        "date": date_list[day_idx],
                        "shift": raw,
                        "shiftType": meta["shiftType"],
                        "hours": meta["hours"],
                        "startTime": meta["startTime"],
                        "endTime": meta["endTime"],
                    }
                    fixes += 1

        logging.info(f"AUTHORITATIVE OCR OVERLAY APPLIED: {fixes} corrections")
        return schedule
    
    @staticmethod
    def _run_ortools_solver(assignments, constraints, date_list, nurses, day_shift_codes, night_shift_codes, all_shift_codes, shifts_info):
        """Internal OR-Tools solver - may raise exceptions that are caught by caller"""
        num_days = len(date_list)
        logging.info(f"Scheduling {num_days} days: {date_list[0]} to {date_list[-1]}")
        logging.info(f"Day shifts: {day_shift_codes}, Night shifts: {night_shift_codes}")

        # Normalize nurse names - handle complex names like "Alexandra Zatylny 42564 7Y-339.27D"
        def normalize_name(full_name):
            # Extract just the first two words (first name + last name)
            parts = full_name.split()
            return " ".join(parts[:2]) if len(parts) >= 2 else full_name

        nurse_name_to_idx = {}
        for i, n in enumerate(nurses):
            normalized = normalize_name(n["name"])
            nurse_name_to_idx[normalized] = i
            nurse_name_to_idx[n["name"]] = i  # Also map full name
        num_nurses = len(nurses)
        logging.info(f"Number of nurses: {num_nurses}")
        logging.info(f"Nurse names: {[n['name'] for n in nurses]}")

        # Get staffing requirements from parsed constraints
        ai_day_req = constraints["shiftRequirements"]["dayShift"]["count"]
        ai_night_req = constraints["shiftRequirements"]["nightShift"]["count"]

        day_req = ScheduleOptimizer._resolve_staff_requirement(ai_day_req)
        night_req = ScheduleOptimizer._resolve_staff_requirement(ai_night_req)

        logging.info(
            f"Staffing requirements - Day: {day_req} (AI said {ai_day_req}), Night: {night_req} (AI said {ai_night_req})"
        )
        
        # Validate we have enough nurses
        if num_nurses < day_req + night_req:
            logging.warning(f"Not enough nurses ({num_nurses}) to fill all shifts ({day_req} day + {night_req} night)")

        model = cp_model.CpModel()

        # Variables: shift assigned to nurse n on day d with shift s
        shifts = {}
        for n in range(num_nurses):
            for d in range(num_days):
                for s in range(len(all_shift_codes)):
                    shifts[(n, d, s)] = model.NewBoolVar(f"shift_n{n}_d{d}_s{s}")
        logging.info(f"Created {len(shifts)} shift assignment variables")

        # Constraint: each nurse at most one shift per day
        for n in range(num_nurses):
            for d in range(num_days):
                model.AddAtMostOne(shifts[(n, d, s)] for s in range(len(all_shift_codes)))
        logging.info("Added constraint: each nurse at most one shift per day")

        # CRITICAL: Staffing requirements per day - HARD CONSTRAINTS
        # Every day MUST have minimum coverage.
        # Also track per-day excess so the objective can strongly penalize
        # overstaffing above the minimum requirement.
        day_excess_vars = []
        night_excess_vars = []
        for d in range(num_days):
            # Day shift
            day_sum = sum(
                shifts[(n, d, s)]
                for n in range(num_nurses)
                for s, sc in enumerate(all_shift_codes)
                if sc in day_shift_codes
            )
            model.Add(day_sum >= day_req)
            day_excess = model.NewIntVar(0, num_nurses, f"day_excess_d{d}")
            model.Add(day_excess == day_sum - day_req)
            day_excess_vars.append(day_excess)

            # Night shift
            night_sum = sum(
                shifts[(n, d, s)]
                for n in range(num_nurses)
                for s, sc in enumerate(all_shift_codes)
                if sc in night_shift_codes
            )
            model.Add(night_sum >= night_req)
            night_excess = model.NewIntVar(0, num_nurses, f"night_excess_d{d}")
            model.Add(night_excess == night_sum - night_req)
            night_excess_vars.append(night_excess)

            logging.debug(
                f"Day {d} ({date_list[d]}): requiring >= {day_req} day staff, >= {night_req} night staff"
            )

        logging.info(
            f"Added HARD staffing constraints: {day_req} day nurses, {night_req} night nurses per day"
        )

        # Respect off requests - parse from nurses data
        off_count = 0
        for n, nurse in enumerate(nurses):
            off_requests = nurse.get("offRequests", [])
            for off_date in off_requests:
                if off_date in date_list:
                    d = date_list.index(off_date)
                    # Nurse cannot work any shift on this day
                    for s in range(len(all_shift_codes)):
                        model.Add(shifts[(n, d, s)] == 0)
                    off_count += 1
        logging.info(f"Enforced {off_count} off requests as hard constraints")

        # Max consecutive working days constraint (default 5)
        max_consecutive = constraints.get("constraints", {}).get("maxConsecutiveWorkDays", 5)
        for n in range(num_nurses):
            for start_d in range(num_days - max_consecutive):
                # Sum of shifts over (max_consecutive + 1) days must be <= max_consecutive
                consecutive_sum = sum(
                    shifts[(n, d, s)] 
                    for d in range(start_d, start_d + max_consecutive + 1) 
                    for s in range(len(all_shift_codes))
                )
                model.Add(consecutive_sum <= max_consecutive)
        logging.info(f"Added max consecutive working days constraint ({max_consecutive} days)")

        # IMPORTANT: OCR assignments are preferences (soft), not hard constraints.
        # We reward matching OCR-coded shifts, but penalize adding shifts on
        # non-OCR-empty cells and penalize overstaffing above minimum coverage.
        preference_bonus = []
        total_preferences = 0
        skipped_codes = set()

        # Track days that had an OCR work code for each nurse.
        # Used to penalize "added" shifts that were not in OCR baseline.
        has_ocr_work_slot: Set[Tuple[int, int]] = set()

        for nurse_name, shift_list in assignments.items():
            normalized_name = normalize_name(nurse_name)
            n = nurse_name_to_idx.get(normalized_name) or nurse_name_to_idx.get(nurse_name)
            if n is None:
                logging.warning(
                    f"Nurse '{nurse_name}' (normalized: '{normalized_name}') not found in nurse list, skipping"
                )
                continue

            for d, shift_code in enumerate(shift_list):
                if d >= num_days:
                    continue

                raw_code = (shift_code or "").strip()
                code_upper = raw_code.upper()
                if not raw_code or code_upper in ["", "OFF", "C"] or code_upper.startswith("CF"):
                    continue

                if raw_code not in all_shift_codes:
                    skipped_codes.add(raw_code)
                    continue

                has_ocr_work_slot.add((n, d))
                s = all_shift_codes.index(raw_code)
                preference_bonus.append(shifts[(n, d, s)])
                total_preferences += 1

        if skipped_codes:
            logging.warning(f"Skipped unknown shift codes in assignments: {skipped_codes}")
        logging.info(f"Added {total_preferences} nurse preferences as soft constraints (bonuses)")

        # Penalize assignments on non-OCR blank days to keep schedules lean.
        non_ocr_added = []
        total_assigned = []
        for n in range(num_nurses):
            for d in range(num_days):
                day_vars = [shifts[(n, d, s)] for s in range(len(all_shift_codes))]
                day_assigned = model.NewIntVar(0, 1, f"assigned_n{n}_d{d}")
                model.Add(day_assigned == sum(day_vars))
                total_assigned.append(day_assigned)
                if (n, d) not in has_ocr_work_slot:
                    non_ocr_added.append(day_assigned)

        # Objective (MINIMIZE):
        #  1) Overstaffing above required minimum (very high weight)
        #  2) Added shifts on non-OCR days (high weight)
        #  3) Total assignments (small regularizer)
        #  4) Reward OCR preference matches (subtract reward)
        overstaff_penalty = sum(day_excess_vars) + sum(night_excess_vars)
        non_ocr_add_penalty = sum(non_ocr_added) if non_ocr_added else 0
        total_assignment_penalty = sum(total_assigned) if total_assigned else 0
        preference_reward = sum(preference_bonus) if preference_bonus else 0

        model.Minimize(
            10000 * overstaff_penalty
            + 250 * non_ocr_add_penalty
            + 5 * total_assignment_penalty
            - 80 * preference_reward
        )
        logging.info(
            "Objective: minimize overstaff(10000) + nonOCRAdds(250) + totalAssignments(5) - OCRPreferenceMatch(80)"
        )

        # Solve
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 60  # Increased time for better solutions
        solver.parameters.num_search_workers = 4  # Use multiple cores
        logging.info("Starting solver...")
        status = solver.Solve(model)

        if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            logging.error("OR-Tools solver failed to find a feasible solution")
            logging.error("Falling back to guaranteed round-robin scheduler")
            # Use fallback scheduler instead of raising exception
            shift_code_to_idx = {sc: i for i, sc in enumerate(all_shift_codes)}
            return ScheduleOptimizer.create_fallback_schedule(
                assignments=assignments,
                constraints=constraints,
                date_list=date_list,
                nurses=nurses,
                day_shift_codes=day_shift_codes,
                night_shift_codes=night_shift_codes,
                shift_code_to_idx=shift_code_to_idx
            )
        else:
            logging.info(f"Solver finished with status: {solver.StatusName(status)}")
            logging.info(f"Total shifts assigned: {solver.ObjectiveValue()}")

        # Build output and compute coverage stats
        result = {}
        daily_coverage = {d: {"day": 0, "night": 0} for d in range(num_days)}
        
        for n, nurse in enumerate(nurses):
            result[nurse["name"]] = []
            for d, date in enumerate(date_list):
                assigned_shift = None
                for s, shift_code in enumerate(all_shift_codes):
                    if solver.Value(shifts[(n, d, s)]):
                        assigned_shift = shift_code
                        shift_type = "day" if shift_code in day_shift_codes else "night"
                        daily_coverage[d][shift_type] += 1
                        break
                if assigned_shift:
                    meta = shifts_info.get(assigned_shift, {})
                    result[nurse["name"]].append({
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": assigned_shift,
                        "shiftType": meta.get("type", "day"),
                        "hours": meta.get("hours", 0),
                        "startTime": meta.get("startTime", ""),
                        "endTime": meta.get("endTime", "")
                    })
                else:
                    # No shift assigned (off day)
                    result[nurse["name"]].append({
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": "",
                        "shiftType": "off",
                        "hours": 0,
                        "startTime": "",
                        "endTime": ""
                    })
        
        # Log coverage stats for verification
        logging.info("=" * 50)
        logging.info("COVERAGE SUMMARY:")
        coverage_ok = True
        for d, date in enumerate(date_list):
            day_staff = daily_coverage[d]["day"]
            night_staff = daily_coverage[d]["night"]
            day_status = "✓" if day_staff >= day_req else "✗ UNDERSTAFFED"
            night_status = "✓" if night_staff >= night_req else "✗ UNDERSTAFFED"
            logging.info(f"  {date}: Day={day_staff} {day_status}, Night={night_staff} {night_status}")
            if day_staff < day_req or night_staff < night_req:
                coverage_ok = False
        
        if coverage_ok:
            logging.info("All days properly staffed!")
        else:
            logging.warning("Some days are understaffed - PATCHING GAPS NOW")
            # CRITICAL: Patch any gaps to ensure coverage
            result = ScheduleOptimizer.patch_coverage_gaps(
                result, date_list, nurses, shifts_info,
                day_shift_codes, night_shift_codes, day_req, night_req
            )
        logging.info("=" * 50)
        
        logging.info("Schedule built successfully")

        # Try to balance scheduled hours to meet nurse targets (best-effort)
        try:
            result = ScheduleOptimizer.balance_targets(result, date_list, nurses, shifts_info)
        except Exception as e:
            logging.warning(f"Target balancing (post-OR-Tools) failed: {e}")

        return result

    @staticmethod
    def balance_targets(schedule: Dict[str, List[Dict]], date_list: List[str], nurses: List[Dict[str, Any]], shifts_info: Dict[str, Any], ocr_assignments: Dict[str, List[str]] = None) -> Dict[str, List[Dict]]:
        """Best-effort post-processing to try to make per-nurse deltas approach zero.

        This performs greedy reassignment of whole shifts from over-target nurses
        to under-target nurses on days where the under-target nurse is OFF.
        It only makes changes that reduce the total absolute delta across all nurses.
        
        OCR-assigned shifts are NEVER moved away from their nurse — they represent
        the nurse's preferred schedule and are binding.
        """
        logging.info("Running target balancing post-processing...")

        # Build lookup for nurse metadata by name (exact match)
        nurse_map = {n.get("name"): n for n in nurses}

        # Build set of nurses on leave — exclude from all balancing moves
        nurses_on_leave: Set[str] = set()
        for n in nurses:
            if (bool(n.get("isOnMaternityLeave")) or
                bool(n.get("isOnSickLeave")) or
                bool(n.get("isOnSabbatical"))):
                nurses_on_leave.add(n.get("name", ""))

        # Build set of (nurse_name, date) tuples that are OCR-binding (must not be moved)
        ocr_binding: Set[Tuple[str, str]] = set()
        if ocr_assignments:
            for nurse_name, shifts in ocr_assignments.items():
                for day_idx, shift_code in enumerate(shifts):
                    if day_idx < len(date_list) and shift_code and shift_code.strip():
                        code = shift_code.strip().upper()
                        if code not in ("C", "OFF", "*", "") and not code.startswith("CF"):
                            ocr_binding.add((nurse_name, date_list[day_idx]))

        # Compute target hours per nurse, SCALED to the actual period length,
        # then reduced by off days.
        #
        # CRITICAL: targetBiWeeklyHours is the 14-day (bi-weekly) target.
        # For longer periods we must scale: target = biweekly × (total_days / 14).
        # Without this, a 41-day period would use the raw 75h bi-weekly target
        # instead of the correct ~220h, causing the balancer to aggressively
        # strip shifts from every nurse.
        targets: Dict[str, float] = {}
        total_days = len(date_list) if date_list else 14
        period_scale = total_days / 14.0  # How many bi-weekly periods in this schedule
        for name in schedule.keys():
            meta = nurse_map.get(name, {})
            tbw = meta.get("targetBiWeeklyHours")
            tw = meta.get("targetWeeklyHours")
            mw = meta.get("maxWeeklyHours")
            if tbw is not None:
                raw_target = float(tbw) * period_scale
            elif tw is not None:
                raw_target = float(tw) * 2.0 * period_scale
            elif mw is not None:
                raw_target = float(mw) * 2.0 * period_scale
            else:
                raw_target = 0.0

            # Reduce target by off days (offRequests + OCR off codes) to credit
            # vacation.  Each off day reduces the target proportionally AND
            # contributes a virtual 7.5h credit toward scheduled hours.
            off_requests = set(meta.get("offRequests", []) or [])
            off_day_count = 0
            row = schedule.get(name, [])
            for day_idx, d in enumerate(date_list):
                if d in off_requests:
                    off_day_count += 1
                    continue
                # Also count OCR-sourced off codes (C, CF, *)
                if ocr_assignments:
                    ocr_shifts = None
                    if name in ocr_assignments:
                        ocr_shifts = ocr_assignments[name]
                    else:
                        # Normalize name for matching
                        name_lower = name.strip().lower()
                        for oname, oshifts in ocr_assignments.items():
                            if oname.strip().lower() == name_lower:
                                ocr_shifts = oshifts
                                break
                    if ocr_shifts and day_idx < len(ocr_shifts):
                        ocr_code = (ocr_shifts[day_idx] or "").strip().upper()
                        if (ocr_code in ("C", "OFF", "*") or
                            ocr_code.startswith("CF")):
                            off_day_count += 1

            if off_day_count > 0 and total_days > 0:
                available_ratio = max(0, (total_days - off_day_count)) / total_days
                raw_target = raw_target * available_ratio

            targets[name] = raw_target

        def scheduled_hours_for(name: str) -> float:
            hrs = 0.0
            row = schedule.get(name, [])
            for entry in row:
                try:
                    hrs += float(entry.get("hours", 0) or 0)
                except Exception:
                    pass
            return hrs

        # Initial deltas (exclude nurses on leave from balancing)
        deltas: Dict[str, float] = {
            name: scheduled_hours_for(name) - targets.get(name, 0.0)
            for name in schedule.keys()
            if name not in nurses_on_leave
        }

        # Log targets for verification
        logging.info(f"  Period scale: {period_scale:.3f} ({total_days} days / 14)")
        for name in sorted(deltas.keys()):
            logging.info(
                f"  {name}: target={targets.get(name, 0):.1f}h, "
                f"scheduled={scheduled_hours_for(name):.1f}h, "
                f"delta={deltas[name]:+.1f}h"
            )
        if nurses_on_leave:
            logging.info(f"  Excluded from balancing (on leave): {sorted(nurses_on_leave)}")

        def total_abs_delta(dmap: Dict[str, float]) -> float:
            return sum(abs(v) for v in dmap.values())

        improved = True
        iterations = 0
        max_iters = 5000
        while improved and iterations < max_iters:
            iterations += 1
            improved = False
            # Build sorted lists
            over_list = sorted([ (n, d) for n, d in deltas.items() if d > 0 ], key=lambda x: -x[1])
            under_list = sorted([ (n, d) for n, d in deltas.items() if d < 0 ], key=lambda x: x[1])
            if not over_list or not under_list:
                break

            current_score = total_abs_delta(deltas)

            # Try to move a single shift from biggest over to biggest under where possible
            moved = False
            for over_name, over_delta in over_list:
                over_row = schedule.get(over_name, [])
                for day_idx, cell in enumerate(over_row):
                    hours = float(cell.get("hours", 0) or 0)
                    if hours <= 0:
                        continue
                    # NEVER move an OCR-assigned shift away from its nurse
                    if day_idx < len(date_list) and (over_name, date_list[day_idx]) in ocr_binding:
                        continue
                    # Candidate under nurses who are OFF that day
                    for under_name, under_delta in under_list:
                        under_row = schedule.get(under_name, [])
                        # Skip if under already has a shift that day
                        if day_idx >= len(under_row):
                            continue
                        under_cell = under_row[day_idx]
                        if (under_cell.get("shiftType") != "off") and (under_cell.get("hours", 0) or 0) > 0:
                            continue
                        # Respect explicit offRequests
                        meta_under = nurse_map.get(under_name, {})
                        off_reqs = set(meta_under.get("offRequests", []) or [])
                        if day_idx < len(date_list) and date_list[day_idx] in off_reqs:
                            continue

                        # Compute deltas after hypothetical move
                        new_deltas = dict(deltas)
                        new_deltas[over_name] = new_deltas.get(over_name, 0.0) - hours
                        new_deltas[under_name] = new_deltas.get(under_name, 0.0) + hours
                        new_score = total_abs_delta(new_deltas)
                        # Accept move if total absolute delta reduced
                        if new_score < current_score - 0.0001:
                            # Perform move: set over cell to OFF
                            schedule[over_name][day_idx] = {
                                "id": str(uuid.uuid4()),
                                "date": date_list[day_idx],
                                "shift": "",
                                "shiftType": "off",
                                "hours": 0,
                                "startTime": "",
                                "endTime": "",
                            }
                            # Assign same shift code to under nurse cell
                            new_entry = dict(cell)
                            # Ensure id is unique and date correct
                            new_entry["id"] = str(uuid.uuid4())
                            new_entry["date"] = date_list[day_idx]
                            schedule[under_name][day_idx] = new_entry

                            # Update deltas and mark improvement
                            deltas = new_deltas
                            improved = True
                            moved = True
                            logging.info(f"Balanced: moved {hours}h on {date_list[day_idx]} from '{over_name}' to '{under_name}' (score {current_score:.2f} -> {new_score:.2f})")
                            break
                    if moved:
                        break
                if moved:
                    break

            if not moved:
                break

        logging.info(f"Target balancing finished after {iterations} iterations; total_abs_delta={total_abs_delta(deltas):.2f}")
        return schedule
    
    @staticmethod
    def patch_coverage_gaps(result, date_list, nurses, shifts_info, day_shift_codes, night_shift_codes, day_req, night_req):
        """
        POST-PROCESSING: Patches any days that don't have enough coverage.
        This is the LAST LINE OF DEFENSE - ensures no empty days EVER.
        """
        logging.info("PATCHING COVERAGE GAPS...")

        # Build set of nurses on leave — they should never be picked for patching
        on_leave_names = {
            n["name"] for n in nurses
            if (bool(n.get("isOnMaternityLeave")) or
                bool(n.get("isOnSickLeave")) or
                bool(n.get("isOnSabbatical")))
        }
        
        for d_idx, date in enumerate(date_list):
            # Count current coverage
            day_count = 0
            night_count = 0
            off_nurses = []
            
            for nurse in nurses:
                name = nurse["name"]
                if name in on_leave_names:
                    continue  # Skip nurses on leave
                if d_idx < len(result[name]):
                    shift = result[name][d_idx]
                    if shift["shiftType"] == "day":
                        day_count += 1
                    elif shift["shiftType"] == "night":
                        night_count += 1
                    else:
                        off_nurses.append(name)
            
            # Patch day shifts if needed
            day_shift_code = day_shift_codes[0] if day_shift_codes else "7Y"
            night_shift_code = night_shift_codes[0] if night_shift_codes else "7N"
            
            while day_count < day_req and off_nurses:
                nurse_name = off_nurses.pop(0)
                meta = shifts_info.get(day_shift_code, {})
                result[nurse_name][d_idx] = {
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": day_shift_code,
                    "shiftType": "day",
                    "hours": meta.get("hours", 12),
                    "startTime": meta.get("startTime", "07:00"),
                    "endTime": meta.get("endTime", "19:00")
                }
                day_count += 1
                logging.info(f"  PATCHED: Assigned {nurse_name} to DAY shift on {date}")
            
            # Patch night shifts if needed
            while night_count < night_req and off_nurses:
                nurse_name = off_nurses.pop(0)
                meta = shifts_info.get(night_shift_code, {})
                result[nurse_name][d_idx] = {
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": night_shift_code,
                    "shiftType": "night",
                    "hours": meta.get("hours", 12),
                    "startTime": meta.get("startTime", "19:00"),
                    "endTime": meta.get("endTime", "07:00")
                }
                night_count += 1
                logging.info(f"  PATCHED: Assigned {nurse_name} to NIGHT shift on {date}")
            
            # Final coverage check
            if day_count < day_req or night_count < night_req:
                logging.warning(f"  {date}: Could not fully patch - Day={day_count}/{day_req}, Night={night_count}/{night_req} (not enough nurses)")
        
        return result
   
    @staticmethod
    def refine_schedule_with_ai(schedule: Dict, constraints: Dict) -> Dict:
        try:
            # If everyone off, skip refinement
            if all(day["shift"] == "OFF" for days in schedule.values() for day in days):
                logger.warning("Skipping AI refinement - base schedule is all OFF")
                return schedule
            
            # Pulling start_date, end_date from dateRange in constraints 
            start_date = constraints.get("dateRange", {}).get("start", "")
            end_date = constraints.get("dateRange", {}).get("end", "")

            prompt_json = {
                "dateRange": {
                    "start": start_date,
                    "end": end_date
                },
                "shiftRequirements": constraints.get("shiftRequirements", {}),
                "shiftsInfo": constraints.get("shiftsInfo", {}),
                "nurses": [],
                "constraints": constraints.get("constraints", {}),
            }

            # Build nurses list with full needed info:
            for nurse in constraints.get("nurses", []):
                prompt_json["nurses"].append({
                    "id": nurse.get("id", ""),
                    "name": nurse.get("name", ""),
                    "isChemoCertified": nurse.get("isChemoCertified", False),
                    "employmentType": nurse.get("employmentType", "full-time"),
                    "maxWeeklyHours": nurse.get("maxWeeklyHours", 40),
                    "offRequests": nurse.get("offRequests", []),
                    "seniority": nurse.get("seniority", "0")
                })

            # logger.info(f"prompt_json: {prompt_json}")

            # Now the actual prompt to send to AI is the JSON dumped string
            prompt_str = json.dumps(prompt_json, indent=2)
            
            logger.info(f"Sending refinement prompt to AI:\n{prompt_str}")

            # system_prompt = (
            #     "You are a highly reliable nurse scheduling assistant.\n\n"
            #     "Your ONLY task is to refine the input nurse schedule based on updated constraints.\n"
            #     "You MUST return a valid JSON object with the following format:\n"
            #     "{\n"
            #     '  "Nurse Name": [\n'
            #     "    {\n"
            #     '      "id": "UUID",\n'
            #     '      "date": "YYYY-MM-DD",\n'
            #     '      "shift": "Shift Code",\n'
            #     '      "shiftType": "day|night",\n'
            #     '      "hours": Number,\n'
            #     '      "startTime": "HH:MM",\n'
            #     '      "endTime": "HH:MM"\n'
            #     "    },\n"
            #     "    ...\n"
            #     "  ],\n"
            #     "  ...\n"
            #     "}\n\n"
            #     "Do NOT include any explanatory text or markdown. Only return valid JSON."
            # )

            # try:
            #     response = ScheduleOptimizer.call_openai_with_retry(
            #         messages=[
            #             {"role": "system", "content": system_prompt},
            #             {"role": "user", "content": prompt_str}
            #         ],
            #         # Optionally, support temperature or retries if you’ve extended this
            #         temperature=0.2
            #     )
            # except Exception as e:
            #     logger.error(f"OpenAI call failed: {e}")
            #     raise HTTPException(status_code=500, detail="AI refinement request failed.")


            # raw = response.choices[0].message.content
            # parsed_raw = json.loads(raw)  # parse string into dict
            # logger.info(f"Raw AI response type: {type(raw)} content: {raw[:500]}")

            # # refined_schedule = ScheduleOptimizer.parse_ai_response(parsed_raw)


            # # # Validate structure and add defaults
            # # for nurse_name, days in refined_schedule.items():
            # #     if not isinstance(days, list):
            # #         raise HTTPException(
            # #             status_code=400,
            # #             detail=f"Refined schedule for {nurse_name} is invalid."
            # #         )
            # #     for day in days:
            # #         if not isinstance(day, dict):
            # #             raise HTTPException(
            # #                 status_code=400,
            # #                 detail=f"Each day entry for {nurse_name} must be a dict."
            # #             )
            # #         day.setdefault("id", str(uuid.uuid4()))
            # #         day.setdefault("startTime", "")
            # #         day.setdefault("endTime", "")

            # logger.info("AI refinement completed successfully")
            # return {} #refined_schedule

        except Exception as e:
            logger.error(f"AI refinement failed: {e}")
            return schedule

    def validate_constraints_structure(constraints: dict):
        required_top_level_keys = [
            "dateRange", "shiftRequirements", "shiftsInfo", "nurses", "constraints"
        ]
        
        for key in required_top_level_keys:
            if key not in constraints:
                logger.error(f"Missing key in constraints: {key}")
                raise HTTPException(status_code=400, detail=f"Missing required key: '{key}' in constraints")

        # Validate dateRange keys
        if "start" not in constraints["dateRange"] or "end" not in constraints["dateRange"]:
            raise HTTPException(status_code=400, detail="Missing 'start' or 'end' in 'dateRange'")

        # Validate shiftRequirements structure
        for shift_type in ["dayShift", "nightShift"]:
            if shift_type not in constraints["shiftRequirements"]:
                raise HTTPException(status_code=400, detail=f"Missing '{shift_type}' in 'shiftRequirements'")
            for field in ["count", "minChemoCertified", "shiftCodes"]:
                if field not in constraints["shiftRequirements"][shift_type]:
                    raise HTTPException(status_code=400, detail=f"Missing '{field}' in 'shiftRequirements.{shift_type}'")

        # Validate nurses list
        if not isinstance(constraints["nurses"], list) or not constraints["nurses"]:
            raise HTTPException(status_code=400, detail="'nurses' must be a non-empty list")

        required_nurse_fields = ["id", "name", "isChemoCertified", "employmentType", "maxWeeklyHours", "offRequests"]
        for nurse in constraints["nurses"]:
            for field in required_nurse_fields:
                if field not in nurse:
                    raise HTTPException(status_code=400, detail=f"Missing '{field}' in nurse entry")

        # Validate shiftsInfo
        if not isinstance(constraints["shiftsInfo"], dict) or not constraints["shiftsInfo"]:
            raise HTTPException(status_code=400, detail="Missing or invalid 'shiftsInfo'")

        # Validate constraints.rules
        required_constraints_keys = [
            "maxConsecutiveWorkDays", "maxConsecutiveNightShifts", "alternateWeekendsOff",
            "respectOffRequests", "respectCurrentAssignments", "maxHoursPerWeek",
            "shiftCoherencyRules", "workPatternRules", "seniorityRules"
        ]
        for key in required_constraints_keys:
            if key not in constraints["constraints"]:
                raise HTTPException(status_code=400, detail=f"Missing '{key}' in 'constraints'")

@router.post("/preview")
async def preview_constraints(req: OptimizeRequest, db: Session = Depends(get_db)):
    """
    Preview AI-parsed constraints without running optimization.
    Allows user to review and edit before confirming.
    """
    try:
        logger.info("=" * 80)
        logger.info("PREVIEW CONSTRAINTS ENDPOINT CALLED")
        logger.info("=" * 80)
        
        ScheduleOptimizer.validate_input_data(req)
        
        # Extract off requests from comments
        if req.comments:
            for nurse_name, date_comments in req.comments.items():
                # Find the nurse in the nurses list
                for nurse in req.nurses:
                    nurse_dict = nurse.dict() if hasattr(nurse, 'dict') else nurse
                    if nurse_dict.get('name') == nurse_name:
                        # Extract dates where there are OFF requests
                        off_dates = [
                            date for date, comment in date_comments.items()
                            if comment and 'OFF' in comment.upper()
                        ]
                        if off_dates:
                            if hasattr(nurse, 'offRequests'):
                                nurse.offRequests = off_dates
                            elif isinstance(nurse, dict):
                                nurse['offRequests'] = off_dates
                        break
        
        prompt = ScheduleOptimizer.build_prompt_for_constraints_parsing(req, db)
        
        response = ScheduleOptimizer.call_openai_with_retry([
            {"role": "system", "content": "Parse user scheduling input into structured JSON constraints only."},
            {"role": "user", "content": prompt},
        ])
        
        constraints = ScheduleOptimizer.parse_ai_response(response.choices[0].message.content)
        ScheduleOptimizer.validate_constraints_structure(constraints)
        
        # Extract CF (congé férié) codes from OCR assignments as off requests
        # This must happen AFTER we have constraints with dateRange
        if req.assignments and constraints.get('dateRange'):
            from datetime import datetime, timedelta
            start_date = datetime.strptime(constraints['dateRange']['start'], "%Y-%m-%d")
            end_date = datetime.strptime(constraints['dateRange']['end'], "%Y-%m-%d")
            date_list = [(start_date + timedelta(days=i)).strftime("%Y-%m-%d") 
                        for i in range((end_date - start_date).days + 1)]
            
            for nurse_name, shifts in req.assignments.items():
                # Find the nurse
                for nurse in req.nurses:
                    nurse_dict = nurse.dict() if hasattr(nurse, 'dict') else nurse
                    if nurse_dict.get('name') == nurse_name:
                        # Check each shift for CF codes
                        cf_dates = []
                        for day_idx, shift_code in enumerate(shifts):
                            if shift_code and day_idx < len(date_list):
                                shift_upper = shift_code.upper().strip()
                                # Check for CF variations: CF, CF-, CF 01, CF-01, etc.
                                if shift_upper.startswith('CF') or shift_upper == 'C':
                                    cf_dates.append(date_list[day_idx])
                        
                        # Merge CF dates with existing offRequests
                        if cf_dates:
                            existing_off = []
                            if hasattr(nurse, 'offRequests'):
                                existing_off = list(nurse.offRequests or [])
                            elif isinstance(nurse, dict):
                                existing_off = list(nurse.get('offRequests', []))
                            
                            # Combine and deduplicate
                            all_off_dates = list(set(existing_off + cf_dates))
                            
                            if hasattr(nurse, 'offRequests'):
                                nurse.offRequests = all_off_dates
                            elif isinstance(nurse, dict):
                                nurse['offRequests'] = all_off_dates
                        break
        
        # Sanitize shift codes while keeping hospital-specific values.
        shifts_info = constraints.get("shiftsInfo", {}) if isinstance(constraints, dict) else {}
        constraints["shiftRequirements"]["dayShift"]["shiftCodes"] = ScheduleOptimizer._sanitize_shift_codes(
            constraints["shiftRequirements"]["dayShift"].get("shiftCodes", []),
            shifts_info,
            target_kind="day",
        )
        constraints["shiftRequirements"]["nightShift"]["shiftCodes"] = ScheduleOptimizer._sanitize_shift_codes(
            constraints["shiftRequirements"]["nightShift"].get("shiftCodes", []),
            shifts_info,
            target_kind="night",
        )
        
        # Apply staff requirements override
        if req.staffRequirements:
            ai_day_count = constraints['shiftRequirements']['dayShift']['count']
            ai_night_count = constraints['shiftRequirements']['nightShift']['count']
            
            constraints['shiftRequirements']['dayShift']['count'] = ScheduleOptimizer._resolve_staff_requirement(
                ai_day_count,
                req.staffRequirements.minDayStaff,
            )
            constraints['shiftRequirements']['nightShift']['count'] = ScheduleOptimizer._resolve_staff_requirement(
                ai_night_count,
                req.staffRequirements.minNightStaff,
            )
        
        # Replace AI-parsed nurses with ALL frontend nurses (now with off requests)
        all_nurses = ScheduleOptimizer.preprocess_nurse_data(req.nurses)
        constraints['nurses'] = all_nurses
        
        # Count nurses with off requests
        nurses_with_off_requests = sum(1 for n in all_nurses if n.get('offRequests', []))
        
        logger.info(f"Constraints preview generated: {len(constraints['nurses'])} nurses, "
                   f"{constraints['shiftRequirements']['dayShift']['count']} day / "
                   f"{constraints['shiftRequirements']['nightShift']['count']} night, "
                   f"{nurses_with_off_requests} with off requests")
        
        return {
            "constraints": constraints,
            "message": "Constraints parsed successfully. Review and edit before optimizing."
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error previewing constraints: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to preview constraints: {str(e)}")

@router.post("/refine")
async def refine_schedule(
    request: RefineRequest,
    db: Session = Depends(get_db)
):
    """
    Refine an existing schedule using AI based on user feedback.
    """
    try:
        logger.info("=" * 80)
        logger.info("REFINE SCHEDULE ENDPOINT CALLED")
        logger.info(f"Refinement request: {request.refinement_request}")
        logger.info("=" * 80)
        
        # Get system prompt for context
        system_prompt_record = db.query(SystemPrompt).first()
        
        base_prompt = system_prompt_record.content if system_prompt_record else DEFAULT_PROMPT_CONTENT
        
        # Build refinement prompt with complete nurse list AND their actual working dates
        schedule_details = []
        nurse_names_list = []
        total_scheduled_hours = 0
        nurse_hours_info = []
        
        # Calculate number of weeks in schedule period
        num_weeks = len(request.dates) / 7.0  # Can be fractional (e.g., 14 days = 2 weeks)
        logger.info(f"Schedule period: {len(request.dates)} days = {num_weeks:.2f} weeks")

        full_time_weekly_target = request.fullTimeWeeklyTarget or 37.5
        part_time_weekly_target = request.partTimeWeeklyTarget or 26.25
        
        # If frontend provided nurseHoursStats, use it for accurate delta information
        nurse_stats_map = {}
        if request.nurseHoursStats:
            for stat in request.nurseHoursStats:
                nurse_stats_map[stat['name']] = stat
            logger.info(f"Using frontend nurseHoursStats for {len(nurse_stats_map)} nurses")
        
        for nurse_name, shifts in request.schedule.items():
            # Get actual working shifts (not off days) with their dates
            work_shifts = [s for s in shifts if s.get('shiftType') != 'off' and s.get('shift', '') not in ['', 'OFF']]
            work_dates = [f"{s.get('date')} ({s.get('shift', 'ZD12-')})" for s in work_shifts]
            nurse_hours = sum(s.get('hours', 12) for s in work_shifts)
            total_scheduled_hours += nurse_hours
            
            # Find off days for this nurse (potential days to add shifts)
            off_days = [s.get('date') for s in shifts if s.get('shiftType') == 'off' or s.get('shift', '') in ['', 'OFF']]
            
            # Get target hours and delta from frontend stats if available
            if nurse_name in nurse_stats_map:
                stat = nurse_stats_map[nurse_name]
                target_h = stat.get('targetHours', 60)
                delta_h = stat.get('delta', 0)
                emp_type = stat.get('employmentType', 'FT')
                remaining = target_h - nurse_hours
            else:
                # Fallback: use configured FT/PT weekly target values.
                emp_type = 'FT'
                weekly_hours = full_time_weekly_target
                target_h = weekly_hours * num_weeks
                delta_h = nurse_hours - target_h
                remaining = target_h - nurse_hours
            
            if work_dates:
                schedule_details.append(f"- {nurse_name} ({emp_type}): {len(work_shifts)} shifts ({nurse_hours}h / target: {target_h}h, delta: {delta_h:+.1f}h) on {', '.join(work_dates)}")
                nurse_hours_info.append(f"  {nurse_name} ({emp_type}): {nurse_hours}h scheduled, {remaining}h remaining capacity, delta: {delta_h:+.1f}h, OFF on: {', '.join(off_days[:5])}...")
            else:
                schedule_details.append(f"- {nurse_name} ({emp_type}): no shifts scheduled (target: {target_h}h, delta: {-target_h}h)")
                nurse_hours_info.append(f"  {nurse_name} ({emp_type}): 0h scheduled, {target_h}h remaining capacity, delta: {-target_h}h")
            nurse_names_list.append(nurse_name)
        
        # Calculate target hours based on actual nurse types if available
        if nurse_stats_map:
            target_hours = sum(stat.get('targetHours', 60) for stat in nurse_stats_map.values())
            total_delta = sum(stat.get('delta', 0) for stat in nurse_stats_map.values())
            logger.info(f"Using accurate target hours: {target_hours}h, total delta: {total_delta}h")
        else:
            # Fallback: assume all FT nurses with configured weekly target × number of weeks
            num_nurses = len(request.schedule)
            target_hours = num_nurses * full_time_weekly_target * num_weeks
            total_delta = total_scheduled_hours - target_hours
            logger.info(
                f"Fallback target hours: {num_nurses} nurses × {full_time_weekly_target}h/week × {num_weeks:.2f} weeks = {target_hours}h"
            )
        
        hours_delta = total_scheduled_hours - target_hours
        
        # Identify overworked and underworked nurses for strategic balancing
        overworked_nurses = []
        underworked_nurses = []
        for nurse_name, shifts in request.schedule.items():
            if nurse_name in nurse_stats_map:
                stat = nurse_stats_map[nurse_name]
                delta = stat.get('delta', 0)
                if delta > 0:
                    overworked_nurses.append(f"{nurse_name} (+{delta}h)")
                elif delta < 0:
                    underworked_nurses.append(f"{nurse_name} ({delta}h)")
        
        refinement_prompt = f"""You are a nurse scheduling assistant. Analyze the current schedule and provide specific refinement suggestions based on the user's request.

CURRENT HOURS ANALYSIS:
- Total Scheduled Hours: {total_scheduled_hours}h
- Target Hours: {target_hours}h
- Overall Hours Delta: {hours_delta}h {"(SHORTAGE - need to ADD more shifts!)" if hours_delta < 0 else "(SURPLUS - need to REMOVE shifts!)"}

GLOBAL STRATEGY REQUIRED:
When balancing hours to reach delta=0 for all nurses, you must use a TWO-STEP approach:
1. REMOVE shifts from OVERWORKED nurses (positive delta) - these nurses have TOO MANY hours
2. REDISTRIBUTE those hours by ADDING shifts to UNDERWORKED nurses (negative delta) - these nurses need MORE hours

Overworked nurses ({len(overworked_nurses)}): {', '.join(overworked_nurses) if overworked_nurses else 'None'}
Underworked nurses ({len(underworked_nurses)}): {', '.join(underworked_nurses) if underworked_nurses else 'None'}

IMPORTANT: Delta = (Actual Hours) - (Target Hours)
- NEGATIVE delta (e.g., -12h) means nurse is UNDER target → ADD shifts to this nurse
- POSITIVE delta (e.g., +12h) means nurse is OVER target → REMOVE shifts from this nurse
- Zero delta (0h) means nurse is at EXACTLY their target hours (IDEAL)

COMPLETE SCHEDULE (nurse name, employment type, hours worked, target, delta, and ACTUAL working dates):
{chr(10).join(schedule_details)}

NURSE CAPACITY (detailed breakdown per nurse with delta information):
{chr(10).join(nurse_hours_info)}

Total: {len(nurse_names_list)} nurses

Date range: {request.dates[0]} to {request.dates[-1]}

CRITICAL BALANCING STRATEGY:
If the user asks to "minimize delta", "balance hours", or "get delta to 0":
1. Calculate total hours that need to be REMOVED (sum of all positive deltas)
2. Calculate total hours that need to be ADDED (sum of all negative deltas, as absolute value)
3. Prioritize REMOVING shifts from nurses with largest positive deltas first
4. When removing a shift, try to ADD it to a nurse with negative delta who has that day OFF
5. Continue until all nurses are close to delta=0

Example strategy for "get delta to 0":
- If Nurse A has +44h (working 104h, target 60h) → REMOVE 44h worth of shifts from Nurse A
- If Nurse B has -4h (working 56h, target 60h) → ADD 4h to Nurse B on their OFF days
- Continue systematically until everyone reaches their target hours

CRITICAL RULE: For remove_shift or change actions, you MUST use dates that actually appear in the nurse's schedule above. Do NOT use dates that are not listed for that nurse.

User Refinement Request:
{request.refinement_request}

{f'''SCHEDULING RULES (must be respected):
{request.rules}
''' if request.rules else ''}
Analyze the schedule and provide specific, actionable changes. 

CRITICAL RULES:
1. When specifying nurse names, use the EXACT full name from the schedule above
2. For remove_shift actions, ONLY use dates that are listed as working dates for that specific nurse
3. Do NOT generate remove_shift for dates where a nurse has no shift
4. If hours delta is NEGATIVE, prioritize ADDING shifts using "add_shift" action on nurses' OFF days
5. Do NOT reduce shift lengths (12h to 8h) when there's a negative hours delta - that makes the shortage worse!
6. If user asks to "fix a negative delta" or "add more hours", use "add_shift" to add shifts on OFF days

Return ONLY valid JSON with no additional text:

{{
  "changes": [
    {{"nurse": "EXACT Nurse Name", "date": "YYYY-MM-DD", "action": "add_shift", "shift_code": "ZD12-", "reason": "Add shift to fill hours shortage"}}
  ],
  "summary": "Overall summary of suggested improvements"
}}

AVAILABLE ACTIONS:
- "add_shift": Add a new shift on an OFF day (specify shift_code field) - USE THIS TO FIX NEGATIVE DELTAS
- "set_shift": Change an existing shift to a different shift code (specify shift_code field)
- "remove_shift": Remove a shift (set to off day)

AVAILABLE SHIFT CODES (use these exact codes in shift_code field):
DAY SHIFTS (8-hour = 7.5h actual):
  - "07" = Day 8hr (07:00-15:15) = 7.5h
  - "11" = Mid 8hr (11:00-19:15) = 7.5h
  - "E15" = Evening 8hr (15:00-23:15) = 7.5h

DAY SHIFTS (12-hour = 11.25h actual):
  - "Z07" = Day 12hr (07:00-19:25) = 11.25h
  - "Z11" = Mid 12hr (11:00-23:25) = 11.25h

NIGHT SHIFTS (8-hour = 7.5h actual):
  - "23" = Night 8hr (23:00-07:15) = 7.5h

NIGHT SHIFTS (12-hour = 11.25h actual):
  - "Z19" = Night 12hr (19:00-07:25) = 11.25h

NIGHT TOP-UP/FINISH SHIFTS:
  - "Z23" = Night Finish (23:00-07:25) = 7.5h
  - "Z23 B" = Night Finish + Back at 19:00 (23:00-07:25) = 7.5h

EXAMPLES:

To ADD a 12h day shift on an off day (to fix negative delta):
{{"nurse": "Jane Doe", "date": "2025-08-29", "action": "add_shift", "shift_code": "Z07", "reason": "Add 12h shift to fill hours shortage"}}

To ADD an 8h shift (lighter shift while still adding hours):
{{"nurse": "Jane Doe", "date": "2025-08-30", "action": "add_shift", "shift_code": "07", "reason": "Add 8h day shift"}}

To change an existing 12h shift to 8h:
{{"nurse": "Jane Doe", "date": "2025-08-29", "action": "set_shift", "shift_code": "07", "reason": "Convert to 8h day shift"}}

IMPORTANT: 
1. Use EXACT nurse names from the COMPLETE NURSE LIST above
2. Return ONLY the JSON object, no markdown formatting or additional text
3. Always specify a valid shift_code when using set_shift or add_shift actions"""
        
        response = ScheduleOptimizer.call_openai_with_retry([
            {"role": "system", "content": f"{base_prompt}\n\nYou are helping refine an existing schedule."},
            {"role": "user", "content": refinement_prompt},
        ])
        
        raw_ai_response = response.choices[0].message.content
        logger.info(f"Raw AI response: {raw_ai_response}")

        def _recover_changes_from_raw(raw_text: str) -> List[Dict[str, Any]]:
            """Best-effort recovery when AI JSON is truncated/invalid.

            Extracts per-change objects directly from raw text, so we can still
            apply actionable edits instead of returning a no-op.
            """
            if not raw_text:
                return []

            recovered: List[Dict[str, Any]] = []

            # Match compact objects that contain nurse/date/action in any order.
            # This intentionally tolerates trailing commas and missing outer JSON braces.
            candidate_objects = re.findall(r"\{[^{}]*\}", str(raw_text), flags=re.DOTALL)
            for obj in candidate_objects:
                nurse_match = re.search(r'"nurse"\s*:\s*"([^"]+)"', obj)
                date_match = re.search(r'"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"', obj)
                action_match = re.search(r'"action"\s*:\s*"([^"]+)"', obj)

                if not (nurse_match and date_match and action_match):
                    continue

                shift_code_match = re.search(r'"shift_code"\s*:\s*"([^"]*)"', obj)
                reason_match = re.search(r'"reason"\s*:\s*"([^"]*)"', obj)

                change: Dict[str, Any] = {
                    "nurse": nurse_match.group(1).strip(),
                    "date": date_match.group(1).strip(),
                    "action": action_match.group(1).strip(),
                }
                if shift_code_match:
                    change["shift_code"] = shift_code_match.group(1).strip()
                if reason_match:
                    change["reason"] = reason_match.group(1).strip()

                recovered.append(change)

            return recovered

        try:
            ai_suggestions = ScheduleOptimizer.parse_ai_response(raw_ai_response)
        except HTTPException:
            recovered_changes = _recover_changes_from_raw(raw_ai_response)
            if recovered_changes:
                logger.warning(
                    f"AI refinement response JSON invalid, but recovered {len(recovered_changes)} change objects from raw text."
                )
                ai_suggestions = {
                    "changes": recovered_changes,
                    "summary": f"Recovered {len(recovered_changes)} changes from partial AI response.",
                }
            else:
                logger.warning(
                    "AI refinement response was not valid JSON and no changes could be recovered. Falling back to no-op refinement."
                )
                ai_suggestions = {
                    "changes": [],
                    "summary": "AI response could not be parsed as JSON; no refinement changes were applied.",
                }

        # If JSON parsed but changes are missing/invalid, still attempt raw recovery.
        parsed_changes = ai_suggestions.get("changes") if isinstance(ai_suggestions, dict) else None
        if not isinstance(parsed_changes, list) or len(parsed_changes) == 0:
            recovered_changes = _recover_changes_from_raw(raw_ai_response)
            if recovered_changes:
                ai_suggestions = ai_suggestions if isinstance(ai_suggestions, dict) else {}
                ai_suggestions["changes"] = recovered_changes
                ai_suggestions.setdefault(
                    "summary",
                    f"Recovered {len(recovered_changes)} changes from partial AI response.",
                )
                logger.warning(
                    f"Refine fallback: using {len(recovered_changes)} recovered changes from raw output."
                )
        
        logger.info(f"AI refinement suggestions: {ai_suggestions.get('summary', 'No summary')}")
        logger.info(f"AI suggested changes: {ai_suggestions.get('changes', [])}")
        
        # Apply the suggested changes to the schedule
        refined_schedule = {nurse: list(shifts) for nurse, shifts in request.schedule.items()}
        
        # Log DETAILED shift structure to understand date format
        logger.info("=" * 60)
        logger.info("INCOMING SCHEDULE STRUCTURE:")
        for nurse_name, shifts in list(refined_schedule.items())[:3]:  # First 3 nurses
            logger.info(f"  Nurse: '{nurse_name}' ({len(shifts)} shifts)")
            for i, shift in enumerate(shifts[:5]):  # First 5 shifts
                logger.info(f"    Shift {i}: {shift}")
        logger.info("=" * 60)
        
        # Create case-insensitive nurse lookup + fuzzy matching
        nurse_name_map = {}
        for nurse_name in refined_schedule.keys():
            nurse_name_map[nurse_name.lower().strip()] = nurse_name
        
        logger.info(f"Available nurses in schedule: {list(refined_schedule.keys())}")

        def normalize_name_for_match(value: str) -> str:
            text = unicodedata.normalize("NFKD", str(value or ""))
            text = "".join(ch for ch in text if not unicodedata.combining(ch))
            text = re.sub(r"[^a-zA-Z\s]", " ", text).lower()
            text = re.sub(r"\s+", " ", text).strip()
            return text
        
        def find_matching_nurse(suggested_name: str) -> str | None:
            """Find matching nurse using exact, partial, and fuzzy matching."""
            suggested_lower = suggested_name.lower().strip()
            suggested_norm = normalize_name_for_match(suggested_name)
            
            # Exact match
            if suggested_lower in nurse_name_map:
                return nurse_name_map[suggested_lower]
            
            # Partial match - check if suggested name is contained in any nurse name
            for nurse_lower, nurse_actual in nurse_name_map.items():
                if suggested_lower in nurse_lower or nurse_lower in suggested_lower:
                    logger.info(f"    Partial match: '{suggested_name}' matched to '{nurse_actual}'")
                    return nurse_actual

            # Normalized partial match (handles punctuation/diacritics/noise)
            for nurse_actual in refined_schedule.keys():
                nurse_norm = normalize_name_for_match(nurse_actual)
                if suggested_norm and (suggested_norm in nurse_norm or nurse_norm in suggested_norm):
                    logger.info(f"    Normalized partial match: '{suggested_name}' -> '{nurse_actual}'")
                    return nurse_actual
            
            # Try matching by first and last word (handles truncated names)
            suggested_words = suggested_lower.split()
            if len(suggested_words) >= 2:
                first_word = suggested_words[0]
                last_word = suggested_words[-1]
                for nurse_lower, nurse_actual in nurse_name_map.items():
                    nurse_words = nurse_lower.split()
                    if len(nurse_words) >= 2 and nurse_words[-1] == last_word and first_word in nurse_lower:
                        logger.info(f"    Fuzzy match: '{suggested_name}' matched to '{nurse_actual}'")
                        return nurse_actual

            # Similarity fallback (typos like Maky vs Maki, extra OCR noise)
            best_name = None
            best_score = 0.0
            for nurse_actual in refined_schedule.keys():
                nurse_norm = normalize_name_for_match(nurse_actual)
                score = difflib.SequenceMatcher(None, suggested_norm, nurse_norm).ratio()
                if score > best_score:
                    best_score = score
                    best_name = nurse_actual
            if best_name and best_score >= 0.62:
                logger.info(
                    f"    Similarity match: '{suggested_name}' -> '{best_name}' (score={best_score:.2f})"
                )
                return best_name
            
            return None
        
        changes_applied = []
        changes_rejected = []
        
        # Build a lookup of which dates each nurse has WORKING shifts on (not off days)
        nurse_work_dates = {}
        for nurse_name, shifts in refined_schedule.items():
            work_dates = set()
            for s in shifts:
                if s.get('shiftType') != 'off' and s.get('shift', '') not in ['', 'OFF', 'C', 'CF']:
                    work_dates.add(str(s.get('date', '')).strip())
            nurse_work_dates[nurse_name] = work_dates
        
        if "changes" in ai_suggestions and isinstance(ai_suggestions["changes"], list):
            logger.info(f"Processing {len(ai_suggestions['changes'])} suggested changes...")
            for change in ai_suggestions["changes"]:
                nurse_suggested = change.get("nurse", "").strip()
                date = change.get("date")
                action = change.get("action")
                
                logger.info(f"  Change: {nurse_suggested} on {date} -> {action}")
                
                # Find matching nurse name with fuzzy matching
                nurse_key = find_matching_nurse(nurse_suggested)
                if not nurse_key:
                    logger.warning(f"    Skipped: Nurse '{nurse_suggested}' not found. Available: {list(refined_schedule.keys())[:5]}")
                    changes_rejected.append({"change": change, "reason": f"Nurse '{nurse_suggested}' not found"})
                    continue
                
                logger.info(f"    Matched nurse: '{nurse_suggested}' -> '{nurse_key}'")
                
                # VALIDATION: For remove_shift, verify the nurse actually has a WORKING shift on this date
                if action == "remove_shift":
                    work_dates_for_nurse = nurse_work_dates.get(nurse_key, set())
                    target_date = str(date).strip() if date else ""
                    if target_date not in work_dates_for_nurse:
                        logger.warning(f"    REJECTED: Cannot remove shift from {nurse_key} on {date} - no working shift exists on that date")
                        logger.warning(f"    {nurse_key}'s working dates: {sorted(list(work_dates_for_nurse))[:10]}...")
                        changes_rejected.append({
                            "change": change, 
                            "reason": f"Nurse {nurse_key} has no working shift on {date}. Working dates: {sorted(list(work_dates_for_nurse))[:5]}"
                        })
                        continue
                
                # Handle add_shift actions - adds a new entry
                if action in ["add_shift", "add_shift_8h", "add_day_8h", "add_night_8h"]:
                    # Check if shift_code is specified (new flexible approach)
                    shift_code = change.get("shift_code", "").strip()
                    if shift_code:
                        shift_info = get_shift_info(shift_code)
                        if shift_info:
                            new_shift = {
                                "date": date,
                                "shiftType": shift_info["type"],
                                "shift": shift_code,
                                "hours": shift_info["hours"],
                                "startTime": shift_info["start"],
                                "endTime": shift_info["end"]
                            }
                            logger.info(f"    Applied: Added {shift_code} ({shift_info['label']})")
                        else:
                            logger.warning(f"    Skipped add_shift: Unknown shift code '{shift_code}'")
                            continue
                    # Fallback to legacy action-based determination
                    elif action in ["add_shift_8h", "add_day_8h"]:
                        new_shift = {
                            "date": date,
                            "shiftType": "day",
                            "shift": "ZD8-",
                            "hours": 8,
                            "startTime": "07:00",
                            "endTime": "15:00"
                        }
                        logger.info(f"    Applied: Added 8h day shift (7:00-15:00)")
                    elif action == "add_night_8h":
                        new_shift = {
                            "date": date,
                            "shiftType": "night",
                            "shift": "ZN8-",
                            "hours": 8,
                            "startTime": "23:00",
                            "endTime": "07:00"
                        }
                        logger.info(f"    Applied: Added 8h night shift (23:00-07:00)")
                    else:  # add_shift without shift_code - default 12h day
                        new_shift = {
                            "date": date,
                            "shiftType": "day",
                            "shift": "ZD12-",
                            "hours": 12,
                            "startTime": "07:00",
                            "endTime": "19:00"
                        }
                        logger.info(f"    Applied: Added 12h day shift")
                    refined_schedule[nurse_key].append(new_shift)
                    changes_applied.append(change)
                    continue
                    
                # Find the shift entry for this date
                # Normalize date for comparison (handle different formats)
                target_date_normalized = date.strip() if date else ""
                
                # Log ALL available dates for this nurse to debug date matching
                all_dates_for_nurse = [str(s.get("date", "N/A")) for s in refined_schedule[nurse_key]]
                logger.info(f"    ALL dates for {nurse_key}: {all_dates_for_nurse}")
                logger.info(f"    Looking for target: '{target_date_normalized}' (type: {type(date)})")
                
                # Find index of matching shift (don't iterate and delete at same time)
                match_index = None
                for i, shift in enumerate(refined_schedule[nurse_key]):
                    shift_date = str(shift.get("date", "")).strip()
                    logger.info(f"      Comparing: '{shift_date}' == '{target_date_normalized}' ? {shift_date == target_date_normalized}")
                    if shift_date == target_date_normalized:
                        match_index = i
                        logger.info(f"      MATCH FOUND at index {i}")
                        break
                
                if match_index is not None:
                    if action == "set_shift":
                        # Flexible action: set shift to any valid shift code
                        shift_code = change.get("shift_code", "").strip()
                        shift_info = get_shift_info(shift_code)
                        if shift_info:
                            refined_schedule[nurse_key][match_index]["shiftType"] = shift_info["type"]
                            refined_schedule[nurse_key][match_index]["shift"] = shift_code
                            refined_schedule[nurse_key][match_index]["hours"] = shift_info["hours"]
                            refined_schedule[nurse_key][match_index]["startTime"] = shift_info["start"]
                            refined_schedule[nurse_key][match_index]["endTime"] = shift_info["end"]
                            changes_applied.append(change)
                            logger.info(f"    Applied: Changed to {shift_code} ({shift_info['label']})")
                        else:
                            logger.warning(f"    Skipped: Unknown shift code '{shift_code}'")
                    elif action == "change_to_day":
                        refined_schedule[nurse_key][match_index]["shiftType"] = "day"
                        refined_schedule[nurse_key][match_index]["shift"] = "ZD12-"
                        refined_schedule[nurse_key][match_index]["hours"] = 12
                        refined_schedule[nurse_key][match_index]["startTime"] = "07:00"
                        refined_schedule[nurse_key][match_index]["endTime"] = "19:25"
                        changes_applied.append(change)
                        logger.info(f"    Applied: Changed to 12h day shift")
                    elif action == "change_to_night":
                        refined_schedule[nurse_key][match_index]["shiftType"] = "night"
                        refined_schedule[nurse_key][match_index]["shift"] = "ZN-"
                        refined_schedule[nurse_key][match_index]["hours"] = 12
                        refined_schedule[nurse_key][match_index]["startTime"] = "19:00"
                        refined_schedule[nurse_key][match_index]["endTime"] = "07:00"
                        changes_applied.append(change)
                        logger.info(f"    Applied: Changed to 12h night shift")
                    elif action == "change_to_day_8h":
                        refined_schedule[nurse_key][match_index]["shiftType"] = "day"
                        refined_schedule[nurse_key][match_index]["shift"] = "ZD8-"
                        refined_schedule[nurse_key][match_index]["hours"] = 8
                        refined_schedule[nurse_key][match_index]["startTime"] = "07:00"
                        refined_schedule[nurse_key][match_index]["endTime"] = "15:00"
                        changes_applied.append(change)
                        logger.info(f"    Applied: Changed to 8h day shift")
                    elif action == "change_to_night_8h":
                        refined_schedule[nurse_key][match_index]["shiftType"] = "night"
                        refined_schedule[nurse_key][match_index]["shift"] = "ZN8-"
                        refined_schedule[nurse_key][match_index]["hours"] = 8
                        refined_schedule[nurse_key][match_index]["startTime"] = "23:00"
                        refined_schedule[nurse_key][match_index]["endTime"] = "07:00"
                        changes_applied.append(change)
                        logger.info(f"    Applied: Changed to 8h night shift")
                    elif action == "remove_shift":
                        # Set shift to OFF instead of removing (to preserve grid structure)
                        refined_schedule[nurse_key][match_index]["shiftType"] = "off"
                        refined_schedule[nurse_key][match_index]["shift"] = ""
                        refined_schedule[nurse_key][match_index]["hours"] = 0
                        refined_schedule[nurse_key][match_index]["startTime"] = ""
                        refined_schedule[nurse_key][match_index]["endTime"] = ""
                        changes_applied.append(change)
                        logger.info(f"    Applied: Removed shift on {target_date_normalized}")
                    elif action == "add_off_day":
                        refined_schedule[nurse_key][match_index]["shiftType"] = "off"
                        refined_schedule[nurse_key][match_index]["shift"] = "OFF"
                        changes_applied.append(change)
                        logger.info(f"    Applied: Set to OFF")
                    else:
                        logger.warning(f"    Skipped: Unknown action '{action}'")
                else:
                    if action not in ["add_shift"]:
                        logger.warning(f"    Skipped: Date '{date}' not found for nurse '{nurse_key}'")
                        changes_rejected.append({
                            "change": change,
                            "reason": f"Date '{date}' not found in nurse's schedule"
                        })
        else:
            logger.warning("No 'changes' array found in AI suggestions")
        
        logger.info(f"Successfully applied {len(changes_applied)} changes to schedule")
        if changes_rejected:
            logger.warning(f"Rejected {len(changes_rejected)} invalid changes")
            for rejected in changes_rejected:
                logger.warning(f"  - {rejected}")
        
        # Log final schedule state
        logger.info("=" * 80)
        logger.info("REFINED SCHEDULE SUMMARY:")
        for nurse_name, shifts in refined_schedule.items():
            logger.info(f"  {nurse_name}: {len(shifts)} shifts")
        logger.info("=" * 80)
        
        return {
            "suggestions": ai_suggestions,
            "refined_schedule": refined_schedule,
            "changes_applied": len(changes_applied),
            "changes_rejected": len(changes_rejected),
            "rejected_details": changes_rejected[:10] if changes_rejected else [],  # Limit to first 10
            "message": f"AI refinement applied: {len(changes_applied)} changes applied, {len(changes_rejected)} rejected.",
            "raw_ai_response": raw_ai_response
        }
    
    except Exception as e:
        logger.error(f"Error refining schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to refine schedule: {str(e)}")


# ============================================================================
# SELF-SCHEDULING ENDPOINT
# ============================================================================

@router.post("/self-schedule", response_model=SelfScheduleResponse)
async def optimize_with_preferences(
    req: SelfScheduleRequest,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """
    Preferred-First Self-Scheduling Optimization. Requires authentication.
    
    This endpoint implements a 3-stage algorithm:
    1. LOCKED PASS: Assign uncontested preferences
    2. SENIORITY RESOLVER: Resolve conflicts by seniority + equity score
    3. GAP FILLER: Fill remaining slots prioritizing under-target nurses
    
    Hard Constraints (FIQ Collective Agreement):
    - 50% Day Shift Guarantee (unless permanent night waiver)
    - 11-hour minimum rest between shifts
    - Max 3-4 consecutive 12h shifts
    - Weekend fairness (1:2 rotation)
    """
    try:
        # Require authentication
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        logger.info("=" * 80)
        logger.info("SELF-SCHEDULING ENDPOINT CALLED")
        logger.info("=" * 80)
        logger.info(f"  Submissions: {len(req.submissions)} nurses")
        logger.info(f"  Dates: {len(req.dates)} days from {req.dates[0] if req.dates else 'N/A'} to {req.dates[-1] if req.dates else 'N/A'}")
        
        # Convert Pydantic models to dataclasses
        submissions = []
        for sub in req.submissions:
            preferences = []
            for pref in sub.preferences:
                preferences.append(ShiftPreference(
                    date=pref.date,
                    shift_code=pref.shift_code,
                    rank=pref.rank,
                    is_off_request=pref.is_off_request,
                    off_code=pref.off_code,
                    comment=pref.comment
                ))
            
            # Map rotation preference
            rot_pref = RotationPreference.NONE
            if sub.rotation_preference == "block":
                rot_pref = RotationPreference.BLOCK
            elif sub.rotation_preference == "spaced":
                rot_pref = RotationPreference.SPACED
            
            # Map shift type choice
            shift_choice = ShiftTypeChoice.MIXED
            if sub.shift_type_choice == "8h":
                shift_choice = ShiftTypeChoice.EIGHT_HOUR
            elif sub.shift_type_choice == "12h":
                shift_choice = ShiftTypeChoice.TWELVE_HOUR
            
            submissions.append(NurseSubmission(
                nurse_id=sub.nurse_id,
                nurse_name=sub.nurse_name,
                seniority=sub.seniority,
                employment_type=sub.employment_type,
                fte_target_hours=sub.fte_target_hours,
                preferences=preferences,
                rotation_preference=rot_pref,
                shift_type_choice=shift_choice,
                is_permanent_night=sub.is_permanent_night,
                max_weekly_hours=sub.max_weekly_hours,
                certifications=set(sub.certifications)
            ))
        
        # Build staffing requirements
        staffing_reqs = req.staffing_requirements or {}
        if not staffing_reqs:
            # Default: 5 day, 5 night for each date
            for date in req.dates:
                staffing_reqs[date] = {"day": 5, "night": 5}
        
        # Build config
        config = OptimizationConfig()
        if req.config:
            config = OptimizationConfig(
                pay_period_days=req.config.pay_period_days,
                ft_biweekly_target=req.config.ft_biweekly_target,
                pt_biweekly_target=req.config.pt_biweekly_target,
                min_rest_hours=req.config.min_rest_hours,
                max_consecutive_12h=req.config.max_consecutive_12h,
                max_consecutive_any=req.config.max_consecutive_any,
                day_shift_min_percentage=req.config.day_shift_min_percentage,
                weekend_max_ratio=req.config.weekend_max_ratio,
                balance_window_days=req.config.balance_window_days,
                use_seniority_for_conflicts=req.config.use_seniority_for_conflicts,
                allow_overtime=req.config.allow_overtime,
                overtime_cap_hours=req.config.overtime_cap_hours
            )
        
        # Create and run engine
        engine = SelfSchedulingEngine(
            submissions=submissions,
            date_list=req.dates,
            shifts_info=SHIFT_CODES,
            staffing_requirements=staffing_reqs,
            config=config
        )
        
        results = engine.optimize()
        
        # Convert results to serializable format
        results_dict = {}
        grid = []
        total_preferences_submitted = 0
        total_preferences_honored = 0
        total_conflicts = 0
        
        for nurse_name, result in results.items():
            results_dict[nurse_name] = {
                "nurse_id": result.nurse_id,
                "nurse_name": result.nurse_name,
                "assigned_shifts": result.assigned_shifts,
                "preference_results": [
                    {
                        "date": pr.date,
                        "shift_code": pr.shift_code,
                        "status": pr.status.value,
                        "assigned": pr.assigned,
                        "reason_detail": pr.reason_detail,
                        "conflicting_nurse": pr.conflicting_nurse
                    }
                    for pr in result.preference_results
                ],
                "total_hours": result.total_hours,
                "virtual_credit_hours": getattr(result, "virtual_credit_hours", 0),
                "compliance_hours": getattr(result, "compliance_hours", result.total_hours),
                "is_compliant": getattr(result, "is_compliant", True),
                "target_hours": result.target_hours,
                "target_delta": result.target_delta,
                "day_shift_percentage": result.day_shift_percentage,
                "weekend_shifts": result.weekend_shifts,
                "stats": result.stats
            }
            
            # Build grid entry
            grid.append({
                "nurse": nurse_name,
                "shifts": result.assigned_shifts
            })
            
            # Aggregate stats
            total_preferences_submitted += result.stats.get("preferences_submitted", 0)
            total_preferences_honored += result.stats.get("preferences_honored", 0)
            total_conflicts += result.stats.get("conflicts_lost", 0)
        
        # Build summary
        summary = {
            "total_nurses": len(results),
            "total_preferences_submitted": total_preferences_submitted,
            "total_preferences_honored": total_preferences_honored,
            "preference_fulfillment_rate": (
                (total_preferences_honored / total_preferences_submitted * 100)
                if total_preferences_submitted > 0 else 0
            ),
            "total_conflicts_resolved": total_conflicts,
            "compliant_nurses": sum(1 for r in results.values() if getattr(r, 'is_compliant', True)),
            "unmet_slots": len(getattr(engine, 'unmet_slots', [])),
            "date_range": {
                "start": req.dates[0] if req.dates else "",
                "end": req.dates[-1] if req.dates else ""
            }
        }
        
        # Save to database using authenticated org_id
        org_id = auth.organization_id
        
        schedule_data = {
            "schedule_data": {
                "schedule": grid,
                "grid": grid,
                "dates": req.dates,
                "dateRange": summary["date_range"]
            },
            "optimization_results": results_dict,
            "summary": summary,
            "algorithm": "self_scheduling_v2",
            "config": {
                "pay_period_days": config.pay_period_days,
                "ft_biweekly_target": config.ft_biweekly_target,
                "pt_biweekly_target": config.pt_biweekly_target,
                "min_rest_hours": config.min_rest_hours
            }
        }
        
        new_schedule = OptimizedSchedule(
            schedule_id=req.schedule_id if req.schedule_id else None,
            organization_id=org_id,
            result=schedule_data,
            finalized=False,
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)
        
        logger.info(f"✅ Self-scheduling complete. Schedule ID: {new_schedule.id}")
        logger.info(f"   Fulfillment rate: {summary['preference_fulfillment_rate']:.1f}%")
        
        return SelfScheduleResponse(
            schedule_id=str(new_schedule.id),
            results=results_dict,
            summary=summary,
            grid=grid
        )
        
    except Exception as e:
        logger.error(f"Error in self-scheduling: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Self-scheduling failed: {str(e)}")


@router.post("/optimize-with-constraints")
async def optimize_with_constraints(
    constraints: Dict[str, Any] = Body(...),
    assignments: Optional[Dict[str, List[str]]] = Body(default=None),
    nurses: Optional[List[Dict[str, Any]]] = Body(default=None),
    schedule_id: Optional[str] = Body(default=None),
    save_to_db: bool = Body(default=False),
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """
    Optimize schedule using pre-confirmed constraints. Requires authentication.
    This is called after user reviews and edits constraints from /preview.
    """
    try:
        # Require authentication
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        logger.info("=" * 80)
        logger.info("OPTIMIZE WITH CONFIRMED CONSTRAINTS")
        logger.info("=" * 80)
        
        # CRITICAL DEBUG: Log assignments received
        logger.info(f"Assignments received: {len(assignments) if assignments else 0} nurses")
        if assignments:
            for nurse_name, shifts in list(assignments.items())[:3]:  # Sample first 3
                non_empty = [s for s in shifts if s and s.strip()]
                logger.info(f"  Sample - {nurse_name}: {len(non_empty)} non-empty shifts out of {len(shifts)}")
        
        # CRITICAL: If nurses are provided in request body, override constraints.nurses
        if nurses:
            logger.info(f"🔄 OVERRIDING constraints.nurses with {len(nurses)} nurses from request body")
            constraints["nurses"] = nurses
        
        # CRITICAL DEBUG: Log what was received from frontend
        nurses_list = constraints.get("nurses", [])
        logger.info(f"Received {len(nurses_list)} nurses in constraints:")
        for i, nurse in enumerate(nurses_list, 1):
            off_reqs = nurse.get("offRequests", [])
            if off_reqs:
                logger.info(f"  {i}. {nurse.get('name', 'UNNAMED')} | ⚠️ OFF on: {off_reqs}")
            else:
                logger.info(f"  {i}. {nurse.get('name', 'UNNAMED')} | offRequests = []")
        
        # CRITICAL: Log date range
        date_range = constraints.get("dateRange", {})
        logger.info(f"Date range: {date_range.get('start')} to {date_range.get('end')}")
        
        # CRITICAL: Log shift requirements
        shift_reqs = constraints.get("shiftRequirements", {})
        logger.info(f"Shift requirements: Day={shift_reqs.get('dayShift', {}).get('count')}, Night={shift_reqs.get('nightShift', {}).get('count')}")
        logger.info("=" * 80)
        
        ScheduleOptimizer.validate_constraints_structure(constraints)
        
        # Build nurse_defaults from database for any nurses missing from the frontend payload
        nurse_defaults = {}
        org_id = auth.organization_id
        if org_id:
            db_nurses = db.query(Nurse).filter(Nurse.organization_id == org_id).all()
            for db_nurse in db_nurses:
                nurse_defaults[db_nurse.name.strip().lower()] = {
                    "employmentType": db_nurse.employment_type or "full-time",
                    "maxWeeklyHours": db_nurse.max_weekly_hours or 60,
                    "targetBiWeeklyHours": db_nurse.bi_weekly_target_hours or 75,
                    "isChemoCertified": db_nurse.is_chemo_certified or False,
                    "isTransplantCertified": db_nurse.is_transplant_certified or False,
                    "isRenalCertified": db_nurse.is_renal_certified or False,
                    "isChargeCertified": db_nurse.is_charge_certified or False,
                }
            logger.info(f"Loaded {len(nurse_defaults)} nurse defaults from database")
        
        schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
            assignments=assignments or {},
            constraints=constraints,
            nurse_defaults=nurse_defaults,
        )
        
        # Only save to DB if explicitly requested (e.g., on finalize)
        response_data = {"optimized_schedule": schedule}
        
        if save_to_db:
            # Use authenticated organization_id
            org_id = auth.organization_id

            existing_draft = None
            if schedule_id:
                existing_draft = _get_mutable_schedule_or_404(db, auth, schedule_id)

            if existing_draft:
                # Keep one draft lifecycle: update existing draft instead of creating duplicates
                existing_draft.organization_id = org_id
                existing_draft.result = schedule
                existing_draft.finalized = False
                # No updated_at column yet; refresh created_at so Recent Activity reflects latest draft changes
                existing_draft.created_at = datetime.utcnow()
                db.commit()
                db.refresh(existing_draft)

                logger.info(f"Successfully optimized and updated draft schedule: {existing_draft.id}")
                response_data["id"] = str(existing_draft.id)
            else:
                new_schedule = OptimizedSchedule(
                    organization_id=org_id,
                    result=schedule,
                    finalized=False,
                )
                db.add(new_schedule)
                db.commit()
                db.refresh(new_schedule)

                logger.info(f"Successfully optimized and saved schedule: {new_schedule.id}")
                response_data["id"] = str(new_schedule.id)
        else:
            logger.info("Successfully optimized schedule (not saved to DB)")
        
        return response_data
    
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error in optimize_with_constraints: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=OptimizeResponse)
async def optimize_schedule(
    req: OptimizeRequest,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    try:
        # Require authentication for schedule creation
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        logger.info("="  * 80)
        logger.info("OPTIMIZE ENDPOINT CALLED")
        logger.info("=" * 80)
        logger.info(f"Schedule ID: {req.schedule_id}")
        logger.info(f"Organization ID: {auth.organization_id}")
        logger.info(f"Dates: {len(req.dates)} days from {req.dates[0] if req.dates else 'N/A'} to {req.dates[-1] if req.dates else 'N/A'}")
        logger.info(f"Nurses received from frontend: {len(req.nurses)}")
        for i, nurse in enumerate(req.nurses, 1):
            nurse_dict = nurse.dict() if hasattr(nurse, 'dict') else nurse
            logger.info(f"  {i}. {nurse_dict.get('name', 'UNNAMED')}")
        logger.info(f"Assignments (OCR data): {len(req.assignments) if req.assignments else 0} nurses")
        if req.assignments:
            logger.info(f"  Nurses with OCR data: {list(req.assignments.keys())}")
        logger.info(f"Notes: {req.notes}")
        logger.info(f"Staff requirements override: {req.staffRequirements}")
        logger.info("=" * 80)
        
        ScheduleOptimizer.validate_input_data(req)

        prompt = ScheduleOptimizer.build_prompt_for_constraints_parsing(req, db)
        # logger.info("Generated constraints parsing prompt: %s", prompt)

        response = ScheduleOptimizer.call_openai_with_retry([
            {"role": "system", "content": "Parse user scheduling input into structured JSON constraints only."},
            {"role": "user", "content": prompt},
        ])

        constraints = ScheduleOptimizer.parse_ai_response(response.choices[0].message.content)            
        
        # Validate full constraints structure
        ScheduleOptimizer.validate_constraints_structure(constraints)
        
        # Sanitize shift-code lists while preserving site-specific configuration.
        shifts_info = constraints.get("shiftsInfo", {}) if isinstance(constraints, dict) else {}
        ai_day_codes = constraints["shiftRequirements"]["dayShift"].get("shiftCodes", [])
        ai_night_codes = constraints["shiftRequirements"]["nightShift"].get("shiftCodes", [])
        constraints["shiftRequirements"]["dayShift"]["shiftCodes"] = ScheduleOptimizer._sanitize_shift_codes(
            ai_day_codes,
            shifts_info,
            target_kind="day",
        )
        constraints["shiftRequirements"]["nightShift"]["shiftCodes"] = ScheduleOptimizer._sanitize_shift_codes(
            ai_night_codes,
            shifts_info,
            target_kind="night",
        )

        logger.info("Sanitized shift codes")
        logger.info(f"  AI day codes: {ai_day_codes}")
        logger.info(f"  AI night codes: {ai_night_codes}")
        logger.info(
            f"  Final day codes: {constraints['shiftRequirements']['dayShift']['shiftCodes']}"
        )
        logger.info(
            f"  Final night codes: {constraints['shiftRequirements']['nightShift']['shiftCodes']}"
        )

        # Resolve staffing requirements with optional frontend minimum overrides.
        ai_day_count = constraints['shiftRequirements']['dayShift']['count']
        ai_night_count = constraints['shiftRequirements']['nightShift']['count']

        req_day_min = req.staffRequirements.minDayStaff if req.staffRequirements else None
        req_night_min = req.staffRequirements.minNightStaff if req.staffRequirements else None

        constraints['shiftRequirements']['dayShift']['count'] = ScheduleOptimizer._resolve_staff_requirement(
            ai_day_count,
            req_day_min,
        )
        constraints['shiftRequirements']['nightShift']['count'] = ScheduleOptimizer._resolve_staff_requirement(
            ai_night_count,
            req_night_min,
        )

        logger.info("Resolved staffing requirements")
        logger.info(f"  AI suggested: day={ai_day_count}, night={ai_night_count}")
        logger.info(f"  Frontend minima: day={req_day_min}, night={req_night_min}")
        logger.info(
            f"  Final: day={constraints['shiftRequirements']['dayShift']['count']}, night={constraints['shiftRequirements']['nightShift']['count']}"
        )
        
        # CRITICAL FIX: OVERRIDE constraints["nurses"] with ALL nurses from frontend request
        # The AI only parses nurses from OCR data, but we need ALL nurses in the unit!
        logger.info("=" * 60)
        logger.info("NURSE OVERRIDE: Replacing AI-parsed nurses with ALL frontend nurses")
        logger.info(f"  AI parsed {len(constraints['nurses'])} nurses: {[n['name'] for n in constraints['nurses']]}")
        
        # Preprocess all nurses from frontend
        all_nurses = ScheduleOptimizer.preprocess_nurse_data(req.nurses)
        
        # CRITICAL DEBUG: Log offRequests received from frontend
        logger.info("=" * 60)
        logger.info("🚫 OFF REQUESTS RECEIVED FROM FRONTEND:")
        for nurse in all_nurses:
            off_reqs = nurse.get("offRequests", [])
            logger.info(f"  {nurse.get('name', 'UNKNOWN')}: offRequests = {off_reqs}")
        logger.info("=" * 60)
        
        # Merge off requests from AI-parsed data (for CF codes and 'c' markers)
        ai_nurse_off_requests = {}
        for ai_nurse in constraints.get("nurses", []):
            ai_nurse_off_requests[ai_nurse.get("name", "")] = ai_nurse.get("offRequests", [])
        
        # Also extract off days from assignments (CF codes = holidays, 'c'/'C' = off requests)
        for nurse_name, shifts in (req.assignments or {}).items():
            if nurse_name not in ai_nurse_off_requests:
                ai_nurse_off_requests[nurse_name] = []
            for day_idx, shift_code in enumerate(shifts):
                if shift_code:
                    shift_upper = shift_code.upper()
                    # CF = congé férié (statutory holiday), C = off request
                    if shift_upper.startswith("CF") or shift_upper == "C":
                        if day_idx < len(req.dates):
                            off_date = req.dates[day_idx]
                            if off_date not in ai_nurse_off_requests[nurse_name]:
                                ai_nurse_off_requests[nurse_name].append(off_date)
                                logger.info(f"  Marking {nurse_name} OFF on {off_date} (code: {shift_code})")
        
        logger.info("=" * 60)
        logger.info("PARSING COMMENTS FOR VACATION/OFF DAYS:")
        logger.info("Note: Comments with 'vacation', 'off', 'congé', 'holiday', 'leave', 'sick' keywords")
        logger.info("will be converted to offRequests and handled in the FIRST PASS of the scheduler.")
        logger.info("=" * 60)
        
        # Build a lookup for fuzzy nurse name matching
        all_nurse_names = [n.get("name", "") for n in all_nurses]
        
        def find_matching_nurse(comment_nurse_name: str) -> str:
            """Find the best matching nurse name using fuzzy matching"""
            comment_lower = comment_nurse_name.lower().strip()
            
            # Try exact match first
            for nurse_name in all_nurse_names:
                if nurse_name.lower() == comment_lower:
                    return nurse_name
            
            # Try partial match (comment name contains nurse name or vice versa)
            for nurse_name in all_nurse_names:
                nurse_lower = nurse_name.lower()
                if comment_lower in nurse_lower or nurse_lower in comment_lower:
                    return nurse_name
                # Also try first word match (e.g., "imoya 596" -> "imoya")
                comment_first = comment_lower.split()[0] if comment_lower.split() else ""
                nurse_first = nurse_lower.split()[0] if nurse_lower.split() else ""
                if comment_first and nurse_first and (comment_first == nurse_first or comment_first in nurse_lower or nurse_first in comment_lower):
                    return nurse_name
            
            return comment_nurse_name  # Return original if no match
        
        for comment_nurse_name, date_comments in (req.comments or {}).items():
            # Find matching nurse
            matched_nurse = find_matching_nurse(comment_nurse_name)
            if matched_nurse not in ai_nurse_off_requests:
                ai_nurse_off_requests[matched_nurse] = []
            
            for date_str, comment_text in (date_comments or {}).items():
                if comment_text:
                    comment_lower = comment_text.lower()
                    # Check for vacation/off keywords
                    if any(keyword in comment_lower for keyword in ["vacation", "vacances", "off", "congé", "conge", "holiday", "leave", "sick"]):
                        if date_str not in ai_nurse_off_requests[matched_nurse]:
                            ai_nurse_off_requests[matched_nurse].append(date_str)
                            logger.info(f"  Marking {matched_nurse} OFF on {date_str} (comment: {comment_text}, from: {comment_nurse_name})")
        logger.info("=" * 60)
        
        # Apply merged off requests to all nurses
        for nurse in all_nurses:
            nurse_name = nurse.get("name", "")
            existing_off = set(nurse.get("offRequests", []))
            ai_off = set(ai_nurse_off_requests.get(nurse_name, []))
            nurse["offRequests"] = list(existing_off | ai_off)
        
        # CRITICAL DEBUG: Log FINAL offRequests after merge
        logger.info("=" * 60)
        logger.info("🚫 FINAL OFF REQUESTS AFTER MERGE (sent to scheduler):")
        for nurse in all_nurses:
            off_reqs = nurse.get("offRequests", [])
            if off_reqs:
                logger.info(f"  ⚠️ {nurse.get('name', 'UNKNOWN')} is OFF on: {off_reqs}")
        logger.info("=" * 60)
        
        # Replace constraints nurses with ALL frontend nurses
        constraints["nurses"] = all_nurses
        
        logger.info(f"  NOW using {len(constraints['nurses'])} nurses: {[n['name'] for n in constraints['nurses']]}")
        logger.info("=" * 60)
        
        # OVERRIDE staff requirements with frontend values if provided
        if req.staffRequirements:
            logger.info(f"Overriding AI staff requirements with frontend values: day={req.staffRequirements.minDayStaff}, night={req.staffRequirements.minNightStaff}")
            constraints["shiftRequirements"]["dayShift"]["count"] = max(
                constraints["shiftRequirements"]["dayShift"]["count"],
                req.staffRequirements.minDayStaff
            )
            constraints["shiftRequirements"]["nightShift"]["count"] = max(
                constraints["shiftRequirements"]["nightShift"]["count"],
                req.staffRequirements.minNightStaff
            )
        
        final_day_req = constraints['shiftRequirements']['dayShift']['count']
        final_night_req = constraints['shiftRequirements']['nightShift']['count']
        
        logger.info("=" * 60)
        logger.info("FINAL STAFFING REQUIREMENTS:")
        logger.info(f"  Day requirement: {final_day_req}")
        logger.info(f"  Night requirement: {final_night_req}")
        logger.info(f"  Total nurses available: {len(constraints['nurses'])}")
        
        # CRITICAL WARNING: If requirements are too low, most nurses will have OFF days
        if final_day_req < 3 or final_night_req < 2:
            logger.warning(f"⚠️  STAFFING REQUIREMENTS ARE VERY LOW! Day={final_day_req}, Night={final_night_req}")
            logger.warning(f"⚠️  With {len(constraints['nurses'])} nurses available, most will be scheduled OFF")
            logger.warning(f"⚠️  Consider increasing minDayStaff and minNightStaff in the frontend")
        logger.info("=" * 60)

        # Use RobustScheduler which GUARANTEES full coverage
        # Build nurse_defaults from database for any nurses missing from the frontend payload
        nurse_defaults = {}
        if auth.is_authenticated and auth.organization_id:
            db_nurses = db.query(Nurse).filter(Nurse.organization_id == auth.organization_id).all()
            for db_nurse in db_nurses:
                nurse_defaults[db_nurse.name.strip().lower()] = {
                    "employmentType": db_nurse.employment_type or "full-time",
                    "maxWeeklyHours": db_nurse.max_weekly_hours or 60,
                    "targetBiWeeklyHours": db_nurse.bi_weekly_target_hours or 75,
                    "isChemoCertified": db_nurse.is_chemo_certified or False,
                    "isTransplantCertified": db_nurse.is_transplant_certified or False,
                    "isRenalCertified": db_nurse.is_renal_certified or False,
                    "isChargeCertified": db_nurse.is_charge_certified or False,
                }
            logger.info(f"Loaded {len(nurse_defaults)} nurse defaults from database")
        
        schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
            assignments=req.assignments or {},
            constraints=constraints,
            nurse_defaults=nurse_defaults,
        )
        
        # Skip AI refinement - RobustScheduler already produces a complete schedule
        # The old AI refinement was unreliable and often broke the schedule

        # Use authenticated organization_id
        org_id = auth.organization_id

        new_schedule = OptimizedSchedule(
            schedule_id=req.schedule_id if req.schedule_id else None,
            organization_id=org_id,
            result=schedule,  # Use schedule directly
            finalized=False,
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)

        logger.info(f"Successfully optimized schedule with ID: {new_schedule.id}")
        return {"optimized_schedule": schedule, "id": str(new_schedule.id)}
    
    except HTTPException as he:
        logger.error(f"HTTPException during optimization: {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during optimization: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during optimization: {str(e)}"
        )

# IMPORTANT: Specific routes must come BEFORE parameterized routes in FastAPI
# Otherwise /{schedule_id} will match /refine and treat "refine" as an ID

@router.get("/")
async def list_optimized_schedules(
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """List optimized schedules for the current organization, most recent first"""
    # If no organization context, return empty list - never expose all schedules
    if not auth.is_authenticated or not auth.organization_id:
        return []
    
    query = db.query(OptimizedSchedule)
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    query = query.filter(OptimizedSchedule.organization_id == auth.organization_id)
    
    schedules = query.order_by(OptimizedSchedule.created_at.desc()).limit(50).all()
    result = []
    for s in schedules:
        result_data = s.result or {}
        schedule_data = _normalize_schedule_payload(result_data)
        start_date, end_date = _resolve_schedule_date_range(result_data, schedule_data)
        
        result.append({
            "id": str(s.id),
            "schedule_id": str(s.schedule_id) if s.schedule_id else None,
            "organization_id": s.organization_id,
            "is_finalized": s.finalized,
            "start_date": start_date,
            "end_date": end_date,
            "schedule_data": schedule_data,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return result

# Parameterized routes come last to avoid matching specific paths
@router.get("/{schedule_id}")
async def get_optimized_schedule(
    schedule_id: str,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db),
):
    """Get a specific optimized schedule by ID"""
    try:
        schedule = _get_scoped_schedule_or_404(db, auth, schedule_id)
        
        result_data = schedule.result or {}
        schedule_data = _normalize_schedule_payload(result_data)
        start_date, end_date = _resolve_schedule_date_range(result_data, schedule_data)
        
        return {
            "id": str(schedule.id),
            "schedule_id": str(schedule.schedule_id) if schedule.schedule_id else None,
            "organization_id": schedule.organization_id,
            "is_finalized": schedule.finalized,
            "start_date": start_date,
            "end_date": end_date,
            "schedule_data": schedule_data,
            "created_at": schedule.created_at.isoformat() if schedule.created_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{schedule_id}/finalize")
async def finalize_schedule(
    schedule_id: str,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db),
):
    """Mark a schedule as finalized (approved for use)"""
    try:
        schedule = _get_scoped_schedule_or_404(db, auth, schedule_id)
        
        schedule.finalized = True
        db.commit()
        db.refresh(schedule)
        
        logger.info(f"Schedule {schedule_id} finalized")
        return {"success": True, "id": str(schedule.id), "finalized": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error finalizing schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/draft")
async def create_draft_schedule(
    schedule_data: Dict[str, Any],
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """Create an initial draft schedule. Requires authentication."""
    try:
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        org_id = auth.organization_id

        new_schedule = OptimizedSchedule(
            organization_id=org_id,
            result=schedule_data or {},
            finalized=False,
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)

        logger.info(f"Successfully created initial draft schedule: {new_schedule.id}")
        return {
            "success": True,
            "id": str(new_schedule.id),
            "finalized": False,
            "message": "Draft schedule created successfully"
        }
    except Exception as e:
        logger.error(f"Error creating draft schedule: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{schedule_id}/draft")
async def update_draft_schedule(
    schedule_id: str,
    schedule_data: Dict[str, Any],
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """Update an existing draft schedule payload and refresh activity timestamp."""
    try:
        schedule = _get_mutable_schedule_or_404(db, auth, schedule_id)

        existing_payload = schedule.result if isinstance(schedule.result, dict) else {}
        patch_payload = schedule_data if isinstance(schedule_data, dict) else {}
        merged_payload = {**existing_payload, **patch_payload}

        schedule.organization_id = auth.organization_id if auth.is_authenticated else schedule.organization_id
        schedule.result = merged_payload
        schedule.finalized = False
        # No updated_at column exists, so use created_at as latest activity timestamp
        schedule.created_at = datetime.utcnow()

        db.commit()
        db.refresh(schedule)

        logger.info(f"Draft schedule {schedule_id} updated")
        return {
            "success": True,
            "id": str(schedule.id),
            "finalized": False,
            "message": "Draft updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating draft schedule: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save-and-finalize")
async def save_and_finalize_schedule(
    schedule_data: Dict[str, Any],
    schedule_id: Optional[str] = None,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """Save a draft schedule and immediately finalize it. Requires authentication."""
    try:
        # Require authentication
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        org_id = auth.organization_id

        existing_draft = None
        if schedule_id:
            existing_draft = _get_mutable_schedule_or_404(db, auth, schedule_id)

        if existing_draft:
            existing_draft.organization_id = org_id
            existing_draft.result = schedule_data
            existing_draft.finalized = True
            # Surface finalize action in Recent Activity ordering
            existing_draft.created_at = datetime.utcnow()
            db.commit()
            db.refresh(existing_draft)

            logger.info(f"Successfully finalized existing draft schedule: {existing_draft.id}")
            return {
                "success": True,
                "id": str(existing_draft.id),
                "finalized": True,
                "message": "Schedule finalized successfully"
            }

        new_schedule = OptimizedSchedule(
            organization_id=org_id,
            result=schedule_data,
            finalized=True,  # Immediately finalized
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)

        logger.info(f"Successfully saved and finalized schedule: {new_schedule.id}")
        return {
            "success": True,
            "id": str(new_schedule.id),
            "finalized": True,
            "message": "Schedule saved and finalized successfully"
        }
    except Exception as e:
        logger.error(f"Error saving and finalizing schedule: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db),
):
    """Delete an optimized schedule by ID"""
    try:
        schedule = _get_scoped_schedule_or_404(db, auth, schedule_id)

        schedule_payload = getattr(schedule, "schedule_data", None) or getattr(schedule, "result", None)
        if isinstance(schedule_payload, str):
            try:
                schedule_payload = json.loads(schedule_payload)
            except json.JSONDecodeError:
                schedule_payload = {}
        if not isinstance(schedule_payload, dict):
            schedule_payload = {}

        dates = schedule_payload.get("dates") if isinstance(schedule_payload.get("dates"), list) else []
        date_range = schedule_payload.get("dateRange") if isinstance(schedule_payload.get("dateRange"), dict) else {}
        start = (
            getattr(schedule, "start_date", None)
            or schedule_payload.get("start_date")
            or date_range.get("start")
            or (dates[0] if dates else None)
        )
        end = (
            getattr(schedule, "end_date", None)
            or schedule_payload.get("end_date")
            or date_range.get("end")
            or (dates[-1] if dates else None)
        )
        schedule_name = getattr(schedule, "name", None)
        schedule_label = (
            schedule_name.strip()
            if isinstance(schedule_name, str) and schedule_name.strip()
            else "Schedule"
        )
        schedule_details = (
            f"{start} - {end}" if start and end else "Schedule period unavailable"
        )

        record_deletion_activity(
            db,
            object_type="schedule",
            object_id=str(schedule.id),
            object_label=schedule_label,
            details=schedule_details,
            auth=auth,
            organization_id=getattr(schedule, "organization_id", None),
        )
        db.delete(schedule)
        db.commit()

        logger.info(f"Schedule {schedule_id} deleted")
        return {"success": True, "id": str(schedule_id), "message": "Schedule deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting schedule: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/insights")
async def get_schedule_insights(request: InsightsRequest):
    """
    Analyze an optimized schedule with AI and return structured insights:
    coverage issues, fairness observations, and actionable suggestions.
    """
    try:
        logger.info("=" * 80)
        logger.info("GET SCHEDULE INSIGHTS ENDPOINT CALLED")
        logger.info("=" * 80)

        date_range_str = f"{request.dates[0]} – {request.dates[-1]}" if request.dates else "unknown dates"
        total_days = len(request.dates)
        num_weeks = total_days / 7.0

        # Build per-nurse summary from schedule + nurseHoursStats
        nurse_stats_map: dict = {}
        if request.nurseHoursStats:
            for stat in request.nurseHoursStats:
                nurse_stats_map[stat.get("name", "")] = stat

        nurse_lines = []
        total_scheduled_hours = 0.0
        overworked: list = []
        underworked: list = []

        for nurse_name, shifts in request.schedule.items():
            work_shifts = [s for s in shifts if s.get("shiftType") != "off" and s.get("shift", "") not in ["", "OFF"]]
            nurse_hours = sum(float(s.get("hours", 0)) for s in work_shifts)
            total_scheduled_hours += nurse_hours
            working_days = len(work_shifts)

            if nurse_name in nurse_stats_map:
                stat = nurse_stats_map[nurse_name]
                target_h = float(stat.get("targetHours", 0))
                delta_h = float(stat.get("delta", nurse_hours - target_h))
                emp_type = stat.get("employmentType", "FT")
            else:
                emp_type = "FT"
                target_h = 37.5 * num_weeks
                delta_h = nurse_hours - target_h

            off_days = [s.get("date") for s in shifts if s.get("shiftType") == "off" or s.get("shift", "") in ["", "OFF"]]
            nurse_lines.append(
                f"- {nurse_name} ({emp_type}): {working_days} shifts / {nurse_hours:.1f}h | target {target_h:.1f}h | delta {delta_h:+.1f}h | off on {len(off_days)} days"
            )
            if delta_h > 5:
                overworked.append(f"{nurse_name} ({delta_h:+.1f}h)")
            elif delta_h < -5:
                underworked.append(f"{nurse_name} ({delta_h:+.1f}h)")

        total_target_hours = sum(
            float(s.get("targetHours", 37.5 * num_weeks))
            for s in nurse_stats_map.values()
        ) if nurse_stats_map else len(request.schedule) * 37.5 * num_weeks

        # Coverage snapshot lines
        snapshot = request.coverageSnapshot or {}
        coverage_pct = snapshot.get("coveragePct", None)
        off_respect_pct = snapshot.get("offRequestRespectPct", None)
        avg_delta = snapshot.get("avgAbsoluteHourDelta", None)

        coverage_lines = []
        if coverage_pct is not None:
            coverage_lines.append(f"- Coverage: {coverage_pct:.1f}% of days fully staffed")
        if off_respect_pct is not None:
            coverage_lines.append(f"- Off-request respect: {off_respect_pct:.1f}%")
        if avg_delta is not None:
            coverage_lines.append(f"- Average absolute hour delta per nurse: {avg_delta:.1f}h")

        org_context_line = f"\nOrganization context: {request.orgContext}" if request.orgContext else ""

        # Build staff requirements / notes section
        staff_notes_lines = []
        if request.staffNotes:
            for nurse_name, notes in request.staffNotes.items():
                for note in notes:
                    staff_notes_lines.append(f"- {nurse_name}: {note}")

        staff_notes_section = ""
        if staff_notes_lines:
            staff_notes_section = f"""\n\nSTAFF REQUIREMENTS & LEAVE (approved absences — do NOT flag these nurses as underworked):
{chr(10).join(staff_notes_lines)}"""

        marker_comments_section = ""
        if request.markerComments:
            marker_comments_section = f"""\n\nDETECTED MARKER COMMENTS (employee notes from the OCR schedule — * markers):
{request.markerComments}"""

        insights_prompt = f"""You are an expert nurse scheduling analyst. Analyze the following optimized nurse schedule and return a structured JSON report.{org_context_line}

SCHEDULE PERIOD: {date_range_str} ({total_days} days, {num_weeks:.1f} weeks)

WORKFORCE SUMMARY ({len(request.schedule)} nurses):
{chr(10).join(nurse_lines)}

Total scheduled hours: {total_scheduled_hours:.1f}h / target {total_target_hours:.1f}h  (overall delta: {total_scheduled_hours - total_target_hours:+.1f}h)
Overworked nurses (>+5h): {", ".join(overworked) if overworked else "None"}
Underworked nurses (<-5h): {", ".join(underworked) if underworked else "None"}{staff_notes_section}{marker_comments_section}

QUALITY METRICS:
{chr(10).join(coverage_lines) if coverage_lines else "- No coverage metrics provided"}

Return ONLY a valid JSON object (no markdown, no extra text) with the following structure:
{{
  "summary": "2-3 sentence overall assessment of the schedule",
  "score": 85,
  "issues": [
    {{"severity": "error|warning|info", "title": "Short title", "description": "Concise description with specific nurse names or dates"}}
  ],
  "suggestions": [
    {{"category": "staffing|fairness|coverage|compliance|worklife", "text": "Actionable suggestion with specific steps"}}
  ]
}}

Rules:
- "score" is 0-100 reflecting overall schedule quality
- "issues": list 3-6 most important issues found; use "error" for critical problems, "warning" for moderate, "info" for minor observations
- "suggestions": list 3-5 specific, actionable improvements
- Be specific: name nurses with notable deltas, cite exact coverage gaps if present
- Keep each description under 80 words
- CRITICAL: Do NOT flag nurses who have approved off-requests, vacation (CF codes), formation days, or other approved leave as "underworked". Their reduced hours are expected and already accounted for in their adjusted targets. Only flag genuinely unbalanced schedules.
- Night-shift wrap-around tails (marked with ↩) are 0h on purpose — the hours are counted on the start day. Do not treat these as missing shifts.
- Consider marker comments (employee notes) when assessing schedule quality — they provide context about special arrangements.
"""

        response = ScheduleOptimizer.call_openai_with_retry(
            messages=[
                {"role": "system", "content": "You are a nurse scheduling analyst. Return only valid JSON."},
                {"role": "user", "content": insights_prompt},
            ],
            model="gpt-4.1-mini",
            max_tokens=1200,
        )

        raw = response.choices[0].message.content
        logger.info(f"Insights raw AI response: {raw[:500]}")

        try:
            insights = ScheduleOptimizer.parse_ai_response(raw)
        except Exception:
            insights = {
                "summary": raw[:400] if raw else "Could not parse AI response.",
                "score": None,
                "issues": [],
                "suggestions": [],
            }

        # ── Deterministic score calculation (overrides AI score) ────────
        # We compute a weighted score based on actual metrics, not AI guesswork.
        # Components:
        #   - Coverage (40%): % of days with adequate staffing
        #   - Fairness (30%): How close nurses are to their target hours
        #   - Off-request respect (20%): % of off-requests honored
        #   - Balance (10%): Spread of overworked vs underworked
        deterministic_score = 100.0
        score_breakdown = {}

        # 1. Coverage component (40 points max)
        if coverage_pct is not None:
            coverage_score = min(40.0, coverage_pct * 0.4)
            score_breakdown["coverage"] = round(coverage_score, 1)
            deterministic_score = deterministic_score - 40 + coverage_score
        
        # 2. Fairness component (30 points max) - based on average absolute delta
        if avg_delta is not None:
            # Perfect: avg_delta = 0 -> 30 points
            # Acceptable: avg_delta <= 5h -> ~25 points  
            # Poor: avg_delta > 15h -> ~10 points
            fairness_score = max(0, 30.0 - (avg_delta * 2))
            fairness_score = min(30.0, fairness_score)
            score_breakdown["fairness"] = round(fairness_score, 1)
            deterministic_score = deterministic_score - 30 + fairness_score
        
        # 3. Off-request respect (20 points max)
        if off_respect_pct is not None:
            off_score = min(20.0, off_respect_pct * 0.2)
            score_breakdown["offRequests"] = round(off_score, 1)
            deterministic_score = deterministic_score - 20 + off_score
        
        # 4. Balance component (10 points max) - penalize if many overworked/underworked
        total_nurses = len(request.schedule)
        if total_nurses > 0:
            imbalanced_ratio = (len(overworked) + len(underworked)) / total_nurses
            balance_score = max(0, 10.0 - (imbalanced_ratio * 20))
            score_breakdown["balance"] = round(balance_score, 1)
            deterministic_score = deterministic_score - 10 + balance_score

        deterministic_score = max(0, min(100, round(deterministic_score)))
        
        # Override AI score with deterministic calculation
        ai_score = insights.get("score")
        insights["score"] = deterministic_score
        insights["scoreBreakdown"] = score_breakdown
        if ai_score is not None:
            insights["aiSuggestedScore"] = ai_score  # Keep for reference
            logger.info(f"Score override: AI suggested {ai_score}, deterministic calculation = {deterministic_score}")
        
        logger.info(f"Deterministic score: {deterministic_score} (breakdown: {score_breakdown})")

        # ── Deterministic gap-fill suggestions ──────────────────────────
        # For each date, compute staffing coverage and find underworked
        # nurses who are available (not already scheduled) to fill gaps.
        SHIFT_CODE_MAP = {
            "07":  {"start": "07:00", "end": "15:15", "hours": 7.5,   "type": "day"},
            "Z07": {"start": "07:00", "end": "19:25", "hours": 11.25, "type": "day"},
            "11":  {"start": "11:00", "end": "19:15", "hours": 7.5,   "type": "day"},
            "Z11": {"start": "11:00", "end": "23:25", "hours": 11.25, "type": "day"},
            "E15": {"start": "15:00", "end": "23:15", "hours": 7.5,   "type": "day"},
            "23":  {"start": "23:00", "end": "07:15", "hours": 7.5,   "type": "night"},
            "Z19": {"start": "19:00", "end": "07:25", "hours": 11.25, "type": "night"},
            "Z23": {"start": "23:00", "end": "11:25", "hours": 11.25, "type": "night"},
        }

        gap_fill_suggestions = []
        try:
            # Build per-nurse, per-date lookup: which dates is each nurse working?
            nurse_dates: dict[str, set[str]] = {}
            for nurse_name, shifts in request.schedule.items():
                worked = set()
                for s in shifts:
                    code = (s.get("shift") or "").strip().upper()
                    if code and code not in ("", "OFF", "C") and not code.startswith("CF") and not code.startswith("JF") and not code.startswith("FE") and not code.startswith("MA"):
                        if s.get("date"):
                            worked.add(s["date"])
                nurse_dates[nurse_name] = worked

            # Per-date headcount
            date_headcount: dict[str, int] = {}
            for d in request.dates:
                count = 0
                for nurse_name, worked in nurse_dates.items():
                    if d in worked:
                        count += 1
                date_headcount[d] = count

            # Find dates with low staffing (below average)
            if date_headcount:
                avg_staff = sum(date_headcount.values()) / len(date_headcount)
                understaffed_dates = sorted(
                    [(d, c) for d, c in date_headcount.items() if c < avg_staff * 0.85],
                    key=lambda x: x[1],
                )
            else:
                understaffed_dates = []

            # Rank nurses by delta (most underworked first = most available capacity)
            ranked_nurses = []
            for stat in (request.nurseHoursStats or []):
                name = stat.get("name", "")
                delta = float(stat.get("delta", 0))
                target = float(stat.get("targetHours", 0))
                total = float(stat.get("totalHours", 0))
                emp = stat.get("employmentType", "FT")
                if delta < 0:  # Only suggest nurses who are below target
                    ranked_nurses.append({
                        "name": name,
                        "delta": round(delta, 1),
                        "totalHours": round(total, 1),
                        "targetHours": round(target, 1),
                        "employmentType": emp,
                    })
            ranked_nurses.sort(key=lambda n: n["delta"])  # most underworked first

            # Generate gap-fill suggestions: match understaffed dates with available nurses
            used_nurse_dates: dict[str, set[str]] = {}  # track suggestions to avoid double-booking
            for date, headcount in understaffed_dates[:10]:  # limit to top 10 gaps
                for nurse in ranked_nurses:
                    nurse_name = nurse["name"]
                    if nurse_name not in used_nurse_dates:
                        used_nurse_dates[nurse_name] = set(nurse_dates.get(nurse_name, set()))

                    # Skip if nurse already works this date
                    if date in used_nurse_dates[nurse_name]:
                        continue

                    # Check nurse doesn't work day before AND after (avoid 3+ consecutive)
                    from datetime import datetime, timedelta
                    try:
                        dt = datetime.strptime(date, "%Y-%m-%d")
                        prev_day = (dt - timedelta(days=1)).strftime("%Y-%m-%d")
                        next_day = (dt + timedelta(days=1)).strftime("%Y-%m-%d")
                        if prev_day in used_nurse_dates[nurse_name] and next_day in used_nurse_dates[nurse_name]:
                            continue
                    except ValueError:
                        pass

                    # Recommend shift code: pick a standard 8h day shift if delta is small, 12h if large
                    hours_needed = abs(nurse["delta"])
                    if hours_needed >= 11:
                        recommended_code = "Z07"
                        recommended_hours = 11.25
                    elif hours_needed >= 7:
                        recommended_code = "07"
                        recommended_hours = 7.5
                    else:
                        recommended_code = "07"
                        recommended_hours = 7.5

                    code_info = SHIFT_CODE_MAP.get(recommended_code, {})

                    gap_fill_suggestions.append({
                        "date": date,
                        "nurse": nurse_name,
                        "shiftCode": recommended_code,
                        "shiftStart": code_info.get("start", ""),
                        "shiftEnd": code_info.get("end", ""),
                        "shiftHours": recommended_hours,
                        "shiftType": code_info.get("type", "day"),
                        "currentHeadcount": headcount,
                        "averageHeadcount": round(avg_staff, 1),
                        "nurseDelta": nurse["delta"],
                        "nurseCurrentHours": nurse["totalHours"],
                        "nurseTargetHours": nurse["targetHours"],
                        "nurseEmploymentType": nurse["employmentType"],
                        "priority": "high" if headcount <= avg_staff * 0.7 else "medium",
                    })

                    used_nurse_dates[nurse_name].add(date)
                    break  # One suggestion per understaffed date

            logger.info(f"Generated {len(gap_fill_suggestions)} gap-fill suggestions")
        except Exception as gf_err:
            logger.warning(f"Gap-fill analysis failed (non-fatal): {gf_err}")

        insights["gapFillSuggestions"] = gap_fill_suggestions
        return insights

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating schedule insights: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate insights: {str(e)}")
