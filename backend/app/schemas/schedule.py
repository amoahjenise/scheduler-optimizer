## schemas/schedule.py
from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import date

class ScheduleCreate(BaseModel):
    period: str
    notes: Optional[str] = ""
    rules: Optional[Dict[str, str]] = {}
    raw_images: List[str] = []  # image URLs or IDs
    employee_comments: Optional[Dict[str, Dict[str, str]]] = {}

class EmployeeCommentPrefill(BaseModel):
    nurse_name: str
    date: date
    comment: Optional[str] = ""