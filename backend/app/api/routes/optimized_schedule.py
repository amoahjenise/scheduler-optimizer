from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict
from app.db.deps import get_db
from app.core.config import settings
from app.models.optimized_schedule import OptimizedSchedule
from app.schemas.optimized_schedule import OptimizeRequest, OptimizeResponse
from openai import OpenAI
import json
import re

api_key = settings.OPENAI_API_KEY
client = OpenAI(api_key=api_key)

router = APIRouter(redirect_slashes=True)

def extract_json(text: str):
    match = re.search(r'(\{.*\})', text, re.DOTALL)
    if match:
        return match.group(1)
    return text

def get_system_prompt(db: Session, prompt_name: str) -> str:
    from app.models.system_prompt import SystemPrompt
    record = db.query(SystemPrompt).filter(SystemPrompt.name == prompt_name).first()
    if record:
        return record.content

    # Default fallback prompt exactly as requested, with placeholders for .format()
    return """You are a nurse schedule optimizer.

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

@router.post("/", response_model=OptimizeResponse)
async def optimize_schedule(req: OptimizeRequest, db: Session = Depends(get_db)):
    start_date = req.dates[0]
    end_date = req.dates[-1]
    rules_lines = "\n".join(f"- {k.replace('_', ' ')} = {v}" for k, v in req.rules.items())
    nurses_list = "\n".join(f"- {n}" for n in req.nurses)

    prompt_template = get_system_prompt(db, "nurse_schedule_optimizer")
    prompt = prompt_template.format(
        start_date=start_date,
        end_date=end_date,
        nurses_list=nurses_list,
        notes=req.notes,
        rules_lines=rules_lines,
        comments_json=json.dumps(req.comments, indent=2),
        assignments_json=json.dumps(req.assignments, indent=2),
        number_of_days=len(req.dates),
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": "You are a precise and constraint-following nurse scheduling assistant."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        raw = response.choices[0].message.content
        json_str = extract_json(raw)
        optimized = json.loads(json_str)

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Failed to parse GPT output as JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    new_schedule = OptimizedSchedule(
        schedule_id=req.schedule_id,
        result=optimized,
        finalized=False,
    )
    db.add(new_schedule)
    db.commit()
    db.refresh(new_schedule)
    
    return {"optimized_schedule": optimized, "id": str(new_schedule.id)}
