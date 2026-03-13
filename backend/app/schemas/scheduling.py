"""Pydantic schemas for scheduling endpoints."""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


# ============= ScheduleDemand Schemas =============

class ScheduleDemandCreate(BaseModel):
    """Create/update schedule demand."""
    shift_code_id: str
    date: str  # YYYY-MM-DD
    global_daily_target: int = 12
    min_staff_required: int
    skill_requirements: Optional[Dict[str, int]] = None
    notes: Optional[str] = None


class ScheduleDemandResponse(BaseModel):
    """Response schema for schedule demand."""
    id: str
    organization_id: str
    shift_code_id: str
    date: str
    global_daily_target: int
    min_staff_required: int
    skill_requirements: Optional[Dict[str, int]]
    actual_staff_assigned: int
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class ScheduleDemandList(BaseModel):
    """List of demands with compliance info."""
    demands: List[ScheduleDemandResponse]
    total: int
    compliance_score: int  # 0-100


# ============= ShiftTemplate Schemas =============

class ShiftTemplateCreate(BaseModel):
    """Create shift template."""
    name: str
    description: Optional[str] = None
    template_type: str  # "daily", "weekly", "monthly"
    pattern: Dict[str, List[str]]  # {"0": ["Z07"], "1": ["Z07"], ...}
    applicable_shift_codes: Optional[str] = None
    applicable_roles: Optional[str] = None


class ShiftTemplateResponse(BaseModel):
    """Response schema for shift template."""
    id: str
    organization_id: str
    name: str
    description: Optional[str]
    template_type: str
    pattern: Dict[str, Any]
    applicable_shift_codes: Optional[str]
    applicable_roles: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============= TimeOffRequest Schemas =============

class TimeOffRequestCreate(BaseModel):
    """Create time-off request."""
    nurse_id: str  # UUID
    start_date: str  # YYYY-MM-DD
    end_date: str  # YYYY-MM-DD
    reason: str  # "vacation", "sick", "personal", "family"
    notes: Optional[str] = None


class TimeOffRequestApprove(BaseModel):
    """Approve time-off request."""
    approved_by_id: str  # User ID
    approval_timestamp: Optional[datetime] = None


class TimeOffRequestDeny(BaseModel):
    """Deny time-off request."""
    approved_by_id: str  # User ID
    denial_reason: str


class TimeOffRequestResponse(BaseModel):
    """Response schema for time-off request."""
    id: str
    nurse_id: str
    start_date: str
    end_date: str
    reason: str
    notes: Optional[str]
    status: str  # "pending", "approved", "denied"
    approved_by_id: Optional[str]
    approval_timestamp: Optional[datetime]
    denial_reason: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============= Reconciliation Schemas =============

class NurseHoursReconciliationResponse(BaseModel):
    """Response for reconciliation record."""
    id: str
    nurse_id: str
    period_start_date: str
    period_end_date: str
    bi_weekly_target: float
    hours_worked: float
    hours_worked_with_vacation_offset: float
    adjusted_target: float
    delta: float
    balancing_shift_needed: bool
    balancing_shift_hours: Optional[float]
    balancing_shift_recommended_date: Optional[str]
    vacation_days_count: int
    status: str  # "pending", "reconciled", "approved"
    notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


class ComplianceScoreResponse(BaseModel):
    """Organizational compliance score."""
    score: int  # 0-100
    total_nurses: int
    compliant_nurses: int
    avg_delta: float
    nurses_needing_bshift: int
    tolerance_hours: float = 5.0


class BalancingShiftRecommendation(BaseModel):
    """Recommended B-Shift for a nurse."""
    nurse_id: str
    nurse_name: str
    hours_needed: float
    recommended_date: str  # YYYY-MM-DD
    delta: float
    priority: str  # "high", "medium", "low"


class BalancingShiftRecommendations(BaseModel):
    """List of recommended B-Shifts."""
    recommendations: List[BalancingShiftRecommendation]
    total_hours_to_schedule: float
    period_end_date: str


# ============= Schedule Publishing / Approval Schemas =============

class ConflictWarning(BaseModel):
    """Scheduling conflict detected."""
    type: str  # "rest_violation", "24h_violation", "skill_gap", "overstaffed", etc.
    severity: str  # "error", "warning", "info"
    nurse_id: Optional[str] = None
    date: Optional[str] = None
    message: str
    details: Optional[Dict[str, Any]] = None


class PublishScheduleRequest(BaseModel):
    """Request to publish schedule."""
    schedule_dict: Dict[str, List[Dict[str, Any]]]  # nurse_id -> list of shifts
    dates: List[str]  # YYYY-MM-DD
    require_approval: bool = False  # If True, require manager approval before finalizing
    notes: Optional[str] = None


class PublishScheduleResponse(BaseModel):
    """Response after publishing."""
    success: bool
    published_schedule_id: Optional[str] = None
    conflicts_detected: List[ConflictWarning] = []
    requires_approval: bool = False
    approval_workflow_id: Optional[str] = None
    message: str


# ============= Assignment Schemas =============

class ShiftAssignmentRequest(BaseModel):
    """Assign one or more shifts."""
    assignments: List[Dict[str, Any]]  # [{date, shift_code_id, nurse_id}, ...]
    reason: Optional[str] = None


class ShiftAssignmentResponse(BaseModel):
    """Result of shift assignment."""
    success: bool
    assigned_count: int
    failed_count: int
    errors: List[str] = []
    message: str


# ============= Shift Notes/Tasks Schemas =============

class ShiftNoteCreate(BaseModel):
    """Add note to a shift."""
    shift_id: str
    note_text: str
    is_task: bool = False  # If True, can be marked complete
    assigned_to: Optional[str] = None  # Nurse ID or "team"


class ShiftNoteResponse(BaseModel):
    """Response for shift note."""
    id: str
    shift_id: str
    note_text: str
    is_task: bool
    is_complete: bool
    assigned_to: Optional[str]
    created_by_id: str
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============= Recurrence Schemas =============

class ScheduleRecurrenceCreate(BaseModel):
    """Create schedule recurrence pattern."""
    name: str
    description: Optional[str] = None
    recurrence_type: str  # "daily", "weekly", "bi-weekly", "monthly", "custom"
    pattern: Dict[str, List[str]]  # {"monday": ["Z07"], "tuesday": ["Z07"], ...}
    cycle_length_days: int = 7
    applicable_nurses: Optional[List[str]] = None
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None  # YYYY-MM-DD


class ScheduleRecurrenceResponse(BaseModel):
    """Response for schedule recurrence."""
    id: int
    org_id: str
    name: str
    description: Optional[str]
    recurrence_type: str
    pattern: Dict[str, List[str]]
    cycle_length_days: int
    applicable_nurses: List[str]
    start_date: Optional[str]
    end_date: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class EmployeePreferredScheduleCreate(BaseModel):
    """Create employee preferred schedule."""
    nurse_id: str
    preferred_pattern: Dict[str, List[str]]  # {"monday": ["Z07"], ...}
    period_start_date: str  # YYYY-MM-DD
    period_end_date: str  # YYYY-MM-DD
    constraints: Optional[Dict[str, Any]] = None
    source: str = "manual"  # "manual", "upload", "system_generated"
    upload_filename: Optional[str] = None


class EmployeePreferredScheduleResponse(BaseModel):
    """Response for employee preferred schedule."""
    id: int
    org_id: str
    nurse_id: str
    preferred_pattern: Dict[str, List[str]]
    period_start_date: str
    period_end_date: str
    constraints: Optional[Dict[str, Any]]
    source: str
    status: str  # "pending_review", "approved", "rejected", "active"
    admin_notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


class GenerateScheduleFromRecurrenceRequest(BaseModel):
    """Request to generate schedule from recurrence."""
    recurrence_id: int
    start_date: str  # YYYY-MM-DD
    end_date: str  # YYYY-MM-DD
    override_nurses: Optional[List[str]] = None  # Override applicable_nurses


class GeneratedScheduleSnapshotResponse(BaseModel):
    """Response for generated schedule snapshot."""
    id: int
    org_id: str
    recurrence_id: int
    period_start_date: str
    period_end_date: str
    schedule_data: Dict[str, Any]
    is_finalized: bool
    generated_at: datetime
    
    class Config:
        from_attributes = True
