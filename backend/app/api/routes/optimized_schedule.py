# /backend/app/api/routes/optimized_schedule.py
import uuid
import re
import json
import ast
import logging
import difflib
import unicodedata
import time as _time
import traceback
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

# ============================================================================
# MCH CONTRACT CONSTANTS
# ============================================================================
# FT nurses at MCH have a 75h bi-weekly contract fulfilled by 7 shifts.
# The "contract value" of each 12h (Z-code) shift is 75/7 = 10.7143h.
# The "clinical value" (actual paid hours) is 11.25h per 12h shift.
# The optimizer uses contract_hours for target tracking so that
# 7 × 10.714h = 75h exactly (delta = 0), while schedule display
# still shows the clinical 11.25h paid.
MCH_FT_BIWEEKLY_TARGET = 75.0
MCH_FT_SHIFT_COUNT = 7              # Exactly 7 shifts per 14-day block
MCH_FT_MIN_Z_SHIFTS = 5             # At least 5 of the 7 must be 12h (Z-code)
MCH_FT_MAX_SHIFTS_PER_PERIOD = 8    # Hard OT threshold: 8th shift = overtime
MCH_Z_SHIFT_CONTRACT_VALUE = 10.7143  # 75 / 7 = contract hours per Z-shift
MCH_Z_SHIFT_CLINICAL_VALUE = 11.25    # Actual paid hours per Z-shift
MCH_8H_SHIFT_VALUE = 7.5              # Paid hours per 8h shift
# Delta tolerance: FT nurse with 7×12h = 78.75 clinical, but contract = 75.
# Anything between 75 and 78.75 is "at target" (delta clamped to 0).
MCH_FT_DELTA_UPPER_TOLERANCE = 78.75
MCH_FT_DELTA_LOWER_TOLERANCE = 75.0

# Complete shift codes lookup with all properties (actual codes used on schedules)
# MCH NIGHT ROTATION MODEL (bridge/tail):
#   Z19(12h night start) → Z23 B(bridge) → ... → Z23(tail)
#
# Z19   = Start of night rotation (19:00→07:25 next day). 11.25h paid.
# Z23 B = BRIDGE ("Bascule"): finish morning (00:00→07:25) AND return
#         evening (19:00→07:25 next day). 11.25h paid. The nurse works
#         TWO blocks in one calendar day.
# Z23   = TAIL: finish morning only (00:00→07:25). 0h — hours already
#         counted in the previous Z19 or Z23 B.
#
# Examples:
#   1 night:  Z19(N) → Z23(N+1, 0h tail)
#   2 nights: Z19(N) → Z23 B(N+1, 11.25h) → Z23(N+2, 0h tail)
#   3 nights: Z19(N) → Z23 B(N+1) → Z23 B(N+2) → Z23(N+3, 0h tail)
#
# DEDUPLICATION RULE:
# - Z23 (no B) → Z23 on next day = ghost (deduplicate second one)
# - Z23 B → Z23 on next day = REAL back-to-back shifts (do NOT deduplicate)
#
# PAID HOURS: All hours below are actual paid time (clock time minus breaks).
# - 12h shifts: 11.25h paid (12h minus 0.75h unpaid meal break)
# - 8h shifts: 7.5h paid (8h minus 0.5h unpaid break)
#
# contract_hours: Used by FT target calculation only.
#   For FT: Z-shifts count as 10.714h toward 75h target (7 shifts = 75h).
#   For PT: Same as clinical hours (11.25h / 7.5h).
SHIFT_CODES = {
    # 8h Shifts (7.5h paid, 7.5h contract)
    "07": {"label": "Day 8hr", "type": "day", "hours": 7.5, "contract_hours": 7.5, "start": "07:00", "end": "15:15"},
    "11": {"label": "Mid 8hr", "type": "day", "hours": 7.5, "contract_hours": 7.5, "start": "11:00", "end": "19:15"},
    "E15": {"label": "Evening 8hr", "type": "day", "hours": 7.5, "contract_hours": 7.5, "start": "15:00", "end": "23:15"},
    "23": {"label": "Night 8hr", "type": "night", "hours": 7.5, "contract_hours": 7.5, "start": "23:00", "end": "07:15"},
    # 12h Day Shifts (11.25h paid: 12h minus 0.75h meal break)
    "Z07": {"label": "Day 12hr", "type": "day", "hours": 11.25, "contract_hours": MCH_Z_SHIFT_CONTRACT_VALUE, "start": "07:00", "end": "19:25"},
    "Z11": {"label": "Mid 12hr", "type": "day", "hours": 11.25, "contract_hours": MCH_Z_SHIFT_CONTRACT_VALUE, "start": "11:00", "end": "23:25"},
    # Night shift components (MCH bridge/tail system)
    # Z19   = Night rotation start (19:00→07:25 next day)  — 11.25h paid (merged 12h night)
    # Z23 B = BRIDGE: morning finish + evening return       — 11.25h paid
    # Z23   = TAIL: morning finish only (end of rotation)   — 0h (hours in previous shift)
    # Context-dependent hours: Z19 always 11.25h, Z23 B always 11.25h, Z23 = 0h when after night shift
    "Z19": {"label": "Night Start", "type": "night", "hours": 11.25, "contract_hours": MCH_Z_SHIFT_CONTRACT_VALUE, "start": "19:00", "end": "07:25"},
    "Z23": {"label": "Night Tail", "type": "night", "hours": 0.0, "contract_hours": 0.0, "start": "00:00", "end": "07:25"},
    "Z23 B": {"label": "Night Bridge", "type": "night", "hours": 11.25, "contract_hours": MCH_Z_SHIFT_CONTRACT_VALUE, "start": "00:00", "end": "07:25"},
    "OFF": {"label": "Off", "type": "off", "hours": 0, "contract_hours": 0, "start": "", "end": ""},
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


def _extract_schedule_actor(result_data: Any, schedule_data: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """Extract creator identity from schedule payloads (top-level first, then nested)."""
    result_obj = result_data if isinstance(result_data, dict) else {}
    schedule_obj = schedule_data if isinstance(schedule_data, dict) else {}

    created_by = (
        result_obj.get("created_by")
        or result_obj.get("createdBy")
        or schedule_obj.get("created_by")
        or schedule_obj.get("createdBy")
    )
    created_by_name = (
        result_obj.get("created_by_name")
        or result_obj.get("createdByName")
        or schedule_obj.get("created_by_name")
        or schedule_obj.get("createdByName")
    )

    return (
        str(created_by) if created_by else None,
        str(created_by_name) if created_by_name else None,
    )


def _with_actor_metadata(payload: Any, auth: AuthContext) -> Dict[str, Any]:
    """Return a schedule payload enriched with actor metadata."""
    payload_obj = payload if isinstance(payload, dict) else {}
    enriched = {**payload_obj}

    if auth.is_authenticated and auth.user_id:
        enriched["created_by"] = auth.user_id

    actor_name = (auth.user_name or auth.user_email or "").strip()
    if actor_name:
        enriched["created_by_name"] = actor_name

    return enriched


def _scoped_schedule_query(
    db: Session,
    auth: AuthContext,
    schedule_id: Optional[str] = None,
):
    """Build a schedule query scoped to the authenticated organization when present."""
    query = db.query(OptimizedSchedule)
    
    # Security check first - if no auth/organization, return empty query
    if not (auth.is_authenticated and auth.organization_id):
        # Return a query that will never match anything
        return query.filter(OptimizedSchedule.id.is_(None))
    
    # Apply organization filter for authenticated users
    query = query.filter(OptimizedSchedule.organization_id == auth.organization_id)
    
    # Apply schedule ID filter if provided
    if schedule_id:
        query = query.filter(OptimizedSchedule.id == schedule_id)

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
    
    @staticmethod
    def _fuzzy_name_match(name1: str, name2: str, threshold: float = 0.85) -> bool:
        """Check if two names are similar enough to be the same person.
        
        Uses simple character-level similarity. Returns True if names match
        with >= threshold similarity (default 85%).
        
        Examples:
            - "Tiffany Glodoviza" vs "Tiffany Glodovizay" -> 96% similar, matches
            - "Alexandra Zatylny" vs "Florent Vidal" -> very low, no match
        """
        n1 = name1.strip().lower()
        n2 = name2.strip().lower()
        
        if n1 == n2:
            return True
        
        # Simple character-based similarity (Jaccard on character bigrams)
        def bigrams(s):
            return set(s[i:i+2] for i in range(len(s) - 1)) if len(s) > 1 else {s}
        
        b1, b2 = bigrams(n1), bigrams(n2)
        if not b1 or not b2:
            return n1 == n2
        
        intersection = len(b1 & b2)
        union = len(b1 | b2)
        similarity = intersection / union if union > 0 else 0
        
        return similarity >= threshold
    
    @staticmethod
    def _find_matching_nurse(name: str, nurse_names: set) -> Optional[str]:
        """Find a matching nurse name using fuzzy matching.
        
        Returns the matching name from nurse_names if found, None otherwise.
        """
        name_lower = name.strip().lower()
        
        # Exact match first
        if name_lower in nurse_names:
            return name_lower
        
        # Fuzzy match
        for existing_name in nurse_names:
            if RobustScheduler._fuzzy_name_match(name_lower, existing_name):
                logger.info(f"  FUZZY MATCH: '{name}' -> '{existing_name}' (merging)")
                return existing_name
        
        return None
    
    def __init__(self, nurses: List[Dict], date_list: List[str], 
                 day_shift_codes: List[str], night_shift_codes: List[str],
                 shifts_info: Dict, day_req: int, night_req: int,
                 max_consecutive: int = 3, preferences: Dict = None,
                 nurse_defaults: Dict[str, Dict] = None):
        # Initialize shift code rotation indices
        self._day_code_index = 0
        self._night_code_index = 0
        # Track consecutive nights per nurse for realistic MCH pattern:
        # Night 1: Z19 Z23 B (19:00-07:25, coming back)
        # Night 2: Z19 Z23 B (19:00-07:25, coming back)  
        # Night 3: Z19 Z23   (19:00-07:25, final night)
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

        # ── DEDUPLICATE NURSES ARRAY ───────────────────────────────────
        # The frontend may send duplicate nurses with slightly different names
        # (e.g., "Tiffany Glodovizay" vs "Tiffany Glodoviza" due to OCR typos).
        # Merge these duplicates using fuzzy matching.
        logger.info(f"DEDUP CHECK: Input nurses array has {len(nurses)} nurses")
        for i, n in enumerate(nurses):
            logger.info(f"  DEDUP INPUT [{i}]: '{n.get('name', 'NO_NAME')}'")
        
        deduped_nurses = []
        seen_names: Dict[str, str] = {}  # lowercase normalized -> original name
        
        for nurse in nurses:
            nurse_name = nurse.get("name", "").strip()
            if not nurse_name:
                continue
            name_lower = nurse_name.lower()
            
            # Check if this name fuzzy-matches an already-seen name
            found_match = None
            for existing_lower, existing_original in seen_names.items():
                # Use static method call (class method, not instance method)
                similarity_result = RobustScheduler._fuzzy_name_match(name_lower, existing_lower)
                logger.debug(f"  FUZZY CHECK: '{name_lower}' vs '{existing_lower}' -> {similarity_result}")
                if similarity_result:
                    found_match = existing_original
                    break
            
            if found_match:
                # Duplicate detected - skip this nurse (use the first one seen)
                logger.warning(f"  DEDUP: Skipping '{nurse_name}' (fuzzy match with '{found_match}')")
            else:
                deduped_nurses.append(nurse)
                seen_names[name_lower] = nurse_name
        
        if len(deduped_nurses) != len(nurses):
            logger.info(f"  DEDUP: Removed {len(nurses) - len(deduped_nurses)} duplicate nurses")
        else:
            logger.info(f"  DEDUP: No duplicates found")
        nurses = deduped_nurses
        
        # CRITICAL FIX: Ensure all nurses from preferences are included in the nurses array.
        # This fixes the bug where nurses with empty OCR cells were excluded from scheduling
        # because they weren't being sent in the nurses array from the frontend.
        # 
        # ALSO: Use fuzzy name matching to prevent OCR typos from creating duplicate nurses.
        # E.g., "Tiffany Glodovizay" (OCR typo) should match "Tiffany Glodoviza" (DB name).
        self.nurse_defaults = nurse_defaults or {}
        nurse_names_in_array = {n.get("name", "").strip().lower() for n in nurses if n.get("name")}
        
        logger.info(f"PREFERENCES MERGE: Nurses array has {len(nurses)} nurses AFTER dedup")
        logger.info(f"  Names in array: {sorted(nurse_names_in_array)}")
        
        # Build a mapping from pref_name -> actual nurse name (for fuzzy matches)
        self._pref_name_to_actual: Dict[str, str] = {}
        
        if preferences:
            logger.info(f"  Preferences has {len(preferences)} keys: {sorted(preferences.keys())}")
            for pref_nurse_name in preferences.keys():
                pref_lower = pref_nurse_name.strip().lower()
                
                # Check for exact match first, then fuzzy match
                logger.info(f"  Checking preference name: '{pref_nurse_name}' (lower: '{pref_lower}')")
                
                # Direct check first
                if pref_lower in nurse_names_in_array:
                    logger.info(f"    EXACT MATCH: '{pref_lower}' found in nurses array")
                    self._pref_name_to_actual[pref_lower] = pref_lower
                    continue
                
                # Fuzzy match against each existing name
                found_fuzzy = None
                for existing_name in nurse_names_in_array:
                    is_match = RobustScheduler._fuzzy_name_match(pref_lower, existing_name)
                    if is_match:
                        logger.info(f"    FUZZY MATCH: '{pref_lower}' matches '{existing_name}'")
                        found_fuzzy = existing_name
                        break
                
                if found_fuzzy:
                    # Found a match (fuzzy) - map to existing nurse, DON'T add duplicate
                    self._pref_name_to_actual[pref_lower] = found_fuzzy
                    logger.info(f"    -> Mapping preference '{pref_nurse_name}' to existing nurse '{found_fuzzy}'")
                else:
                    # No match found - add as new nurse
                    # Look up nurse defaults from database config
                    db_defaults = self.nurse_defaults.get(pref_lower, {})
                    logger.warning(f"    NO MATCH: Adding missing nurse from preferences: {pref_nurse_name}")
                    
                    # Build nurse dict - only include fields we have from DB
                    nurse_entry = {
                        "name": pref_nurse_name,
                        "employmentType": db_defaults.get("employmentType", "full-time"),
                        "offRequests": db_defaults.get("offRequests", []),
                        "isChemoCertified": db_defaults.get("isChemoCertified", False),
                        "isTransplantCertified": db_defaults.get("isTransplantCertified", False),
                        "isRenalCertified": db_defaults.get("isRenalCertified", False),
                        "isChargeCertified": db_defaults.get("isChargeCertified", False),
                    }
                    # Only include bi-weekly target if we have it from DB
                    if "targetBiWeeklyHours" in db_defaults:
                        nurse_entry["targetBiWeeklyHours"] = db_defaults["targetBiWeeklyHours"]
                    
                    nurses.append(nurse_entry)
                    nurse_names_in_array.add(pref_lower)
                    self._pref_name_to_actual[pref_lower] = pref_lower
        
        logger.info(f"  After preferences merge: {len(nurses)} nurses total")

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
                    if shift_code and shift_code.strip() and shift_code.upper() not in ["C", "OFF"] and not (
                        shift_code.upper().startswith("CF") and not RobustScheduler._is_composite_cf_shift(shift_code)
                    ):
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
        # MCH 12h nights: Use separate Z19, Z23 B, Z23 codes (not merged)
        self.day_shift_codes = day_shift_codes if day_shift_codes else ["Z07", "07"]
        self.night_shift_codes = night_shift_codes if night_shift_codes else ["Z19", "Z23", "Z23 B", "23"]
        self.shifts_info = shifts_info
        self.reference_shift_hours = self._resolve_reference_shift_hours()
        self.day_req = max(day_req, 1)  # At least 1
        self.night_req = max(night_req, 1)  # At least 1
        self.max_consecutive = max_consecutive
        self.preferences = preferences or {}
        
        # Normalize preferences dict keys using fuzzy mapping
        # This ensures OCR typos like "Tiffany Glodovizay" are merged into "Tiffany Glodoviza"
        if hasattr(self, '_pref_name_to_actual') and self._pref_name_to_actual:
            normalized_preferences = {}
            for pref_name, shifts in self.preferences.items():
                pref_lower = pref_name.strip().lower()
                actual_name = self._pref_name_to_actual.get(pref_lower, pref_lower)
                # Find the actual capitalized name from nurse_by_name
                actual_capitalized = pref_name  # default to original
                for nurse_data in nurses:
                    if nurse_data.get("name", "").strip().lower() == actual_name:
                        actual_capitalized = nurse_data["name"]
                        break
                if actual_capitalized != pref_name:
                    logger.info(f"  MERGING PREFERENCES: '{pref_name}' -> '{actual_capitalized}'")
                normalized_preferences[actual_capitalized] = shifts
            self.preferences = normalized_preferences
        
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
        # Track ACTUAL PAID hours per nurse per 14-day pay period (used for capacity checks)
        self.nurse_period_hours: Dict[str, Dict[str, float]] = {n["name"]: {} for n in nurses}
        # Track TARGET-WEIGHTED hours per nurse per 14-day period (used for delta calculation)
        # FT 12h shifts count as 10.71h (not 11.25h) so 7 shifts = 75h = 0 delta
        self.nurse_period_target_hours: Dict[str, Dict[str, float]] = {n["name"]: {} for n in nurses}
        # Track shift COUNT per nurse per 14-day pay period: {nurse_name: {period_key: int}}
        # Used to enforce FT max 7 shifts per 14 days (prevents shift bloat scenario)
        self.nurse_period_shifts: Dict[str, Dict[str, int]] = {n["name"]: {} for n in nurses}
        # Track Z-shift (12h) COUNT per nurse per 14-day period
        # FT nurses need min 5 Z-shifts out of 7 to hit 75h contract
        self.nurse_period_z_shifts: Dict[str, Dict[str, int]] = {n["name"]: {} for n in nurses}
        self.nurse_total_shifts: Dict[str, int] = {n["name"]: 0 for n in nurses}
        
        # MCH FT Contract constraints (from module-level constants)
        self.FT_MAX_SHIFTS_PER_PERIOD = MCH_FT_SHIFT_COUNT  # 7 shifts = target
        self.FT_OT_THRESHOLD = MCH_FT_MAX_SHIFTS_PER_PERIOD  # 8th shift = overtime
        self.FT_MIN_Z_SHIFTS = MCH_FT_MIN_Z_SHIFTS  # At least 5 of 7 must be 12h
        self.FT_12H_TARGET_WEIGHT = MCH_Z_SHIFT_CONTRACT_VALUE  # 10.7143h per Z-shift
        
    # ── Composite CF helpers ────────────────────────────────────────────
    # Composite CF codes look like "CF-4 07", "CF-11 Z07", "CF-3 23" etc.
    # They mean: statutory holiday (CF-X) + actual working shift (07/23/Z07/Z19).
    # The nurse works a regular shift on the holiday and should be treated
    # as a WORKING shift with the corresponding hours, not as an off day.
    _COMPOSITE_CF_RE = re.compile(
        r"^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)\s*$", re.IGNORECASE
    )

    @staticmethod
    def _is_composite_cf_shift(code: str) -> bool:
        """True when *code* is a composite CF+shift like 'CF-4 07'."""
        if not code:
            return False
        return bool(RobustScheduler._COMPOSITE_CF_RE.match(code.strip()))

    @staticmethod
    def _extract_shift_from_cf(code: str) -> str:
        """Extract the shift component from a composite CF code.

        'CF-4 07' → '07',  'CF-11 Z19' → 'Z19',  'CF-3 23' → '23'
        Returns '' for non-composite codes.
        """
        if not code:
            return ""
        m = RobustScheduler._COMPOSITE_CF_RE.match(code.strip())
        return m.group(1).upper() if m else ""

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
        """Current 14-day period delta = scheduled - target (negative means under-target).
        
        Uses TARGET-WEIGHTED hours where FT 12h shifts count as 10.71h (not 11.25h)
        so that 7 × 12h shifts = 75h = exactly at target (delta = 0).
        """
        period_key = self.date_to_period.get(date, "unknown")
        # Use target-weighted hours for delta calculation
        scheduled = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
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

    # Night shift codes that lock the NEXT calendar day.
    # MCH Rule: Z19 works until 07:25 next morning.  Z23 B (back shift)
    # requires 11+ hours rest → nurse locked out of entire next day.
    _NIGHT_CODES = {"Z19", "Z23", "Z23 B", "23", "N8-", "ZN-", "ZN8-", "ZN+ZE2-", "N8+ZE2-"}

    def _worked_night_previous_day(self, nurse_name: str, day_idx: int) -> bool:
        """Return True if the nurse worked a night shift on the previous day.
        
        MCH Rule: nurses finishing Z19 or Z23 B cannot work ANY shift the
        next calendar day (11+ hour rest requirement).
        Z23 ↩ (0h continuation) does NOT trigger this — the nurse already
        finished at 07:25 on that day and has 16+ hours rest by next day.
        """
        if day_idx <= 0:
            return False
        prev_shift = self.schedule[nurse_name][day_idx - 1]
        if not prev_shift:
            return False
        prev_code = str(prev_shift.get("shift", "")).strip()
        # 0h slots are continuation markers — nurse already finished, next day FREE.
        if prev_shift.get("hours", 0) <= 0:
            return False
        prev_upper = prev_code.upper()
        prev_type = str(prev_shift.get("shiftType", "")).strip().lower()
        return prev_upper in self._NIGHT_CODES or prev_type == "night"

    def _is_locked_for_night_continuation(self, nurse_name: str, day_idx: int) -> bool:
        """Return True if this day slot is locked after a PAID night shift.
        
        MCH Night Lockout Rules (bridge/tail model):
        - Z19 on Day N-1 (11.25h) → Day N locked (nurse works until 07:25)
        - Z23 B on Day N-1 (11.25h bridge) → Day N locked (nurse returns PM)
        - Z23 (0h tail) on Day N-1 → Day N FREE (nurse finished at 07:25)
        """
        if day_idx <= 0:
            return False
        prev_shift = self.schedule[nurse_name][day_idx - 1]
        if not prev_shift:
            return False
        # 0h slots are continuation markers — nurse already done, next day FREE.
        if prev_shift.get("hours", 0) <= 0:
            return False
        prev_upper = str(prev_shift.get("shift", "")).strip().upper()
        # Z19 and Z23 B standalone (paid hours) both lock the next day.
        return prev_upper in ("Z19", "Z23 B", "Z23B")

    def _can_accept_night_shift(self, nurse_name: str, day_idx: int) -> bool:
        """Check if assigning a 12h night (Z19) on day_idx is valid.
        
        Z19 requires TWO subsequent days:
          N+1 for Z23 B (bridge, 11.25h)
          N+2 for Z23 (tail, 0h)
        Returns False if either day is unavailable.
        """
        def _slot_available(idx: int) -> bool:
            if idx >= len(self.date_list):
                # Past end of schedule — continuation falls into next period.
                return True
            slot_date = self.date_list[idx]
            # Off-request blocks the slot
            if slot_date in self.get_off_requests(nurse_name):
                return False
            row = self.schedule.get(nurse_name, [])
            if idx < len(row):
                slot = row[idx]
                if slot is not None:
                    sc = str(slot.get("shift", "")).replace("↩", "").strip().upper()
                    sh = float(slot.get("hours", 0) or 0)
                    # Already has Z23 B or Z23 continuation — OK
                    if "Z23" in sc and sh <= 11.26:
                        return True
                    if slot.get("shiftType") == "off":
                        return True
                    if sh > 0:
                        return False  # Real non-night shift blocks
            return True  # Slot is free (None)

        # Need N+1 (for Z23 B) and N+2 (for Z23 tail)
        return _slot_available(day_idx + 1) and _slot_available(day_idx + 2)

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

    def _predict_future_coverage_shortfall(self, date: str, lookhead_days: int = 4) -> Dict[str, Dict[str, int]]:
        """Predict if future days (next N days) will be understaffed based on:
        - Currently assigned shifts
        - Nurses already locked into Z19 rotations
        - Nurses with off-requests or on leave
        - Consecutive day limits
        
        Returns: {future_date: {'day_gap': X, 'night_gap': Y}} where gap is
                 how many nurses short of minimum requirements.
        """
        day_idx = self.date_to_index.get(date, -1)
        if day_idx < 0:
            return {}
        
        predictions = {}
        for offset in range(1, lookhead_days + 1):
            future_idx = day_idx + offset
            if future_idx >= len(self.date_list):
                break
            
            future_date = self.date_list[future_idx]
            
            # Count already-assigned staff
            day_count = 0
            night_count = 0
            for nurse_name in self.nurse_names:
                if future_idx >= len(self.schedule.get(nurse_name, [])):
                    continue
                shift = self.schedule[nurse_name][future_idx]
                if not shift:
                    continue
                if shift.get("shiftType") == "day" and shift.get("hours", 0) > 0:
                    day_count += 1
                elif shift.get("shiftType") == "night":
                    # Exclude Z23 tails (0h) from count
                    if shift.get("hours", 0) > 0:
                        night_count += 1
            
            # Count available nurses (not assigned, not on leave, not blocked, not hours-blocked)
            available_for_day = 0
            available_for_night = 0
            for nurse_name in self.nurse_names:
                if nurse_name in self.nurses_on_leave:
                    continue
                if future_idx >= len(self.schedule.get(nurse_name, [])):
                    continue
                if self.schedule[nurse_name][future_idx] is not None:
                    continue  # Already assigned
                if future_date in self.get_off_requests(nurse_name):
                    continue  # Off-request
                # Check if locked for night continuation
                if self._is_locked_for_night_continuation(nurse_name, future_idx):
                    continue
                    
                # CRITICAL: Check hours capacity - nurse must have room for another shift
                # This was the bug: we weren't checking if nurses would exceed their target
                remaining = self.get_target_remaining_hours(nurse_name, future_date)
                is_ft = self._is_full_time(nurse_name)
                
                # Check shift limit
                if self.has_reached_shift_limit(nurse_name, future_date):
                    continue  # Already at max shifts
                    
                # Check hours capacity for the shift type
                # Day shifts: 12h for FT, 8h otherwise
                # Night shifts: 12h (Z19 creates 3-day rotation issue)
                day_shift_hours = 12 if is_ft else 8
                night_shift_hours = 12 if is_ft else 8
                
                if remaining < 7.5:
                    # Not enough room for even minimum shift
                    continue
                
                if remaining >= day_shift_hours:
                    available_for_day += 1
                elif remaining >= 7.5:
                    # Room for an 8h shift but not 12h
                    available_for_day += 1
                    
                if remaining >= night_shift_hours:
                    available_for_night += 1
                elif remaining >= 7.5 and not is_ft:
                    # PT can do 8h night shifts
                    available_for_night += 1
            
            # Calculate gaps: need = (requirement - assigned), gap = need - available
            day_need = max(0, self.day_req - day_count)
            night_need = max(0, self.night_req - night_count)
            day_gap = max(0, day_need - available_for_day)
            night_gap = max(0, night_need - available_for_night)
            
            if day_gap > 0 or night_gap > 0:
                predictions[future_date] = {
                    'day_gap': day_gap,
                    'night_gap': night_gap,
                    'day_need': day_need,
                    'night_need': night_need,
                    'day_available': available_for_day,
                    'night_available': available_for_night
                }
        
        return predictions

    def _select_candidate_for_assignment(self, candidates: List[str], date: str, hours: float = 12) -> Optional[str]:
        """Select best candidate preferring nurses under their period target and
        who have remaining target capacity for the requested hours.
        HARD RULE: Never select a nurse who would exceed their target hours.
        Returns None if no suitable candidate found.
        """
        if not candidates:
            return None

        # HARD FILTER: exclude any nurse who would exceed their biweekly target
        eligible = [n for n in candidates if not self.has_reached_target_hours(n, date, hours)]
        if not eligible:
            # All candidates would exceed target — return None to signal
            # that this slot cannot be filled without overtime.
            logger.debug(f"  No eligible candidate for {date}: all {len(candidates)} would exceed target")
            return None

        # Prefer nurses who are under their target (negative delta) AND have
        # room under their pay-period target remaining for this shift.
        under_with_capacity = [
            n for n in eligible if self.get_target_delta(n, date) < 0 and self.get_target_remaining_hours(n, date) >= hours
        ]
        if under_with_capacity:
            # Prefer PT before FT — PT nurses have lower targets and are the
            # cheapest resource to fill gaps without pushing FT into overtime.
            # Within PT/FT groups, choose the most under-target nurse.
            return min(
                under_with_capacity,
                key=lambda n: (self._is_full_time(n), self.get_target_delta(n, date)),
            )

        # Next prefer any under-target nurse (even if remaining < hours)
        under = [n for n in eligible if self.get_target_delta(n, date) < 0]
        if under:
            return min(
                under,
                key=lambda n: (self._is_full_time(n), self.get_target_delta(n, date)),
            )

        # Otherwise fall back to any eligible candidate who has weekly capacity remaining
        with_capacity = [n for n in eligible if self.get_remaining_hours(n, date) >= hours]
        if with_capacity:
            # Prefer those closest to target (smaller positive delta)
            return min(with_capacity, key=lambda n: (self.get_target_delta(n, date), sum(self.nurse_period_hours.get(n, {}).values())))

        # Last resort among eligible: return the one with the smallest positive delta
        return min(eligible, key=lambda n: (max(0.0, self.get_target_delta(n, date)), sum(self.nurse_period_hours.get(n, {}).values())))

    def _track_hours(self, nurse_name: str, date: str, hours_delta: float, shift_delta: int = 0, is_12h_shift: bool = None) -> None:
        """Track both weekly and 14-day period hours with a signed delta.
        
        Args:
            nurse_name: Name of the nurse
            date: The date being tracked
            hours_delta: Hours to add (positive) or remove (negative) - ACTUAL paid hours
            shift_delta: Shift count change (+1 for adding, -1 for removing, 0 for hour-only adjustments)
            is_12h_shift: Whether this is a 12h shift (uses 10.71h target weight for FT).
                          If None, inferred from hours_delta: >= 10h = 12h shift, < 10h = 8h shift.
        """
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

        # Track TARGET-WEIGHTED hours for delta calculation
        # FT nurses: 12h shifts count as 10.71h (so 7 × 10.71h = 75h = 0 delta)
        # This separates capacity tracking (actual 11.25h) from target tracking (10.71h)
        target_weighted_delta = hours_delta
        
        # Infer is_12h_shift from hours_delta if not explicitly specified
        if is_12h_shift is None and shift_delta != 0:
            # If adding/removing a shift, infer type from hours: >= 10h = 12h, < 10h = 8h
            is_12h_shift = abs(hours_delta) >= 10.0
        
        if is_12h_shift and self._is_full_time(nurse_name):
            # For FT 12h shifts: use 10.71h target weight instead of actual 11.25h
            sign = 1 if hours_delta >= 0 else -1
            target_weighted_delta = sign * self.FT_12H_TARGET_WEIGHT
        
        if nurse_name not in self.nurse_period_target_hours:
            self.nurse_period_target_hours[nurse_name] = {}
        if period_key not in self.nurse_period_target_hours[nurse_name]:
            self.nurse_period_target_hours[nurse_name][period_key] = 0.0
        self.nurse_period_target_hours[nurse_name][period_key] = max(
            0.0, self.nurse_period_target_hours[nurse_name][period_key] + float(target_weighted_delta)
        )

        # Track shift count per period (for FT max 7 shifts enforcement)
        if shift_delta != 0:
            if nurse_name not in self.nurse_period_shifts:
                self.nurse_period_shifts[nurse_name] = {}
            if period_key not in self.nurse_period_shifts[nurse_name]:
                self.nurse_period_shifts[nurse_name][period_key] = 0
            self.nurse_period_shifts[nurse_name][period_key] = max(
                0, self.nurse_period_shifts[nurse_name][period_key] + shift_delta
            )

            # Track Z-shift (12h) count separately for FT min-5 constraint
            if is_12h_shift:
                if nurse_name not in self.nurse_period_z_shifts:
                    self.nurse_period_z_shifts[nurse_name] = {}
                if period_key not in self.nurse_period_z_shifts[nurse_name]:
                    self.nurse_period_z_shifts[nurse_name][period_key] = 0
                self.nurse_period_z_shifts[nurse_name][period_key] = max(
                    0, self.nurse_period_z_shifts[nurse_name][period_key] + shift_delta
                )

    def get_period_shift_count(self, nurse_name: str, date: str) -> int:
        """Get the number of shifts assigned to a nurse in the period containing date."""
        period_key = self.date_to_period.get(date, "unknown")
        return self.nurse_period_shifts.get(nurse_name, {}).get(period_key, 0)

    def get_period_z_shift_count(self, nurse_name: str, date: str) -> int:
        """Get the number of 12h (Z-code) shifts assigned to a nurse in the period."""
        period_key = self.date_to_period.get(date, "unknown")
        return self.nurse_period_z_shifts.get(nurse_name, {}).get(period_key, 0)

    def ft_needs_z_shift(self, nurse_name: str, date: str) -> bool:
        """Check if FT nurse still needs more Z-shifts to meet the min-5 constraint.
        
        MCH rule: FT nurses must have at least 5 Z-shifts (12h) out of 7 total.
        If a nurse has used most of their shift budget on 8h shifts, they MUST
        get 12h shifts for the remaining slots.
        """
        if not self._is_full_time(nurse_name):
            return False
        total_shifts = self.get_period_shift_count(nurse_name, date)
        z_shifts = self.get_period_z_shift_count(nurse_name, date)
        remaining_shifts = self.FT_MAX_SHIFTS_PER_PERIOD - total_shifts
        # If the remaining shifts must ALL be Z-shifts to meet minimum
        return z_shifts < self.FT_MIN_Z_SHIFTS and (z_shifts + remaining_shifts) >= self.FT_MIN_Z_SHIFTS

    def has_reached_shift_limit(self, nurse_name: str, date: str) -> bool:
        """Check if a nurse has reached their max shift count for the period.
        
        FT nurses: max 7 shifts per 14-day period (7 × 10.714h = 75h target).
        PT nurses: max shifts derived from their biweekly target hours.
        """
        current_count = self.get_period_shift_count(nurse_name, date)
        if self._is_full_time(nurse_name):
            return current_count >= self.FT_MAX_SHIFTS_PER_PERIOD
        # PT nurses: derive shift limit from target hours / reference shift hours
        target_biweekly = self.get_target_biweekly_hours(nurse_name)
        # Use reference shift hours (typically 7.5-11.25) to compute max shifts
        pt_max_shifts = max(1, int(target_biweekly / self.reference_shift_hours + 0.5))
        return current_count >= pt_max_shifts

    def has_reached_target_hours(self, nurse_name: str, date: str, hours: float = 0) -> bool:
        """HARD CONSTRAINT: Check if assigning additional hours would exceed the
        nurse's biweekly target for the period containing this date.
        
        MCH/MUHC Policy: FT target is 75h bi-weekly, but 7×11.25h = 78.75h is the
        standard rotation. The extra 3.75h is "banked time" per union agreement.
        Therefore, allow +3.75h tolerance (5% of 75h) dynamically scaled to target.
        
        For non-standard targets, use 5% tolerance: e.g., 60h target → +3.0h tolerance.
        """
        period_key = self.date_to_period.get(date, "unknown")
        # Use target-weighted hours (FT 12h shifts = 10.71h) for fair comparison
        current_target_hours = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
        target = self.get_period_target_hours(nurse_name, period_key)
        
        # Dynamic tolerance: 5% of target (min 3.0h, max 5.0h)
        # This allows flexibility while preventing unlimited overtime bloat.
        tolerance = max(3.0, min(5.0, target * 0.05))
        
        # Would adding this shift exceed target?
        if hours > 0:
            # For FT 12h shifts, the target-weighted addition is 10.71h not 11.25h
            weighted_hours = hours
            if self._is_full_time(nurse_name) and hours >= 10.0:
                weighted_hours = self.FT_12H_TARGET_WEIGHT
            elif self._is_full_time(nurse_name) and hours >= 7.0:
                weighted_hours = hours  # 8h shifts count at face value
            return (current_target_hours + weighted_hours) > (target + tolerance)
        return current_target_hours >= (target - 0.5)

    def _get_scaled_period_target_hours(self, period_key: str) -> float:
        """Get total target for a period with boundary scaling and off-request reductions."""
        return self.get_period_total_target_hours(period_key)

    def _get_dynamic_daily_staff_cap(self, date: str) -> int:
        """
        Daily working-nurse cap — STRICT to prevent front-loading.
        
        Problem solved: with a high cap (12), the greedy algorithm
        overstaffs early days and exhausts nurse hours before the last
        days of the period, leaving them nearly empty (Sep 4 = 1 nurse).
        
        Fix: cap at base + 1 (= 10 for MCH 5D+4N).  This forces nurses
        to be spread across ALL 14 days.  The extra +1 slot provides
        just enough flexibility for FT nurses to reach their 7th shift
        without creating 12-nurse surges.
        """
        base_cap = self.day_req + self.night_req  # 5+4=9
        return base_cap + 1  # 10 — strict cap

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
        day_idx = self.date_list.index(date) if date in self.date_list else -1
        
        # MCH Night Linkage: if this slot is locked for Z23 continuation, no new shifts
        if day_idx >= 0 and self._is_locked_for_night_continuation(nurse_name, day_idx):
            logger.debug(f"  {nurse_name} blocked on {date}: locked for Z23 night continuation")
            return False

        # Minimum-rest guard: after a night shift, only night shifts allowed
        if not is_night and day_idx >= 0 and self._worked_night_previous_day(nurse_name, day_idx):
            logger.debug(f"  {nurse_name} blocked for day shift on {date}: worked night yesterday (min rest)")
            return False
        
        # MCH Night Linkage: Z19 requires next day available for Z23 continuation
        if is_night and hours >= 10 and day_idx >= 0:
            if not self._can_accept_night_shift(nurse_name, day_idx):
                logger.debug(f"  {nurse_name} blocked for 12h night on {date}: next day unavailable for Z23 continuation")
                return False

        # Check hours limit FIRST - most important constraint
        remaining_hours = self.get_remaining_hours(nurse_name, date)
        if remaining_hours < hours:
            week_key = self.date_to_week.get(date, "unknown")
            logger.debug(f"  {nurse_name} has only {remaining_hours}h remaining in week {week_key} (need {hours}h)")
            return False
        
        # SHIFT COUNT LIMIT: max shifts per 14-day period (FT=7, PT=derived)
        # Z19 auto-places Z23 B(11.25h) on N+1, costing 2 shift slots total.
        # Check accordingly: if this is a night shift, the nurse needs 2 free slots.
        if self.has_reached_shift_limit(nurse_name, date):
            period_key = self.date_to_period.get(date, "unknown")
            current_count = self.get_period_shift_count(nurse_name, date)
            logger.debug(f"  {nurse_name} has {current_count} shifts in {period_key} — shift limit reached")
            return False
        if is_night and hours >= 11:
            # Z19 needs 2 slots (itself + Z23 B bridge)
            current_count = self.get_period_shift_count(nurse_name, date)
            if self._is_full_time(nurse_name):
                if current_count + 2 > self.FT_MAX_SHIFTS_PER_PERIOD:
                    logger.debug(f"  {nurse_name} has {current_count} shifts — Z19 needs 2 slots (Z19+Z23 B), would exceed {self.FT_MAX_SHIFTS_PER_PERIOD}")
                    return False
        
        # HARD CONSTRAINT: Never exceed biweekly target hours
        if self.has_reached_target_hours(nurse_name, date, hours):
            period_key = self.date_to_period.get(date, "unknown")
            current_h = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
            target_h = self.get_period_target_hours(nurse_name, period_key)
            logger.debug(f"  {nurse_name} at {current_h:.1f}h / {target_h:.1f}h target in {period_key} — would exceed target with +{hours}h")
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
        
        Standard shift codes (hours are PAID, not clock time):
        - Day 12h:   Z07 (07:00-19:25, 11.25h paid)
        - Day 8h:    07  (07:00-15:15, 7.5h paid)
        - Night 12h: Z19+Z23 merged (19:00-07:25, 11.25h paid)
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
                
                # MCH 12h night rotation pattern:
                #   1 night:  Z19(N) → Z23(N+1, 0h tail)
                #   2 nights: Z19(N) → Z23 B(N+1, 11.25h) → Z23(N+2, 0h)
                #   3 nights: Z19(N) → Z23 B(N+1) → Z23 B(N+2) → Z23(N+3, 0h)
                #
                # Z19   = Start of rotation (19:00→07:25) = 11.25h
                # Z23 B = BRIDGE: finish morning + return evening = 11.25h
                # Z23   = TAIL: finish morning only = 0h
                #
                # Check if the previous day already has Z19 or Z23 B for
                # this nurse — if so, this is a CONSECUTIVE night and
                # should use Z23 B (bridge) instead of Z19 (new rotation).
                day_idx_check = self.date_to_index.get(date, -1)
                prev_has_active_night = False
                if day_idx_check > 0 and nurse_name in self.schedule:
                    _row = self.schedule[nurse_name]
                    if day_idx_check - 1 < len(_row):
                        _prev = _row[day_idx_check - 1]
                        if _prev:
                            _pc = str(_prev.get("shift", "")).strip().upper()
                            _ph = float(_prev.get("hours", 0) or 0)
                            if _pc in ("Z19", "Z23 B", "Z23B") and _ph > 0:
                                prev_has_active_night = True
                
                if prev_has_active_night:
                    shift_code = "Z23 B"  # Bridge: consecutive night
                else:
                    shift_code = "Z19"  # Start of new rotation
                
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
            
        meta = self.shifts_info.get(shift_code, {})
        
        # ── FIX: 12h Night Shifts ──
        # Z19 and Z23 B both represent full 12h night blocks = 11.25h paid.
        # Z19 = rotation start (19:00→07:25). Z23 B = bridge (finish + return).
        # Don't let standalone SHIFT_CODES metadata override the contextual hours.
        is_12h_night = (shift_type == "night" and hours >= 11 and shift_code in ("Z19", "Z23 B"))
        
        # Get hours from metadata if available - BUT NOT for 12h night shifts
        if meta and "hours" in meta and not is_12h_night:
            hours = meta["hours"]
        elif is_12h_night:
            hours = 11.25  # Full 12h night paid hours
        
        # Calculate start/end times based on shift code metadata or defaults
        if is_12h_night:
            start_time = "19:00"
            end_time = "07:25"
        elif meta:
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
        
        # Determine if this is a 12h (Z-code) shift for FT contract tracking
        is_z_shift = (hours >= 10.0 or is_12h_night or shift_code in ("Z07", "Z11", "Z19"))
        
        # Track hours for week + 14-day period containing this date, and shift count
        self._track_hours(nurse_name, date, float(hours), shift_delta=1, is_12h_shift=is_z_shift)
        self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
        
        shift_entry = {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": shift_code,
            "shiftType": shift_type,
            "hours": hours,
            "startTime": start_time,
            "endTime": end_time
        }
        
        # ── MCH Night Linkage: Auto-place continuations ──
        # MCH MANDATORY pattern: Z19(N) → Z23 B(N+1, 11.25h) → Z23(N+2, 0h)
        # Z23 B on its own only needs Z23(0h) tail on N+1.
        if is_12h_night:
            day_idx = self.date_to_index.get(date, -1)
            if day_idx >= 0 and nurse_name in self.schedule:
                row = self.schedule[nurse_name]

                if shift_code == "Z19":
                    # Z19 → must place Z23 B(11.25h) on N+1 and Z23(0h) on N+2
                    bridge_idx = day_idx + 1
                    tail_idx = day_idx + 2

                    # Place Z23 B (bridge, 11.25h) on N+1
                    if bridge_idx < len(self.date_list):
                        bridge_date = self.date_list[bridge_idx]
                        while len(row) <= bridge_idx:
                            row.append(None)
                        existing = row[bridge_idx]
                        if existing is None or existing.get("shiftType") == "off" or existing.get("hours", 0) == 0:
                            row[bridge_idx] = {
                                "id": str(uuid.uuid4()),
                                "date": bridge_date,
                                "shift": "Z23 B",
                                "shiftType": "night",
                                "hours": 11.25,
                                "startTime": "00:00",
                                "endTime": "07:25"
                            }
                            # Track hours for the auto-placed bridge shift
                            self._track_hours(nurse_name, bridge_date, 11.25, shift_delta=1, is_12h_shift=True)
                            self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                            logger.info(
                                f"  ⛓️ NIGHT LINKAGE: {nurse_name} {bridge_date}: "
                                f"auto-placed Z23 B bridge (11.25h, Day N+1 after Z19)"
                            )

                    # Place Z23 (tail, 0h) on N+2
                    if tail_idx < len(self.date_list):
                        tail_date = self.date_list[tail_idx]
                        while len(row) <= tail_idx:
                            row.append(None)
                        existing_tail = row[tail_idx]
                        if existing_tail is None or existing_tail.get("shiftType") == "off" or existing_tail.get("hours", 0) == 0:
                            row[tail_idx] = {
                                "id": str(uuid.uuid4()),
                                "date": tail_date,
                                "shift": "Z23",
                                "shiftType": "night",
                                "hours": 0,
                                "startTime": "00:00",
                                "endTime": "07:25"
                            }
                            logger.info(
                                f"  ⛓️ NIGHT LINKAGE: {nurse_name} {tail_date}: "
                                f"auto-placed Z23 tail (0h, Day N+2 after Z19→Z23 B)"
                            )

                else:
                    # Z23 B → place Z23(0h) tail on N+1
                    next_idx = day_idx + 1
                    if next_idx < len(self.date_list):
                        next_date = self.date_list[next_idx]
                        while len(row) <= next_idx:
                            row.append(None)
                        existing = row[next_idx]
                        if existing is None or existing.get("shiftType") == "off" or existing.get("hours", 0) == 0:
                            row[next_idx] = {
                                "id": str(uuid.uuid4()),
                                "date": next_date,
                                "shift": "Z23",
                                "shiftType": "night",
                                "hours": 0,
                                "startTime": "00:00",
                                "endTime": "07:25"
                            }
                            logger.info(
                                f"  ⛓️ NIGHT LINKAGE: {nurse_name} {next_date}: "
                                f"auto-placed Z23 tail (0h, Day N+1 after Z23 B)"
                            )
        
        return shift_entry
    
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
        
        # CF codes (congé férié/statutory holidays) are PAID off days.
        # Nurses get 7.5h paid but don't work. Set hours > 0 so they
        # appear in the frontend shift breakdown.
        hours = 7.5 if normalized_code.startswith("CF") else 0
        
        return {
            "id": str(uuid.uuid4()),
            "date": date,
            "shift": normalized_code,
            "shiftType": "off",
            "hours": hours,
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
                    # Composite CF+shift → return the shift component
                    if self._is_composite_cf_shift(cleaned):
                        return self._extract_shift_from_cf(cleaned)
                    # BLOCK all invalid codes
                    if (shift_upper.startswith("CF") or 
                        shift_upper.startswith("C-") or
                        shift_upper in ["C", "OFF", ""] or
                        "CF-" in shift_upper):
                        logger.debug(f"  Filtered CF/OFF code: {shift} for {nurse_name}")
                        return ""  # Treat as no preference
                    return cleaned
        return ""
    
    # ── Pre-processing: Filter out overnight continuation markers ─────
    # The ↩ symbol indicates an overnight shift continuation that's already
    # been counted. Z23 is a legitimate 8h night shift code, not a tail.
    # Maximum paid hours a single nurse can accumulate in one calendar day.
    # Any entry that would push a day beyond this is clearly a ghost.
    MAX_HOURS_PER_DAY = 12.5

    @staticmethod
    def _preprocess_ocr_preferences(
        preferences: Dict[str, List[str]],
        shifts_info: Dict[str, Any],
    ) -> Dict[str, List[str]]:
        """Pre-process OCR preferences - remove only ↩ markers.

        Z23 is a legitimate 8h night shift code, not a tail to be removed.
        Only shifts containing the ↩ marker should be filtered out.

        Also enforces MAX_HOURS_PER_DAY per calendar day by removing any
        shift that would exceed the cap.

        Returns a NEW dict (does not mutate the original).
        """
        if not preferences:
            return {}

        MAX_H = RobustScheduler.MAX_HOURS_PER_DAY

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
        total_markers = 0

        for nurse_name, shifts in preferences.items():
            new_shifts = list(shifts)  # shallow copy
            num_days = len(new_shifts)

            # --- Pass 1: Mark Z23 continuations of Z19 (KEEP THEM, DON'T DELETE) ---
            # Z23 semantics (MCH Pediatric Heme-Onc):
            #   - Z23 after Z19 (previous day) → continuation of 12h night shift
            #     DO NOT DELETE! Mark with ↩ so hours merge into Z19 (11.25h total)
            #   - Z23 standalone (no Z19 before) → full 8h night shift (7.5h paid)
            for i in range(1, num_days):
                prev_code = _norm(new_shifts[i-1] or "")
                curr_code = _norm(new_shifts[i] or "")
                
                # If previous day had Z19 and current day has Z23, mark Z23 as continuation
                # CRITICAL: Keep the shift but mark it so hours = 0 (already counted in Z19)
                if prev_code == "Z19" and curr_code == "Z23":
                    logger.info(
                        f"  Z23 MERGE: {nurse_name} day {i}: "
                        f"Z23 follows Z19 on day {i-1} → marking as continuation (0h, counted in Z19)"
                    )
                    new_shifts[i] = new_shifts[i] + " ↩"  # Mark but DON'T delete
                    total_markers += 1

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

        logger.info(f"PRE-CLEAN COMPLETE: {total_markers} Z23 continuations marked (hours will merge into Z19)")
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
        _build_t0 = _time.monotonic()
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
        _step_t0 = _time.monotonic()
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
                # BUT composite CF+shift codes (e.g. "CF-4 07") are WORKING
                # shifts — they should NOT be treated as off days.
                if date in self.get_off_requests(nurse_name):
                    # Peek at OCR to check for composite CF codes
                    ocr_pref = ""
                    if nurse_name in self.preferences:
                        prefs = self.preferences[nurse_name]
                        if day_idx < len(prefs):
                            ocr_pref = (prefs[day_idx] or "").strip()
                    # Composite CF = working shift — fall through to OCR processing
                    if not self._is_composite_cf_shift(ocr_pref):
                        # Preserve the original CF/OFF code from OCR if present,
                        # otherwise default to "OFF".  A blank shift code is
                        # invisible in the frontend calendar.
                        off_code = ocr_pref if ocr_pref and (
                            ocr_pref.upper().startswith("CF") or
                            ocr_pref.upper() in ("C", "OFF")
                        ) else "OFF"
                        self.schedule[nurse_name].append(self.assign_off(nurse_name, date, off_code))
                        nurse_consecutive_count[nurse_name] = 0  # Reset consecutive
                        logger.info(f"  {nurse_name} {date}: OFF (offRequest - code: {off_code})")
                        continue
                
                ocr_shift = self._get_raw_ocr_shift(nurse_name, day_idx)
                
                if not ocr_shift or not ocr_shift.strip():
                    # No OCR data - placeholder (will fill later)
                    self.schedule[nurse_name].append(None)
                    continue
                
                # Check if this is a continuation marker (Z23 ↩)
                # KEEP IT but assign 0 hours (hours already counted in Z19 on previous day)
                is_continuation = "↩" in ocr_shift or "↩" in ocr_shift
                clean_shift = ocr_shift.replace("↩", "").replace("↩", "").strip()
                
                if not clean_shift:
                    self.schedule[nurse_name].append(None)
                    continue
                
                shift_upper = clean_shift.upper().strip()
                
                # DEBUG: Log all CF-related codes
                if "CF" in shift_upper:
                    logger.info(f"🔍 DEBUG CF: {nurse_name} {date}: raw='{ocr_shift}' clean='{clean_shift}' upper='{shift_upper}'")
                
                # ── Composite CF+shift (e.g. "CF-4 07"): WORKING shift ──
                if self._is_composite_cf_shift(clean_shift):
                    logger.warning(f"🎯 STEP 1 COMPOSITE CF DETECTED: {nurse_name} {date}: '{clean_shift}'")
                    extracted = self._extract_shift_from_cf(clean_shift)
                    shift_info = self._get_shift_metadata(extracted)
                    shift_hours = shift_info["hours"]
                    shift_entry = {
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": clean_shift,  # keep original "CF-4 07" visible
                        "shiftType": shift_info["type"],
                        "hours": shift_hours,
                        "startTime": shift_info["start"],
                        "endTime": shift_info["end"],
                    }
                    self.schedule[nurse_name].append(shift_entry)
                    self._track_hours(nurse_name, date, float(shift_hours), shift_delta=1)
                    self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                    nurse_consecutive_count[nurse_name] += 1
                    self.ocr_assignments.add((nurse_name, date))
                    logger.warning(
                        f"✅ {nurse_name} {date}: COMPOSITE CF SHIFT cached: {clean_shift} → "
                        f"{extracted} (type={shift_info['type']}, hours={shift_hours}h)"
                    )
                    continue

                # Check for explicit OFF codes (NOT '*')
                # Handle CF variations: CF, CF-, CF 01, CF-01, C, OFF
                # BUT: Composite CF+shift codes (checked above) should have already matched and continued
                is_off_code = (shift_upper in ["C", "OFF"] or 
                              shift_upper.startswith("CF") or
                              shift_upper.startswith("CF-") or
                              "CF " in shift_upper)
                
                if is_off_code:
                    # DEBUG: This should NOT happen for composite CF
                    if "CF" in shift_upper and any(c.isdigit() for c in shift_upper):
                        logger.warning(f"⚠️  UNEXPECTED: {nurse_name} {date}: CF code '{clean_shift}' treated as OFF despite composite CF check!")
                    # PRESERVE the original off-day code (e.g., CF-1, C, CF)
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date, clean_shift))
                    nurse_consecutive_count[nurse_name] = 0
                    logger.debug(f"  {nurse_name} {date}: OFF (code: {clean_shift})")
                elif shift_upper == "*":
                    # '*' means OFF in nurse preferred schedules (asterisk = day off)
                    self.schedule[nurse_name].append(self.assign_off(nurse_name, date, "*"))
                    nurse_consecutive_count[nurse_name] = 0
                    logger.info(f"  {nurse_name} {date}: OFF (asterisk * = day off)")
                else:
                    # Valid shift code - PRESERVE EXACTLY (OCR is binding, not flexible)
                    # Special handling for Z23 ↩ (continuation marker)
                    if is_continuation:
                        # This is a continuation of previous night's Z19
                        # Keep it in schedule but with 0 hours (already counted in Z19)
                        shift_info = self._get_shift_metadata(clean_shift)
                        shift_entry = {
                            "id": str(uuid.uuid4()),
                            "date": date,
                            "shift": clean_shift + " ↩",  # Keep marker visible
                            "shiftType": "night",
                            "hours": 0,  # 0 hours - already counted in Z19
                            "startTime": "00:00",
                            "endTime": "07:25"
                        }
                        self.schedule[nurse_name].append(shift_entry)
                        logger.info(f"✓ {nurse_name} {date}: Z23 ↩ continuation (0h - merged into previous Z19)")
                    else:
                        # Regular shift - get metadata and assign hours
                        shift_info = self._get_shift_metadata(clean_shift)

                        # MCH Night Rotation Hours:
                        # Z19 = ALWAYS 11.25h paid (starts night rotation)
                        # Z23 B after Z19/Z23 B = 11.25h (BRIDGE: finish AM + return PM)
                        # Z23 after Z19/Z23 B/Z23 = 0h (TAIL: finish AM only, hours in prev shift)
                        # Z23 B standalone (no Z19/Z23 B prev day) = standalone value
                        is_z23_tail = False
                        is_z23_bridge = False
                        if shift_upper == "Z19":
                            shift_hours = 11.25  # Full 12h night, always
                        elif shift_upper in ("Z23 B", "Z23", "Z23B") and day_idx > 0:
                            prev_entry = (
                                self.schedule[nurse_name][day_idx - 1]
                                if day_idx - 1 < len(self.schedule[nurse_name])
                                else None
                            )
                            prev_code = str(prev_entry.get("shift", "")).strip().upper() if prev_entry else ""
                            # Check the FULL chain: Z19 → Z23 B → ... → Z23
                            if prev_code in ("Z19", "Z23 B", "Z23B", "Z23"):
                                if shift_upper in ("Z23 B", "Z23B"):
                                    # Z23 B = BRIDGE: finish morning (00:00-07:25)
                                    # AND return evening (19:00-07:25). Full paid 11.25h.
                                    shift_hours = 11.25
                                    is_z23_bridge = True
                                else:
                                    # Plain Z23 = TAIL: finish morning only. 0h.
                                    shift_hours = 0
                                    is_z23_tail = True
                            else:
                                shift_hours = shift_info["hours"]
                        else:
                            shift_hours = shift_info["hours"]

                        if is_z23_tail:
                            # Z23 tail: 0h, morning end of rotation
                            shift_entry = {
                                "id": str(uuid.uuid4()),
                                "date": date,
                                "shift": clean_shift,
                                "shiftType": "night",
                                "hours": 0,
                                "startTime": "00:00",
                                "endTime": "07:25"
                            }
                            self.schedule[nurse_name].append(shift_entry)
                            # Do NOT track hours or shift count — part of previous shift
                            logger.info(
                                f"✓ {nurse_name} {date}: {clean_shift} TAIL — end of rotation "
                                f"(0h — hours in previous Z19/Z23 B)"
                            )
                        elif is_z23_bridge:
                            # Z23 B bridge: 11.25h, finish morning + return evening
                            shift_entry = {
                                "id": str(uuid.uuid4()),
                                "date": date,
                                "shift": clean_shift,
                                "shiftType": "night",
                                "hours": 11.25,
                                "startTime": "00:00",
                                "endTime": "07:25"
                            }
                            self.schedule[nurse_name].append(shift_entry)
                            # Track hours: Z23 B is a FULL paid shift
                            is_z_shift_bridge = True
                            self._track_hours(nurse_name, date, 11.25, shift_delta=1, is_12h_shift=is_z_shift_bridge)
                            self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                            nurse_consecutive_count[nurse_name] += 1
                            logger.info(
                                f"✓ {nurse_name} {date}: {clean_shift} BRIDGE — finish AM + "
                                f"return PM (11.25h paid)"
                            )
                        else:
                            shift_entry = {
                                "id": str(uuid.uuid4()),
                                "date": date,
                                "shift": clean_shift,  # PRESERVE ORIGINAL CODE
                                "shiftType": shift_info["type"],
                                "hours": shift_hours,
                                "startTime": shift_info["start"],
                                "endTime": shift_info["end"]
                            }
                            self.schedule[nurse_name].append(shift_entry)
                            # Track hours for week + 14-day period, and shift count
                            self._track_hours(nurse_name, date, float(shift_hours), shift_delta=1)
                            self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                            nurse_consecutive_count[nurse_name] += 1
                            logger.info(f"✓ {nurse_name} {date}: OCR PRESERVED {clean_shift} ({shift_info['type']}, {shift_hours}h)")
        
        # ============================================================
        logger.info(f"  ⏱ STEP 1 completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # STEP 1.5: MCH NIGHT LINKAGE - Ensure rotation completeness
        #
        # MCH NIGHT ROTATION (bridge/tail model):
        #   Z19(N, 11.25h) → Z23 B(N+1, 11.25h bridge) → ... → Z23(last, 0h tail)
        #
        # Z23 B = BRIDGE: finish morning (00:00-07:25) AND return evening
        #         (19:00-07:25 next day). Full paid 11.25h shift.
        # Z23   = TAIL: finish morning only (00:00-07:25). 0h (hours
        #         already counted in previous Z19 or Z23 B).
        #
        # Rules enforced:
        # 1. After Z19 or Z23 B: next day must have Z23 B(11.25h) or Z23(0h)
        # 2. Z23 B in rotation → hours = 11.25h always
        # 3. Z23 (plain) in rotation → hours = 0h always
        # ============================================================
        logger.info("=" * 80)
        logger.info("STEP 1.5: MCH NIGHT LINKAGE ENFORCEMENT (bridge/tail model)")
        linkage_added = 0
        linkage_conflicts = 0

        def _place_tail(row, slot_idx, date_str):
            """Place a Z23(0h) tail at row[slot_idx]. Returns True if placed."""
            while len(row) <= slot_idx:
                row.append(None)
            existing = row[slot_idx]
            if existing is None or existing.get("shiftType") == "off" or existing.get("hours", 0) == 0:
                row[slot_idx] = {
                    "id": str(uuid.uuid4()),
                    "date": date_str,
                    "shift": "Z23",
                    "shiftType": "night",
                    "hours": 0,
                    "startTime": "00:00",
                    "endTime": "07:25"
                }
                return True
            return False

        def _place_bridge(nurse_name, row, slot_idx, date_str):
            """Place a Z23 B(11.25h) bridge at row[slot_idx]. Returns True if placed."""
            while len(row) <= slot_idx:
                row.append(None)
            existing = row[slot_idx]
            if existing is None or existing.get("shiftType") == "off" or existing.get("hours", 0) == 0:
                row[slot_idx] = {
                    "id": str(uuid.uuid4()),
                    "date": date_str,
                    "shift": "Z23 B",
                    "shiftType": "night",
                    "hours": 11.25,
                    "startTime": "00:00",
                    "endTime": "07:25"
                }
                self._track_hours(nurse_name, date_str, 11.25, shift_delta=1, is_12h_shift=True)
                self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                return True
            return False

        def _upgrade_to_bridge(nurse_name, nxt, next_date, old_h):
            """Upgrade an existing Z23(0h) tail to Z23 B(11.25h) bridge."""
            if old_h > 0:
                self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
            nxt["shift"] = "Z23 B"
            nxt["hours"] = 11.25
            nxt["shiftType"] = "night"
            self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
            self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1

        for nurse_name in self.nurse_names:
            if nurse_name in self.nurses_on_leave:
                continue

            row = self.schedule.get(nurse_name, [])
            for day_idx in range(len(row)):
                curr = row[day_idx]
                if not curr:
                    continue

                curr_hours = float(curr.get("hours", 0) or 0)
                curr_code = str(curr.get("shift", "")).strip().upper()

                # Only process active night starts (Z19) and bridges (Z23 B)
                if curr_code not in ("Z19", "Z23 B", "Z23B"):
                    continue
                if curr_hours <= 0:
                    continue  # Skip 0h entries

                is_z19 = (curr_code == "Z19")

                # ── Z19: needs Z23 B on N+1, Z23 on N+2 ──
                # ── Z23 B: needs Z23 tail on N+1 ──
                if day_idx + 1 >= len(self.date_list):
                    continue  # Last day, no room

                next_date = self.date_list[day_idx + 1]
                while len(row) <= day_idx + 1:
                    row.append(None)
                nxt = row[day_idx + 1]
                nxt_str = str(nxt.get("shift", "")).strip().upper() if nxt else ""
                nxt_h = float(nxt.get("hours", 0) or 0) if nxt else 0

                if is_z19:
                    # ── Z19 → must have Z23 B(11.25h) on N+1 ──
                    if nxt and "Z23" in nxt_str:
                        if nxt_str in ("Z23 B", "Z23B"):
                            # Already Z23 B — fix hours if needed
                            if nxt_h != 11.25:
                                old_h = nxt_h
                                if old_h > 0:
                                    self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                nxt["hours"] = 11.25
                                nxt["shiftType"] = "night"
                                self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                                self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE FIX: {nurse_name} {next_date}: Z23 B bridge hours {old_h}→11.25 (after Z19)")
                        else:
                            # Plain Z23 (tail) after Z19 — WRONG! Upgrade to Z23 B bridge
                            _upgrade_to_bridge(nurse_name, nxt, next_date, nxt_h)
                            linkage_added += 1
                            logger.info(f"  ⛓️ LINKAGE FIX: {nurse_name} {next_date}: UPGRADED Z23→Z23 B (Z19 must have bridge on N+1)")
                    elif nxt and nxt.get("hours", 0) > 0 and nxt.get("shiftType") not in ("off", None):
                        # CONFLICT: paid non-Z23 shift on bridge day
                        nxt_conflict = str(nxt.get("shift", "")).strip()
                        logger.error(
                            f"  ❌ ILLEGAL OVERLAP: {nurse_name} {curr.get('date')}: "
                            f"Z19 needs Z23 B on {next_date} but '{nxt_conflict}' occupies it — replacing"
                        )
                        removed_hours = nxt.get("hours", 0)
                        if removed_hours > 0:
                            self._track_hours(nurse_name, next_date, -float(removed_hours), shift_delta=-1)
                            self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                        linkage_conflicts += 1
                        # Place Z23 B bridge
                        row[day_idx + 1] = None  # Clear for _place_bridge
                        if _place_bridge(nurse_name, row, day_idx + 1, next_date):
                            linkage_added += 1
                            logger.info(f"  ⛓️ LINKAGE: {nurse_name} {next_date}: placed Z23 B bridge after Z19 (conflict resolved)")
                    else:
                        # Empty/off/0h slot — place Z23 B bridge
                        if _place_bridge(nurse_name, row, day_idx + 1, next_date):
                            linkage_added += 1
                            logger.info(f"  ⛓️ LINKAGE: {nurse_name} {next_date}: placed Z23 B bridge (Day N+1 after Z19)")

                    # ── Z19 also needs Z23 tail on N+2 ──
                    if day_idx + 2 < len(self.date_list):
                        tail_date = self.date_list[day_idx + 2]
                        while len(row) <= day_idx + 2:
                            row.append(None)
                        tail_slot = row[day_idx + 2]
                        tail_str = str(tail_slot.get("shift", "")).strip().upper() if tail_slot else ""
                        tail_h = float(tail_slot.get("hours", 0) or 0) if tail_slot else 0
                        if tail_slot and "Z23" in tail_str:
                            # Already Z23 variant — if Z23 B, it extends the rotation (OK)
                            # If Z23 plain, ensure 0h
                            if tail_str not in ("Z23 B", "Z23B") and tail_h != 0:
                                old_h = tail_h
                                tail_slot["hours"] = 0
                                if old_h > 0:
                                    self._track_hours(nurse_name, tail_date, -float(old_h), shift_delta=-1)
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE FIX: {nurse_name} {tail_date}: Z23 tail hours {old_h}→0 (N+2 after Z19)")
                        elif tail_slot and tail_h > 0 and tail_slot.get("shiftType") not in ("off", None):
                            # Conflict on tail day — remove and place tail
                            removed_hours = tail_h
                            self._track_hours(nurse_name, tail_date, -float(removed_hours), shift_delta=-1)
                            self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                            linkage_conflicts += 1
                            row[day_idx + 2] = None
                            if _place_tail(row, day_idx + 2, tail_date):
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE: {nurse_name} {tail_date}: placed Z23 tail on N+2 after Z19 (conflict resolved)")
                        else:
                            # Empty — place Z23 tail
                            if _place_tail(row, day_idx + 2, tail_date):
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE: {nurse_name} {tail_date}: placed Z23 tail (Day N+2 after Z19→Z23 B)")

                else:
                    # ── Z23 B → needs Z23 tail on N+1 ──
                    if nxt and "Z23" in nxt_str:
                        if nxt_str in ("Z23 B", "Z23B"):
                            # Z23 B bridge extended — ensure hours = 11.25h
                            if nxt_h != 11.25:
                                old_h = nxt_h
                                if old_h > 0:
                                    self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                nxt["hours"] = 11.25
                                nxt["shiftType"] = "night"
                                self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                                self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE FIX: {nurse_name} {next_date}: Z23 B hours {old_h}→11.25 (after Z23 B)")
                        else:
                            # Plain Z23 tail — ensure hours = 0h
                            if nxt_h != 0:
                                old_h = nxt_h
                                nxt["hours"] = 0
                                if old_h > 0:
                                    self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1)
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                linkage_added += 1
                                logger.info(f"  ⛓️ LINKAGE FIX: {nurse_name} {next_date}: Z23 tail hours {old_h}→0 (after Z23 B)")
                    elif nxt and nxt.get("hours", 0) > 0 and nxt.get("shiftType") not in ("off", None):
                        nxt_conflict = str(nxt.get("shift", "")).strip()
                        logger.error(
                            f"  ❌ ILLEGAL OVERLAP: {nurse_name} {curr.get('date')}: "
                            f"Z23 B needs Z23 tail on {next_date} but '{nxt_conflict}' occupies it — replacing"
                        )
                        removed_hours = nxt.get("hours", 0)
                        if removed_hours > 0:
                            self._track_hours(nurse_name, next_date, -float(removed_hours), shift_delta=-1)
                            self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                        linkage_conflicts += 1
                        row[day_idx + 1] = None
                        if _place_tail(row, day_idx + 1, next_date):
                            linkage_added += 1
                            logger.info(f"  ⛓️ LINKAGE: {nurse_name} {next_date}: placed Z23 tail after Z23 B (conflict resolved)")
                    else:
                        if _place_tail(row, day_idx + 1, next_date):
                            linkage_added += 1
                            logger.info(f"  ⛓️ LINKAGE: {nurse_name} {next_date}: placed Z23 tail (Day N+1 after Z23 B)")

        logger.info(
            f"NIGHT LINKAGE COMPLETE: {linkage_added} continuations added, "
            f"{linkage_conflicts} illegal overlaps removed and corrected"
        )
        if linkage_conflicts > 0:
            logger.warning(
                f"⚠️ CORRECTED {linkage_conflicts} illegal shift overlaps in OCR data. "
                f"Nurses cannot work non-Z23 shifts on mornings they finish Z19 (07:25 end). "
                f"Conflicting shifts were removed and replaced with Z23 B continuations."
            )
        logger.info("=" * 80)
        
        # ============================================================
        logger.info(f"  ⏱ STEP 1.5 completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # STEP 2: Fill gaps to meet coverage requirements
        # PRE-STEP: De-peak overstaffed OCR-heavy days to avoid large daily spikes
        # while preserving minimum staffing and pay-period reconciliation.
        logger.info("=" * 60)
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
                    self._track_hours(candidate, date, -float(removed_hours), shift_delta=-1)

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
        
        logger.info("=" * 80)
        logger.info("🔍 REACHED PRE-SCAN SECTION - ABOUT TO SCAN FOR SHORTAGES")
        logger.info("=" * 80)
        
        # ============================================================
        # PRE-SCAN: Identify critically understaffed dates
        # Problem: processing dates chronologically fills easy days first,
        # leaving shortage days (e.g., Sep 5) with no available nurses.
        # Solution: identify shortage dates and prioritize them FIRST.
        # ============================================================
        logger.info("PRE-SCAN: Identifying at-risk dates for priority assignment...")
        logger.info(f"  Scanning {len(self.date_list)} dates: {self.date_list[0]} to {self.date_list[-1]}")

        # Build per-nurse availability bitmap and remaining capacity
        # nurse_available_days[nurse] = list of day indices where nurse can still be assigned
        total_needed = self.day_req + self.night_req
        nurse_remaining_slots: dict[str, int] = {}
        nurse_available_days: dict[str, list] = {}

        for nurse_name in self.nurse_names:
            if nurse_name in self.nurses_on_leave:
                nurse_remaining_slots[nurse_name] = 0
                nurse_available_days[nurse_name] = []
                continue

            # Current shift count and max
            current_shifts = self.get_period_shift_count(nurse_name, self.date_list[0])
            if self._is_full_time(nurse_name):
                max_shifts = self.FT_MAX_SHIFTS_PER_PERIOD
            else:
                tbw = self.get_target_biweekly_hours(nurse_name)
                max_shifts = max(1, int(tbw / self.reference_shift_hours + 0.5))
            remaining = max(0, max_shifts - current_shifts)
            nurse_remaining_slots[nurse_name] = remaining

            avail_days = []
            for day_idx, date in enumerate(self.date_list):
                if remaining <= 0:
                    break
                shift = self.schedule[nurse_name][day_idx]
                # Already assigned — doesn't consume a slot for another date
                if shift and shift.get("hours", 0) > 0 and shift.get("shiftType") not in ("off", None):
                    continue
                # Skip off requests and leave
                if date in self.get_off_requests(nurse_name):
                    continue
                avail_days.append(day_idx)

            nurse_available_days[nurse_name] = avail_days

        # Per-date assigned count (from Step 1 OCR)
        date_assigned: list[int] = []
        date_available: list[int] = []
        for day_idx, date in enumerate(self.date_list):
            assigned = 0
            avail = 0
            for nurse_name in self.nurse_names:
                if nurse_name in self.nurses_on_leave:
                    continue
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("hours", 0) > 0 and shift.get("shiftType") not in ("off", None):
                    assigned += 1
                elif day_idx in nurse_available_days.get(nurse_name, []):
                    avail += 1
            date_assigned.append(assigned)
            date_available.append(avail)

        # ── SUPPLY-DEMAND SIMULATION ──────────────────────────────────
        # Simulate the greedy chronological assignment:
        # For each date (in order), assign nurses greedily.
        # A nurse's remaining capacity decreases after each assignment.
        # Dates that would be under-staffed AFTER earlier dates consume nurses
        # are the "at-risk" dates.
        #
        # We simulate this with a forward pass:
        # remaining_capacity[nurse] = available slots
        # For each date: need (total_needed - assigned) more nurses.
        #   Greedily consume from nurses available on this date.
        #   Record the "deficit" each date would face at this point.
        sim_remaining: dict[str, int] = {n: nurse_remaining_slots[n] for n in self.nurse_names}

        # Pre-compute which dates each nurse is available for (unassigned slots)
        nurse_avail_set: dict[str, set] = {
            n: set(nurse_available_days[n]) for n in self.nurse_names
        }

        # KEY FIX: Use a mutable copy of date_assigned that gets Z23-B auto-coverage
        # credits added as the simulation progresses.
        #
        # Why the old simulation was wrong:
        #   Each Z19 night shift cascades: Z19(D) → Z23 B(D+1, 11.25h) → Z23 tail(D+2, 0h)
        #   This means one Z19 assignment:
        #     • Burns 2 of the nurse's 7 shift slots (Z19 + auto Z23 B)
        #     • Blocks the nurse from days D, D+1, and D+2
        #     • Also auto-covers night on D+1 (Z23 B counts as night coverage)
        #   Without this model, sim saw 168 slots vs 126 needed = "no shortage",
        #   but real capacity with cascade costs is ~24 nurses × 7 slots / 1.44 ≈ 117
        #   effective unique date-slots.  Late dates run dry.
        sim_date_assigned: list[int] = list(date_assigned)

        shortage_dates = []
        for day_idx, date in enumerate(self.date_list):
            still_needed = max(0, total_needed - sim_date_assigned[day_idx])
            if still_needed == 0:
                logger.info(
                    f"  PRE-SCAN {date}: fully assigned={sim_date_assigned[day_idx]}/{total_needed} ✓"
                )
                continue

            # How many of still_needed are night slots?
            # Count night coverage already placed (from OCR + Z23-B credits from earlier dates)
            current_night_sim = sum(
                1 for n in self.nurse_names
                if day_idx < len(self.schedule.get(n, []))
                and self.schedule[n][day_idx] is not None
                and self.schedule[n][day_idx].get("shiftType") == "night"
                and self.schedule[n][day_idx].get("hours", 0) > 0
            )
            nights_still_needed = max(0, self.night_req - current_night_sim)
            night_to_fill = min(still_needed, nights_still_needed)
            day_to_fill = still_needed - night_to_fill

            # All nurses available for this date (any remaining capacity)
            all_available = [
                n for n in self.nurse_names
                if day_idx in nurse_avail_set.get(n, set()) and sim_remaining.get(n, 0) >= 1
            ]
            # Night-capable nurses need ≥2 remaining shift slots (Z19 + auto Z23 B)
            night_capable = [n for n in all_available if sim_remaining.get(n, 0) >= 2]

            will_fill_night = min(len(night_capable), night_to_fill)
            # Day nurses = total available minus those dedicated to night
            will_fill_day = min(len(all_available) - will_fill_night, day_to_fill)
            will_fill = will_fill_night + will_fill_day
            shortfall = still_needed - will_fill

            logger.info(
                f"  PRE-SCAN {date}: assigned={sim_date_assigned[day_idx]}/{total_needed}, "
                f"still_needed={still_needed} (day={day_to_fill}, night={night_to_fill}), "
                f"can_fill={len(all_available)} (night_capable={len(night_capable)}), "
                f"{'SHORTAGE shortfall=' + str(shortfall) if shortfall > 0 else 'OK'}"
            )

            # ── Consume night nurses (Z19 cascade model) ────────────────
            # Each Z19 burns 2 slots and blocks 3 consecutive days.
            # The auto-placed Z23 B on D+1 provides +1 night credit for
            # the NEXT date, so the simulation stays accurate.
            night_consumed: set[str] = set()
            night_filled = 0
            for n in night_capable:
                if night_filled >= will_fill_night:
                    break
                sim_remaining[n] = max(0, sim_remaining[n] - 2)    # Z19 + Z23 B = 2 shifts
                nurse_avail_set[n].discard(day_idx)                   # blocked: D (Z19 night)
                if day_idx + 1 < len(self.date_list):
                    nurse_avail_set[n].discard(day_idx + 1)           # blocked: D+1 (Z23 B)
                    sim_date_assigned[day_idx + 1] += 1               # Z23 B auto-covers D+1 night
                if day_idx + 2 < len(self.date_list):
                    nurse_avail_set[n].discard(day_idx + 2)           # blocked: D+2 (Z23 tail)
                night_consumed.add(n)
                night_filled += 1

            # ── Consume day nurses (no cascade) ─────────────────────────
            day_filled = 0
            for n in all_available:
                if day_filled >= will_fill_day:
                    break
                if n in night_consumed:
                    continue
                sim_remaining[n] = max(0, sim_remaining[n] - 1)
                nurse_avail_set[n].discard(day_idx)
                day_filled += 1

            if shortfall > 0:
                shortage_score = shortfall / max(1, still_needed)
                shortage_dates.append((day_idx, date, shortage_score, sim_date_assigned[day_idx], shortfall, total_needed))
                logger.warning(
                    f"  ⚠️  AT-RISK: {date} needs {still_needed} more, "
                    f"only {will_fill} fillable "
                    f"(night={will_fill_night}/{night_to_fill}, day={will_fill_day}/{day_to_fill}), "
                    f"shortfall={shortfall}"
                )

        # Sort shortage dates by severity (highest shortfall ratio first)
        shortage_dates.sort(key=lambda x: -x[2])

        if shortage_dates:
            logger.info(f"PRIORITY ASSIGNMENT: Processing {len(shortage_dates)} at-risk dates first")
            dates_to_process_first = set(d[1] for d in shortage_dates)
        else:
            logger.info("No at-risk dates detected - proceeding with chronological assignment")
            dates_to_process_first = set()
        
        # ============================================================
        # MAIN LOOP: Process dates (shortage dates first, then chronological)
        # ============================================================
        # Build processing order: shortage dates first, then remaining in chronological order
        processing_order = [d[1] for d in shortage_dates]  # Shortage dates sorted by severity
        processing_order += [d for d in self.date_list if d not in dates_to_process_first]  # Remaining dates
        
        logger.info("=" * 80)
        logger.info(f"📅 GAP-FILLING LOOP: Processing {len(processing_order)} dates")
        logger.info(f"  Processing order (first 5): {processing_order[:5]}")
        logger.info(f"  Chronological order (first 5): {self.date_list[:5]}")
        logger.info(f"  {'✓ Priority-based' if processing_order[:5] != self.date_list[:5] else '❌ Still chronological!'}")
        logger.info("=" * 80)
        
        for date in processing_order:
            day_idx = self.date_to_index[date]
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

                    # MCH Night Linkage: if previous day had Z19 or Z23 B,
                    # this day is locked for Z23 ↩ continuation — skip gap-fill.
                    if self._is_locked_for_night_continuation(nurse_name, day_idx):
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
                    elif self.has_reached_shift_limit(nurse_name, date):
                        # Nurse already at shift limit for this period
                        blocked_by_hours.add(nurse_name)
                    elif self.has_reached_target_hours(nurse_name, date, 12 if self._is_full_time(nurse_name) else 8):
                        # HARD: would exceed biweekly target hours
                        blocked_by_hours.add(nurse_name)
                    elif remaining < 7.5:
                        # Not enough room for even an 8h shift (7.5h paid)
                        blocked_by_hours.add(nurse_name)
                    elif self._is_full_time(nurse_name) and remaining >= 12:
                        # FT nurses with room for 12h shift
                        available_nurses.append(nurse_name)
                    elif self._is_full_time(nurse_name) and remaining >= 7.5:
                        # FT nurses with room for 8h shift (e.g., 67.5h → needs 7.5h more)
                        available_nurses.append(nurse_name)
                    elif not self._is_full_time(nurse_name) and remaining >= 8:
                        # PT nurses can work with 8h+ remaining
                        available_nurses.append(nurse_name)
                    else:
                        blocked_by_hours.add(nurse_name)
                elif shift["shiftType"] == "day":
                    day_count += 1
                elif shift["shiftType"] == "night":
                    # Z23 tails (0h) are finishing nurses — NOT fresh night coverage.
                    # Z23 B (bridge, 11.25h) IS active night coverage — nurse returns at 19:00.
                    # Z19 IS active night coverage — nurse starts at 19:00.
                    shift_code = str(shift.get("shift", "")).strip()
                    shift_hours = float(shift.get("hours", 0) or 0)
                    if shift_hours == 0 or (shift_code == "Z23" and shift_hours == 0):
                        pass  # Z23 tail (0h) — not active night coverage
                    else:
                        night_count += 1  # Z19, Z23 B, 23 — all active night workers
                # Don't increment consecutive here - we recalculate at start of each day
            
            # Sort: PT first (cheaper for gap-fill), then by hours deficit.
            # This prevents FT nurses from being front-loaded on early days
            # while PT nurses (Jasmine, Khady, Katryn) sit idle.
            available_nurses.sort(
                key=lambda n: (
                    0 if (self._is_weekend_date(date) and self._weekend_commitment_missing(n, date)) else 1,
                    self._is_full_time(n),  # PT (False=0) before FT (True=1)
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

            # Compute adaptive caps for this day (allows target-balancing beyond min)
            daily_staff_cap_gap = self._get_dynamic_daily_staff_cap(date)
            day_cap_gap = max(self.day_req, int(daily_staff_cap_gap * self.day_req / (self.day_req + self.night_req) + 0.5))
            night_cap_gap = max(self.night_req, daily_staff_cap_gap - day_cap_gap)

            # Fill day shifts first (only from any_shift pool)
            while day_count < day_cap_gap and any_shift_nurses:
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
            while night_count < night_cap_gap and night_candidates:
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
            # NOTE: FT 7-shift limit is NEVER relaxed - it's a hard contract constraint.
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
                    # HARD CONSTRAINT: shift limit per 14-day period
                    if self.has_reached_shift_limit(nurse_name, date):
                        continue
                    # HARD CONSTRAINT: never exceed biweekly target hours
                    if self.has_reached_target_hours(nurse_name, date, self.reference_shift_hours):
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
                        try:
                            relaxed_pool.remove(candidate)
                        except ValueError:
                            pass
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
                    # HARD CONSTRAINT: shift limit per 14-day period
                    if self.has_reached_shift_limit(nurse_name, date):
                        continue
                    # HARD CONSTRAINT: never exceed biweekly target hours
                    if self.has_reached_target_hours(nurse_name, date, self.reference_shift_hours):
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

            # 8H SHIFT FALLBACK: If still understaffed, allow hours-blocked nurses
            # to take 8h shifts (7.5h paid) when they can't take 12h shifts.
            # This addresses the "hours-blocked candidates" warning.
            if day_count < self.day_req or night_count < self.night_req:
                already_assigned = set(nurses_for_day + nurses_for_night)
                fallback_8h_pool = []

                for nurse_name in self.nurse_names:
                    if nurse_name in already_assigned:
                        continue
                    if self._nurse_has_ocr_baseline(nurse_name):
                        continue
                    if self.schedule[nurse_name][day_idx] is not None:
                        continue
                    if date in self.get_off_requests(nurse_name):
                        continue
                    # HARD CONSTRAINT: shift limit per 14-day period
                    if self.has_reached_shift_limit(nurse_name, date):
                        continue
                    # Consecutive days guard - respect max consecutive
                    if nurse_consecutive_count[nurse_name] >= self.max_consecutive:
                        continue
                    # Check if nurse is blocked for 12h but NOT blocked for 8h
                    remaining = self.get_remaining_hours(nurse_name, date)
                    if remaining >= 7.5 and remaining < 12:
                        # Can take 8h shift but not 12h
                        fallback_8h_pool.append(nurse_name)
                    elif self.has_reached_target_hours(nurse_name, date, 12):
                        # Would exceed target with 12h, but check for 8h
                        if not self.has_reached_target_hours(nurse_name, date, 8):
                            fallback_8h_pool.append(nurse_name)

                if fallback_8h_pool:
                    fallback_8h_pool.sort(
                        key=lambda n: (
                            0 if (self._is_weekend_date(date) and self._weekend_commitment_missing(n, date)) else 1,
                            self.get_target_delta(n, date) >= 0,
                            self.get_target_delta(n, date),
                            sum(self.nurse_period_hours.get(n, {}).values()),
                            -self.get_certification_score(n),
                            -self.nurse_seniority.get(n, 0),
                        )
                    )

                    # Partition: nurses who can work day vs night-only (worked previous night)
                    fallback_day_pool = []
                    fallback_night_only_pool = []
                    for n in fallback_8h_pool:
                        if self._worked_night_previous_day(n, day_idx):
                            fallback_night_only_pool.append(n)
                        else:
                            fallback_day_pool.append(n)

                    # Fill DAY shortages with 8h shifts (only from day-eligible pool)
                    while day_count < self.day_req and fallback_day_pool:
                        candidate = fallback_day_pool.pop(0)
                        nurses_for_day.append(candidate)
                        already_assigned.add(candidate)
                        day_count += 1
                        logger.info(
                            f"    8H FALLBACK: {candidate} assigned 8h DAY on {date} (hours-blocked for 12h)"
                        )

                    # Fill NIGHT shortages with 8h shifts (night-only first, then remaining day-eligible)
                    combined_night_pool = fallback_night_only_pool + fallback_day_pool
                    while night_count < self.night_req and combined_night_pool:
                        candidate = combined_night_pool.pop(0)
                        if candidate in already_assigned:
                            continue
                        nurses_for_night.append(candidate)
                        already_assigned.add(candidate)
                        night_count += 1
                        logger.info(
                            f"    8H FALLBACK: {candidate} assigned 8h NIGHT on {date} (hours-blocked for 12h)"
                        )

            # LAST-RESORT MINIMUM COVERAGE: if STILL below minimum after all pools,
            # allow nurses who exceeded their biweekly target to take an 8h shift.
            # This guarantees every day meets minimum staffing (patient safety).
            if day_count < self.day_req or night_count < self.night_req:
                already_assigned = set(nurses_for_day + nurses_for_night)
                last_resort_pool = []

                for nurse_name in self.nurse_names:
                    if nurse_name in already_assigned:
                        continue
                    if self._nurse_has_ocr_baseline(nurse_name):
                        continue
                    if self.schedule[nurse_name][day_idx] is not None:
                        continue
                    if date in self.get_off_requests(nurse_name):
                        continue
                    # HARD CONSTRAINT: shift limit per 14-day period
                    if self.has_reached_shift_limit(nurse_name, date):
                        continue
                    # NOTE: deliberately NO hours check — that is the whole point
                    last_resort_pool.append(nurse_name)

                last_resort_pool.sort(
                    key=lambda n: (
                        # 1) PT first (0) — lower target = cheaper to pull, avoids FT OT
                        0 if not self._is_full_time(n) else 1,
                        # 2) Within PT/FT, prefer LEAST over target (minimize overshoot)
                        sum(self.nurse_period_hours.get(n, {}).values()),
                        -self.get_certification_score(n),
                        -self.nurse_seniority.get(n, 0),
                    )
                )

                while day_count < self.day_req and last_resort_pool:
                    candidate = last_resort_pool[0]
                    last_resort_pool.pop(0)
                    if self._worked_night_previous_day(candidate, day_idx):
                        continue
                    nurses_for_day.append(candidate)
                    already_assigned.add(candidate)
                    day_count += 1
                    logger.warning(
                        f"    LAST-RESORT: {candidate} assigned 8h DAY on {date} "
                        f"(over biweekly target — minimum coverage)"
                    )

                while night_count < self.night_req and last_resort_pool:
                    candidate = last_resort_pool[0]
                    last_resort_pool.pop(0)
                    if candidate in already_assigned:
                        continue
                    nurses_for_night.append(candidate)
                    already_assigned.add(candidate)
                    night_count += 1
                    logger.warning(
                        f"    LAST-RESORT: {candidate} assigned 8h NIGHT on {date} "
                        f"(over biweekly target — minimum coverage)"
                    )

            # OPTIONAL EXTRA COVERAGE: DISABLED — hard cap at 5 day / 4 night.
            # All additional staffing is handled by spreading nurses across days,
            # not by overstaffing any single day.
            extra_assignments: Dict[str, Tuple[str, int]] = {}
            
            # Track which nurses were assigned via 8h fallback or last-resort (for shift assignment)
            nurses_via_8h_fallback = set()
            # Track last-resort nurses explicitly (they are OVER target, must use 8h)
            nurses_via_last_resort = set()
            for n in nurses_for_day + nurses_for_night:
                if self.has_reached_target_hours(n, date, 8):
                    # Over target even for 8h — this is a last-resort nurse
                    nurses_via_last_resort.add(n)
                    nurses_via_8h_fallback.add(n)
                else:
                    remaining = self.get_remaining_hours(n, date)
                    if remaining >= 7.5 and remaining < 12:
                        nurses_via_8h_fallback.add(n)
                    elif self.has_reached_target_hours(n, date, 12) and not self.has_reached_target_hours(n, date, 8):
                        nurses_via_8h_fallback.add(n)
            
            # Apply assignments
            for nurse_name in self.nurse_names:
                if self.schedule[nurse_name][day_idx] is None:
                    if nurse_name in nurses_for_day:
                        # Intelligently choose 8h vs 12h based on hours needed
                        remaining = self.get_target_remaining_hours(nurse_name, date)
                        is_ft = self._is_full_time(nurse_name)
                        # Force 8h if nurse was added via 8h fallback
                        if nurse_name in nurses_via_8h_fallback:
                            hours = 8
                        # If nurse needs < 10h to reach target, use 8h shift (avoids overshoot)
                        # Otherwise use 12h shift (standard for FT nurses)
                        elif remaining < 10.0 and remaining >= 7.5:
                            hours = 8
                        else:
                            hours = 12
                        hours = 8 if (remaining < 10.0 and remaining >= 7.5) else 12
                        shift = self.assign_shift(nurse_name, date, "day", hours=hours)
                        self.schedule[nurse_name][day_idx] = shift
                        nurse_consecutive_count[nurse_name] += 1
                    elif nurse_name in nurses_for_night:
                        # Intelligently choose 8h vs 12h for night shifts
                        remaining = self.get_target_remaining_hours(nurse_name, date)
                        is_ft = self._is_full_time(nurse_name)
                        
                        # CRITICAL LOOKAHEAD: check if future days need coverage!
                        # Z19 (12h) locks nurse for 3 days (Z19→Z23 B→Z23 tail),
                        # so if future days are predicted to be understaffed, prefer:
                        # 1) Standard 23 (8h) — no rotation, nurse free next day
                        # 2) Or avoid assigning this nurse to night at all if they're
                        #    critically needed for future day coverage.
                        future_shortfalls = self._predict_future_coverage_shortfall(date, lookhead_days=4)
                        
                        if future_shortfalls:
                            gaps_summary = []
                            for d, f in future_shortfalls.items():
                                gaps_summary.append(
                                    f"{d}: day_gap={f['day_gap']}/{f['day_need']}, night_gap={f['night_gap']}/{f['night_need']}"
                                )
                            logger.info(
                                f"    LOOKAHEAD on {date}: Future coverage predictions: {'; '.join(gaps_summary)}"
                            )
                        
                        critical_future_shortage = any(
                            (gap['day_gap'] >= 2 or gap['night_gap'] >= 2)
                            for gap in future_shortfalls.values()
                        )
                        
                        # Force 8h shift if future days are critically understaffed
                        # UNLESS nurse has very few shifts remaining and needs 12h
                        force_8h = False
                        if critical_future_shortage and is_ft:
                            # FT nurse: check if they can afford an 8h shift
                            # (won't leave them unable to hit 7-shift target)
                            current_shifts = self.get_period_shift_count(nurse_name, date)
                            z_shifts = self.get_period_z_shift_count(nurse_name, date)
                            remaining_slots = self.FT_MAX_SHIFTS_PER_PERIOD - current_shifts
                            needs_z_shifts = (self.FT_MIN_Z_SHIFTS - z_shifts)
                            # If nurse has room for multiple shifts and doesn't critically need Z-shifts
                            if remaining_slots >= 2 and needs_z_shifts <= remaining_slots - 1:
                                force_8h = True
                                logger.info(
                                    f"    LOOKAHEAD: {nurse_name} {date} using 8h night (not Z19) "
                                    f"to preserve availability for future coverage gaps: "
                                    f"{list(future_shortfalls.keys())}"
                                )
                        elif critical_future_shortage and not is_ft:
                            # PT nurse: prefer 8h to keep them available
                            force_8h = True
                            logger.info(
                                f"    LOOKAHEAD: {nurse_name} {date} using 8h night (not Z19) "
                                f"to preserve availability for future coverage gaps"
                            )
                        
                        # Determine shift hours
                        if force_8h:
                            hours = 8
                        elif remaining < 10.0 and remaining >= 7.5 and not is_ft:
                            # PT with < 10h remaining: use 8h
                            hours = 8
                        else:
                            # Default: 12h for FT, or FT with room
                            hours = 12
                        
                        shift = self.assign_shift(nurse_name, date, "night", hours=hours)
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

            # POST-ASSIGNMENT DE-PEAK: enforce adaptive daily cap.
            # Allow up to dynamic cap (day_req + buffer) per shift type to ensure
            # nurses can reach their 7th shift while preventing runaway overstaffing.
            daily_staff_cap = self._get_dynamic_daily_staff_cap(date)
            # Distribute the cap between day/night proportionally
            day_cap = max(self.day_req, int(daily_staff_cap * self.day_req / (self.day_req + self.night_req) + 0.5))
            night_cap = max(self.night_req, daily_staff_cap - day_cap)
            
            final_day_workers: List[str] = []
            final_night_workers: List[str] = []
            for nurse_name in self.nurse_names:
                shift = self.schedule[nurse_name][day_idx]
                if shift and shift.get("hours", 0) > 0:
                    if shift.get("shiftType") == "day":
                        final_day_workers.append(nurse_name)
                    elif shift.get("shiftType") == "night":
                        final_night_workers.append(nurse_name)

            # Remove excess DAY nurses above day_cap
            day_excess = len(final_day_workers) - day_cap
            if day_excess > 0:
                # Sort: remove over-target, non-OCR nurses first
                removable = [n for n in final_day_workers if (n, date) not in self.ocr_assignments]
                removable.sort(key=lambda n: (
                    -self.get_target_delta(n, date),
                    -self.nurse_period_hours.get(n, {}).get(self.date_to_period.get(date, "unknown"), 0),
                ))
                for candidate in removable[:day_excess]:
                    current_shift = self.schedule[candidate][day_idx]
                    removed_hours = current_shift.get("hours", 0) if current_shift else 0
                    if removed_hours > 0:
                        self._track_hours(candidate, date, -float(removed_hours), shift_delta=-1)
                    self.schedule[candidate][day_idx] = self.assign_off(candidate, date)
                    self.nurse_total_shifts[candidate] = max(0, self.nurse_total_shifts.get(candidate, 0) - 1)
                    final_day_workers.remove(candidate)
                    logger.info(f"    HARD-CAP: removed {candidate} from DAY on {date} (day_req={self.day_req})")

            # Remove excess NIGHT nurses above night_cap
            night_excess = len(final_night_workers) - night_cap
            if night_excess > 0:
                removable = [n for n in final_night_workers if (n, date) not in self.ocr_assignments]
                removable.sort(key=lambda n: (
                    -self.get_target_delta(n, date),
                    -self.nurse_period_hours.get(n, {}).get(self.date_to_period.get(date, "unknown"), 0),
                ))
                for candidate in removable[:night_excess]:
                    current_shift = self.schedule[candidate][day_idx]
                    removed_hours = current_shift.get("hours", 0) if current_shift else 0
                    if removed_hours > 0:
                        self._track_hours(candidate, date, -float(removed_hours), shift_delta=-1)
                    self.schedule[candidate][day_idx] = self.assign_off(candidate, date)
                    self.nurse_total_shifts[candidate] = max(0, self.nurse_total_shifts.get(candidate, 0) - 1)
                    final_night_workers.remove(candidate)
                    logger.info(f"    HARD-CAP: removed {candidate} from NIGHT on {date} (night_req={self.night_req})")

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
        logger.info(f"  ⏱ STEP 2 completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
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

                # HARD CONSTRAINT: shift limit per 14-day period
                if self.has_reached_shift_limit(nurse_name, self.date_list[0]):
                    logger.info(f"    {nurse_name}: already at shift limit, cannot force-fill")
                    break

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

                    # MCH Night Linkage: skip days locked for Z23 ↩ continuation
                    if self._is_locked_for_night_continuation(nurse_name, day_idx):
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

                    # ANTI-OVERSTAFF GUARD (relaxed for target-balancing):
                    # Prefer days with coverage deficits. If no deficit, still allow
                    # placement up to the daily cap so under-target nurses can reach
                    # their 7th shift (needed for FT 78.75h / 75h target).
                    day_deficit = max(0, self.day_req - day_staff)
                    night_deficit = max(0, self.night_req - night_staff)

                    # Also respect adaptive daily cap during force-fill.
                    daily_staff_cap = self._get_dynamic_daily_staff_cap(date)
                    if (day_staff + night_staff) >= daily_staff_cap:
                        continue

                    # Score: prefer days with less total coverage (understaffed days first)
                    total_staff = day_staff + night_staff
                    # Prefer the type that's most understaffed

                    if came_off_night:
                        # Can only work night
                        score = -(night_deficit if night_deficit > 0 else 0) + total_staff
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
                        # NEVER slide Z19 night shifts — they have Z23 ↩ linkage
                        # that we can't safely reconstruct after a slide.
                        if str(s.get("shift", "")).strip().upper() == "Z19":
                            continue
                        if s.get("shiftType") == "night":
                            continue  # Don't slide any night shift (complex linkage)
                        for neighbour_offset in (-1, 1):
                            ni = di + neighbour_offset
                            if ni < 0 or ni >= len(self.date_list):
                                continue
                            ns = self.schedule[nurse_name][ni]
                            if ns and ns.get("hours", 0) > 0:
                                continue  # Neighbour already has a real shift
                            # NEVER slide into a Z23 ↩ continuation slot
                            if ns and ns.get("shiftType") == "night":
                                ns_sc = str(ns.get("shift", "")).strip()
                                if "Z23" in ns_sc or "↩" in ns_sc:
                                    continue
                            # NEVER slide into a day AFTER Z19 (locked day)
                            if ni > 0 and ni - 1 < len(self.schedule[nurse_name]):
                                prev_ns = self.schedule[nurse_name][ni - 1]
                                if prev_ns:
                                    prev_sc_ns = str(prev_ns.get("shift", "")).strip()
                                    if prev_sc_ns in ("Z19", "Z23 B") and float(prev_ns.get("hours", 0) or 0) > 0:
                                        continue  # This slot is locked after a night shift
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

                # Determine shift type: prefer the side with biggest coverage deficit.
                # If no deficit, default to day (more desirable, better for balance).
                if came_off_night:
                    shift_type = "night"
                elif night_deficit > day_deficit:
                    shift_type = "night"
                elif day_deficit > 0:
                    shift_type = "day"
                else:
                    # No coverage deficit — add to the least-staffed side
                    # Prefer day shifts to balance the schedule (avoids night-heavy skew)
                    shift_type = "day" if day_staff <= night_staff else "night"

                # INTELLIGENT SHIFT-LENGTH SELECTION:
                # Choose 8h vs 12h based on how many hours the nurse needs
                # to reach their target without significantly overshooting.
                fill_hours = 12
                remaining = self.get_target_remaining_hours(nurse_name, date)
                
                if not self._is_full_time(nurse_name):
                    # PT: Use 8h shift if they need 7.5-10h more (avoids overshoot)
                    if 7.5 <= remaining < 10.0:
                        fill_hours = 8
                        logger.info(f"    8h TOP-UP for PT {nurse_name}: remaining={remaining:.1f}h, using 8h shift")
                    else:
                        logger.info(f"    PT {nurse_name}: remaining={remaining:.1f}h, using 12h shift")
                else:
                    # FT: Use 8h shift only if they need 7.5-10h more
                    # (e.g., 67.5h → 75h target, remaining=7.5h)
                    # Otherwise use 12h (standard for FT to reach 78.75h with 7 shifts)
                    if 7.5 <= remaining < 10.0:
                        fill_hours = 8
                        logger.info(f"    8h TOP-UP for FT {nurse_name}: remaining={remaining:.1f}h, using 8h shift")
                    else:
                        logger.info(f"    FT {nurse_name}: remaining={remaining:.1f}h, using 12h shift")

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
        logger.info(f"  ⏱ STEP 2.5 completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # STEP 3: FINAL OCR ENFORCEMENT
        # Safety net: after all gap-filling and de-peaking, scan every
        # nurse's OCR data and force-correct any shift that was dropped
        # or overwritten.  This GUARANTEES OCR assignments survive.
        # ============================================================
        logger.info("=" * 80)
        logger.info("STEP 3: FINAL OCR ENFORCEMENT (authoritative overlay)")
        logger.warning("🎯 OCR ASSIGNMENTS RECEIVED (self.preferences):")
        for nurse_name, shifts in (self.preferences or {}).items():
            non_empty = [s for s in shifts if s and str(s).strip() and str(s).strip() not in ("—", "-")]
            if non_empty:
                logger.warning(f"  '{nurse_name}': {non_empty}")
        logger.info("=" * 80)
        
        ocr_corrections = 0
        ocr_already_correct = 0
        schedule_name_by_norm = {
            self._normalize_nurse_name_key(n): n for n in self.nurse_names
        }

        for pref_name, pref_shifts in (self.preferences or {}).items():
            # CRITICAL DEBUG: Log the exact nurse name from OCR
            normalized_pref = self._normalize_nurse_name_key(pref_name)
            schedule_name = schedule_name_by_norm.get(normalized_pref)
            logger.warning(f"🔍 STEP 3 NURSE MATCH: OCR name='{pref_name}' normalized='{normalized_pref}' → schedule_name='{schedule_name}'")
            if not schedule_name:
                logger.warning(f"  ⚠️ OCR OVERLAY SKIP: nurse '{pref_name}' not found in active schedule")
                logger.warning(f"  Available schedule names: {list(schedule_name_by_norm.values())}")
                continue

            for day_idx, raw_ocr in enumerate(pref_shifts or []):
                if day_idx >= len(self.date_list):
                    break
                if not raw_ocr or not str(raw_ocr).strip():
                    continue

                raw_ocr = str(raw_ocr).strip()
                shift_upper = raw_ocr.upper()
                date = self.date_list[day_idx]

                # CRITICAL: Check for composite CF codes FIRST (e.g., "CF-4 07")
                # These are WORKING shifts, NOT off days
                is_composite_cf = self._is_composite_cf_shift(raw_ocr)

                is_off_code = (
                    not is_composite_cf and (  # Only if NOT composite CF
                        shift_upper in ["C", "OFF"]
                        or shift_upper.startswith("CF")
                        or "CF " in shift_upper
                    )
                )

                # DEBUG: Log composite CF processing in STEP 3
                if "CF" in shift_upper and any(c.isdigit() for c in shift_upper):
                    logger.warning(
                        f"🎯 STEP 3 CF DEBUG: {schedule_name} {date}: "
                        f"raw='{raw_ocr}' | is_composite={is_composite_cf} | is_off={is_off_code}"
                    )

                current = (
                    self.schedule[schedule_name][day_idx]
                    if day_idx < len(self.schedule.get(schedule_name, []))
                    else None
                )

                # CRITICAL FIX: Composite CF shifts override offRequests
                # Even if date is in offRequests, composite CF codes (e.g., "CF-4 07")
                # are WORKING shifts and must be processed as such, not as OFF days.
                is_off_request = date in self.get_off_requests(schedule_name)
                
                # Only treat as OFF if: (offRequest OR off_code) AND NOT composite CF
                if (is_off_request or is_off_code) and not is_composite_cf:
                    if current and current.get("hours", 0) > 0:
                        # Remove a real shift - decrement shift count
                        self._track_hours(schedule_name, date, -float(current["hours"]), shift_delta=-1)
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

                # OVERNIGHT TAIL MARKER: Only skip if OCR itself contains a ↩ marker
                # (meaning OCR explicitly wants a tail, not a work shift)
                if "↩" in raw_ocr:
                    # OCR explicitly specifies continuation marker — keep it
                    ocr_already_correct += 1
                    continue

                # OCR OVERRIDE: If OCR has a real shift code (like CF-11 07), it should
                # REPLACE any system-placed Z23 tail, because OCR is authoritative.
                # No longer protect Z23 tails from OCR overwrite — OCR wins.

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
                old_type = current.get("shiftType", "None") if current else "None"
                logger.warning(
                    f"  🎯 STEP 3 OCR CORRECTION: {schedule_name} on {date}: "
                    f"'{old_label}' (was {old_type}) -> '{raw_ocr}' (NOW shiftType={shift_info['type']}, hours={shift_info['hours']}h)"
                )

                if current and current.get("hours", 0) > 0:
                    # Replacing a real shift with OCR shift - adjust shift count
                    self._track_hours(schedule_name, date, -float(current["hours"]), shift_delta=-1)
                # Add the OCR shift
                self._track_hours(schedule_name, date, float(shift_info["hours"]), shift_delta=1)

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

        logger.info(f"  ⏱ STEP 3 completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # ============================================================
        # STEP 4: WORKLOAD EQUALIZATION
        # Swap shifts from over-target nurses (+delta) to under-target
        # nurses (−delta) to reduce FTE variance.  Only NON-OCR shifts
        # are eligible for redistribution.
        # ============================================================
        self._equalize_workload()

        logger.info(f"  ⏱ STEP 4 (equalization) completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # ============================================================
        # STEP 4.5: COVERAGE REBALANCING
        # After equalization, some days may still be below minimum
        # staffing because equalization only balances per-nurse hours,
        # not per-day coverage.  This step moves shifts from overstaffed
        # days to understaffed days to guarantee minimums are met.
        # ============================================================
        self._rebalance_daily_coverage()

        logger.info(f"  ⏱ STEP 4.5 (coverage rebalance) completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # ============================================================
        # STEP 4.75: TARGET COMPLETION
        # After coverage rebalancing, some nurses may still be 1+ shifts
        # short because the strict daily cap prevented assignment.
        # This pass ignores the daily cap and tries to give each
        # under-target nurse their remaining shifts.
        # ============================================================
        self._complete_target_hours()

        logger.info(f"  ⏱ STEP 4.75 (target completion) completed in {_time.monotonic() - _step_t0:.2f}s")
        _step_t0 = _time.monotonic()
        # ============================================================
        # STEP 5: FINAL SAFETY PASS
        # After all optimization, run a final sweep that:
        #   (a) Enforces MCH night linkage (Z19/Z23 B → Z23 ↩ on N+1).
        #   (b) Enforces 12.5h max per nurse per day (hard limit).
        #   (c) Enforces max 3 consecutive work days.
        # This is the absolute last word before the schedule is returned.
        # ============================================================
        self._final_safety_pass()
        logger.info(f"  ⏱ STEP 5 (safety pass) completed in {_time.monotonic() - _step_t0:.2f}s")

        logger.info(f"  ⏱ TOTAL build_schedule time: {_time.monotonic() - _build_t0:.2f}s")
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
        MAX_EQUALIZATION_SECONDS = 15  # Time-box equalization to prevent timeouts
        _eq_start = _time.monotonic()
        swaps_done = 0

        for iteration in range(MAX_SWAPS):
            # Time-based early exit
            if _time.monotonic() - _eq_start > MAX_EQUALIZATION_SECONDS:
                logger.info(f"  Equalization time limit ({MAX_EQUALIZATION_SECONDS}s) reached after {swaps_done} swaps.")
                break
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

                        # MCH Night Linkage: never swap Z19 (has Z23 ↩ on N+1)
                        # or Z23 ↩ continuations (0h, not real shifts)
                        donor_code = str(donor_shift.get("shift", "")).strip().upper()
                        if donor_code in ("Z19", "Z23 B") or donor_shift.get("hours", 0) <= 0:
                            continue

                        # Recipient must be OFF on this day
                        if recip_shift and recip_shift.get("hours", 0) > 0:
                            continue

                        # MCH Night Linkage: recipient's slot must not be locked for Z23 ↩
                        if self._is_locked_for_night_continuation(recip_name, day_idx):
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

                        # Shift cap: never give a recipient more than their max shifts
                        recip_shifts = self.nurse_total_shifts.get(recip_name, 0)
                        if self._is_full_time(recip_name):
                            if recip_shifts >= self.FT_MAX_SHIFTS_PER_PERIOD:
                                continue
                        else:
                            recip_tbw = self.get_target_biweekly_hours(recip_name)
                            recip_pt_max = max(1, int(recip_tbw / self.reference_shift_hours + 0.5))
                            if recip_shifts >= recip_pt_max:
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
                        self._track_hours(donor_name, date, -float(shift_hours), shift_delta=-1)
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
                        self._track_hours(recip_name, date, float(shift_hours), shift_delta=1)
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

    def _rebalance_daily_coverage(self) -> None:
        """STEP 4.5 — Move shifts from overstaffed days to understaffed days.

        After gap-filling and equalization, some days may still be below the
        minimum staffing requirement because nurses ran out of target hours.
        This step finds overstaffed days (above minimum + 1) and moves shifts
        to understaffed days (below minimum) by relocating the same nurse's
        shift from one day to another.

        Only non-OCR, non-linkage shifts are eligible for relocation.
        """
        logger.info("=" * 80)
        logger.info("STEP 4.5: COVERAGE REBALANCING — enforce daily minimums")

        MAX_MOVES = 200
        moves_done = 0
        _rebal_start = _time.monotonic()
        MAX_REBALANCE_SECONDS = 20

        for _pass in range(MAX_MOVES):
            if _time.monotonic() - _rebal_start > MAX_REBALANCE_SECONDS:
                logger.info(f"  Coverage rebalancing time limit ({MAX_REBALANCE_SECONDS}s) reached after {moves_done} moves.")
                break

            # Compute per-day staffing
            day_staff = {}
            night_staff = {}
            for day_idx, date in enumerate(self.date_list):
                dc, nc = 0, 0
                for nurse_name in self.nurse_names:
                    shift = self.schedule[nurse_name][day_idx]
                    if shift and shift.get("hours", 0) > 0:
                        if shift.get("shiftType") == "day":
                            dc += 1
                        elif shift.get("shiftType") == "night":
                            nc += 1
                day_staff[day_idx] = dc
                night_staff[day_idx] = nc

            # Find most understaffed day (largest deficit)
            worst_deficit = 0
            worst_day_idx = -1
            worst_type = None  # "day" or "night"
            for day_idx in range(len(self.date_list)):
                day_gap = self.day_req - day_staff[day_idx]
                night_gap = self.night_req - night_staff[day_idx]
                if day_gap > worst_deficit:
                    worst_deficit = day_gap
                    worst_day_idx = day_idx
                    worst_type = "day"
                if night_gap > worst_deficit:
                    worst_deficit = night_gap
                    worst_day_idx = day_idx
                    worst_type = "night"

            if worst_deficit <= 0:
                logger.info(f"  All days meet minimum coverage after {moves_done} moves.")
                break

            target_date = self.date_list[worst_day_idx]
            logger.info(
                f"  Pass {_pass+1}: {target_date} needs {worst_deficit} more {worst_type} nurse(s) "
                f"(has {day_staff[worst_day_idx]}/{self.day_req} day, {night_staff[worst_day_idx]}/{self.night_req} night)"
            )

            # Find a donor day with surplus for this shift type AND a nurse we can move
            moved = False
            # Sort donor days by surplus (most overstaffed first)
            if worst_type == "day":
                donor_days = sorted(
                    [(di, day_staff[di] - self.day_req) for di in range(len(self.date_list)) if di != worst_day_idx and day_staff[di] > self.day_req],
                    key=lambda x: -x[1]
                )
            else:
                donor_days = sorted(
                    [(di, night_staff[di] - self.night_req) for di in range(len(self.date_list)) if di != worst_day_idx and night_staff[di] > self.night_req],
                    key=lambda x: -x[1]
                )

            for donor_day_idx, surplus in donor_days:
                if moved:
                    break
                donor_date = self.date_list[donor_day_idx]

                # Find a nurse working on donor_date with matching type who is OFF on target_date
                for nurse_name in self.nurse_names:
                    if nurse_name in self.nurses_on_leave:
                        continue
                    donor_shift = self.schedule[nurse_name][donor_day_idx]
                    target_shift = self.schedule[nurse_name][worst_day_idx]

                    # Must have a work shift of the right type on donor day
                    if not donor_shift or donor_shift.get("hours", 0) <= 0:
                        continue
                    if donor_shift.get("shiftType") != worst_type:
                        continue

                    # Must NOT be OCR-assigned
                    if (nurse_name, donor_date) in self.ocr_assignments:
                        continue

                    # Must not be a linkage shift (Z19, Z23 B)
                    donor_code = str(donor_shift.get("shift", "")).strip().upper()
                    if donor_code in ("Z19", "Z23 B", "Z23B"):
                        continue

                    # Must be OFF on target day
                    if target_shift and target_shift.get("hours", 0) > 0:
                        continue

                    # Must not have an off-request on target day
                    if target_date in self.get_off_requests(nurse_name):
                        continue

                    # Must not be locked for night continuation on target day
                    if self._is_locked_for_night_continuation(nurse_name, worst_day_idx):
                        continue

                    is_night = worst_type == "night"
                    shift_hours = donor_shift.get("hours", 12)

                    # Must be able to work on target day (rest, consecutive, etc.)
                    if not self.can_work(nurse_name, target_date, is_night=is_night, hours=int(shift_hours)):
                        continue

                    # Check consecutive stretch on target day
                    recip_stretch = self._get_consecutive_stretch(nurse_name, worst_day_idx)
                    if recip_stretch > self.max_consecutive:
                        continue

                    # Minimum rest: can't work day after a night
                    if is_night and worst_day_idx + 1 < len(self.date_list):
                        next_shift = self.schedule[nurse_name][worst_day_idx + 1]
                        if next_shift and next_shift.get("shiftType") == "day" and next_shift.get("hours", 0) > 0:
                            continue

                    # ── Execute the move ──
                    # Remove shift from donor day
                    self._track_hours(nurse_name, donor_date, -float(shift_hours), shift_delta=-1)
                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                    self.schedule[nurse_name][donor_day_idx] = self.assign_off(nurse_name, donor_date)

                    # Place shift on target day
                    new_shift = {
                        "id": str(uuid.uuid4()),
                        "date": target_date,
                        "shift": donor_shift.get("shift", ""),
                        "shiftType": worst_type,
                        "hours": shift_hours,
                        "startTime": donor_shift.get("startTime", ""),
                        "endTime": donor_shift.get("endTime", ""),
                    }
                    self.schedule[nurse_name][worst_day_idx] = new_shift
                    self._track_hours(nurse_name, target_date, float(shift_hours), shift_delta=1)
                    self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1

                    logger.info(
                        f"    MOVE #{moves_done + 1}: {nurse_name} {donor_shift.get('shift','')} "
                        f"{donor_date} -> {target_date} ({worst_type})"
                    )
                    moves_done += 1
                    moved = True
                    break  # restart scan with updated staffing

            if not moved:
                logger.warning(
                    f"  Could not find a movable shift for {target_date} ({worst_type}). "
                    f"Deficit remains: {worst_deficit}"
                )
                # Mark this day/type as unfillable to avoid looping forever
                # by trying to fill it in the next pass: set the requirement
                # effectively to current level for this scan
                break

        logger.info(f"COVERAGE REBALANCING COMPLETE: {moves_done} shifts relocated")
        logger.info("=" * 80)

    def _complete_target_hours(self) -> None:
        """STEP 4.75 — Final target completion for under-target nurses.

        After gap-filling + equalization + coverage rebalancing, some nurses
        may still be short by 1+ shifts because the strict daily staff cap
        (base_cap + 1) prevented them from being assigned.

        This pass **ignores the daily staff cap** and assigns shifts on any
        available day where the nurse can legally work, respecting all other
        constraints:
          • Off requests
          • Shift count limit (FT=7, PT=derived)
          • Biweekly target hours (with tolerance)
          • Consecutive-day limit
          • Night-rest guard (12h min between night→day)
          • OCR-locked slots
        """
        logger.info("=" * 80)
        logger.info("STEP 4.75: TARGET COMPLETION — fill under-target nurses (ignoring daily cap)")

        assignments = 0
        ref_date = self.date_list[0] if self.date_list else None
        if not ref_date:
            return

        # Build list of under-target nurses (delta < -3.75 = half a shift)
        under_target = []
        for nurse in self.nurse_names:
            delta = self.get_target_delta(nurse, ref_date)
            if delta < -3.75:
                under_target.append((nurse, delta))
        under_target.sort(key=lambda x: x[1])  # most under first

        if not under_target:
            logger.info("  All nurses at or above target — nothing to do.")
            logger.info("=" * 80)
            return

        logger.info(f"  {len(under_target)} nurses under target:")
        for name, delta in under_target:
            shifts = self.get_period_shift_count(name, ref_date)
            logger.info(f"    {name}: {delta:+.1f}h ({shifts} shifts)")

        for nurse_name, _ in under_target:
            # Re-check delta (previous iterations may have changed things)
            delta = self.get_target_delta(nurse_name, ref_date)
            if delta >= -3.75:
                continue

            # Decide preferred shift length: if FT nurse still needs Z-shifts,
            # try 12h first; otherwise 8h first (smaller, more flexible).
            prefer_12h = self.ft_needs_z_shift(nurse_name, ref_date)

            # Collect candidate days (OFF slots that aren't off-requests/OCR)
            day_scores = []
            for day_idx, date in enumerate(self.date_list):
                entry = self.schedule[nurse_name][day_idx]
                # Only consider OFF or empty slots
                if entry and entry.get("hours", 0) > 0:
                    continue
                # Skip OCR-locked days
                if (nurse_name, date) in self.ocr_assignments:
                    continue
                # Count current staffing (for sorting)
                total_staff = sum(
                    1 for n in self.nurse_names
                    if day_idx < len(self.schedule[n])
                    and self.schedule[n][day_idx]
                    and self.schedule[n][day_idx].get("hours", 0) > 0
                )
                day_scores.append((day_idx, date, total_staff))

            # Prefer understaffed days
            day_scores.sort(key=lambda x: x[2])

            for day_idx, date, total_staff in day_scores:
                delta = self.get_target_delta(nurse_name, ref_date)
                if delta >= -3.75:
                    break

                assigned = False
                # Build shift attempt order
                if prefer_12h:
                    attempts = [
                        ("day", 12, 11.25),
                        ("day", 8, 7.5),
                        ("night", 8, 7.5),
                    ]
                else:
                    attempts = [
                        ("day", 8, 7.5),
                        ("day", 12, 11.25),
                        ("night", 8, 7.5),
                    ]

                for shift_type, shift_hours_param, paid_hours in attempts:
                    is_night = shift_type == "night"
                    if self.can_work(nurse_name, date, is_night=is_night, hours=shift_hours_param):
                        shift_entry = self.assign_shift(nurse_name, date, shift_type, hours=shift_hours_param)
                        self.schedule[nurse_name][day_idx] = shift_entry
                        self._track_hours(nurse_name, date, paid_hours, shift_delta=1)
                        self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                        assignments += 1
                        code = shift_entry.get("shift", "?")
                        logger.info(
                            f"  TARGET-FILL: {nurse_name} ← {code} ({paid_hours}h) on {date} "
                            f"[day total staff → {total_staff + 1}]"
                        )
                        assigned = True
                        break

                if not assigned:
                    logger.debug(
                        f"  TARGET-FILL: no valid slot for {nurse_name} on {date}"
                    )

        logger.info(f"TARGET COMPLETION: {assignments} shifts assigned")
        if assignments > 0:
            for nurse_name, _ in under_target:
                delta = self.get_target_delta(nurse_name, ref_date)
                shifts = self.get_period_shift_count(nurse_name, ref_date)
                marker = "✓" if delta >= -3.75 else "⚠️"
                logger.info(f"  {marker} {nurse_name}: {delta:+.1f}h ({shifts} shifts)")
        logger.info("=" * 80)

    def _final_safety_pass(self) -> None:
        """STEP 5 — Final safety sweep after all optimization.

        (a) Enforce MCH night linkage: Z19/Z23 B → Z23 tail on N+1.
        (b) Enforce 12.5h max per nurse per day (hard limit).
        (c) Enforce max consecutive work days.
        """
        logger.info("=" * 80)
        logger.info("STEP 5: FINAL SAFETY PASS")

        # (a) Night linkage enforcement — Z19→Z23 B→Z23 mandatory pattern.
        #     Bridge/tail model: Z23 B = 11.25h, Z23 = 0h.
        #     Z19 on day N → Z23 B(11.25h) on N+1 → Z23(0h) on N+2
        #     Z23 B on day N → Z23(0h) on N+1
        linkage_fixes = 0
        for nurse_name in self.nurse_names:
            row = self.schedule.get(nurse_name, [])
            for day_idx in range(len(row)):
                curr = row[day_idx]
                if not curr:
                    continue
                curr_code = str(curr.get("shift", "")).strip().upper()
                curr_h = float(curr.get("hours", 0) or 0)
                if curr_h <= 0:
                    continue
                if curr_code not in ("Z19", "Z23 B", "Z23B"):
                    continue

                is_z19 = (curr_code == "Z19")

                if day_idx + 1 < len(self.date_list):
                    while len(row) <= day_idx + 1:
                        row.append(None)
                    nxt = row[day_idx + 1]
                    nxt_code = str(nxt.get("shift", "")).strip().upper() if nxt else ""
                    nxt_h = float(nxt.get("hours", 0) or 0) if nxt else 0
                    next_date = self.date_list[day_idx + 1]

                    if is_z19:
                        # Z19 → must have Z23 B(11.25h) on N+1
                        if nxt and "Z23" in nxt_code:
                            if nxt_code in ("Z23 B", "Z23B"):
                                # Already Z23 B — fix hours if needed
                                if nxt_h != 11.25:
                                    old_h = nxt_h
                                    if old_h > 0:
                                        self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                                        self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                    nxt["hours"] = 11.25
                                    nxt["shiftType"] = "night"
                                    self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                                    self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                                    linkage_fixes += 1
                                    logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {next_date}: Z23 B hours {old_h}→11.25 (after Z19)")
                            else:
                                # Plain Z23 or other — upgrade to Z23 B
                                old_h = nxt_h
                                if old_h > 0:
                                    self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1)
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                nxt["shift"] = "Z23 B"
                                nxt["hours"] = 11.25
                                nxt["shiftType"] = "night"
                                self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                                self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                                linkage_fixes += 1
                                logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {next_date}: UPGRADED to Z23 B (after Z19)")
                        elif not nxt or nxt.get("shiftType") == "off" or nxt_h == 0:
                            # Empty — place Z23 B bridge
                            row[day_idx + 1] = {
                                "id": str(uuid.uuid4()), "date": next_date, "shift": "Z23 B",
                                "shiftType": "night", "hours": 11.25, "startTime": "00:00", "endTime": "07:25"
                            }
                            self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                            self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                            linkage_fixes += 1
                            logger.info(f"  ⛓️ SAFETY ADD: {nurse_name} {next_date}: added Z23 B bridge after Z19")
                        else:
                            logger.warning(f"  ⚠️ LINKAGE CONFLICT: {nurse_name} {next_date}: '{nxt_code}' after Z19 — cannot place Z23 B")

                        # Z19 also needs Z23 tail on N+2
                        if day_idx + 2 < len(self.date_list):
                            while len(row) <= day_idx + 2:
                                row.append(None)
                            tail = row[day_idx + 2]
                            tail_code = str(tail.get("shift", "")).strip().upper() if tail else ""
                            tail_h = float(tail.get("hours", 0) or 0) if tail else 0
                            tail_date = self.date_list[day_idx + 2]
                            if tail and "Z23" in tail_code:
                                if tail_code in ("Z23 B", "Z23B"):
                                    pass  # Extends the rotation — OK
                                elif tail_code == "Z23" and tail_h != 0:
                                    tail["hours"] = 0
                                    if tail_h > 0:
                                        self._track_hours(nurse_name, tail_date, -float(tail_h), shift_delta=-1)
                                        self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                    linkage_fixes += 1
                                    logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {tail_date}: Z23 tail hours {tail_h}→0 (N+2 after Z19)")
                            elif not tail or tail.get("shiftType") == "off" or tail_h == 0:
                                row[day_idx + 2] = {
                                    "id": str(uuid.uuid4()), "date": tail_date, "shift": "Z23",
                                    "shiftType": "night", "hours": 0, "startTime": "00:00", "endTime": "07:25"
                                }
                                linkage_fixes += 1
                                logger.info(f"  ⛓️ SAFETY ADD: {nurse_name} {tail_date}: added Z23 tail (N+2 after Z19→Z23 B)")

                    else:
                        # Z23 B → Z23 tail on N+1
                        if nxt and "Z23" in nxt_code:
                            if nxt_code in ("Z23 B", "Z23B"):
                                if nxt_h != 11.25:
                                    old_h = nxt_h
                                    if old_h > 0:
                                        self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                                        self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                    nxt["hours"] = 11.25
                                    nxt["shiftType"] = "night"
                                    self._track_hours(nurse_name, next_date, 11.25, shift_delta=1, is_12h_shift=True)
                                    self.nurse_total_shifts[nurse_name] = self.nurse_total_shifts.get(nurse_name, 0) + 1
                                    linkage_fixes += 1
                                    logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {next_date}: Z23 B hours {old_h}→11.25 (after Z23 B)")
                            elif nxt_code == "Z23" and nxt_h != 0:
                                old_h = nxt_h
                                nxt["hours"] = 0
                                if old_h > 0:
                                    self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1)
                                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                linkage_fixes += 1
                                logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {next_date}: Z23 tail hours {old_h}→0 (after Z23 B)")
                            elif "↩" in nxt_code:
                                nxt["shift"] = "Z23"
                                nxt["hours"] = 0
                                linkage_fixes += 1
                        elif not nxt or nxt.get("shiftType") == "off" or nxt_h == 0:
                            row[day_idx + 1] = {
                                "id": str(uuid.uuid4()), "date": next_date, "shift": "Z23",
                                "shiftType": "night", "hours": 0, "startTime": "00:00", "endTime": "07:25"
                            }
                            linkage_fixes += 1
                            logger.info(f"  ⛓️ SAFETY ADD: {nurse_name} {next_date}: added Z23 tail after Z23 B")
                        else:
                            # CRITICAL FIX: Remove the conflicting shift and force Z23 tail
                            logger.warning(f"  ⚠️ LINKAGE CONFLICT: {nurse_name} {next_date}: '{nxt_code}' after Z23 B — REMOVING conflicting shift and forcing Z23 tail")
                            old_h = nxt_h
                            if old_h > 0:
                                self._track_hours(nurse_name, next_date, -float(old_h), shift_delta=-1, is_12h_shift=(old_h >= 10))
                                self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                            row[day_idx + 1] = {
                                "id": str(uuid.uuid4()), "date": next_date, "shift": "Z23",
                                "shiftType": "night", "hours": 0, "startTime": "00:00", "endTime": "07:25"
                            }
                            linkage_fixes += 1
                            logger.info(f"  ⛓️ SAFETY FIX: {nurse_name} {next_date}: removed '{nxt_code}' ({old_h}h) and placed Z23 tail (after Z23 B)")

        logger.info(f"  Night linkage fixes: {linkage_fixes}")

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
        #     NEVER remove Z23 B (bridge) or Z23 (tail) — they are mandatory
        #     night rotation continuations that cannot be individually removed.
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
                    # Remove the excess shift (prefer removing non-OCR, non-night-rotation)
                    # Try removing from the tail of the streak first
                    remove_idx = day_idx
                    date = self.date_list[remove_idx]

                    # Find a removable shift — skip OCR, Z19, Z23 B, Z23 (night rotation)
                    def _is_removable(idx):
                        d = self.date_list[idx]
                        if (nurse_name, d) in self.ocr_assignments:
                            return False
                        s = row[idx]
                        if not s:
                            return False
                        sc = str(s.get("shift", "")).strip().upper()
                        # Never remove night rotation components
                        if sc in ("Z19", "Z23 B", "Z23B", "Z23"):
                            return False
                        return True

                    # Search for a removable shift in the streak (tail-first)
                    found = False
                    for try_idx in range(day_idx, streak_start - 1, -1):
                        if _is_removable(try_idx):
                            remove_idx = try_idx
                            date = self.date_list[remove_idx]
                            found = True
                            break
                    
                    if not found:
                        # All shifts in streak are OCR or night rotation — skip
                        continue

                    removed_shift = row[remove_idx]
                    removed_hours = removed_shift.get("hours", 0)
                    if removed_hours > 0:
                        self._track_hours(nurse_name, date, -float(removed_hours), shift_delta=-1)
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

        # (d) FT max 7 shifts per period / PT max shifts — HARD CONSTRAINT
        #     Remove excess shifts (prefer non-OCR, non-night-rotation) if nurse exceeds limit
        shift_limit_fixes = 0
        for nurse_name in self.nurse_names:
            is_ft = self._is_full_time(nurse_name)
            if is_ft:
                max_shifts = self.FT_MAX_SHIFTS_PER_PERIOD
            else:
                # PT: derive from target biweekly hours / reference shift hours
                target_bw = self.get_target_biweekly_hours(nurse_name)
                max_shifts = max(1, int(target_bw / self.reference_shift_hours + 0.5))
            
            # Count current paid shifts
            shift_count = 0
            shift_indices = []  # (day_idx, is_ocr, hours, is_night_rotation)
            row = self.schedule.get(nurse_name, [])
            for day_idx, shift in enumerate(row):
                if shift and shift.get("hours", 0) > 0 and shift.get("shiftType") not in ("off", None):
                    date = self.date_list[day_idx] if day_idx < len(self.date_list) else ""
                    is_ocr = (nurse_name, date) in self.ocr_assignments
                    sc = str(shift.get("shift", "")).strip().upper()
                    # Night rotation shifts (Z19, Z23 B) must not be individually removed
                    # as that breaks the mandatory Z19→Z23 B→Z23 chain
                    is_night_rot = sc in ("Z19", "Z23 B", "Z23B")
                    shift_indices.append((day_idx, is_ocr, shift.get("hours", 0), is_night_rot))
                    shift_count += 1
            
            # Remove excess shifts (prefer non-OCR non-night-rotation day shifts, from the end)
            while shift_count > max_shifts:
                # First try: non-OCR, non-night-rotation shifts
                removable = [(idx, h) for idx, is_ocr, h, is_nr in shift_indices if not is_ocr and not is_nr]
                if not removable:
                    # Second try: non-OCR night rotation — remove entire rotation (Z19 + Z23 B = -2 shifts)
                    nr_shifts = [(idx, h) for idx, is_ocr, h, is_nr in shift_indices if not is_ocr and is_nr]
                    if nr_shifts:
                        # Find a Z19 and remove the whole rotation (Z19 + Z23 B)
                        z19_found = False
                        for idx, h in nr_shifts:
                            sc = str(row[idx].get("shift", "")).strip().upper()
                            if sc == "Z19":
                                # Remove Z19
                                date = self.date_list[idx]
                                self._track_hours(nurse_name, date, -float(h), shift_delta=-1)
                                self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                row[idx] = self.assign_off(nurse_name, date)
                                shift_indices = [(i, o, hs, nr) for i, o, hs, nr in shift_indices if i != idx]
                                shift_count -= 1
                                shift_limit_fixes += 1
                                logger.info(f"  SHIFT LIMIT: {nurse_name} {date}: removed Z19 (whole rotation)")
                                # Remove Z23 B on next day
                                bridge_idx = idx + 1
                                if bridge_idx < len(row):
                                    bridge = row[bridge_idx]
                                    if bridge:
                                        bsc = str(bridge.get("shift", "")).strip().upper()
                                        bh = float(bridge.get("hours", 0) or 0)
                                        if bsc in ("Z23 B", "Z23B") and bh > 0:
                                            bdate = self.date_list[bridge_idx]
                                            self._track_hours(nurse_name, bdate, -bh, shift_delta=-1)
                                            self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                                            row[bridge_idx] = self.assign_off(nurse_name, bdate)
                                            shift_indices = [(i, o, hs, nr) for i, o, hs, nr in shift_indices if i != bridge_idx]
                                            shift_count -= 1
                                            shift_limit_fixes += 1
                                            logger.info(f"  SHIFT LIMIT: {nurse_name} {bdate}: removed Z23 B (from rotation)")
                                # Remove Z23 tail on day after bridge
                                tail_idx = idx + 2
                                if tail_idx < len(row):
                                    tail = row[tail_idx]
                                    if tail:
                                        tsc = str(tail.get("shift", "")).strip().upper()
                                        if tsc == "Z23" and float(tail.get("hours", 0) or 0) == 0:
                                            tdate = self.date_list[tail_idx]
                                            row[tail_idx] = self.assign_off(nurse_name, tdate)
                                            logger.info(f"  SHIFT LIMIT: {nurse_name} {tdate}: removed Z23 tail (from rotation)")
                                z19_found = True
                                break
                        if not z19_found:
                            logger.warning(f"  SHIFT LIMIT: {nurse_name} has {shift_count} shifts (max={max_shifts}) but no removable Z19 rotation")
                            break
                    else:
                        logger.warning(
                            f"  SHIFT LIMIT: {nurse_name} has {shift_count} shifts "
                            f"(all OCR) - cannot enforce max {max_shifts}"
                        )
                        break
                else:
                    remove_idx, removed_hours = removable[-1]  # Last removable shift
                    date = self.date_list[remove_idx]
                    if removed_hours > 0:
                        self._track_hours(nurse_name, date, -float(removed_hours), shift_delta=-1)
                    self.nurse_total_shifts[nurse_name] = max(
                        0, self.nurse_total_shifts.get(nurse_name, 0) - 1
                    )
                    row[remove_idx] = self.assign_off(nurse_name, date)
                    shift_indices = [(i, o, hs, nr) for i, o, hs, nr in shift_indices if i != remove_idx]
                    shift_count -= 1
                    shift_limit_fixes += 1
                    logger.info(
                        f"  SHIFT LIMIT: {nurse_name} {date}: removed shift "
                        f"to enforce max {max_shifts} shifts ({'FT' if is_ft else 'PT'})"
                    )

        # (e) FT min 5 Z-shifts per period — upgrade 8h shifts to 12h
        #     If an FT nurse has too many 8h shifts, upgrade them to 12h
        #     to ensure minimum Z-shift count and approach 75h target.
        z_upgrade_fixes = 0
        for nurse_name in self.nurse_names:
            if not self._is_full_time(nurse_name):
                continue

            row = self.schedule.get(nurse_name, [])
            z_count = 0
            eight_h_indices = []  # (day_idx, shift_type) — candidates for upgrade

            for day_idx, shift in enumerate(row):
                if shift and shift.get("hours", 0) > 0 and shift.get("shiftType") not in ("off", None):
                    hours = shift.get("hours", 0)
                    if hours >= 10.0:
                        z_count += 1
                    elif hours >= 7.0 and hours < 10.0:
                        # Exclude Z23 B — it's a bridge shift (11.25h), not an 8h shift
                        sc = str(shift.get("shift", "")).strip().upper()
                        if sc in ("Z23 B", "Z23B"):
                            continue
                        eight_h_indices.append((day_idx, shift.get("shiftType", "day")))

            if z_count < self.FT_MIN_Z_SHIFTS and eight_h_indices:
                upgrades_needed = self.FT_MIN_Z_SHIFTS - z_count
                for day_idx, shift_type in eight_h_indices[:upgrades_needed]:
                    date = self.date_list[day_idx]
                    old_shift = row[day_idx]
                    old_hours = old_shift.get("hours", 7.5)

                    # Remove old shift hours and re-assign as 12h
                    self._track_hours(nurse_name, date, -float(old_hours), shift_delta=-1, is_12h_shift=False)
                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                    row[day_idx] = self.assign_shift(nurse_name, date, shift_type, hours=12)
                    z_upgrade_fixes += 1
                    logger.info(
                        f"  Z-UPGRADE: {nurse_name} {date}: upgraded {old_hours}h → 12h "
                        f"(Z-shifts now: {z_count + 1}/{self.FT_MIN_Z_SHIFTS} min)"
                    )
                    z_count += 1

        # (f) HARD TARGET-HOURS CAP — strip excess shifts for ALL nurses
        #     who would exceed their biweekly target hours.  Remove non-OCR
        #     shifts from the tail of the period until hours ≤ target.
        target_hours_fixes = 0
        for nurse_name in self.nurse_names:
            if nurse_name in self.nurses_on_leave:
                continue
            row = self.schedule.get(nurse_name, [])
            # Check each period
            for period_key in set(self.date_to_period.values()):
                target_h = self.get_period_target_hours(nurse_name, period_key)
                current_h = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
                if current_h <= target_h + 0.5:
                    continue  # Within target

                # Collect removable shifts (non-OCR, with hours>0) in this period
                period_dates = self.period_to_dates.get(period_key, [])
                removable = []
                for day_idx, shift in enumerate(row):
                    if day_idx >= len(self.date_list):
                        break
                    date = self.date_list[day_idx]
                    if date not in period_dates:
                        continue
                    if not shift or shift.get("hours", 0) <= 0:
                        continue
                    if shift.get("shiftType") in ("off", None):
                        continue
                    is_ocr = (nurse_name, date) in self.ocr_assignments
                    if is_ocr:
                        continue
                    removable.append((day_idx, date, shift))

                # Remove from the end backwards until within target
                for day_idx, date, shift in reversed(removable):
                    current_h = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
                    if current_h <= target_h + 0.5:
                        break
                    removed_hours = float(shift.get("hours", 0))
                    is_12h = removed_hours >= 10.0
                    self._track_hours(nurse_name, date, -removed_hours, shift_delta=-1, is_12h_shift=is_12h)
                    self.nurse_total_shifts[nurse_name] = max(0, self.nurse_total_shifts.get(nurse_name, 0) - 1)
                    row[day_idx] = self.assign_off(nurse_name, date)
                    target_hours_fixes += 1
                    new_h = self.nurse_period_target_hours.get(nurse_name, {}).get(period_key, 0)
                    logger.info(
                        f"  TARGET CAP: {nurse_name} {date}: removed {shift.get('shift','')} "
                        f"({removed_hours}h) — now {new_h:.1f}h / {target_h:.1f}h target"
                    )

        logger.info(
            f"SAFETY PASS COMPLETE: {linkage_fixes} night linkage fixes, "
            f"{stack_fixes} stack caps, {consec_fixes} consecutive fixes, "
            f"{shift_limit_fixes} shift limit fixes, {z_upgrade_fixes} Z-shift upgrades, "
            f"{target_hours_fixes} target-hours cap removals"
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
                if shift_upper in ["C", "OFF"] or (
                    shift_upper.startswith("CF")
                    and not RobustScheduler._is_composite_cf_shift(shift_code)
                ):
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
        """Get metadata for a shift code.
        
        Returns PAID hours (actual work time minus breaks) for target tracking.
        - 12h shifts (Z-codes): 11.25h paid (12h minus 0.75h break)
        - 8h shifts: 7.5h paid (8h minus 0.5h break)
        MCH Rule: Z19 = ALWAYS 11.25h (full night including Z23 continuation).
        """
        code_upper = shift_code.strip().upper()

        # CRITICAL: Handle composite CF codes FIRST (e.g., "CF-4 07", "CF-11 Z07")
        # These are WORKING shifts on statutory holidays, not off days.
        # Extract the embedded shift code and get its metadata.
        if self._is_composite_cf_shift(shift_code):
            # Regex: CF[-\s]?\d+\s+(shift_code)
            import re
            match = re.search(r'CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)', code_upper)
            if match:
                embedded_code = match.group(1).strip()
                # Recursively get metadata for the embedded shift code
                embedded_meta = self._get_shift_metadata(embedded_code)
                # Return same metadata but preserve original composite code
                return embedded_meta

        # MCH Rule: Z19 alone = full 12h night (11.25h paid).
        # This includes the Z23 continuation — MUST override shifts_info.
        if code_upper == "Z19":
            return {"type": "night", "hours": 11.25, "start": "19:00", "end": "07:25"}

        if shift_code in self.shifts_info:
            info = self.shifts_info[shift_code]
            return {
                "type": info.get("type", "day"),
                "hours": info.get("hours", 12),
                "start": info.get("startTime", "07:00"),
                "end": info.get("endTime", "19:00"),
            }

        # MCH merged night shift patterns - use PAID hours (11.25h)
        if "Z19" in code_upper and "Z23" in code_upper:
            # Z19 Z23 B or Z19 Z23 - merged 12h night: 11.25h paid (19:00-07:25)
            return {"type": "night", "hours": 11.25, "start": "19:00", "end": "07:25"}
        
        if "Z19" in code_upper:
            # Any Z19 variant: full 12h night = 11.25h paid
            return {"type": "night", "hours": 11.25, "start": "19:00", "end": "07:25"}
            
        if "Z23" in code_upper:
            # Z23 B = Back shift (00:00-07:25, 7.25h paid)
            # Z23 standalone = 8h night (23:00-07:25, 7.5h paid)
            if "B" in code_upper:
                return {"type": "night", "hours": 7.25, "start": "00:00", "end": "07:25"}
            return {"type": "night", "hours": 7.5, "start": "23:00", "end": "07:25"}
            
        if "N" in code_upper or "23" in code_upper:
            # Plain 23 (no Z prefix) - 8h night: 7.5h paid
            return {"type": "night", "hours": 7.5, "start": "23:00", "end": "07:15"}

        if "D" in code_upper or "07" in code_upper or "11" in code_upper:
            if "8" in code_upper:
                # 8h day shift: 7.5h paid
                return {"type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"}
            # 12h day shift (Z07, Z11): 11.25h paid
            return {"type": "day", "hours": 11.25, "start": "07:00", "end": "19:25"}

        # Default fallback: 8h shift
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
                        # Exclude 0h continuations from coverage count (Z23 B, Z23, Z23 ↩)
                        if shift.get("hours", 0) > 0:
                            night_count += 1

            day_ok = "✓" if day_count >= self.day_req else "✗"
            night_ok = "✓" if night_count >= self.night_req else "✗"

            if day_count < self.day_req or night_count < self.night_req:
                total_issues += 1
                logger.error(f"  {date}: Day={day_count}/{self.day_req} {day_ok}, Night={night_count}/{self.night_req} {night_ok}")
            else:
                logger.info(f"  {date}: Day={day_count}/{self.day_req} {day_ok}, Night={night_count}/{self.night_req} {night_ok}")

        logger.info("-" * 40)
        logger.info("WORKLOAD DISTRIBUTION (MCH CONTRACT VIEW):")
        shifts_list = sorted(self.nurse_total_shifts.items(), key=lambda x: x[1], reverse=True)
        for name, _ in shifts_list:
            is_ft = self._is_full_time(name)
            # Count shifts directly from schedule for accuracy
            z_count = 0
            eight_count = 0
            cf_count = 0  # Track composite CF shifts separately
            off_count = 0  # Track off-request days (C, OFF, CF-X)
            for shift in self.schedule.get(name, []):
                if shift:
                    shift_code = str(shift.get("shift", "")).strip().upper()
                    shift_hours = shift.get("hours", 0)
                    shift_type = shift.get("shiftType", "")
                    
                    # Check for composite CF codes like "CF-4 07" (holiday + work)
                    is_composite_cf = bool(re.match(r'^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)', shift_code))
                    
                    # Count composite CF codes separately
                    if is_composite_cf:
                        cf_count += 1
                    # Count regular paid shifts
                    elif shift_hours > 0 and shift_type not in ("off", None):
                        if shift_hours >= 10.0:
                            z_count += 1
                        else:
                            eight_count += 1
                    # Count off-request days (but not blank offs)
                    elif shift_code in ('C', 'OFF') or (shift_code.startswith('CF') and not is_composite_cf):
                        off_count += 1
            actual_count = z_count + eight_count + cf_count
            
            # Compute contract hours (CF shifts contribute their shift type hours)
            # CF-4 07 = 7.5h, CF-11 Z07 = 11.25h, etc.
            cf_hours_contract = 0
            cf_hours_clinical = 0
            for shift in self.schedule.get(name, []):
                if shift:
                    shift_code = str(shift.get("shift", "")).strip().upper()
                    is_composite_cf = bool(re.match(r'^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)', shift_code))
                    if is_composite_cf:
                        shift_hours = shift.get("hours", 0)
                        if shift_hours >= 10.0:
                            cf_hours_contract += MCH_Z_SHIFT_CONTRACT_VALUE
                            cf_hours_clinical += MCH_Z_SHIFT_CLINICAL_VALUE
                        else:
                            cf_hours_contract += MCH_8H_SHIFT_VALUE
                            cf_hours_clinical += MCH_8H_SHIFT_VALUE
            
            if is_ft:
                contract_h = z_count * MCH_Z_SHIFT_CONTRACT_VALUE + eight_count * MCH_8H_SHIFT_VALUE + cf_hours_contract
                clinical_h = z_count * MCH_Z_SHIFT_CLINICAL_VALUE + eight_count * MCH_8H_SHIFT_VALUE + cf_hours_clinical
                delta = contract_h - MCH_FT_BIWEEKLY_TARGET
                marker = "✓" if abs(delta) <= 3.76 else ("⚠" if delta > 0 else "✗")
                off_info = f" • {off_count} off" if off_count > 0 else ""
                # Build shift breakdown string
                parts = []
                if z_count > 0:
                    parts.append(f"{z_count} Z")
                if eight_count > 0:
                    parts.append(f"{eight_count} x8h")
                if cf_count > 0:
                    parts.append(f"{cf_count} CF")
                shift_breakdown = " + ".join(parts) if parts else "0"
                logger.info(
                    f"  {marker} {name} (FT): {actual_count} shifts ({shift_breakdown}{off_info}) "
                    f"| contract={contract_h:.1f}h | clinical={clinical_h:.1f}h | delta={delta:+.1f}h"
                )
            else:
                total_h = sum(
                    s.get("hours", 0) for s in self.schedule.get(name, [])
                    if s and s.get("hours", 0) > 0 and s.get("shiftType") not in ("off", None)
                )
                off_info = f" • {off_count} off" if off_count > 0 else ""
                logger.info(f"  {name} (PT): {actual_count} shifts{off_info} | hours={total_h:.1f}h")

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
        
        # CRITICAL: Add missing shift codes with proper PAID HOURS metadata
        # PAID HOURS = clock time minus unpaid breaks (12h → 11.25h, 8h → 7.5h)
        DEFAULT_SHIFTS = {
            "D8-": {"hours": 7.5, "startTime": "07:00", "endTime": "15:15", "type": "day"},
            "E8-": {"hours": 7.5, "startTime": "15:00", "endTime": "23:15", "type": "day"},
            "N8-": {"hours": 7.5, "startTime": "23:00", "endTime": "07:15", "type": "night"},
            "N8+ZE2-": {"hours": 11.25, "startTime": "19:00", "endTime": "07:15", "type": "night"},
            "ZD12-": {"hours": 11.25, "startTime": "07:00", "endTime": "19:25", "type": "day"},
            "ZE2-": {"hours": 4.0, "startTime": "19:00", "endTime": "23:00", "type": "night"},
            "ZN-": {"hours": 7.25, "startTime": "23:00", "endTime": "07:25", "type": "night"},
            "ZN+ZE2-": {"hours": 11.25, "startTime": "19:00", "endTime": "07:25", "type": "night"},
            "Z11": {"hours": 11.25, "startTime": "11:00", "endTime": "23:25", "type": "day"},
            "11": {"hours": 7.5, "startTime": "11:00", "endTime": "19:15", "type": "day"},
            "07": {"hours": 7.5, "startTime": "07:00", "endTime": "15:15", "type": "day"},
            "E15": {"hours": 7.5, "startTime": "15:00", "endTime": "23:15", "type": "day"},
            "Z07": {"hours": 11.25, "startTime": "07:00", "endTime": "19:25", "type": "day"},
            "23": {"hours": 7.5, "startTime": "23:00", "endTime": "07:15", "type": "night"},
            "Z19": {"hours": 4.0, "startTime": "19:00", "endTime": "23:00", "type": "night"},
            "Z23": {"hours": 7.25, "startTime": "23:00", "endTime": "07:25", "type": "night"},
            "Z23 B": {"hours": 7.25, "startTime": "23:00", "endTime": "07:25", "type": "night"},
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
                        # Exclude 0h continuations (Z23 B, Z23, Z23 ↩) from real coverage count
                        if float(shift.get("hours", 0) or 0) > 0:
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
        # POST-OVERLAY GHOST SWEEP: only zero out non-continuation Z23 ghosts.
        # Z23 ↩ entries (hours=0) are VALID continuation markers — never remove them.
        # Only target: Z19 followed by bare "Z23" (ghost tail from OCR).
        # Z23 B is a legitimate standalone shift — never remove.
        GHOST_PAIRS_FINAL = {"Z19": {"Z23"}}
        post_ghost_fixes = 0
        for nurse_name, row in schedule.items():
            for i in range(1, len(row)):
                prev = row[i - 1]
                curr = row[i]
                if not prev or not curr:
                    continue
                # NEVER touch 0h night continuation markers (Z23 B, Z23, Z23 ↩)
                curr_raw = str(curr.get("shift", "")).strip()
                if curr.get("hours", 0) == 0 and curr.get("shiftType") == "night":
                    continue
                prev_h = prev.get("hours", 0)
                curr_h = curr.get("hours", 0)
                if prev_h <= 0 or curr_h <= 0:
                    continue
                prev_code = str(prev.get("shift", "")).strip().upper()
                curr_code = curr_raw.upper()
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

        # ────────────────────────────────────────────────────────────
        # FINAL HARD-CAP ENFORCEMENT
        # After overlay + ghost sweep, ensure no day exceeds the DYNAMIC
        # cap (not the bare day_req/night_req).  The minimum staffing is
        # day_req + night_req = 9, but we allow more workers per day so
        # that FT nurses can reach their 7-shift / 75h target.
        # ────────────────────────────────────────────────────────────
        # Compute dynamic cap (same formula as RobustScheduler._get_dynamic_daily_staff_cap)
        # STRICT: base + 1 to prevent front-loading and ensure coverage spread
        _base_cap = day_req + night_req
        _dynamic_cap = _base_cap + 1
        _dynamic_day_cap = max(day_req, int(_dynamic_cap * day_req / (day_req + night_req) + 0.5))
        _dynamic_night_cap = max(night_req, _dynamic_cap - _dynamic_day_cap)
        logging.info(f"FINAL HARD-CAP using dynamic caps: day={_dynamic_day_cap}, night={_dynamic_night_cap} (total={_dynamic_cap})")

        # Build nurse name normalization map for OCR protection matching
        def _norm_name(name: str) -> str:
            return re.sub(r"\s+", " ", str(name or "").strip().lower())
        _schedule_name_by_norm = {_norm_name(n): n for n in schedule.keys()}

        ocr_binding_set: set = set()
        if assignments:
            for a_name, a_shifts in assignments.items():
                # CRITICAL: Normalize OCR name to match schedule name
                norm_a_name = _norm_name(a_name)
                schedule_name = _schedule_name_by_norm.get(norm_a_name, a_name)
                
                for a_idx, a_code in enumerate(a_shifts or []):
                    if a_idx < len(date_list) and a_code and a_code.strip():
                        cu = a_code.strip().upper()
                        # Protect all work shifts including composite CF codes
                        if cu not in ("C", "OFF", "*", "") and not (
                            cu.startswith("CF") and not RobustScheduler._is_composite_cf_shift(a_code.strip())
                        ):
                            ocr_binding_set.add((schedule_name, date_list[a_idx]))
                            logging.info(f"🔒 HARD-CAP OCR-protecting: {schedule_name} on {date_list[a_idx]} = {a_code}")

        # Pre-compute per-nurse shift counts and target shift counts for smart removal
        # CRITICAL: Scale shift targets by period length (41 days = ~3 bi-weekly periods)
        period_scale = len(date_list) / 14.0  # How many bi-weekly periods in this schedule
        logging.info(f"PER-NURSE CAP SCALING: period_scale={period_scale:.2f} ({len(date_list)} days / 14)")
        
        _nurse_shift_counts: dict = {}
        for nname, nrow in schedule.items():
            _nurse_shift_counts[nname] = sum(
                1 for s in nrow
                if s and float(s.get("hours", 0) or 0) > 0
            )
        _nurse_target_shifts: dict = {}
        for n in nurses:
            emp = str(n.get("employmentType", "")).lower()
            if emp in ("full-time", "ft", ""):
                base_target = MCH_FT_SHIFT_COUNT  # 7 shifts per 14 days
                _nurse_target_shifts[n["name"]] = int(base_target * period_scale + 0.5)
            else:
                tbw = float(n.get("targetBiWeeklyHours", 37.5) or 37.5)
                base_target = max(1, round(tbw / MCH_Z_SHIFT_CLINICAL_VALUE))
                _nurse_target_shifts[n["name"]] = int(base_target * period_scale + 0.5)

        hardcap_removals = 0
        for d_idx, d_date in enumerate(date_list):
            day_nurses = []
            night_nurses = []
            for nname, nrow in schedule.items():
                if d_idx < len(nrow):
                    s = nrow[d_idx]
                    if s and s.get("hours", 0) > 0:
                        if s.get("shiftType") == "day":
                            day_nurses.append(nname)
                        elif s.get("shiftType") == "night":
                            night_nurses.append(nname)

            # Remove excess DAY nurses above dynamic cap
            day_excess = len(day_nurses) - _dynamic_day_cap
            if day_excess > 0:
                non_ocr = [n for n in day_nurses if (n, d_date) not in ocr_binding_set]
                removable = non_ocr if non_ocr else day_nurses[:]
                # Prefer removing over-target nurses; protect under-target
                removable.sort(key=lambda n: -_nurse_shift_counts.get(n, 0))
                actually_removed = 0
                for candidate in removable:
                    if actually_removed >= day_excess:
                        break
                    # Protect nurses below their target shift count
                    if _nurse_shift_counts.get(candidate, 0) < _nurse_target_shifts.get(candidate, 7):
                        continue
                    schedule[candidate][d_idx] = {
                        "id": str(uuid.uuid4()), "date": d_date,
                        "shift": "", "shiftType": "off",
                        "hours": 0, "startTime": "", "endTime": "",
                    }
                    _nurse_shift_counts[candidate] = max(0, _nurse_shift_counts.get(candidate, 0) - 1)
                    hardcap_removals += 1
                    actually_removed += 1
                    logging.info(f"  FINAL HARD-CAP: removed {candidate} DAY on {d_date}")

            # Remove excess NIGHT nurses above dynamic cap
            night_excess = len(night_nurses) - _dynamic_night_cap
            if night_excess > 0:
                non_ocr = [n for n in night_nurses if (n, d_date) not in ocr_binding_set]
                removable = non_ocr if non_ocr else night_nurses[:]
                # Prefer removing over-target nurses; protect under-target
                removable.sort(key=lambda n: -_nurse_shift_counts.get(n, 0))
                actually_removed = 0
                for candidate in removable:
                    if actually_removed >= night_excess:
                        break
                    if _nurse_shift_counts.get(candidate, 0) < _nurse_target_shifts.get(candidate, 7):
                        continue
                    schedule[candidate][d_idx] = {
                        "id": str(uuid.uuid4()), "date": d_date,
                        "shift": "", "shiftType": "off",
                        "hours": 0, "startTime": "", "endTime": "",
                    }
                    _nurse_shift_counts[candidate] = max(0, _nurse_shift_counts.get(candidate, 0) - 1)
                    hardcap_removals += 1
                    actually_removed += 1
                    logging.info(f"  FINAL HARD-CAP: removed {candidate} NIGHT on {d_date}")

        if hardcap_removals:
            logging.info(f"FINAL HARD-CAP ENFORCEMENT: {hardcap_removals} excess shifts removed")

        # ── PER-NURSE SHIFT LIMIT ENFORCEMENT ──────────────────────────
        # After OCR overlay may have restored shifts that _final_safety_pass
        # trimmed, enforce per-nurse max shifts one more time.
        # CRITICAL: Scale max_shifts by period length to allow appropriate workload
        nurse_map_for_cap = {n["name"]: n for n in nurses}
        pn_cap_removals = 0
        for nname, nrow in schedule.items():
            meta = nurse_map_for_cap.get(nname, {})
            emp = str(meta.get("employmentType", "")).lower()
            if emp in ("full-time", "ft", ""):
                base_max = MCH_FT_SHIFT_COUNT  # 7 shifts per 14 days
                max_shifts = int(base_max * period_scale + 0.5)
            else:
                tbw = float(meta.get("targetBiWeeklyHours", 37.5) or 37.5)
                base_max = max(1, int(tbw / MCH_Z_SHIFT_CLINICAL_VALUE + 0.5))
                max_shifts = int(base_max * period_scale + 0.5)

            # Count paid shifts and collect removable indices
            paid = []
            for idx, s in enumerate(nrow):
                if s and float(s.get("hours", 0) or 0) > 0 and s.get("shiftType") not in ("off", None):
                    is_ocr = (nname, date_list[idx]) in ocr_binding_set if idx < len(date_list) else False
                    sc = str(s.get("shift", "")).strip().upper()
                    is_nr = sc in ("Z19", "Z23 B", "Z23B")
                    paid.append((idx, is_ocr, is_nr))

            excess = len(paid) - max_shifts
            if excess <= 0:
                continue

            # Remove non-OCR, non-night-rotation first; then non-OCR night rotations
            non_ocr_non_nr = [p for p in paid if not p[1] and not p[2]]
            non_ocr_nr = [p for p in paid if not p[1] and p[2]]
            # Last resort: OCR-bound shifts (non-night-rotation, then night-rotation)
            ocr_non_nr = [p for p in paid if p[1] and not p[2]]
            ocr_nr = [p for p in paid if p[1] and p[2]]
            removable = non_ocr_non_nr + non_ocr_nr + ocr_non_nr + ocr_nr
            removed = 0
            for idx, _, is_nr in removable:
                if removed >= excess:
                    break
                if is_nr:
                    # Remove entire Z19 rotation (Z19 + Z23 B + Z23 tail)
                    sc = str(nrow[idx].get("shift", "")).strip().upper()
                    if sc != "Z19":
                        continue  # Only start removal from Z19
                    nrow[idx] = {"id": str(uuid.uuid4()), "date": date_list[idx], "shift": "", "shiftType": "off", "hours": 0, "startTime": "", "endTime": ""}
                    removed += 1
                    if idx + 1 < len(nrow):
                        bsc = str(nrow[idx + 1].get("shift", "")).strip().upper()
                        if bsc in ("Z23 B", "Z23B") and float(nrow[idx + 1].get("hours", 0) or 0) > 0:
                            nrow[idx + 1] = {"id": str(uuid.uuid4()), "date": date_list[idx + 1], "shift": "", "shiftType": "off", "hours": 0, "startTime": "", "endTime": ""}
                            removed += 1
                    if idx + 2 < len(nrow):
                        tsc = str(nrow[idx + 2].get("shift", "")).strip().upper()
                        if tsc == "Z23" and float(nrow[idx + 2].get("hours", 0) or 0) == 0:
                            nrow[idx + 2] = {"id": str(uuid.uuid4()), "date": date_list[idx + 2], "shift": "", "shiftType": "off", "hours": 0, "startTime": "", "endTime": ""}
                else:
                    nrow[idx] = {"id": str(uuid.uuid4()), "date": date_list[idx], "shift": "", "shiftType": "off", "hours": 0, "startTime": "", "endTime": ""}
                    removed += 1
                pn_cap_removals += 1
            if removed > 0:
                logging.info(f"  PER-NURSE CAP: {nname} had {len(paid)} shifts (max={max_shifts}), removed {removed}")
        if pn_cap_removals:
            logging.info(f"PER-NURSE SHIFT CAP: {pn_cap_removals} excess shifts removed")

        # COVERAGE SAFETY NET: Patch any remaining gaps before balancing
        coverage_ok = True
        for d_idx, date in enumerate(date_list):
            day_c = 0
            night_c = 0
            for nname, nrow in schedule.items():
                if d_idx < len(nrow):
                    s = nrow[d_idx]
                    sc = str(s.get("shift", "")).strip()
                    h = float(s.get("hours", 0) or 0)
                    if s.get("shiftType") == "day" and h > 0:
                        day_c += 1
                    elif s.get("shiftType") == "night" and h > 0:
                        night_c += 1
            if day_c < day_req or night_c < night_req:
                coverage_ok = False
                break
        if not coverage_ok:
            logging.warning("Coverage gaps detected after ghost sweep - PATCHING NOW")
            schedule = ScheduleOptimizer.patch_coverage_gaps(
                schedule, date_list, nurses, shifts_info,
                day_shift_codes, night_shift_codes, day_req, night_req
            )

        # Attempt to balance nurse period targets to reduce deltas to zero.
        # Pass the original OCR assignments so the balancer can protect them.
        try:
            schedule = ScheduleOptimizer.balance_targets(schedule, date_list, nurses, shifts_info, assignments or {})
        except Exception as e:
            logging.warning(f"Target balancing failed: {e}")
        
        # Final pass: Add shifts to nurses still under their target hours
        # This can ignore the hard cap (base + 1) to help nurses reach their goals
        try:
            schedule = ScheduleOptimizer.fill_under_target_nurses(schedule, date_list, nurses, shifts_info, assignments or {})
        except Exception as e:
            logging.warning(f"Under-target fill failed: {e}")

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
            code_u = code.strip().upper()
            # Handle composite CF shifts: extract the underlying shift code
            if RobustScheduler._is_composite_cf_shift(code):
                extracted = RobustScheduler._extract_shift_from_cf(code)
                if extracted:
                    return meta_for(extracted)
            # Z19 ALWAYS = 11.25h paid (full night) — must come BEFORE shifts_info
            # lookup because shifts_info may contain the old "Z19":{"hours":4.0}.
            if code_u == "Z19":
                return {"shiftType": "night", "hours": 11.25, "startTime": "19:00", "endTime": "07:25"}
            if code in shifts_info:
                m = shifts_info[code]
                return {
                    "shiftType": m.get("type", "day"),
                    "hours": m.get("hours", 12),
                    "startTime": m.get("startTime", "07:00"),
                    "endTime": m.get("endTime", "19:00"),
                }
            if "N" in code_u or "19" in code_u or "23" in code_u:
                if "Z19" in code_u:
                    return {"shiftType": "night", "hours": 11.25, "startTime": "19:00", "endTime": "07:25"}
                if "Z23" in code_u:
                    # Z23 B = Back shift (00:00-07:25, 7.25h paid)
                    # Z23 standalone = 8h night (23:00-07:25, 7.25h paid)
                    if "B" in code_u:
                        return {"shiftType": "night", "hours": 7.25, "startTime": "00:00", "endTime": "07:25"}
                    return {"shiftType": "night", "hours": 7.25, "startTime": "23:00", "endTime": "07:25"}
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
                is_off = raw_u in ["C", "OFF"] or (
                    (raw_u.startswith("CF") or "CF " in raw_u)
                    and not RobustScheduler._is_composite_cf_shift(raw)
                )

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

                # OVERNIGHT MARKER: Only skip if OCR explicitly contains ↩
                # Z23 is a legitimate 8h night shift code, not a tail
                if "↩" in raw:
                    # OCR explicitly specifies continuation marker — keep it
                    continue

                # OCR OVERRIDE: If OCR has a real shift code (like CF-11 07), it should
                # REPLACE any system-placed Z23 tail, because OCR is AUTHORITATIVE.
                # No longer protect Z23 tails from OCR overwrite — OCR wins.

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
                        # Protect all work shifts including composite CF codes like "CF-4 07"
                        # Pure CF off codes (CF-1, CF-2 without embedded shift) are vacation
                        if code not in ("C", "OFF", "*", ""):
                            # If it's a CF code, only protect if it's composite (work shift)
                            if code.startswith("CF"):
                                if RobustScheduler._is_composite_cf_shift(code):
                                    ocr_binding.add((nurse_name, date_list[day_idx]))
                                    logging.info(f"🔒 OCR-protecting composite CF shift: {nurse_name} on {date_list[day_idx]} = {code}")
                            else:
                                # Regular work shift (07, 11, Z07, etc.) - always protect
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
                        ocr_code = (ocr_shifts[day_idx] or "").strip()
                        ocr_code_u = ocr_code.upper()
                        if (ocr_code_u in ("C", "OFF", "*") or
                            (ocr_code_u.startswith("CF")
                             and not RobustScheduler._is_composite_cf_shift(ocr_code))):
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
                    # Skip night shifts — they have complex linkage (Z19 → Z23 ↩)
                    # that the balancer cannot properly reconstruct.
                    if cell.get("shiftType") == "night":
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

                        # Shift limit: don't give shifts to nurses at their max
                        emp = str(meta_under.get("employmentType", "full-time")).lower()
                        under_shift_count = sum(
                            1 for e in under_row
                            if float(e.get("hours", 0) or 0) > 0
                            and e.get("shiftType") not in ("off", None)
                        )
                        if emp in ("full-time", "ft", ""):
                            if under_shift_count >= 7:
                                continue
                        else:
                            # PT: derive max shifts from target hours
                            tbw = float(meta_under.get("targetBiWeeklyHours", 37.5) or 37.5)
                            pt_max = max(1, int(tbw / MCH_Z_SHIFT_CLINICAL_VALUE + 0.5))
                            if under_shift_count >= pt_max:
                                continue

                        # Rest constraint: don't assign if previous day has night shift
                        if day_idx > 0 and day_idx - 1 < len(under_row):
                            prev_entry = under_row[day_idx - 1]
                            if (prev_entry and prev_entry.get("shiftType") == "night"
                                    and float(prev_entry.get("hours", 0) or 0) > 0):
                                continue

                        # Don't assign if next day has early shift (rest violation from new night)
                        if day_idx + 1 < len(under_row):
                            next_entry = under_row[day_idx + 1]
                            if (next_entry and next_entry.get("shiftType") == "day"
                                    and float(next_entry.get("hours", 0) or 0) > 0):
                                continue

                        # Skip if under-nurse has Z23 ↩ on this day (continuation slot)
                        if (under_cell.get("shiftType") == "night" and
                                float(under_cell.get("hours", 0) or 0) == 0):
                            uc_sc = str(under_cell.get("shift", "")).strip()
                            if "Z23" in uc_sc or "↩" in uc_sc or (under_cell.get("hours", 0) or 0) == 0:
                                continue  # Don't overwrite Z23 ↩ continuation

                        # Night lockout: skip this day if previous day is Z19/Z23 B
                        if day_idx > 0 and day_idx - 1 < len(under_row):
                            prev_uc = under_row[day_idx - 1]
                            if prev_uc:
                                prev_uc_sc = str(prev_uc.get("shift", "")).strip()
                                if prev_uc_sc in ("Z19", "Z23 B") and float(prev_uc.get("hours", 0) or 0) > 0:
                                    continue  # Day is locked after night shift

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
    def fill_under_target_nurses(
        schedule: Dict[str, List[Dict]],
        date_list: List[str],
        nurses: List[Dict[str, Any]],
        shifts_info: Dict[str, Any],
        ocr_assignments: Dict[str, List[str]] = None
    ) -> Dict[str, List[Dict]]:
        """
        Final pass to add shifts to nurses below their target hours.
        Ignores the hard cap (base + 1) to help under-target nurses reach their goals.
        """
        logging.info("Running under-target fill pass...")
        
        # Build nurse metadata
        nurse_map = {n.get("name"): n for n in nurses}
        
        # Build set of OCR-protected shifts
        ocr_binding: Set[Tuple[str, str]] = set()
        if ocr_assignments:
            def _norm_name(name: str) -> str:
                return re.sub(r"\s+", " ", str(name or "").strip().lower())
            _schedule_name_by_norm = {_norm_name(n): n for n in schedule.keys()}
            
            for a_name, a_shifts in ocr_assignments.items():
                norm_a_name = _norm_name(a_name)
                schedule_name = _schedule_name_by_norm.get(norm_a_name, a_name)
                for a_idx, a_code in enumerate(a_shifts or []):
                    if a_idx < len(date_list) and a_code and a_code.strip():
                        cu = a_code.strip().upper()
                        if cu not in ("C", "OFF", "*", "") and not (
                            cu.startswith("CF") and not RobustScheduler._is_composite_cf_shift(a_code.strip())
                        ):
                            ocr_binding.add((schedule_name, date_list[a_idx]))
        
        # Calculate targets and current hours for each nurse
        total_days = len(date_list)
        period_scale = total_days / 14.0
        
        def scheduled_hours_for(name: str) -> float:
            hrs = 0.0
            row = schedule.get(name, [])
            for entry in row:
                try:
                    hrs += float(entry.get("hours", 0) or 0)
                except Exception:
                    pass
            return hrs
        
        def shift_count_for(name: str) -> int:
            row = schedule.get(name, [])
            return sum(
                1 for e in row
                if float(e.get("hours", 0) or 0) > 0
                and e.get("shiftType") not in ("off", None)
            )
        
        # Identify under-target FT nurses
        under_target_nurses = []
        for name in schedule.keys():
            meta = nurse_map.get(name, {})
            emp = str(meta.get("employmentType", "")).lower()
            if emp not in ("full-time", "ft", ""):
                continue  # Skip PT nurses
            
            # Calculate target (same logic as balance_targets)
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
                raw_target = MCH_FT_BIWEEKLY_TARGET * period_scale
            
            # Adjust for off days
            off_requests = set(meta.get("offRequests", []) or [])
            off_day_count = len([d for d in date_list if d in off_requests])
            if off_day_count > 0 and total_days > 0:
                available_ratio = max(0, (total_days - off_day_count)) / total_days
                raw_target = raw_target * available_ratio
            
            current_hours = scheduled_hours_for(name)
            delta = current_hours - raw_target
            
            if delta < -3.0:  # More than 3h under target
                under_target_nurses.append((name, raw_target, current_hours, delta))
        
        if not under_target_nurses:
            logging.info("  All nurses at or above target. No fill needed.")
            return schedule
        
        logging.info(f"  Found {len(under_target_nurses)} nurses under target:")
        for name, target, current, delta in under_target_nurses:
            logging.info(f"    {name}: {current:.1f}h / {target:.1f}h (delta={delta:.1f}h)")
        
        # Sort by most under-target first
        under_target_nurses.sort(key=lambda x: x[3])  # Sort by delta (most negative first)
        
        # Calculate period-scaled shift caps
        ft_max_shifts = int(MCH_FT_SHIFT_COUNT * period_scale + 0.5)
        
        # Build daily coverage map to track staffing levels
        def count_day_coverage(date_idx: int) -> int:
            """Count active nurses on a given day (exclude Z23 tails)"""
            count = 0
            for name, row in schedule.items():
                if date_idx < len(row):
                    cell = row[date_idx]
                    if cell and float(cell.get("hours", 0) or 0) > 0:
                        count += 1
            return count
        
        fills = 0
        for nurse_name, target, initial_current, initial_delta in under_target_nurses:
            meta = nurse_map.get(nurse_name, {})
            
            # Keep adding shifts until nurse reaches target or no more suitable days
            max_iterations = 10  # Safety limit
            iteration = 0
            
            while iteration < max_iterations:
                iteration += 1
                
                # Recalculate current state after each addition
                current_hours = scheduled_hours_for(nurse_name)
                current_shifts = shift_count_for(nurse_name)
                delta = current_hours - target
                
                # Stop if nurse is now within 3h of target
                if delta >= -3.0:
                    break
                
                # Don't exceed period-scaled shift cap for FT nurses
                if current_shifts >= ft_max_shifts:
                    break
                
                # Determine if we should add 8h or 12h shift
                hours_needed = abs(delta)
                prefer_12h = hours_needed >= 10.0
                target_shift_hours = 11.25 if prefer_12h else 7.5
                target_shift_code = "Z07" if prefer_12h else "07"
                target_shift_type = "day"
                
                # Find suitable days for this nurse
                row = schedule.get(nurse_name, [])
                off_requests = set(meta.get("offRequests", []) or [])
                
                # Build list of candidate days with their coverage counts
                candidates = []
                for day_idx, date in enumerate(date_list):
                    # Skip if day is off-request
                    if date in off_requests:
                        continue
                    
                    # Skip if already has a shift this day
                    if day_idx < len(row):
                        current_cell = row[day_idx]
                        if current_cell and float(current_cell.get("hours", 0) or 0) > 0:
                            continue
                    
                    # Skip if OCR-protected (shouldn't change OCR-assigned days)
                    if (nurse_name, date) in ocr_binding:
                        continue
                    
                    # Rest constraint: don't add if previous day has night shift
                    if day_idx > 0 and day_idx - 1 < len(row):
                        prev_entry = row[day_idx - 1]
                        if (prev_entry and prev_entry.get("shiftType") == "night"
                                and float(prev_entry.get("hours", 0) or 0) > 0):
                            continue
                    
                    # Don't add if next day has early shift (rest violation from new night)
                    if day_idx + 1 < len(row):
                        next_entry = row[day_idx + 1]
                        if (next_entry and next_entry.get("shiftType") == "day"
                                and float(next_entry.get("hours", 0) or 0) > 0):
                            continue
                    
                    # This day is suitable - record it with its current coverage
                    coverage = count_day_coverage(day_idx)
                    candidates.append((day_idx, date, coverage))
                
                if not candidates:
                    logging.info(f"  ⚠ No suitable days for {nurse_name} (still {delta:.1f}h under target)")
                    break
                
                # Sort candidates by coverage (lowest first) to balance across days
                candidates.sort(key=lambda x: x[2])
                
                # Pick the day with lowest coverage
                day_idx, date, coverage = candidates[0]
                
                # Add the shift
                new_shift = {
                    "id": str(uuid.uuid4()),
                    "date": date,
                    "shift": target_shift_code,
                    "shiftType": target_shift_type,
                    "hours": target_shift_hours,
                    "startTime": "07:00" if target_shift_type == "day" else "19:00",
                    "endTime": "19:25" if prefer_12h else "15:15",
                }
                
                if day_idx < len(row):
                    schedule[nurse_name][day_idx] = new_shift
                else:
                    while len(schedule[nurse_name]) <= day_idx:
                        schedule[nurse_name].append(None)
                    schedule[nurse_name][day_idx] = new_shift
                
                fills += 1
                logging.info(f"  ✓ Added {target_shift_code} ({target_shift_hours}h) for {nurse_name} on {date} (coverage was {coverage}, iteration {iteration})")
                # Continue to next iteration to potentially add another shift
        
        logging.info(f"Under-target fill complete: {fills} shifts added")
        return schedule
    
    @staticmethod
    def patch_coverage_gaps(result, date_list, nurses, shifts_info, day_shift_codes, night_shift_codes, day_req, night_req):
        """
        POST-PROCESSING: Patches any days that don't have enough coverage.
        This is the LAST LINE OF DEFENSE - ensures no empty days EVER.
        """
        logging.info("PATCHING COVERAGE GAPS...")

        # Calculate period scale for shift caps
        period_scale = len(date_list) / 14.0
        ft_max_shifts = int(MCH_FT_SHIFT_COUNT * period_scale + 0.5)

        # Build set of nurses on leave — they should never be picked for patching
        on_leave_names = {
            n["name"] for n in nurses
            if (bool(n.get("isOnMaternityLeave")) or
                bool(n.get("isOnSickLeave")) or
                bool(n.get("isOnSabbatical")))
        }
        
        # Build off-request lookup
        off_req_map = {}
        for n in nurses:
            off_req_map[n["name"]] = set(n.get("offRequests", []) or [])

        for d_idx, date in enumerate(date_list):
            # Count current coverage
            day_count = 0
            night_count = 0
            off_nurses = []
            
            # Build off_nurses list with FT shift count check
            for nurse in nurses:
                name = nurse["name"]
                if name in on_leave_names:
                    continue  # Skip nurses on leave
                # Skip nurses with off-request for this day
                if date in off_req_map.get(name, set()):
                    continue
                if d_idx < len(result[name]):
                    shift = result[name][d_idx]
                    sc = str(shift.get("shift", "")).strip()
                    h = float(shift.get("hours", 0) or 0)
                    if shift["shiftType"] == "day" and h > 0:
                        day_count += 1
                    elif shift["shiftType"] == "night":
                        if h > 0:
                            night_count += 1
                        elif "Z23" in sc or "↩" in sc or h == 0:
                            pass  # Night continuation — do NOT reassign
                        else:
                            # Shift cap: skip nurses already at their max paid shifts
                            emp = str(nurse.get("employmentType", "")).lower()
                            paid_count = sum(1 for e in result[name] if float(e.get("hours", 0) or 0) > 0 and e.get("shiftType") not in ("off", None))
                            if emp in ("full-time", "ft", ""):
                                if paid_count >= ft_max_shifts:
                                    continue
                            else:
                                tbw = float(nurse.get("targetBiWeeklyHours", 37.5) or 37.5)
                                base_pt_max = max(1, int(tbw / MCH_Z_SHIFT_CLINICAL_VALUE + 0.5))
                                pt_max = int(base_pt_max * period_scale + 0.5)
                                if paid_count >= pt_max:
                                    continue
                            off_nurses.append(name)
                    else:
                        # Shift cap: skip nurses already at their max paid shifts
                        emp = str(nurse.get("employmentType", "")).lower()
                        paid_count = sum(1 for e in result[name] if float(e.get("hours", 0) or 0) > 0 and e.get("shiftType") not in ("off", None))
                        if emp in ("full-time", "ft", ""):
                            if paid_count >= ft_max_shifts:
                                continue
                        else:
                            tbw = float(nurse.get("targetBiWeeklyHours", 37.5) or 37.5)
                            base_pt_max = max(1, int(tbw / MCH_Z_SHIFT_CLINICAL_VALUE + 0.5))
                            pt_max = int(base_pt_max * period_scale + 0.5)
                            if paid_count >= pt_max:
                                continue
                        off_nurses.append(name)
            
            # Patch day shifts if needed
            day_shift_code = day_shift_codes[0] if day_shift_codes else "7Y"
            night_shift_code = night_shift_codes[0] if night_shift_codes else "7N"
            
            # Patch day shifts if needed — skip nurses locked by night continuation
            while day_count < day_req and off_nurses:
                nurse_name = off_nurses.pop(0)
                # Lockout check: don't assign if prev day has Z19 / Z23 B
                if d_idx > 0 and d_idx - 1 < len(result.get(nurse_name, [])):
                    prev = result[nurse_name][d_idx - 1]
                    prev_sc = str(prev.get("shift", "")).strip()
                    if prev_sc in ("Z19", "Z23 B") and "↩" not in prev_sc:
                        continue
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
            
            # Patch night shifts if needed — skip nurses locked by night continuation
            while night_count < night_req and off_nurses:
                nurse_name = off_nurses.pop(0)
                # Lockout check: don't assign if prev day has Z19 / Z23 B
                if d_idx > 0 and d_idx - 1 < len(result.get(nurse_name, [])):
                    prev = result[nurse_name][d_idx - 1]
                    prev_sc = str(prev.get("shift", "")).strip()
                    if prev_sc in ("Z19", "Z23 B") and "↩" not in prev_sc:
                        continue
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
                                # SKIP composite CF+shift codes (e.g. "CF-4 07") —
                                # those are WORKING shifts, not off days.
                                if RobustScheduler._is_composite_cf_shift(shift_code):
                                    continue
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
All hours are PAID hours (clock time minus unpaid breaks).

DAY SHIFTS (8-hour = 7.5h paid):
  - "07" = Day 8hr (07:00-15:15) = 7.5h
  - "11" = Mid 8hr (11:00-19:15) = 7.5h
  - "E15" = Evening 8hr (15:00-23:15) = 7.5h

DAY SHIFTS (12-hour = 11.25h paid):
  - "Z07" = Day 12hr (07:00-19:25) = 11.25h
  - "Z11" = Mid 12hr (11:00-23:25) = 11.25h

NIGHT SHIFTS (8-hour = 7.5h paid):
  - "23" = Night 8hr (23:00-07:15) = 7.5h

NIGHT SHIFTS (12-hour merged = 11.25h paid):
  - "Z19 Z23 B" = Night 12hr (19:00-07:25, coming back) = 11.25h
  - "Z19 Z23" = Night 12hr (19:00-07:25) = 11.25h

NIGHT TOP-UP/FINISH SHIFTS:
  - "Z23" = Night Finish (23:00-07:25) = 7.25h
  - "Z23 B" = Night Finish + Back at 19:00 (23:00-07:25) = 7.25h

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
        # Require authentication (bypass in dev mode for testing)
        import os as _os
        _dev_bypass = _os.environ.get("DEV_BYPASS_AUTH", "").lower() == "true"
        
        # DEBUG: Log authentication status
        logger.info(f"AUTH CHECK: is_authenticated={auth.is_authenticated}, organization_id={auth.organization_id}, user_id={auth.user_id}")
        
        if not _dev_bypass and (not auth.is_authenticated or not auth.organization_id):
            logger.error(f"Authentication failed: is_authenticated={auth.is_authenticated}, organization_id={auth.organization_id}")
            raise HTTPException(status_code=401, detail=f"Authentication required (authenticated={auth.is_authenticated}, org_id={'present' if auth.organization_id else 'missing'})")
        
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
        logger.error(traceback.format_exc())
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
            logger.warning(f"🎯 RAW OCR ASSIGNMENTS FROM FRONTEND:")
            for nurse_name, shift_list in req.assignments.items():
                non_empty = [s for s in shift_list if s and str(s).strip() and str(s).strip() not in ("—", "-")]
                if non_empty:
                    logger.warning(f"  '{nurse_name}': {non_empty}")
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

        schedule_payload = _with_actor_metadata(schedule, auth)

        new_schedule = OptimizedSchedule(
            schedule_id=req.schedule_id if req.schedule_id else None,
            organization_id=org_id,
            result=schedule_payload,
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
        created_by, created_by_name = _extract_schedule_actor(result_data, schedule_data)
        
        result.append({
            "id": str(s.id),
            "schedule_id": str(s.schedule_id) if s.schedule_id else None,
            "organization_id": s.organization_id,
            "is_finalized": s.finalized,
            "start_date": start_date,
            "end_date": end_date,
            "schedule_data": schedule_data,
            "created_by": created_by,
            "created_by_name": created_by_name,
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
        created_by, created_by_name = _extract_schedule_actor(result_data, schedule_data)
        
        return {
            "id": str(schedule.id),
            "schedule_id": str(schedule.schedule_id) if schedule.schedule_id else None,
            "organization_id": schedule.organization_id,
            "is_finalized": schedule.finalized,
            "start_date": start_date,
            "end_date": end_date,
            "schedule_data": schedule_data,
            "created_by": created_by,
            "created_by_name": created_by_name,
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

        payload = _with_actor_metadata(schedule_data, auth)

        new_schedule = OptimizedSchedule(
            organization_id=org_id,
            result=payload,
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
        merged_payload = _with_actor_metadata({**existing_payload, **patch_payload}, auth)

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
    body: Dict[str, Any],
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """Save a draft schedule and immediately finalize it. Requires authentication."""
    try:
        # Require authentication
        if not auth.is_authenticated or not auth.organization_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        org_id = auth.organization_id
        
        # Extract schedule_data and schedule_id from the request body
        # Frontend sends: {schedule_data: {...}, schedule_id: "..."}
        schedule_data = body.get("schedule_data", body)
        schedule_id = body.get("schedule_id")

        existing_draft = None
        if schedule_id:
            existing_draft = _get_mutable_schedule_or_404(db, auth, schedule_id)

        if existing_draft:
            existing_draft.organization_id = org_id
            existing_draft.result = _with_actor_metadata(schedule_data, auth)
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

        payload = _with_actor_metadata(schedule_data, auth)

        new_schedule = OptimizedSchedule(
            organization_id=org_id,
            result=payload,
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

        # Debug: Count Z23 tails with hours=0 vs hours>0
        total_z23_tails = 0
        z23_with_zero_hours = 0
        z23_with_positive_hours = 0
        total_raw_hours = 0.0
        for nurse_name, shifts in request.schedule.items():
            for s in shifts:
                shift_code = (s.get("shift") or "").strip().upper()
                hours = float(s.get("hours", 0) or 0)
                total_raw_hours += hours
                if shift_code == "Z23" or "Z23" in shift_code:
                    total_z23_tails += 1
                    if hours == 0:
                        z23_with_zero_hours += 1
                    elif hours > 0:
                        z23_with_positive_hours += 1
        
        logger.info(f"DEBUG AI Insights RAW DATA ANALYSIS:")
        logger.info(f"  Total raw hours (before filtering): {total_raw_hours:.1f}h")
        logger.info(f"  Total Z23 codes found: {total_z23_tails}")
        logger.info(f"  Z23 with hours=0: {z23_with_zero_hours}")
        logger.info(f"  Z23 with hours>0: {z23_with_positive_hours}")
        
        # Debug: Log first nurse's raw data from request
        if request.schedule:
            first_nurse = list(request.schedule.keys())[0]
            logger.info(f"DEBUG AI Insights - First nurse raw data: {first_nurse}")
            logger.info(f"  Total shifts in request: {len(request.schedule[first_nurse])}")
            for i, s in enumerate(request.schedule[first_nurse][:5]):  # First 5 shifts
                logger.info(f"    Shift {i}: code='{s.get('shift')}', hours={s.get('hours')}, type='{s.get('shiftType')}'")
        
        for nurse_name, shifts in request.schedule.items():
            # Exclude off days, CF codes (vacation), and empty cells from work hours
            work_shifts = []
            for s in shifts:
                shift_code = (s.get("shift") or "").strip().upper()
                shift_type = s.get("shiftType", "")
                hours = float(s.get("hours", 0) or 0)
                
                # Exclude offs, empty cells, and simple CF codes (vacation)
                # Include composite CF codes (CF-4 07) as they are WORK shifts
                is_composite_cf = bool(re.match(r"^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)\s*$", shift_code, re.IGNORECASE))
                is_work = (
                    hours > 0 and
                    shift_type not in ("", "off") and
                    shift_code not in ("", "OFF", "C") and
                    (not shift_code.startswith("CF") or is_composite_cf)
                )
                if is_work:
                    work_shifts.append(s)
            
            nurse_hours = sum(float(s.get("hours", 0) or 0) for s in work_shifts)
            total_scheduled_hours += nurse_hours
            working_days = len(work_shifts)
            
            # Debug: Log work shift calculation for first nurse
            if len(nurse_lines) == 0:
                logger.info(f"DEBUG AI Insights - {nurse_name}: {len(shifts)} total shifts, {len(work_shifts)} work shifts (filtered), {nurse_hours:.1f}h")
                logger.info(f"  Sample shifts: {shifts[:3]}")

            if nurse_name in nurse_stats_map:
                stat = nurse_stats_map[nurse_name]
                target_h = float(stat.get("targetHours", 0))
                delta_h = float(stat.get("delta", nurse_hours - target_h))
                emp_type = stat.get("employmentType", "FT")
                # Count off-requests from metadata
                off_requests = stat.get("offRequests", [])
                num_off_requests = len(off_requests) if off_requests else 0
            else:
                emp_type = "FT"
                target_h = 37.5 * num_weeks
                delta_h = nurse_hours - target_h
                num_off_requests = 0

            off_days = [s.get("date") for s in shifts if s.get("shiftType") == "off" or s.get("shift", "") in ["", "OFF"]]
            nurse_lines.append(
                f"- {nurse_name} ({emp_type}): {working_days} shifts / {nurse_hours:.1f}h | target {target_h:.1f}h | delta {delta_h:+.1f}h | off on {len(off_days)} days"
            )
            # Only flag as overworked if significantly over target (>10h) to avoid false positives
            # Nurses with off-requests have adjusted targets, so small positive deltas are normal
            if delta_h > 10 and emp_type in ("PT", "Part-Time"):
                overworked.append(f"{nurse_name} ({delta_h:+.1f}h)")
            elif delta_h < -10 and num_off_requests == 0:
                # Only flag underworked if they have NO approved off-requests
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

        # Determine language instruction based on locale
        language_instruction = ""
        if request.locale and request.locale.startswith("fr"):
            language_instruction = "\n\nIMPORTANT: Respond in French. All text in the JSON response (summary, issue titles/descriptions, suggestions) must be in French."
        
        # Debug: Log the calculated totals before sending to AI
        logger.info(f"DEBUG AI Insights totals: total_scheduled_hours={total_scheduled_hours:.1f}h, total_target_hours={total_target_hours:.1f}h, delta={total_scheduled_hours - total_target_hours:+.1f}h")
        
        insights_prompt = f"""You are an expert nurse scheduling analyst. Analyze the following optimized nurse schedule and return a structured JSON report.{org_context_line}{language_instruction}

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
        # Hours are PAID hours (clock time minus breaks)
        SHIFT_CODE_MAP = {
            "07":  {"start": "07:00", "end": "15:15", "hours": 7.5,   "type": "day"},
            "Z07": {"start": "07:00", "end": "19:25", "hours": 11.25, "type": "day"},
            "11":  {"start": "11:00", "end": "19:15", "hours": 7.5,   "type": "day"},
            "Z11": {"start": "11:00", "end": "23:25", "hours": 11.25, "type": "day"},
            "E15": {"start": "15:00", "end": "23:15", "hours": 7.5,   "type": "day"},
            "23":  {"start": "23:00", "end": "07:15", "hours": 7.5,   "type": "night"},
            "Z19": {"start": "19:00", "end": "23:00", "hours": 4.0,   "type": "night"},
            "Z23": {"start": "23:00", "end": "07:25", "hours": 7.25,  "type": "night"},
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

            # Per-date headcount (day and night separately)
            date_headcount: dict[str, dict[str, int]] = {}
            for d in request.dates:
                day_count = 0
                night_count = 0
                for nurse_name, shifts_list in request.schedule.items():
                    for s in shifts_list:
                        if s.get("date") == d and (s.get("hours") or 0) > 0:
                            shift_type = s.get("shiftType", "")
                            if shift_type == "day":
                                day_count += 1
                            elif shift_type == "night":
                                # Skip Z23 tails (0h continuation)
                                if (s.get("hours") or 0) > 0:
                                    night_count += 1
                date_headcount[d] = {"day": day_count, "night": night_count, "total": day_count + night_count}

            # Find dates with staffing BELOW required minimum (not just below average)
            understaffed_dates = []
            if date_headcount and request.requiredStaff:
                # Parse required staff from requiredStaff dict
                # Format: {"Day Shift (07)": {"2025-08-24": 5, ...}, "Night Shift (19)": {...}}
                for d in request.dates:
                    actual = date_headcount.get(d, {"day": 0, "night": 0, "total": 0})
                    
                    # Calculate required staff for this date
                    required_day = 5  # default minimum
                    required_night = 4  # default minimum
                    
                    for shift_type_key, dates_dict in (request.requiredStaff or {}).items():
                        key_lower = shift_type_key.lower()
                        if "day" in key_lower or "07" in key_lower or "morning" in key_lower:
                            req = dates_dict.get(d, 0)
                            if req > required_day:
                                required_day = req
                        elif "night" in key_lower or "19" in key_lower or "23" in key_lower:
                            req = dates_dict.get(d, 0)
                            if req > required_night:
                                required_night = req
                    
                    # Only flag if BELOW requirement (not just below average)
                    if actual["day"] < required_day or actual["night"] < required_night:
                        gap_size = max(required_day - actual["day"], required_night - actual["night"])
                        understaffed_dates.append((d, actual["total"], required_day, required_night, gap_size))
                
                # Sort by gap size (largest first)
                understaffed_dates.sort(key=lambda x: x[4], reverse=True)
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
            for date, headcount, required_day, required_night, gap_size in understaffed_dates[:10]:  # limit to top 10 gaps
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
                    
                    # Calculate required total staff
                    required_total = required_day + required_night

                    gap_fill_suggestions.append({
                        "date": date,
                        "nurse": nurse_name,
                        "shiftCode": recommended_code,
                        "shiftStart": code_info.get("start", ""),
                        "shiftEnd": code_info.get("end", ""),
                        "shiftHours": recommended_hours,
                        "shiftType": code_info.get("type", "day"),
                        "currentHeadcount": headcount,
                        "requiredStaff": required_total,
                        "gapSize": gap_size,
                        "nurseDelta": nurse["delta"],
                        "nurseCurrentHours": nurse["totalHours"],
                        "nurseTargetHours": nurse["targetHours"],
                        "nurseEmploymentType": nurse["employmentType"],
                        "priority": "high" if gap_size >= 2 else "medium",
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
