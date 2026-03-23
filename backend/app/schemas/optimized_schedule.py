from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional
import uuid

class OptimizedScheduleCreate(BaseModel):
    schedule_id: str
    result: Dict[str, Any]
    finalized: bool = False

# Staff requirements from frontend
class StaffRequirements(BaseModel):
    minDayStaff: int = 3
    minNightStaff: int = 2

# Full nurse object with all properties
class NurseInput(BaseModel):
    id: Optional[str] = None
    name: str
    employeeId: Optional[str] = None
    isChemoCertified: Optional[bool] = False
    isTransplantCertified: Optional[bool] = False
    isRenalCertified: Optional[bool] = False
    isChargeCertified: Optional[bool] = False
    isHeadNurse: Optional[bool] = False
    employmentType: Optional[str] = "full-time"
    fte: Optional[float] = None
    maxWeeklyHours: Optional[float] = 60.0
    targetWeeklyHours: Optional[float] = None
    targetBiWeeklyHours: Optional[float] = None
    preferredShiftLengthHours: Optional[float] = None
    offRequests: Optional[List[str]] = []

# Your existing request model
class OptimizeRequest(BaseModel):
    schedule_id: Optional[str] = None
    nurses: List[NurseInput]  # Full nurse objects, not just strings
    dates: List[str]
    assignments: Dict[str, List[str]]
    comments: Dict[str, Dict[str, str]]
    rules: Dict[str, Any]
    notes: str
    staffRequirements: Optional[StaffRequirements] = None

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

# Model for refine request
class RefineRequest(BaseModel):
    schedule: Dict[str, List[Dict[str, Any]]]
    refinement_request: str
    dates: List[str]
    nurseHoursStats: Optional[List[Dict[str, Any]]] = None  # Optional hours breakdown per nurse
    fullTimeWeeklyTarget: Optional[float] = None
    partTimeWeeklyTarget: Optional[float] = None
    rules: Optional[str] = None  # Optional scheduling rules to guide refinement

# Model for AI schedule insights request
class InsightsRequest(BaseModel):
    schedule: Dict[str, List[Dict[str, Any]]]
    dates: List[str]
    nurseHoursStats: Optional[List[Dict[str, Any]]] = None
    coverageSnapshot: Optional[Dict[str, Any]] = None
    orgContext: Optional[str] = None
    staffNotes: Optional[Dict[str, List[str]]] = None
    markerComments: Optional[str] = None
    locale: Optional[str] = "en"  # Default to English
