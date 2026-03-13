"""Recurrence and rotating schedule models."""

from datetime import datetime, date
from typing import List, Optional
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Boolean, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.database import Base


class ScheduleRecurrence(Base):
    """Rotating schedule template for recurring patterns."""

    __tablename__ = "schedule_recurrences"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name = Column(String(255), index=True)
    description = Column(String(1000), nullable=True)
    
    # Recurrence type: daily, weekly, bi-weekly, monthly, custom
    recurrence_type = Column(String(50), default="weekly")
    
    # Pattern definition (JSON) - defines which shifts on which days
    # Example: {"monday": ["DAY"], "tuesday": ["NIGHT"], "wednesday": ["OFF"]}
    pattern = Column(JSON, default={})
    
    # Cycle length in days (7 for weekly, 14 for bi-weekly, 28 for monthly, etc.)
    cycle_length_days = Column(Integer, default=7)
    
    # Which employees this template applies to (JSON list of nurse IDs)
    applicable_nurses = Column(JSON, default=[])
    
    # Start date for this recurrence
    start_date = Column(Date, nullable=True)
    
    # End date (null = ongoing)
    end_date = Column(Date, nullable=True)
    
    # Is this the active template?
    is_active = Column(Boolean, default=True)
    
    # Created/updated timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    organization = relationship("Organization", backref="schedule_recurrences")

    class Config:
        from_attributes = True


class EmployeePreferredSchedule(Base):
    """Store employee preferred schedules (uploaded as screenshots or preferences)."""

    __tablename__ = "employee_preferred_schedules"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    nurse_id = Column(UUID(as_uuid=True), ForeignKey("nurses.id", ondelete="CASCADE"), index=True)
    
    # Preferred schedule as JSON (pattern similar to recurrence pattern)
    # Example: {"monday": ["DAY"], "tuesday": ["NIGHT"], ...}
    preferred_pattern = Column(JSON, default={})
    
    # Period for which this preference applies
    period_start_date = Column(Date, index=True)
    period_end_date = Column(Date)
    
    # Constraints (availability, preferences, notes)
    # JSON with keys: unavailable_dates, preferred_dates, notes, flexibility_score
    constraints = Column(JSON, default={})
    
    # Source: "manual", "upload", "system_generated"
    source = Column(String(50), default="manual")
    
    # If uploaded, store metadata
    upload_filename = Column(String(255), nullable=True)
    upload_metadata = Column(JSON, nullable=True)
    
    # Status: pending_review, approved, rejected, active
    status = Column(String(50), default="pending_review")
    
    # Notes from admin
    admin_notes = Column(String(1000), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    organization = relationship("Organization", backref="employee_preferred_schedules")
    nurse = relationship("Nurse", backref="preferred_schedules")

    class Config:
        from_attributes = True


class GeneratedScheduleSnapshot(Base):
    """Track generated schedules from recurrence patterns."""

    __tablename__ = "generated_schedule_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    recurrence_id = Column(Integer, ForeignKey("schedule_recurrences.id", ondelete="CASCADE"))
    
    # The period this snapshot covers
    period_start_date = Column(Date, index=True)
    period_end_date = Column(Date)
    
    # Generated schedule data (JSON) - full shift assignments
    schedule_data = Column(JSON, default={})
    
    # Generation metadata
    generated_at = Column(DateTime, default=datetime.utcnow)
    generation_method = Column(String(50))  # "recurrence", "template", "manual"
    
    # Whether this has been finalized/locked
    is_finalized = Column(Boolean, default=False)
    finalized_at = Column(DateTime, nullable=True)
    
    # Adjustments made (for tracking changes from base pattern)
    adjustments = Column(JSON, default={})
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    organization = relationship("Organization", backref="schedule_snapshots")
    recurrence = relationship("ScheduleRecurrence")

    class Config:
        from_attributes = True
