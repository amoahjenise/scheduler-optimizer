# system_prompts.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from app.db.deps import get_db
from app.models.system_prompt import SystemPrompt as SystemPromptModel
from app.schemas.system_prompt import SystemPrompt as SystemPromptSchema, SystemPromptUpdate
from app.core.auth import OrgAuth, AdminAuth
import logging
import json
from typing import List, Dict, Any, Optional

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_PROMPT_ID = 0
GLOBAL_PROMPT_ID = 1
DEFAULT_PROMPT_NAME = "default"
GLOBAL_PROMPT_NAME = "global"

# ---------------------------------------------------------------------------
# Dynamic shift-code helpers
# ---------------------------------------------------------------------------

def _load_shift_codes_from_db(db: Session) -> Optional[List[Dict[str, Any]]]:
    """Load shift codes from the database. Returns None if unavailable."""
    try:
        from app.models.shift_code import ShiftCode
        codes = (
            db.query(ShiftCode)
            .filter(ShiftCode.is_active == True)
            .order_by(ShiftCode.display_order)
            .all()
        )
        if codes:
            return [
                {
                    "code": sc.code,
                    "start": sc.start_time,
                    "end": sc.end_time,
                    "hours": float(sc.paid_hours),
                    "type": sc.shift_type.value if hasattr(sc.shift_type, "value") else str(sc.shift_type),
                    "label": sc.label,
                }
                for sc in codes
            ]
    except Exception as e:
        logger.warning(f"Could not load shift codes from DB: {e}")
    return None


# Hard-coded fallback (used when no DB codes exist)
_FALLBACK_SHIFT_CODES: List[Dict[str, Any]] = [
    {"code": "07",    "start": "07:00", "end": "15:15", "hours": 7.5,   "type": "day",      "label": "Day 8hr"},
    {"code": "Z07",   "start": "07:00", "end": "19:25", "hours": 11.25, "type": "day",      "label": "Day 12hr"},
    {"code": "11",    "start": "11:00", "end": "19:15", "hours": 7.5,   "type": "day",      "label": "Mid 8hr"},
    {"code": "Z11",   "start": "11:00", "end": "23:25", "hours": 11.25, "type": "day",      "label": "Mid 12hr"},
    {"code": "E15",   "start": "15:00", "end": "23:15", "hours": 7.5,   "type": "day",      "label": "Evening 8hr"},
    {"code": "23",    "start": "23:00", "end": "07:15", "hours": 7.5,   "type": "night",    "label": "Night 8hr"},
    {"code": "Z19",   "start": "19:00", "end": "23:00", "hours": 3.75,  "type": "night",    "label": "Night Start"},
    {"code": "Z23",   "start": "23:00", "end": "07:25", "hours": 7.5,   "type": "night",    "label": "Night Finish"},
    {"code": "Z23 B", "start": "23:00", "end": "07:25", "hours": 7.5,   "type": "combined", "label": "Night Finish + Back at 19:00"},
]


def _build_shift_codes_section(shift_codes: List[Dict[str, Any]]) -> str:
    """Build the human-readable SHIFT CODES REFERENCE section."""
    day_8h  = [sc for sc in shift_codes if sc["type"] == "day" and sc["hours"] < 10]
    day_12h = [sc for sc in shift_codes if sc["type"] == "day" and sc["hours"] >= 10]
    night_codes = [sc for sc in shift_codes if sc["type"] in ("night", "combined")]

    lines: list[str] = [
        "SHIFT CODES REFERENCE (HEMA-ONCOLOGY UNIT):",
        "ACTUAL SHIFT CODES (codes that appear on schedules):",
        "",
    ]
    if day_8h:
        lines.append(f"DAY SHIFTS (8-hour = {day_8h[0]['hours']}h actual work):")
        for sc in day_8h:
            lines.append(f"- {sc['code']}: {sc['label']} ({sc['start']}-{sc['end']}) = {sc['hours']}h")
        lines.append("")

    if day_12h:
        lines.append(f"DAY SHIFTS (12-hour = {day_12h[0]['hours']}h actual work):")
        for sc in day_12h:
            lines.append(f"- {sc['code']}: {sc['label']} ({sc['start']}-{sc['end']}) = {sc['hours']}h")
        lines.append("")

    if night_codes:
        lines.append("NIGHT SHIFTS:")
        for sc in night_codes:
            lines.append(f"- {sc['code']}: {sc['label']} ({sc['start']}-{sc['end']}) = {sc['hours']}h")
        lines.append("")

    return "\n".join(lines)


def _build_shifts_info_block(shift_codes: List[Dict[str, Any]]) -> str:
    """Build the ``shiftsInfo`` JSON fragment.

    Braces are doubled so the result survives a later ``.format()`` call.
    """
    entries: list[str] = []
    for sc in shift_codes:
        entries.append(
            f'    "{sc["code"]}": {{{{"hours": {sc["hours"]}, '
            f'"startTime": "{sc["start"]}", '
            f'"endTime": "{sc["end"]}", '
            f'"type": "{sc["type"]}"}}}}'
        )
    return '  "shiftsInfo": {{\n' + ",\n".join(entries) + "\n  }}"


def _build_shift_requirements_block(shift_codes: List[Dict[str, Any]]) -> str:
    """Build the ``shiftRequirements`` JSON fragment.

    Braces are doubled so the result survives a later ``.format()`` call.
    """
    day_codes   = [sc["code"] for sc in shift_codes if sc["type"] == "day"]
    night_codes = [sc["code"] for sc in shift_codes if sc["type"] in ("night", "combined")]

    day_json   = json.dumps(day_codes)
    night_json = json.dumps(night_codes)

    return (
        '  "shiftRequirements": {{\n'
        '    "dayShift": {{\n'
        '      "count": 5,\n'
        '      "minChemoCertified": 2,\n'
        f'      "shiftCodes": {day_json}\n'
        '    }},\n'
        '    "nightShift": {{\n'
        '      "count": 3,\n'
        '      "minChemoCertified": 1,\n'
        f'      "shiftCodes": {night_json}\n'
        '    }}\n'
        '  }}'
    )


# ---------------------------------------------------------------------------
# Prompt template – markers get replaced with dynamic content
# ---------------------------------------------------------------------------

_SHIFT_CODES_MARKER        = "__SHIFT_CODES_SECTION__"
_SHIFTS_INFO_MARKER        = "__SHIFTS_INFO_JSON__"
_SHIFT_REQUIREMENTS_MARKER = "__SHIFT_REQUIREMENTS_JSON__"

_PROMPT_TEMPLATE = (
    "You are a nurse scheduling assistant that converts scheduling requirements "
    "into structured JSON constraints. \n\n"
    "IMPORTANT RULES:\n"
    "1. Return ONLY valid JSON that matches the exact structure below\n"
    "2. Do NOT include any additional text, explanations, or markdown formatting\n"
    "3. The JSON must be complete and parseable\n"
    "4. All fields must be included exactly as shown\n"
    "5. `dayShift.count` and `nightShift.count` are STRICT MINIMUM floors, not exact quotas\n"
    "6. Preserve OCR assignments as much as possible while meeting minimum coverage and certification constraints\n"
    "7. Consider D/E/N coverage across the full 24h timeline (day, evening, night)\n"
    "8. Prioritize senior nurse presence and avoid patterns where only junior nurses cover a slot\n"
    "9. Treat 12h lines with pay-period reconciliation: avoid forcing exactly 37.5h every single week\n"
    "10. For full-time nurses, prefer at least one worked weekend in each 14-day pay period when feasible\n"
    "11. Compute expected average daily staffing from target hours and avoid large overstaffing spikes\n\n"
    + _SHIFT_CODES_MARKER + "\n"
    "NIGHT SHIFTS - OVERNIGHT SPLIT:\n"
    "IMPORTANT: Overnight shifts use Z19 + Z23 pattern (breaks included in times)\n"
    "Example: Z19 on Monday, Z23 B on Tuesday means:\n"
    "  Monday 19:00-23:00: Z19 = 3.75h\n"
    "  Tuesday 23:00-07:25: Z23 = 7.5h AND back at 19:00 Tuesday for next shift\n"
    "Total overnight: 3.75h + 7.5h = 11.25h\n\n"
    "REQUIRED JSON STRUCTURE:\n"
    "{{\n"
    '  "dateRange": {{\n'
    '    "start": "{start_date}",\n'
    '    "end": "{end_date}"\n'
    "  }},\n"
    + _SHIFT_REQUIREMENTS_MARKER + ",\n"
    + _SHIFTS_INFO_MARKER + ",\n"
    '  "nurses": [\n'
    "    {{\n"
    '      "id": "NurseID",\n'
    '      "name": "Nurse Name",\n'
    '      "isChemoCertified": true,\n'
    '      "employmentType": "full-time",\n'
    '      "maxWeeklyHours": 37.5,\n'
    '      "targetWeeklyHours": 37.5,\n'
    '      "targetBiWeeklyHours": 75,\n'
    '      "preferredShiftLengthHours": 8,\n'
    '      "offRequests": [],\n'
    '      "seniority": "Nurse Experience"\n'
    "    }}\n"
    "  ],\n"
    '  "constraints": {{\n'
    '    "maxConsecutiveWorkDays": 3,\n'
    '    "maxConsecutiveNightShifts": 3,\n'
    '    "alternateWeekendsOff": true,\n'
    '    "respectOffRequests": true,\n'
    '    "respectCurrentAssignments": true,\n'
    '    "maxHoursPerWeek": {{\n'
    '      "fullTime": 37.5,\n'
    '      "partTime": 26.25\n'
    "    }},\n"
    '    "shiftCoherencyRules": {{\n'
    '      "noDayAfterNight": true,\n'
    '      "minimumRestHours": 12\n'
    "    }},\n"
    '    "workPatternRules": {{\n'
    '      "type": "2-3-2-3",\n'
    '      "enforced": true,\n'
    '      "strictSequence": true\n'
    "    }},\n"
    '    "seniorityRules": {{\n'
    '      "enabled": true,\n'
    '      "higherIsSenior": true\n'
    "    }}\n"
    "  }}\n"
    "}}\n\n"
    "Processing Instructions:\n"
    "1. Nurse Employment Type:\n"
    "  - Prefer explicit employmentType from {{nurses_list}}\n"
    "  - If employmentType is missing, infer from maxWeeklyHours and/or notes/comments\n"
    "   - Default to full-time if unclear\n\n"
    "2. Weekly Targets:\n"
    "  - Respect organization-configured FT/PT weekly targets and nurse-specific maxWeeklyHours\n"
    "  - Also support 14-day reconciliation targets (default FT 75h / PT 52.5h unless overridden)\n"
    "  - Support 0.6 FTE part-time lines at 45h per 2 weeks via nurse-specific maxWeeklyHours/target fields\n"
    "  - For 12h lines, allow 3-shift/4-shift week variation as long as pay-period targets balance\n"
    "  - Do NOT overwrite provided maxWeeklyHours with hardcoded values\n\n"
    "3. CF-n assignments:\n"
    "   - Treat as a banked holiday (day off request)\n"
    "   - Add the assignment date to the nurse's `offRequests`\n"
    "   - DO NOT schedule this as a shift - the nurse is OFF\n"
    "   - CF codes should NEVER appear in shiftCodes lists\n\n"
    "4. 'c' in assignments:\n"
    "   - Add date to nurse's offRequests\n"
    "   - Do not assign shift that day\n\n"
    "5. Preserve ALL existing non-OFF assignments as much as possible\n\n"
    "6. Do not treat unassigned days as implicit offRequests.\n"
    "   Only use 'c', CF-n, or comments with explicit vacation/holiday requests.\n\n"
    "7. Coverage interpretation:\n"
    "  - `dayShift.count` and `nightShift.count` are strict minimums, not exact required counts\n"
    "  - Extra coverage above minimum is allowed when needed for balancing or safety\n\n"
    "8. Prioritization order:\n"
    "  1) Respect OCR schedule as much as possible\n"
    "  2) Meet minimum staffing and certification requirements (including chemo/renal where specified)\n"
    "  3) Meet FT/PT pay-period targets (reconciliation) and nurse max hours\n"
    "  4) Prefer at least one worked weekend per 14-day period for full-time nurses when feasible\n"
    "  5) Keep D/E/N slot coverage balanced with senior nurse presence\n\n"
    "9. Daily staffing normalization:\n"
    "  - Compute expected average daily staff as:\n"
    "    (sum of nurses' targetBiWeeklyHours, or 2*targetWeeklyHours fallback) / (11.25 * number_of_days)\n"
    "  - Keep daily assigned headcount near this average (small buffer), while preserving strict minimum floors.\n"
    "  - Do not create avoidable spikes (e.g., 18 staff one day and 8 another) unless explicitly required "
    "by off requests or fixed assignments.\n\n"
    "Input Data:\n"
    "- Nurses: {nurses_list}\n"
    "- Notes: {notes}\n"
    "- Comments: {comments_json} \n"
    "- Existing Assignments: {existing_assignments}\n\n"
    "AGAIN: RETURN ONLY THE JSON OBJECT WITH NO ADDITIONAL TEXT"
)


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

def build_default_prompt_content(db: Session = None) -> str:
    """Build the default system prompt, injecting shift codes from the DB when available."""
    shift_codes = None
    if db:
        shift_codes = _load_shift_codes_from_db(db)

    if not shift_codes:
        shift_codes = _FALLBACK_SHIFT_CODES

    return (
        _PROMPT_TEMPLATE
        .replace(_SHIFT_CODES_MARKER, _build_shift_codes_section(shift_codes))
        .replace(_SHIFTS_INFO_MARKER, _build_shifts_info_block(shift_codes))
        .replace(_SHIFT_REQUIREMENTS_MARKER, _build_shift_requirements_block(shift_codes))
    )


# Backward-compatible constant (no DB – uses fallback codes)
DEFAULT_PROMPT_CONTENT = build_default_prompt_content()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_default_prompt(db: Session) -> SystemPromptModel:
    """Return (or create) the default prompt row, built dynamically from DB shift codes."""
    prompt = db.query(SystemPromptModel).filter(
        SystemPromptModel.id == DEFAULT_PROMPT_ID
    ).first()

    fresh_content = build_default_prompt_content(db)

    if not prompt:
        try:
            prompt = SystemPromptModel(
                id=DEFAULT_PROMPT_ID,
                name=DEFAULT_PROMPT_NAME,
                content=fresh_content,
            )
            db.add(prompt)
            db.commit()
            db.refresh(prompt)
        except Exception as e:
            logger.error(f"Failed to create default prompt: {e}")
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to initialize default system prompt")
    else:
        # Keep default row in sync with current DB shift codes
        if prompt.content != fresh_content:
            prompt.content = fresh_content
            try:
                db.commit()
                db.refresh(prompt)
            except Exception:
                db.rollback()
    return prompt


def get_global_prompt(db: Session) -> Optional[SystemPromptModel]:
    return db.query(SystemPromptModel).filter(
        SystemPromptModel.id == GLOBAL_PROMPT_ID
    ).first()


def get_fallback_prompt_payload() -> dict:
    return {
        "id": DEFAULT_PROMPT_ID,
        "name": DEFAULT_PROMPT_NAME,
        "content": DEFAULT_PROMPT_CONTENT,
    }


# ---------------------------------------------------------------------------
# Public helper (used by optimizer import)
# ---------------------------------------------------------------------------

def get_system_prompt(db: Session) -> SystemPromptModel:
    """Return the active system prompt (global override or dynamic default).

    This is the function imported by optimized_schedule.py.
    """
    prompt = get_global_prompt(db)
    if prompt:
        return prompt
    return get_default_prompt(db)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/", response_model=SystemPromptSchema)
def read_system_prompt(
    auth: OrgAuth,
    db: Session = Depends(get_db)
):
    """Get the system prompt. Requires organization membership."""
    # OrgAuth already validates auth and org - if we get here, auth is valid
    try:
        prompt = get_global_prompt(db)
        if prompt:
            return prompt
        return get_default_prompt(db)
    except SQLAlchemyError as e:
        logger.error(f"System prompt DB unavailable, using fallback: {e}")
        db.rollback()
        return get_fallback_prompt_payload()


@router.put("/", response_model=SystemPromptSchema)
def update_system_prompt(
    prompt_in: SystemPromptUpdate,
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """Update the system prompt. Requires admin role."""
    # AdminAuth already validates auth and admin role
    try:
        prompt = get_global_prompt(db)
        if not prompt:
            prompt = SystemPromptModel(
                id=GLOBAL_PROMPT_ID,
                name=GLOBAL_PROMPT_NAME,
                content=prompt_in.content,
            )
            db.add(prompt)
        else:
            prompt.content = prompt_in.content
        db.commit()
        db.refresh(prompt)
        return prompt
    except Exception as e:
        logger.error(f"Prompt update failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update system prompt")


@router.post("/reset", response_model=SystemPromptSchema)
def reset_system_prompt(
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """Delete any custom global prompt and return a fresh default. Requires admin role."""
    # AdminAuth already validates auth and admin role
    try:
        prompt = get_global_prompt(db)
        if prompt:
            db.delete(prompt)
            db.commit()
        return get_default_prompt(db)
    except Exception as e:
        logger.error(f"Prompt reset failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to reset system prompt")
