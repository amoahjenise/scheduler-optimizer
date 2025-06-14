# system_prompts.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.system_prompt import SystemPrompt as SystemPromptModel
from app.schemas.system_prompt import SystemPrompt as SystemPromptSchema, SystemPromptUpdate
from functools import lru_cache
import logging
import json

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_PROMPT_ID = 0
GLOBAL_PROMPT_ID = 1
DEFAULT_PROMPT_NAME = "default"
GLOBAL_PROMPT_NAME = "global"

DEFAULT_PROMPT_CONTENT = """IMPORTANT: Return ONLY valid complete JSON output with no additional text or formatting, no trailing commas, and complete the full JSON without truncation.

You are a professional nurse scheduler AI.

Your sole task is to **parse the given input data into a structured JSON object describing all constraints and rules necessary for an external scheduling algorithm** to generate an optimal nurse schedule.

DO NOT include existingAssignments in the response — that data is already provided in the input and will be handled externally.

---

Input Data:
• Nurses: {nurses_list}
• Notes: {notes}
• Employee Comments: {comments_json}

---

Output JSON Schema:

{{
  "dateRange": {{
    "start": "{start_date}",
    "end": "{end_date}"
  }},
  "shiftRequirements": {{
    "dayShift": {{
      "count": 5,
      "minChemoCertified": 2,
      "shiftCodes": ["07", "E15", "Z07"]
    }},
    "nightShift": {{
      "count": 4,
      "minChemoCertified": 2,
      "shiftCodes": ["23", "Z19", "Z23"]
    }}
  }},
  "shiftsInfo": {{
    "07": {{"hours": 8, "startTime": "07:00", "endTime": "15:15", "mealBreak": "00:45", "type": "day"}},
    "E15": {{"hours": 8, "startTime": "15:00", "endTime": "23:15", "mealBreak": "00:45", "type": "day"}},
    "Z07": {{"hours": 12, "startTime": "07:00", "endTime": "19:25", "mealBreak": "01:10", "type": "day"}},
    "23": {{"hours": 8, "startTime": "23:00", "endTime": "07:15", "mealBreak": "00:45", "type": "night"}},
    "Z19": {{"hours": 4, "startTime": "19:00", "endTime": "23:00", "mealBreak": "00:15", "type": "night"}},
    "Z23": {{"hours": 8, "startTime": "23:00", "endTime": "07:25", "mealBreak": "00:55", "type": "night"}}
  }},
  "nurses": [
    {{
      "id": "NurseID",
      "name": "Nurse Name",
      "isChemoCertified": true|false,
      "employmentType": "full-time|part-time",
      "maxWeeklyHours": 75|37.5,
      "offRequests": ["YYYY-MM-DD", "..."]  # inferred from employee comments or 'c', 'CF-n' shift codes
    }}
  ],
  "constraints": {{
    "maxConsecutiveWorkDays": 3,
    "alternateWeekendsOff": true,
    "respectOffRequests": true,
    "respectHolidays": true,
    "maxHoursPerWeek": {{
      "fullTime": 75,
      "partTime": 37.5
    }}
  }}
}}

---

Be complete and precise in parsing all constraints from the input. Return the full JSON object as shown.
"""

@lru_cache(maxsize=1)
def get_default_prompt_cached() -> str:
    return DEFAULT_PROMPT_CONTENT

def get_default_prompt(db: Session) -> SystemPromptModel:
    prompt = db.query(SystemPromptModel).filter(
        SystemPromptModel.id == DEFAULT_PROMPT_ID
    ).first()
    
    if not prompt:
        try:
            prompt = SystemPromptModel(
                id=DEFAULT_PROMPT_ID,
                name=DEFAULT_PROMPT_NAME,
                content=get_default_prompt_cached()
            )
            db.add(prompt)
            db.commit()
            db.refresh(prompt)
        except Exception as e:
            logger.error(f"Failed to create default prompt: {e}")
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to initialize default system prompt")
    return prompt

def get_global_prompt(db: Session) -> SystemPromptModel | None:
    return db.query(SystemPromptModel).filter(
        SystemPromptModel.id == GLOBAL_PROMPT_ID
    ).first()

@router.get("/", response_model=SystemPromptSchema)
def get_system_prompt(db: Session = Depends(get_db)):
    prompt = get_global_prompt(db)
    if prompt:
        return prompt
    return get_default_prompt(db)

@router.put("/", response_model=SystemPromptSchema)
def update_system_prompt(prompt_in: SystemPromptUpdate, db: Session = Depends(get_db)):
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
def reset_system_prompt(db: Session = Depends(get_db)):
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
