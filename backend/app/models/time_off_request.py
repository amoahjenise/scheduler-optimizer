"""Time-off requests and reconciliation models."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, Float, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from uuid import uuid4
import uuid
from app.db.database import Base


class TimeOffRequest(Base):
    """
    Employee time-off requests (vacation, sick leave, personal).
    Managers can approve/deny before publishing schedule.
    """
    __tablename__ = "time_off_requests"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    nurse_id = Column(UUID(as_uuid=True), ForeignKey("nurses.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Request details
    start_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    end_date = Column(String(10), nullable=False)  # YYYY-MM-DD (inclusive)
    reason = Column(String(50), nullable=False)  # "vacation", "sick", "personal", "family"
    notes = Column(Text, nullable=True)
    
    # Status
    status = Column(String(20), nullable=False, default="pending")  # "pending", "approved", "denied"
    approved_by_id = Column(String, nullable=True)  # User ID who approved/denied
    approval_timestamp = Column(DateTime(timezone=True), nullable=True)
    denial_reason = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="time_off_requests")
    nurse = relationship("Nurse", backref="time_off_requests")
    
    def __repr__(self):
        return f"<TimeOffRequest {self.nurse_id} {self.start_date}-{self.end_date} ({self.status})>"


class NurseHoursReconciliation(Base):
    """
    28-day (4-week) reconciliation tracking for nurse hours.
    
    Used to calculate:
    - Hours worked over 28-day lookback
    - Comparison to bi-weekly target
    - B-Shift balancing logic
    - Vacation offset adjustments
    """
    __tablename__ = "nurse_hours_reconciliation"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    nurse_id = Column(UUID(as_uuid=True), ForeignKey("nurses.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Period (28-day window)
    # "period_start_date" to "period_start_date + 27 days"
    period_start_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    period_end_date = Column(String(10), nullable=False)
    
    # Nurse contract snapshot at period start
    bi_weekly_target = Column(Float, nullable=False)  # From nurse.bi_weekly_target_hours
    
    # Hours calculation (paid hours only, using shift.paid_hours)
    hours_worked = Column(Float, nullable=False, default=0.0)
    
    # Hours with vacation offset applied
    # If nurse had 7+ days OFF, reduce target by 50% for those weeks
    hours_worked_with_vacation_offset = Column(Float, nullable=False, default=0.0)
    adjusted_target = Column(Float, nullable=False)
    
    # Delta
    delta = Column(Float, nullable=False, default=0.0)  # delta = hours_worked_with_vacation_offset - adjusted_target
    
    # B-Shift balancing
    # If delta < 0, suggest a B-Shift (balancing shift) to fill the gap
    balancing_shift_needed = Column(Boolean, default=False)
    balancing_shift_hours = Column(Float, nullable=True)  # Suggested hours for B-Shift
    balancing_shift_recommended_date = Column(String(10), nullable=True)  # YYYY-MM-DD
    
    # Vacation days in this period
    vacation_days_count = Column(Integer, default=0)
    
    # Status
    status = Column(String(20), nullable=False, default="pending")  # "pending", "reconciled", "approved"
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="nurse_hours_reconciliation")
    nurse = relationship("Nurse", backref="hours_reconciliation")
    
    def __repr__(self):
        return f"<NurseHoursReconciliation {self.nurse_id} {self.period_start_date}: {self.delta:+.1f}h>"
