"""Schemas for Micro-Learning / Onboarding."""
from pydantic import BaseModel, UUID4, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ── Module Schemas ──

class LearningModuleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    category: str = Field(..., pattern="^(orientation|safety|medication|equipment|charting|infection_control|patient_handling|emergency|compliance|specialty)$")
    content_type: str = Field(default="interactive", pattern="^(interactive|video|quiz|checklist|simulation)$")
    content: Dict[str, Any]
    estimated_duration_minutes: int = Field(default=5, ge=1, le=60)
    difficulty_level: str = Field(default="beginner", pattern="^(beginner|intermediate|advanced)$")
    tags: Optional[List[str]] = None
    prerequisite_module_ids: Optional[List[str]] = None
    target_roles: Optional[List[str]] = None
    required_for_onboarding: bool = False
    is_mandatory: bool = False
    is_published: bool = True
    passing_score: float = Field(default=0.8, ge=0.0, le=1.0)
    sort_order: int = 0


class LearningModuleUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = None
    content_type: Optional[str] = None
    content: Optional[Dict[str, Any]] = None
    estimated_duration_minutes: Optional[int] = Field(None, ge=1, le=60)
    difficulty_level: Optional[str] = None
    tags: Optional[List[str]] = None
    target_roles: Optional[List[str]] = None
    required_for_onboarding: Optional[bool] = None
    is_mandatory: Optional[bool] = None
    is_published: Optional[bool] = None
    passing_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    sort_order: Optional[int] = None


class LearningModuleResponse(BaseModel):
    id: UUID4
    organization_id: Optional[str]
    title: str
    description: Optional[str]
    category: str
    content_type: str
    content: Dict[str, Any]
    estimated_duration_minutes: int
    difficulty_level: str
    tags: Optional[List[str]]
    prerequisite_module_ids: Optional[List[str]]
    target_roles: Optional[List[str]]
    required_for_onboarding: bool
    is_mandatory: bool
    is_published: bool
    passing_score: float
    sort_order: int
    version: int
    created_at: datetime

    class Config:
        from_attributes = True


class LearningModuleListResponse(BaseModel):
    modules: List[LearningModuleResponse]
    total: int


# ── Progress Schemas ──

class ProgressUpdate(BaseModel):
    """Incremental progress update from the mobile client."""
    current_step: Optional[int] = None
    progress_percentage: Optional[float] = Field(None, ge=0.0, le=100.0)
    time_spent_seconds: Optional[int] = Field(None, ge=0)
    quiz_answers: Optional[Dict[str, Any]] = None
    checklist_state: Optional[Dict[str, bool]] = None


class LearningProgressResponse(BaseModel):
    id: UUID4
    nurse_id: UUID4
    module_id: UUID4
    status: str
    progress_percentage: float
    current_step: int
    quiz_score: Optional[float]
    quiz_attempts: int
    passed: Optional[bool]
    time_spent_seconds: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    last_accessed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Learning Path Schemas ──

class LearningPathCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = None
    module_ids: List[str]
    target_roles: Optional[List[str]] = None
    is_required: bool = False


class LearningPathResponse(BaseModel):
    id: UUID4
    organization_id: Optional[str]
    title: str
    description: Optional[str]
    category: Optional[str]
    module_ids: List[str]
    target_roles: Optional[List[str]]
    is_required: bool
    estimated_total_minutes: Optional[int]
    is_published: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Dashboard Schemas ──

class NurseOnboardingStatus(BaseModel):
    nurse_id: UUID4
    nurse_name: str
    total_modules: int
    completed_modules: int
    in_progress_modules: int
    completion_percentage: float
    mandatory_completed: bool
    last_activity_at: Optional[datetime]


class LearningDashboardResponse(BaseModel):
    """Manager view of onboarding progress across nurses."""
    total_nurses: int
    fully_onboarded: int
    in_progress: int
    not_started: int
    modules_available: int
    paths_available: int
    nurse_statuses: List[NurseOnboardingStatus]


# ── Assignment Schemas ──

class LearningAssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    assignment_type: str = Field(default="module", pattern="^(module|link|reading)$")
    module_id: Optional[str] = None
    url: Optional[str] = None
    target_team: Optional[str] = None
    due_date: Optional[datetime] = None
    is_mandatory: bool = True


class LearningAssignmentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    target_team: Optional[str] = None
    due_date: Optional[datetime] = None
    is_mandatory: Optional[bool] = None
    url: Optional[str] = None


class LearningAssignmentResponse(BaseModel):
    id: UUID4
    organization_id: str
    title: str
    description: Optional[str] = None
    assignment_type: str
    module_id: Optional[UUID4] = None
    url: Optional[str] = None
    target_team: Optional[str] = None
    due_date: Optional[datetime] = None
    is_mandatory: bool
    created_by_name: Optional[str] = None
    created_at: datetime

    # Derived, per-request fields
    completed_by_me: bool = False
    completed_count: int = 0

    class Config:
        from_attributes = True


class AssignmentCompletionResponse(BaseModel):
    id: UUID4
    assignment_id: UUID4
    user_id: str
    user_name: Optional[str] = None
    completed_at: datetime

    class Config:
        from_attributes = True
