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
    
    # Employment details (FTE contract)
    employment_type = Column(String, nullable=False, default="full-time")  # "full-time" or "part-time"
    fte_value = Column(Float, nullable=False, default=1.0)  # e.g., 1.0 for full-time, 0.5 for part-time
    bi_weekly_target_hours = Column(Float, nullable=False, default=75.0)  # Bi-weekly contract hours (4-week avg = this / 2)
    max_hours_per_24h = Column(Float, nullable=False, default=12.5)  # Safety limit per 24h period
    min_rest_hours_between_shifts = Column(Float, nullable=False, default=11.0)  # Min hours between end of one shift and start of next
    weekend_requirement_ratio = Column(Float, nullable=False, default=0.5)  # e.g., 0.5 = work 1 out of 2 weekends
    max_weekly_hours = Column(Float, nullable=False, default=37.5)  # hard weekly safety cap
    target_weekly_hours = Column(Float, nullable=True)  # workload target for balancing (deprecated, use bi_weekly)
    preferred_shift_length_hours = Column(Float, nullable=True)  # e.g., 11.25 for 12h paid, 7.5 for 8h paid
    
    # Certifications
    is_chemo_certified = Column(Boolean, nullable=False, default=False)
    is_transplant_certified = Column(Boolean, nullable=False, default=False)
    is_renal_certified = Column(Boolean, nullable=False, default=False)
    is_charge_certified = Column(Boolean, nullable=False, default=False)
    other_certifications = Column(Text, nullable=True)  # JSON array or comma-separated
    
    # Leave Status - nurses on leave are excluded from scheduling
    is_on_maternity_leave = Column(Boolean, nullable=False, default=False)
    is_on_sick_leave = Column(Boolean, nullable=False, default=False)
    is_on_sabbatical = Column(Boolean, nullable=False, default=False)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    def __repr__(self):
        return f"<Nurse(id={self.id}, name={self.name}, type={self.employment_type})>"
