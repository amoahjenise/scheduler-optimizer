"""Schemas for Ambient Documentation sessions."""
from pydantic import BaseModel, UUID4, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class AmbientSessionCreate(BaseModel):
    patient_mrn: Optional[str] = None
    interaction_type: str = Field(default="rounds", pattern="^(admission|rounds|discharge|medication_admin|procedure)$")


class AmbientSessionUpdate(BaseModel):
    """Submit transcript text for AI extraction or mark session ended."""
    transcript: Optional[str] = None
    status: Optional[str] = None


class ExtractedEHRData(BaseModel):
    chief_complaint: Optional[str] = None
    vital_signs: Optional[Dict[str, Any]] = None
    symptoms: Optional[List[str]] = None
    medications_discussed: Optional[List[Dict[str, str]]] = None
    allergies_mentioned: Optional[List[str]] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    pain_level: Optional[int] = Field(None, ge=0, le=10)
    diet: Optional[str] = None
    activity_level: Optional[str] = None
    fall_risk: Optional[str] = None
    isolation_precautions: Optional[str] = None
    iv_access: Optional[Dict[str, str]] = None
    labs_ordered: Optional[List[str]] = None
    follow_up: Optional[str] = None


class AmbientReviewSubmit(BaseModel):
    """Nurse reviews AI-extracted data, optionally corrects fields, then approves."""
    corrections: Optional[Dict[str, Any]] = None
    approved: bool = True


class AmbientSessionResponse(BaseModel):
    id: UUID4
    organization_id: str
    nurse_id: UUID4
    patient_mrn: Optional[str]
    status: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    transcript: Optional[str]
    extracted_data: Optional[Dict[str, Any]]
    nurse_corrections: Optional[Dict[str, Any]]
    confidence_score: Optional[float]
    reviewed_at: Optional[datetime]
    committed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class AmbientSessionListResponse(BaseModel):
    sessions: List[AmbientSessionResponse]
    total: int


class AmbientTemplateResponse(BaseModel):
    id: UUID4
    name: str
    interaction_type: str
    fields_schema: Any
    is_default: bool
    is_active: bool

    class Config:
        from_attributes = True
