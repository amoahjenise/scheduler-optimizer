## schemas/optimized_schedule.py
from pydantic import BaseModel
from typing import Dict, Any

class OptimizedScheduleCreate(BaseModel):
    schedule_id: str
    result: Dict[str, Any]
    finalized: bool = False