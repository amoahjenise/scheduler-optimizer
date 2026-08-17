"""
Ambient Documentation Models

AI-powered ambient listening that captures nurse-patient interactions
and auto-fills structured EHR (Electronic Health Record) data.
"""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Float, Text, ForeignKey, Boolean, Enum
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
import enum

from app.db.database import Base


class SessionStatus(str, enum.Enum):
    RECORDING = "recording"
    PROCESSING = "processing"
    DRAFT = "draft"
    REVIEWED = "reviewed"
    COMMITTED = "committed"
    DISCARDED = "discarded"


class AmbientSession(Base):
    """
    A single ambient documentation session capturing a nurse-patient interaction.

    The session records audio context, runs AI extraction, and produces
    structured EHR fields that must be nurse-reviewed before committing.
    """
    __tablename__ = "ambient_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)
    nurse_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    patient_mrn = Column(String, nullable=True, index=True)

    # Session metadata
    status = Column(String, nullable=False, default=SessionStatus.RECORDING.value, index=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)

    # AI-generated transcript (never stored as raw audio for HIPAA — only text)
    transcript = Column(Text, nullable=True)

    # AI-extracted structured EHR fields (nurse must review before commit)
    extracted_data = Column(JSONB, nullable=True)
    # Schema of extracted_data:
    # {
    #   "chief_complaint": str,
    #   "vital_signs": { "bp": str, "hr": int, "temp": float, "spo2": int, "rr": int },
    #   "symptoms": [str],
    #   "medications_discussed": [{ "name": str, "dose": str, "route": str, "frequency": str }],
    #   "allergies_mentioned": [str],
    #   "assessment": str,
    #   "plan": str,
    #   "pain_level": int | null,
    #   "diet": str | null,
    #   "activity_level": str | null,
    #   "fall_risk": str | null,
    #   "isolation_precautions": str | null,
    #   "iv_access": { "type": str, "site": str, "status": str } | null,
    #   "labs_ordered": [str],
    #   "follow_up": str | null
    # }

    # Nurse review
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    nurse_corrections = Column(JSONB, nullable=True)  # Fields the nurse edited
    confidence_score = Column(Float, nullable=True)  # AI confidence 0.0 - 1.0

    # EHR integration
    ehr_commit_id = Column(String, nullable=True)  # External EHR reference after push
    committed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<AmbientSession {self.id} status={self.status}>"


class AmbientTemplate(Base):
    """
    Configurable templates for what fields the AI should extract
    from different interaction types (admission, rounds, discharge, etc.).
    """
    __tablename__ = "ambient_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)

    name = Column(String, nullable=False)
    interaction_type = Column(String, nullable=False)  # admission, rounds, discharge, medication_admin, procedure
    fields_schema = Column(JSONB, nullable=False)  # Array of field definitions
    # Each field: { "key": str, "label": str, "type": "text"|"number"|"list"|"vitals"|"medications", "required": bool }

    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<AmbientTemplate {self.name} type={self.interaction_type}>"
