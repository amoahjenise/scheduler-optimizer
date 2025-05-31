from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.system_prompt import SystemPrompt as SystemPromptModel
from app.schemas.system_prompt import SystemPrompt as SystemPromptSchema, SystemPromptUpdate

router = APIRouter()

DEFAULT_PROMPT_CONTENT = """You are a nurse schedule optimizer.

Schedule Dates: {start_date} to {end_date}
Nurses in scope:
{nurses_list}

Shift Code Rules:
- Shift codes starting with 'Z' (e.g., Z19, Z23, Z07) are 12-hour shifts.
- Shift codes like '07' or '19' are standard 8-hour shifts.
- 'B' is a shift modifier (e.g., 'Z23 B' is a valid shift) and must be preserved.
- Preserve all original shift codes and labels exactly.

Notes from manager or admin:
{notes}

Constraints:
{rules_lines}
- Do not assign shifts outside the date range ({start_date} to {end_date}).
- Employee comments must be respected as the highest priority.
- If an employee requests a specific day off or shift, do not assign them any conflicting shift.
- The schedule must fully cover every day in the period; no day should be left without assigned shifts.
- Each nurse’s shift list length must exactly match the number of days.
- If a nurse is off on a day, assign "—" for that day.
- Nurses should not be assigned shifts for more than 3 consecutive days as a strong constraint.
- Typically, nurses work 3 days then have 2 days off, aiming to allow at least one weekend off every two weeks.

Staffing requirements per day:

- Day shifts must have exactly 5 nurses assigned, including exactly 1 head nurse.
- Night shifts must have exactly 4 nurses assigned, with no head nurse.
- Each shift (day or night) must include at least 2 chemo certified nurses.
- No day should have fewer or more nurses than required.

Shift Code Classification:
- Day shifts: 07, 19, Z07, Z19, Z23 B
- Night shifts: Z23, Z23 B

Final validation: Before returning, ensure all these conditions are fully satisfied for every day.

Employee Comments:
{comments_json}

Current Assignments:
{assignments_json}

Return ONLY a valid JSON object in the format:
{{
  "Nurse Name (ID, Experience, Hours)": ["shift_1", "shift_2", ..., "shift_N"]
}}

The schedule optimization must fully cover the entire period;

IMPORTANT: Return ONLY the JSON object without any explanations, comments, or additional text.
"""

DEFAULT_PROMPT_ID = 0
DEFAULT_PROMPT_NAME = "default"

GLOBAL_PROMPT_ID = 1
GLOBAL_PROMPT_NAME = "global"


def get_default_prompt(db: Session) -> SystemPromptModel:
    prompt = db.query(SystemPromptModel).filter(SystemPromptModel.id == DEFAULT_PROMPT_ID).first()
    if not prompt:
        prompt = SystemPromptModel(
            id=DEFAULT_PROMPT_ID,
            name=DEFAULT_PROMPT_NAME,
            content=DEFAULT_PROMPT_CONTENT
        )
        db.add(prompt)
        db.commit()
        db.refresh(prompt)
    return prompt


def get_global_prompt(db: Session) -> SystemPromptModel | None:
    return db.query(SystemPromptModel).filter(SystemPromptModel.id == GLOBAL_PROMPT_ID).first()


@router.get("/", response_model=SystemPromptSchema)
def get_system_prompt(db: Session = Depends(get_db)):
    # Return global prompt if exists, else default prompt
    prompt = get_global_prompt(db)
    if prompt:
        return prompt
    return get_default_prompt(db)


@router.put("/", response_model=SystemPromptSchema)
def update_system_prompt(prompt_in: SystemPromptUpdate, db: Session = Depends(get_db)):
    prompt = get_global_prompt(db)
    if not prompt:
        # Create new global prompt
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


@router.post("/reset", response_model=SystemPromptSchema)
def reset_system_prompt(db: Session = Depends(get_db)):
    # Delete global prompt if exists
    prompt = get_global_prompt(db)
    if prompt:
        db.delete(prompt)
        db.commit()
    # Return default prompt always
    return get_default_prompt(db)
