"""
SIMPLE Schedule Optimizer v2

WORKFLOW:
1. Admin uploads OCR scan of nurse PREFERENCES (not final schedule)
2. Comments (*) can be anything - display but don't assume meaning
3. Optimizer creates schedule respecting:
   - Nurse preferences (when possible)
   - Max 3 consecutive work days
   - Min 5 day nurses, 3 night nurses  
   - Head nurse required on nights
   - Fair distribution of hours

SIMPLICITY PRINCIPLES:
- No AI for core optimization (deterministic algorithm)
- AI only for refinement/adjustments
- Clear, readable code
- Minimal dependencies
"""
import uuid
import json
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from openai import OpenAI

from app.db.deps import get_db
from app.core.config import settings
from app.core.auth import get_optional_auth, AuthContext
from app.models.optimized_schedule import OptimizedSchedule
from app.schemas.optimized_schedule import OptimizeRequest, OptimizeResponse, RefineRequest

logger = logging.getLogger(__name__)
router = APIRouter(redirect_slashes=True)
client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=120.0)

# ============================================================
# SHIFT DEFINITIONS
# ============================================================

SHIFTS = {
    # Day shifts
    "ZD12-": {"type": "day", "hours": 12, "start": "07:00", "end": "19:25"},
    "Z07":   {"type": "day", "hours": 12, "start": "07:00", "end": "19:00"},
    "D8-":   {"type": "day", "hours": 8,  "start": "07:00", "end": "15:15"},
    "ZD8-":  {"type": "day", "hours": 8,  "start": "07:00", "end": "15:00"},
    "E8-":   {"type": "day", "hours": 8,  "start": "15:00", "end": "23:15"},
    "Z11":   {"type": "day", "hours": 12, "start": "11:00", "end": "23:25"},
    # Night shifts  
    "ZN-":   {"type": "night", "hours": 12, "start": "19:00", "end": "07:00"},
    "Z19":   {"type": "night", "hours": 12, "start": "19:00", "end": "07:00"},
    "Z23":   {"type": "night", "hours": 12, "start": "23:00", "end": "07:00"},
    "Z23 B": {"type": "night", "hours": 12, "start": "23:00", "end": "07:00"},
    "N8-":   {"type": "night", "hours": 8,  "start": "23:00", "end": "07:15"},
}

OFF_CODES = {"C", "CF", "OFF", ""}

def get_shift_info(code: str) -> Dict:
    """Get shift metadata, with inference for unknown codes."""
    if not code or code.upper() in OFF_CODES or code.upper().startswith("CF"):
        return {"type": "off", "hours": 0, "start": "", "end": ""}
    
    # Exact match
    if code in SHIFTS:
        return SHIFTS[code]
    
    # Case-insensitive
    for k, v in SHIFTS.items():
        if k.upper() == code.upper():
            return v
    
    # Infer from pattern
    code_up = code.upper()
    if "N" in code_up or "19" in code_up or "23" in code_up:
        hours = 8 if "8" in code else 12
        return {"type": "night", "hours": hours, "start": "19:00", "end": "07:00"}
    
    # Default: day 12h
    hours = 8 if "8" in code else 12
    return {"type": "day", "hours": hours, "start": "07:00", "end": "19:00" if hours == 12 else "15:00"}


def is_off(code: str) -> bool:
    """Check if this is an OFF code."""
    if not code:
        return True
    code_up = code.upper().strip()
    return code_up in OFF_CODES or code_up.startswith("CF")


def is_marker(code: str) -> bool:
    """Check if this is a marker (comment indicator)."""
    return code == "*"


# ============================================================
# CORE SCHEDULING ALGORITHM
# ============================================================

def create_schedule(
    nurses: List[Dict],
    dates: List[str],
    preferences: Dict[str, List[str]],  # OCR data = preferences
    comments: Dict[str, Dict[str, str]],  # Comments for markers
    min_day: int = 5,
    min_night: int = 3,
    max_consecutive: int = 3
) -> Dict[str, List[Dict]]:
    """
    Create an optimized schedule.
    
    Algorithm:
    1. Parse preferences to understand what each nurse wants
    2. Respect explicit OFF requests (CF codes, explicit off days)
    3. Fill schedule to meet staffing requirements
    4. Balance hours fairly across nurses
    5. Enforce max consecutive days rule
    """
    
    # Initialize tracking
    nurse_names = [n.get("name", "") for n in nurses]
    schedule = {name: [None] * len(dates) for name in nurse_names}
    nurse_hours = {name: 0 for name in nurse_names}
    nurse_consecutive = {name: 0 for name in nurse_names}
    
    # Get max hours per nurse (default 60)
    nurse_max_hours = {}
    nurse_is_head = {}
    for n in nurses:
        name = n.get("name", "")
        nurse_max_hours[name] = n.get("maxWeeklyHours", 60)
        # Check if head nurse (could be in name or special field)
        nurse_is_head[name] = "head" in name.lower() or n.get("isHeadNurse", False)
    
    # Head nurses (for night shift requirement)
    head_nurses = [n for n in nurse_names if nurse_is_head.get(n, False)]
    
    logger.info("=" * 60)
    logger.info("CREATING SCHEDULE")
    logger.info(f"  Nurses: {len(nurses)}")
    logger.info(f"  Dates: {len(dates)}")
    logger.info(f"  Requirements: {min_day} day, {min_night} night")
    logger.info(f"  Head nurses: {head_nurses}")
    logger.info("=" * 60)
    
    # STEP 1: Process each day
    for day_idx, date in enumerate(dates):
        day_coverage = []
        night_coverage = []
        unavailable = set()
        
        # First pass: apply explicit requests from preferences
        for nurse in nurse_names:
            pref_list = preferences.get(nurse, [])
            pref_code = pref_list[day_idx] if day_idx < len(pref_list) else ""
            
            # Check for explicit OFF (CF codes)
            if is_off(pref_code):
                schedule[nurse][day_idx] = make_shift(date, "", "off", 0)
                unavailable.add(nurse)
                nurse_consecutive[nurse] = 0
                continue
            
            # Check markers - marker means there's a comment, could be preference
            if is_marker(pref_code):
                comment_text = comments.get(nurse, {}).get(date, "")
                # Log the comment but don't auto-assign - admin reviews these
                logger.info(f"  Marker for {nurse} on {date}: {comment_text}")
                # Leave as available for now - admin can see comment
                continue
            
            # If they specified a specific shift, try to honor it
            if pref_code and not is_off(pref_code):
                shift_info = get_shift_info(pref_code)
                if shift_info["type"] == "day":
                    day_coverage.append(nurse)
                elif shift_info["type"] == "night":
                    night_coverage.append(nurse)
                schedule[nurse][day_idx] = make_shift(
                    date, pref_code, 
                    shift_info["type"], shift_info["hours"],
                    shift_info["start"], shift_info["end"]
                )
                nurse_hours[nurse] += shift_info["hours"]
                nurse_consecutive[nurse] += 1
                unavailable.add(nurse)
        
        # STEP 2: Check coverage and fill gaps
        available = [
            n for n in nurse_names 
            if n not in unavailable 
            and nurse_hours.get(n, 0) < nurse_max_hours.get(n, 60)
            and nurse_consecutive.get(n, 0) < max_consecutive
        ]
        
        # Sort by hours (least first for fairness)
        available.sort(key=lambda n: nurse_hours.get(n, 0))
        
        # Fill day shifts
        while len(day_coverage) < min_day and available:
            nurse = available.pop(0)
            schedule[nurse][day_idx] = make_shift(date, "ZD12-", "day", 12, "07:00", "19:25")
            nurse_hours[nurse] += 12
            nurse_consecutive[nurse] += 1
            day_coverage.append(nurse)
        
        # Fill night shifts (ensure at least one head nurse if possible)
        need_head = len([n for n in night_coverage if nurse_is_head.get(n, False)]) == 0
        
        while len(night_coverage) < min_night and available:
            # Prefer head nurse if needed
            if need_head:
                head_avail = [n for n in available if nurse_is_head.get(n, False)]
                if head_avail:
                    nurse = head_avail[0]
                    available.remove(nurse)
                    need_head = False
                else:
                    nurse = available.pop(0)
            else:
                nurse = available.pop(0)
            
            schedule[nurse][day_idx] = make_shift(date, "ZN-", "night", 12, "19:00", "07:00")
            nurse_hours[nurse] += 12
            nurse_consecutive[nurse] += 1
            night_coverage.append(nurse)
        
        # Remaining nurses get OFF
        for nurse in nurse_names:
            if schedule[nurse][day_idx] is None:
                schedule[nurse][day_idx] = make_shift(date, "", "off", 0)
                nurse_consecutive[nurse] = 0
        
        logger.info(f"  {date}: Day={len(day_coverage)}/{min_day}, Night={len(night_coverage)}/{min_night}")
    
    # Log final summary
    logger.info("=" * 60)
    logger.info("SCHEDULE SUMMARY:")
    for nurse in nurse_names:
        hours = nurse_hours.get(nurse, 0)
        target = nurse_max_hours.get(nurse, 60)
        delta = hours - target
        sign = "+" if delta >= 0 else ""
        logger.info(f"  {nurse}: {hours}h (target {target}h, {sign}{delta})")
    logger.info("=" * 60)
    
    return schedule


def make_shift(date: str, code: str, shift_type: str, hours: int, 
               start: str = "", end: str = "") -> Dict:
    """Create a shift entry."""
    return {
        "id": str(uuid.uuid4()),
        "date": date,
        "shift": code,
        "shiftType": shift_type,
        "hours": hours,
        "startTime": start,
        "endTime": end
    }


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/", response_model=OptimizeResponse)
async def optimize_schedule(
    req: OptimizeRequest,
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """
    Main optimization endpoint.
    Creates an optimized schedule from nurse preferences.
    """
    try:
        logger.info("=" * 80)
        logger.info("OPTIMIZE ENDPOINT CALLED")
        logger.info(f"  Nurses: {len(req.nurses)}")
        logger.info(f"  Dates: {len(req.dates)}")
        logger.info("=" * 80)
        
        # Build nurse list
        nurses = []
        for n in req.nurses:
            if hasattr(n, 'dict'):
                nurses.append(n.dict())
            elif hasattr(n, 'model_dump'):
                nurses.append(n.model_dump())
            elif isinstance(n, dict):
                nurses.append(n)
            else:
                nurses.append({"name": str(n)})
        
        # Get staffing requirements from staffRequirements (system prompt has defaults)
        min_day = 5
        min_night = 3
        max_consecutive = 3
        
        # Override from staffRequirements
        if req.staffRequirements:
            min_day = req.staffRequirements.minDayStaff or 5
            min_night = req.staffRequirements.minNightStaff or 3
        
        # Additional rules from the Rules Editor are stored as free text
        # They will be passed to the AI refine endpoint, not parsed here
        additional_rules = ""
        if req.rules:
            # If rules is a dict with a "text" key, use that
            if isinstance(req.rules, dict) and "text" in req.rules:
                additional_rules = req.rules["text"]
            # If rules is a dict (old format), ignore for core optimization
            # The defaults are in system prompt
            elif isinstance(req.rules, dict):
                additional_rules = str(req.rules)
            else:
                additional_rules = str(req.rules)
        
        logger.info(f"  Staffing: min_day={min_day}, min_night={min_night}, max_consecutive={max_consecutive}")
        if additional_rules:
            logger.info(f"  Additional rules (for AI refinement): {additional_rules[:100]}...")
        
        # Create schedule using core algorithm (deterministic, uses system prompt defaults)
        schedule = create_schedule(
            nurses=nurses,
            dates=req.dates,
            preferences=req.assignments or {},
            comments=req.comments or {},
            min_day=min_day,
            min_night=min_night,
            max_consecutive=max_consecutive
        )
        
        # Save to database
        org_id = auth.organization_id if auth.is_authenticated else None
        new_schedule = OptimizedSchedule(
            schedule_id=req.schedule_id,
            organization_id=org_id,
            result=schedule,
            finalized=False,
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)
        
        logger.info(f"Schedule saved: {new_schedule.id}")
        
        return {"optimized_schedule": schedule, "id": str(new_schedule.id)}
    
    except Exception as e:
        logger.error(f"Optimization error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview")
async def preview_constraints(req: OptimizeRequest):
    """
    Preview endpoint - analyzes input and returns constraint summary.
    This is a lightweight endpoint that doesn't save to DB or run full optimization.
    Returns structure compatible with ConstraintsConfirmation component.
    """
    try:
        logger.info("=" * 80)
        logger.info("PREVIEW ENDPOINT CALLED")
        logger.info("=" * 80)
        
        # Build nurses array in format expected by frontend
        nurses_list = []
        for n in req.nurses:
            nurse_dict = {}
            if hasattr(n, 'model_dump'):
                nurse_dict = n.model_dump()
            elif hasattr(n, 'dict'):
                nurse_dict = n.dict()
            elif isinstance(n, dict):
                nurse_dict = n
            else:
                nurse_dict = {"name": str(n)}
            
            # Ensure required fields exist
            nurses_list.append({
                "id": nurse_dict.get("id", str(len(nurses_list))),
                "name": nurse_dict.get("name", f"Nurse {len(nurses_list) + 1}"),
                "isChemoCertified": nurse_dict.get("isChemoCertified", False),
                "employmentType": nurse_dict.get("employmentType", "full-time"),
                "maxWeeklyHours": nurse_dict.get("maxWeeklyHours", 60),
                "offRequests": nurse_dict.get("offRequests", []),
                "seniority": nurse_dict.get("seniority", 0),
            })
        
        # Analyze preferences from OCR data
        nurse_preferences = {}
        for nurse, shifts in (req.assignments or {}).items():
            prefs = {
                "requested_days": [],
                "requested_nights": [],
                "requested_off": [],
                "markers": []
            }
            for idx, code in enumerate(shifts):
                if idx >= len(req.dates):
                    continue
                date = req.dates[idx]
                
                if not code or code.upper() in ["", "C", "OFF"] or code.upper().startswith("CF"):
                    if code:  # Explicit off request
                        prefs["requested_off"].append(date)
                        # Also add to nurse's offRequests
                        for n in nurses_list:
                            if n["name"].lower().strip() == nurse.lower().strip():
                                if date not in n["offRequests"]:
                                    n["offRequests"].append(date)
                elif code == "*":
                    prefs["markers"].append(date)
                else:
                    shift_info = get_shift_info(code)
                    if shift_info["type"] == "day":
                        prefs["requested_days"].append({"date": date, "shift": code})
                    elif shift_info["type"] == "night":
                        prefs["requested_nights"].append({"date": date, "shift": code})
            
            nurse_preferences[nurse] = prefs
        
        # Process comments for OFF/vacation/day off requests
        comments = req.comments or {}
        for nurse_name, nurse_comments in comments.items():
            for date, comment_text in nurse_comments.items():
                if not comment_text:
                    continue
                # Check if comment indicates day off request
                comment_lower = comment_text.lower().strip()
                is_off_request = (
                    comment_lower.startswith("off") or
                    "vacation" in comment_lower or
                    "day off" in comment_lower or
                    "pto" in comment_lower or
                    "time off" in comment_lower
                )
                if is_off_request:
                    # Add to nurse's offRequests
                    for n in nurses_list:
                        if n["name"].lower().strip() == nurse_name.lower().strip():
                            if date not in n["offRequests"]:
                                n["offRequests"].append(date)
                                logger.info(f"  Added OFF request for {nurse_name} on {date} from comment: {comment_text}")
                    # Also add to preferences
                    if nurse_name in nurse_preferences:
                        if date not in nurse_preferences[nurse_name]["requested_off"]:
                            nurse_preferences[nurse_name]["requested_off"].append(date)
        
        # Get staffing from staffRequirements (defaults are in system prompt)
        min_day = req.staffRequirements.minDayStaff if req.staffRequirements else 5
        min_night = req.staffRequirements.minNightStaff if req.staffRequirements else 3
        max_consecutive = 3  # Default from system prompt
        
        # Additional rules are free-form text for AI refinement
        additional_rules = ""
        if req.rules:
            if isinstance(req.rules, str):
                additional_rules = req.rules
            elif isinstance(req.rules, dict):
                additional_rules = req.rules.get("text", str(req.rules)) if req.rules else ""
        
        # Build constraints in format expected by ConstraintsConfirmation component
        constraints = {
            "dateRange": {
                "start": req.dates[0] if req.dates else "",
                "end": req.dates[-1] if req.dates else "",
            },
            "shiftRequirements": {
                "dayShift": {
                    "count": min_day,
                    "minChemoCertified": 2,
                    "shiftCodes": ["ZD12-", "D8-", "E8-", "Z11", "11", "07", "Z07", "E15"]
                },
                "nightShift": {
                    "count": min_night,
                    "minChemoCertified": 1,
                    "shiftCodes": ["ZN-", "N8-", "ZE2-", "N8+ZE2-", "ZN+ZE2-", "Z19", "Z23", "Z23 B", "23"]
                }
            },
            "nurses": nurses_list,  # Array of nurse objects
            "shiftsInfo": {
                "D8-": {"hours": 8, "startTime": "07:00", "endTime": "15:15", "type": "day"},
                "E8-": {"hours": 8, "startTime": "15:00", "endTime": "23:15", "type": "day"},
                "N8-": {"hours": 8, "startTime": "23:00", "endTime": "07:15", "type": "night"},
                "ZD12-": {"hours": 12, "startTime": "07:00", "endTime": "19:25", "type": "day"},
                "ZN-": {"hours": 12, "startTime": "19:00", "endTime": "07:00", "type": "night"},
                "Z11": {"hours": 12, "startTime": "11:00", "endTime": "23:25", "type": "day"},
            },
            "constraints": {
                "maxConsecutiveWorkDays": max_consecutive,
                "maxConsecutiveNightShifts": 3,
                "alternateWeekendsOff": True,
                "respectOffRequests": True,
                "respectCurrentAssignments": True,
            },
            # Extra info for display
            "additionalRules": additional_rules if additional_rules else "(none - using system prompt defaults)",
            "preferences": nurse_preferences,
            "summary": {
                "totalNurses": len(nurses_list),
                "totalDays": len(req.dates),
                "withPreferences": len([n for n, p in nurse_preferences.items() 
                                       if p["requested_days"] or p["requested_nights"] or p["requested_off"]]),
                "withMarkers": len([n for n, p in nurse_preferences.items() if p["markers"]]),
            }
        }
        
        return {
            "status": "preview",
            "constraints": constraints,
            "message": f"Ready to optimize schedule for {len(nurses_list)} nurses over {len(req.dates)} days"
        }
    
    except Exception as e:
        logger.error(f"Preview error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/optimize-with-constraints")
async def optimize_with_constraints(
    payload: Dict[str, Any],
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """
    Optimize using confirmed constraints from the Review Constraints step.
    This endpoint is called after user reviews and confirms the constraints.
    """
    try:
        logger.info("=" * 80)
        logger.info("OPTIMIZE WITH CONSTRAINTS ENDPOINT")
        logger.info("=" * 80)
        
        constraints = payload.get("constraints", {})
        assignments = payload.get("assignments", {})
        schedule_id = payload.get("schedule_id")
        
        # Extract nurse list from constraints
        nurses_data = constraints.get("nurses", [])
        if not nurses_data:
            raise HTTPException(status_code=400, detail="No nurses in constraints")
        
        # Build nurses list
        nurses = []
        for n in nurses_data:
            if isinstance(n, dict):
                nurses.append(n)
            else:
                nurses.append({"name": str(n)})
        
        # Get date range
        date_range = constraints.get("dateRange", {})
        start_date = date_range.get("start", "")
        end_date = date_range.get("end", "")
        
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="Invalid date range")
        
        # Generate dates list
        from datetime import datetime, timedelta
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        dates = []
        current = start
        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        
        # Get staffing requirements
        shift_reqs = constraints.get("shiftRequirements", {})
        min_day = shift_reqs.get("dayShift", {}).get("count", 5)
        min_night = shift_reqs.get("nightShift", {}).get("count", 3)
        
        constraint_rules = constraints.get("constraints", {})
        max_consecutive = constraint_rules.get("maxConsecutiveWorkDays", 3)
        
        logger.info(f"  Nurses: {len(nurses)}")
        logger.info(f"  Dates: {len(dates)} ({start_date} to {end_date})")
        logger.info(f"  Requirements: {min_day} day, {min_night} night")
        
        # Build comments from any marker data
        comments = {}
        
        # Create schedule
        schedule = create_schedule(
            nurses=nurses,
            dates=dates,
            preferences=assignments or {},
            comments=comments,
            min_day=min_day,
            min_night=min_night,
            max_consecutive=max_consecutive
        )
        
        # Save to database
        org_id = auth.organization_id if auth.is_authenticated else None
        new_schedule = OptimizedSchedule(
            schedule_id=schedule_id,
            organization_id=org_id,
            result=schedule,
            finalized=False,
        )
        db.add(new_schedule)
        db.commit()
        db.refresh(new_schedule)
        
        logger.info(f"Schedule saved: {new_schedule.id}")
        
        return {"optimized_schedule": schedule, "id": str(new_schedule.id)}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Optimize with constraints error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refine")
async def refine_schedule(
    request: RefineRequest,
    db: Session = Depends(get_db)
):
    """
    Refine schedule using AI.
    This is the ONLY place we use AI - for natural language adjustments.
    """
    try:
        logger.info("=" * 80)
        logger.info(f"REFINE: {request.refinement_request}")
        logger.info("=" * 80)
        
        # Build summary for AI
        summary_lines = []
        for nurse, shifts in request.schedule.items():
            work_shifts = [s for s in shifts if s.get('shiftType') != 'off']
            hours = sum(s.get('hours', 0) for s in work_shifts)
            days_worked = len(work_shifts)
            summary_lines.append(f"- {nurse}: {hours}h over {days_worked} days")
        
        prompt = f"""You are a nurse scheduling assistant. 
        
CURRENT SCHEDULE:
{chr(10).join(summary_lines[:20])}

USER REQUEST: {request.refinement_request}

Respond with JSON:
{{
  "changes": [
    {{"nurse": "Name", "date": "YYYY-MM-DD", "action": "set_off|set_day|set_night", "reason": "..."}}
  ],
  "summary": "What changes were made"
}}

Use these actions:
- set_off: Give this nurse the day off
- set_day: Assign a day shift (ZD12-, 07:00-19:25)
- set_night: Assign a night shift (ZN-, 19:00-07:00)

Return ONLY valid JSON."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=1500,
            response_format={"type": "json_object"}
        )
        
        ai_response = json.loads(response.choices[0].message.content)
        
        # Apply changes
        refined = {n: list(s) for n, s in request.schedule.items()}
        applied = []
        
        for change in ai_response.get("changes", []):
            nurse = change.get("nurse")
            date = change.get("date")
            action = change.get("action")
            
            if nurse not in refined:
                continue
            
            # Find shift for this date
            for idx, shift in enumerate(refined[nurse]):
                if shift.get("date") == date:
                    if action == "set_off":
                        refined[nurse][idx] = make_shift(date, "", "off", 0)
                        applied.append(change)
                    elif action == "set_day":
                        refined[nurse][idx] = make_shift(date, "ZD12-", "day", 12, "07:00", "19:25")
                        applied.append(change)
                    elif action == "set_night":
                        refined[nurse][idx] = make_shift(date, "ZN-", "night", 12, "19:00", "07:00")
                        applied.append(change)
                    break
        
        return {
            "suggestions": ai_response,
            "refined_schedule": refined,
            "changes_applied": len(applied)
        }
    
    except Exception as e:
        logger.error(f"Refine error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# CRUD ENDPOINTS
# ============================================================

@router.get("/")
async def list_schedules(
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    """List optimized schedules."""
    query = db.query(OptimizedSchedule)
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(OptimizedSchedule.organization_id == auth.organization_id)
    schedules = query.order_by(OptimizedSchedule.created_at.desc()).limit(20).all()
    return [{"id": str(s.id), "created_at": s.created_at, "finalized": s.finalized} for s in schedules]


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Get a specific schedule."""
    schedule = db.query(OptimizedSchedule).filter(OptimizedSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": str(schedule.id), "result": schedule.result, "finalized": schedule.finalized}


@router.patch("/{schedule_id}/finalize")
async def finalize_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Finalize a schedule."""
    schedule = db.query(OptimizedSchedule).filter(OptimizedSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Not found")
    schedule.finalized = True
    db.commit()
    return {"id": str(schedule.id), "finalized": True}


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Delete a schedule."""
    schedule = db.query(OptimizedSchedule).filter(OptimizedSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(schedule)
    db.commit()
    return {"deleted": True}
