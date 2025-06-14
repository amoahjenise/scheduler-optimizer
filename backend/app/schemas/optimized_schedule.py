from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional
import uuid

class OptimizedScheduleCreate(BaseModel):
    schedule_id: str
    result: Dict[str, Any]
    finalized: bool = False

# Your existing request model
class OptimizeRequest(BaseModel):
    schedule_id: str
    nurses: List[str]
    dates: List[str]
    assignments: Dict[str, List[str]]
    comments: Dict[str, Dict[str, str]]
    rules: Dict[str, Any]
    notes: str

# Add this helper model for each shift entry
class ShiftEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # Add unique ID
    date: str
    shift: str
    shiftType: str
    hours: int

class ShiftEntryResponse(BaseModel):
    id: str
    date: str
    shift: str
    shiftType: str
    hours: int
    startTime: str
    endTime: str    

# Fix the response model to expect a list of ShiftEntry, not list of str
class OptimizeResponse(BaseModel):
    optimized_schedule: Dict[str, List[ShiftEntryResponse]]
    id: str
