from pydantic import BaseModel
from typing import Dict, List, Any

class OptimizedScheduleCreate(BaseModel):
    schedule_id: str
    result: Dict[str, Any]
    finalized: bool = False

# ✅ Add these below
class OptimizeRequest(BaseModel):
    schedule_id: str
    nurses: List[str]
    dates: List[str]
    assignments: Dict[str, List[str]]
    comments: Dict[str, Dict[str, str]]
    rules: Dict[str, Any]
    notes: str

class OptimizeResponse(BaseModel):
    optimized_schedule: Dict[str, List[str]]
    id: str
