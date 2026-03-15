# /backend/app/models/nurse.py
from sqlalchemy import Column, String, Integer, Boolean, Float, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.types import DateTime
import uuid

from app.db.database import Base


class Nurse(Base):
    """Database model for nurse profiles"""
    __tablename__ = "nurses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(String, nullable=False, index=True)  # Link to user (Clerk user ID)
    organization_id = Column(String, nullable=True, index=True)  # Multi-tenant org ID
    
    # Basic info
    name = Column(String, nullable=False, index=True)
    employee_id = Column(String, nullable=True)  # e.g., "47554"
    seniority = Column(String, nullable=True)  # e.g., "3Y-283.95D" (years-days format)
    
    # Employment details
    employment_type = Column(String, nullable=False, default="full-time")  # "full-time" or "part-time"
    max_weekly_hours = Column(Float, nullable=False, default=37.5)  # Updated: 37.5h/week = 75h/2weeks
    
    # Certifications
    is_chemo_certified = Column(Boolean, nullable=False, default=False)
    is_transplant_certified = Column(Boolean, nullable=False, default=False)
    is_renal_certified = Column(Boolean, nullable=False, default=False)
    is_charge_certified = Column(Boolean, nullable=False, default=False)
    other_certifications = Column(Text, nullable=True)  # JSON array or comma-separated
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    def __repr__(self):
        return f"<Nurse(id={self.id}, name={self.name}, type={self.employment_type})>"
