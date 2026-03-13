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

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import UUID4
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
from app.schemas.optimized_schedule import OptimizeRequest, OptimizeResponse, RefineRequest, InsightsRequest
from app.api.routes.system_prompts import get_system_prompt, DEFAULT_PROMPT_CONTENT
from app.services.deletion_activity import record_deletion_activity

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
        query = query.filter(
            or_(
                OptimizedSchedule.organization_id == auth.organization_id,
                OptimizedSchedule.organization_id.is_(None),
            )
        )

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
    """Fetch a schedule for mutation and preserve 403 semantics for other-org rows."""
    schedule = db.query(OptimizedSchedule).filter(OptimizedSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if auth.is_authenticated and auth.organization_id and schedule.organization_id not in [None, auth.organization_id]:
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
                 max_consecutive: int = 3, preferences: Dict = None):
        # Initialize shift code rotation indices
        self._day_code_index = 0
        self._night_code_index = 0
        # Track consecutive nights per nurse for B suffix (Z23, Z23 B, Z23 B pattern)
        self._nurse_consecutive_nights: Dict[str, int] = {}
        
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
        self.day_shift_codes = day_shift_codes if day_shift_codes else ["ZD12-", "Z07", "D8-"]
        self.night_shift_codes = night_shift_codes if night_shift_codes else ["ZN-", "Z19", "Z23"]
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
        """Check if nurse has reached their hours limit for the week containing this date"""
        max_hours = self.get_max_hours(nurse_name)
        week_key = self.date_to_week.get(date, "unknown")
        current_hours = self.nurse_weekly_hours.get(nurse_name, {}).get(week_key, 0)
        return current_hours >= max_hours
    
    def get_remaining_hours(self, nurse_name: str, date: str) -> float:
        """Get remaining hours a nurse can work in the week containing this date"""
        max_hours = self.get_max_hours(nurse_name)
        week_key = self.date_to_week.get(date, "unknown")
        current_hours = self.nurse_weekly_hours.get(nurse_name, {}).get(week_key, 0)
        return max(0, max_hours - current_hours)

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

    def get_period_target_hours(self, nurse_name: str, period_key: str) -> float:
        """Target hours for one period, scaled by period length and reduced for explicit off requests."""
        period_dates = self.period_to_dates.get(period_key, [])
        total_days = len(period_dates)
        if total_days <= 0:
            return 0.0

        base_target = self.get_target_biweekly_hours(nurse_name) * (total_days / 14.0)

        off_requests = self.get_off_requests(nurse_name)
        off_days_in_period = sum(1 for d in period_dates if d in off_requests)
        available_days = max(0, total_days - off_days_in_period)
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
        """FT soft policy: at least one worked weekend per 14-day period."""
        if not self._is_full_time(nurse_name):
            return False
        period_key = self.date_to_period.get(date, "unknown")
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

        # Allow only slight flexibility above average to absorb vacations/off requests
        # without creating large spikes. Keeps daily totals closer to expected average
        # (e.g., around 12 staff/day when that is the period mean).
        max_extra_envelope = max(1, avg_extra_needed + 1)
        envelope_cap = min_required + max_extra_envelope

        # Additional guardrail: do not exceed rounded average by more than 1 headcount.
        average_anchor_cap = max(min_required, int(round(avg_daily_staff_target)) + 1)

        cap = min(cap, envelope_cap, average_anchor_cap)
        return max(min_required, min(len(self.nurse_names), cap))

    def get_week_total_scheduled_hours(self, date: str) -> float:
        week_key = self.date_to_week.get(date, "unknown")
        return sum(self.nurse_weekly_hours.get(n, {}).get(week_key, 0) for n in self.nurse_names)

    def get_week_total_target_hours(self) -> float:
        return sum(self.get_target_weekly_hours(n) for n in self.nurse_names)
        
    def can_work(self, nurse_name: str, date: str, is_night: bool = False, hours: int = 12) -> bool:
        """Check if a nurse can work on a given date"""
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
        
        # Check consecutive days (with some flexibility)
        if self.nurse_consecutive[nurse_name] >= self.max_consecutive:
            return False
        
        return True
        
    def assign_shift(self, nurse_name: str, date: str, shift_type: str, hours: int = 12) -> Dict:
        """Create a shift assignment - uses variety of shift codes by rotating through available codes"""
        # Rotate through available shift codes for variety
        if shift_type == "day":
            if hours == 8:
                shift_code = "D8-"
            else:
                # Rotate through day shift codes
                shift_code = self.day_shift_codes[self._day_code_index % len(self.day_shift_codes)]
                self._day_code_index += 1
            # Reset consecutive nights counter for day shifts
            self._nurse_consecutive_nights[nurse_name] = 0
        elif shift_type == "night":
            if hours == 8:
                shift_code = "N8-"
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
                    # Rotate through other night shift codes
                    shift_code = self.night_shift_codes[self._night_code_index % len(self.night_shift_codes)]
                    self._night_code_index += 1
                
                # Increment consecutive nights counter
                self._nurse_consecutive_nights[nurse_name] = consecutive_nights + 1
        elif shift_type == "day_8h":
            shift_code = "D8-"
            shift_type = "day"
            hours = 8
            # Reset consecutive nights counter
            self._nurse_consecutive_nights[nurse_name] = 0
        elif shift_type == "night_8h":
            shift_code = "N8-"
            shift_type = "night"
            hours = 8
            # Reset consecutive nights counter
            self._nurse_consecutive_nights[nurse_name] = 0
        else:
            shift_code = ""
        
        # CRITICAL: Final safety check - NEVER allow CF codes
        if shift_code.upper().startswith("CF") or "CF-" in shift_code.upper():
            logger.error(f"BLOCKED CF CODE in assign_shift: {shift_code} - using default")
            shift_code = "ZD12-" if shift_type == "day" else "ZN-"
            
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
    
    def assign_off(self, nurse_name: str, date: str) -> Dict:
        """Create an off day assignment"""
        return {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": "",
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
                    # BLOCK all invalid codes
                    if (shift_upper.startswith("CF") or 
                        shift_upper.startswith("C-") or
                        shift_upper in ["C", "OFF", ""] or
                        "CF-" in shift_upper):
                        logger.debug(f"  Filtered CF/OFF code: {shift} for {nurse_name}")
                        return ""  # Treat as no preference
                return shift
        return ""
    
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
                
                shift_upper = ocr_shift.upper().strip()
                
                # Check for explicit OFF codes (NOT '*')
                # Handle CF variations: CF, CF-, CF 01, CF-01, C, OFF
                is_off_code = (shift_upper in ["C", "OFF"] or 
                              shift_upper.startswith("CF") or
                              shift_upper.startswith("CF-") or
                              "CF " in shift_upper)
                
                if is_off_code:
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date))
                    nurse_consecutive_count[nurse_name] = 0
                    logger.debug(f"  {nurse_name} {date}: OFF (code: {ocr_shift})")
                elif shift_upper == "*":
                    # '*' is a MARKER (has comment)
                    # Already checked offRequests above, so this is a workable day
                    self.schedule[nurse_name].append(None)  # Will fill
                    logger.debug(f"  {nurse_name} {date}: MARKER (*) - will fill")
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
                    # Preserve OCR baseline nurses as authored.
                    # We should not auto-fill their blank days.
                    if self._nurse_has_ocr_baseline(nurse_name):
                        continue

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
            
            # Fill day shifts if needed
            while day_count < self.day_req and available_nurses:
                nurse = available_nurses.pop(0)
                nurses_for_day.append(nurse)
                day_count += 1
            
            # Fill night shifts if needed
            while night_count < self.night_req and available_nurses:
                nurse = available_nurses.pop(0)
                nurses_for_night.append(nurse)
                night_count += 1

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
                    nurse = relaxed_pool.pop(0)
                    nurses_for_day.append(nurse)
                    already_assigned.add(nurse)
                    day_count += 1

                while night_count < self.night_req and relaxed_pool:
                    nurse = relaxed_pool.pop(0)
                    nurses_for_night.append(nurse)
                    already_assigned.add(nurse)
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
                    nurse = emergency_pool.pop(0)
                    nurses_for_day.append(nurse)
                    already_assigned.add(nurse)
                    day_count += 1

                while night_count < self.night_req and emergency_pool:
                    nurse = emergency_pool.pop(0)
                    nurses_for_night.append(nurse)
                    already_assigned.add(nurse)
                    night_count += 1

            # OPTIONAL EXTRA COVERAGE: assign additional shifts to nurses who are
            # still under target hours, while preserving minimum requirements.
            # This prevents schedules from stopping at the absolute minimum only.
            extra_assignments: Dict[str, Tuple[str, int]] = {}
            period_total_scheduled = self.get_period_total_scheduled_hours(date)
            period_key = self.date_to_period.get(date, "unknown")
            period_total_target = self.get_period_total_target_hours(period_key)
            for nurse in list(available_nurses):
                # Never add optional shifts once period target volume is reached.
                if period_total_scheduled >= period_total_target:
                    break

                # Avoid daily front-loading spikes; keep day totals near cap.
                if (day_count + night_count) >= daily_staff_cap:
                    break

                target_remaining = self.get_target_remaining_hours(nurse, date)
                if target_remaining < 8:
                    continue

                remaining_hours = self.get_remaining_hours(nurse, date)
                if remaining_hours < 8:
                    continue

                # Prefer 12h where possible, otherwise use 8h to progress toward target.
                candidate_hours = 12 if (remaining_hours >= 12 and target_remaining >= 12) else 8

                # Keep day/night distribution reasonably balanced relative to minimums.
                day_ratio = day_count / max(self.day_req, 1)
                night_ratio = night_count / max(self.night_req, 1)
                prefer_night = night_ratio < day_ratio

                chosen_shift = None
                if prefer_night and self.can_work(nurse, date, is_night=True, hours=candidate_hours):
                    chosen_shift = "night"
                    night_count += 1
                elif self.can_work(nurse, date, is_night=False, hours=candidate_hours):
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

                    candidate = max(
                        non_ocr_pool,
                        key=lambda n: (
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

        self._validate_schedule()
        return self.schedule
    
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
            if "B" in code_upper:
                return {"type": "night", "hours": 7.5, "start": "23:00", "end": "07:00"}
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
    def optimize_schedule_with_ortools(assignments, constraints):
        """
        Main scheduling method - uses RobustScheduler which GUARANTEES full coverage.
        OR-Tools is no longer used as it was too unreliable.
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
            "Z23": {"hours": 7.5, "startTime": "23:00", "endTime": "07:25", "type": "night"},
            "Z23 B": {"hours": 7.5, "startTime": "23:00", "endTime": "07:25", "type": "night"},
        }
        
        # Merge with AI-parsed shiftsInfo (defaults take precedence for missing codes)
        for code, meta in DEFAULT_SHIFTS.items():
            if code not in shifts_info:
                shifts_info[code] = meta
        
        # Update constraints with complete shiftsInfo
        constraints["shiftsInfo"] = shifts_info
        
        logging.info(f"Shift codes available: {list(shifts_info.keys())}")
        
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
            preferences=assignments  # OCR preferences
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
                if "B" in code_u:
                    return {"shiftType": "night", "hours": 7.5, "startTime": "23:00", "endTime": "07:00"}
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

        # CRITICAL: Staffing requirements per day - HARD CONSTRAINTS (no slack)
        # Every day MUST have minimum coverage
        for d in range(num_days):
            # Day shift - MUST have at least day_req nurses
            day_sum = sum(shifts[(n, d, s)] for n in range(num_nurses) for s, sc in enumerate(all_shift_codes) if sc in day_shift_codes)
            model.Add(day_sum >= day_req)
            
            # Night shift - MUST have at least night_req nurses  
            night_sum = sum(shifts[(n, d, s)] for n in range(num_nurses) for s, sc in enumerate(all_shift_codes) if sc in night_shift_codes)
            model.Add(night_sum >= night_req)
            
            logging.debug(f"Day {d} ({date_list[d]}): requiring >= {day_req} day staff, >= {night_req} night staff")
            
        logging.info(f"Added HARD staffing constraints: {day_req} day nurses, {night_req} night nurses per day")

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

        # IMPORTANT: Treat OCR assignments as PREFERENCES (soft constraints), not hard constraints!
        # The OCR data shows what nurses PREFER, but ALL nurses can be assigned to ANY shift
        # We will add a bonus to the objective function for honoring preferences
        preference_bonus = []
        total_preferences = 0
        skipped_codes = set()
        
        for nurse_name, shift_list in assignments.items():
            normalized_name = normalize_name(nurse_name)
            n = nurse_name_to_idx.get(normalized_name) or nurse_name_to_idx.get(nurse_name)
            if n is None:
                logging.warning(f"Nurse '{nurse_name}' (normalized: '{normalized_name}') not found in nurse list, skipping")
                continue
            for d, shift_code in enumerate(shift_list):
                if d >= num_days:
                    continue
                # Skip empty, OFF, or invalid codes
                if not shift_code or shift_code.upper() in ["", "OFF", "C"]:
                    continue
                if shift_code not in all_shift_codes:
                    skipped_codes.add(shift_code)
                    continue
                    
                s = all_shift_codes.index(shift_code)
                # Add this as a PREFERENCE (bonus in objective), not a hard constraint
                preference_bonus.append(shifts[(n, d, s)])
                total_preferences += 1
        
        if skipped_codes:
            logging.warning(f"Skipped unknown shift codes in assignments: {skipped_codes}")
        logging.info(f"Added {total_preferences} nurse preferences as soft constraints (bonuses)")

        # Objective: MAXIMIZE coverage + honor preferences
        # Primary goal: Fill ALL shifts (weight: 100 per shift)
        # Secondary goal: Honor nurse preferences (weight: 10 per preference)
        coverage_score = sum(
            100 * shifts[(n, d, s)]
            for n in range(num_nurses)
            for d in range(num_days)
            for s in range(len(all_shift_codes))
        )
        
        # Add preference bonus (weight each preference match at 10 points)
        preference_score = sum(10 * pref for pref in preference_bonus) if preference_bonus else 0
        
        # Combined objective
        model.Maximize(coverage_score + preference_score)
        logging.info(f"Objective: maximize coverage (weight 100) + preferences (weight 10, {len(preference_bonus)} prefs)")

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
        return result
    
    @staticmethod
    def patch_coverage_gaps(result, date_list, nurses, shifts_info, day_shift_codes, night_shift_codes, day_req, night_req):
        """
        POST-PROCESSING: Patches any days that don't have enough coverage.
        This is the LAST LINE OF DEFENSE - ensures no empty days EVER.
        """
        logging.info("PATCHING COVERAGE GAPS...")
        
        for d_idx, date in enumerate(date_list):
            # Count current coverage
            day_count = 0
            night_count = 0
            off_nurses = []
            
            for nurse in nurses:
                name = nurse["name"]
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
                    continue
                
                logger.info(f"    Matched nurse: '{nurse_suggested}' -> '{nurse_key}'")
                
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
        else:
            logger.warning("No 'changes' array found in AI suggestions")
        
        logger.info(f"Successfully applied {len(changes_applied)} changes to schedule")
        
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
            "message": "AI refinement applied successfully.",
            "raw_ai_response": raw_ai_response
        }
    
    except Exception as e:
        logger.error(f"Error refining schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to refine schedule: {str(e)}")

@router.post("/optimize-with-constraints")
async def optimize_with_constraints(
    constraints: Dict[str, Any],
    assignments: Optional[Dict[str, List[str]]] = None,
    nurses: Optional[List[Dict[str, Any]]] = None,  # ADD nurses parameter
    schedule_id: Optional[str] = None,
    save_to_db: bool = False,  # NEW: Only save to DB if explicitly requested
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """
    Optimize schedule using pre-confirmed constraints.
    This is called after user reviews and edits constraints from /preview.
    """
    try:
        logger.info("=" * 80)
        logger.info("OPTIMIZE WITH CONFIRMED CONSTRAINTS")
        logger.info("=" * 80)
        
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
        
        schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
            assignments=assignments or {},
            constraints=constraints,
        )
        
        # Only save to DB if explicitly requested (e.g., on finalize)
        response_data = {"optimized_schedule": schedule}
        
        if save_to_db:
            # Get organization_id from auth context
            org_id = auth.organization_id if auth.is_authenticated else None

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
        logger.info("="  * 80)
        logger.info("OPTIMIZE ENDPOINT CALLED")
        logger.info("=" * 80)
        logger.info(f"Schedule ID: {req.schedule_id}")
        logger.info(f"Organization ID: {auth.organization_id if auth.is_authenticated else 'N/A'}")
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
        schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
            assignments=req.assignments or {},
            constraints=constraints,
        )
        
        # Skip AI refinement - RobustScheduler already produces a complete schedule
        # The old AI refinement was unreliable and often broke the schedule

        # Get organization_id from auth context
        org_id = auth.organization_id if auth.is_authenticated else None

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
    query = db.query(OptimizedSchedule)
    
    # Filter by organization if authenticated.
    # Include legacy rows with NULL organization_id to avoid hiding old schedules
    # created before multitenancy was introduced.
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(
            or_(
                OptimizedSchedule.organization_id == auth.organization_id,
                OptimizedSchedule.organization_id.is_(None),
            )
        )
    
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
    """Create an initial draft schedule so it appears immediately in Schedule Management and dashboard counts."""
    try:
        org_id = auth.organization_id if auth.is_authenticated else None

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
    """Save a draft schedule and immediately finalize it"""
    try:
        # Get organization_id from auth context
        org_id = auth.organization_id if auth.is_authenticated else None

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

        insights_prompt = f"""You are an expert nurse scheduling analyst. Analyze the following optimized nurse schedule and return a structured JSON report.{org_context_line}

SCHEDULE PERIOD: {date_range_str} ({total_days} days, {num_weeks:.1f} weeks)

WORKFORCE SUMMARY ({len(request.schedule)} nurses):
{chr(10).join(nurse_lines)}

Total scheduled hours: {total_scheduled_hours:.1f}h / target {total_target_hours:.1f}h  (overall delta: {total_scheduled_hours - total_target_hours:+.1f}h)
Overworked nurses (>+5h): {", ".join(overworked) if overworked else "None"}
Underworked nurses (<-5h): {", ".join(underworked) if underworked else "None"}

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

        return insights

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating schedule insights: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate insights: {str(e)}")
