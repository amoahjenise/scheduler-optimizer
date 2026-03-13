"""Schedule demand and staffing requirement models."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, Float, Integer, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
from app.db.database import Base


class ScheduleDemand(Base):
    """
    Per-cell (date + shift code) staffing requirements with skill mix.
    
    This is where the "100% Compliance" score is calculated.
    """
    __tablename__ = "schedule_demands"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    shift_code_id = Column(String, ForeignKey("shift_codes.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Date (YYYY-MM-DD format)
    date = Column(String(10), nullable=False, index=True)
    
    # Global daily target (all shifts combined)
    global_daily_target = Column(Integer, nullable=False, default=12)
    
    # Minimum staff for this specific shift
    min_staff_required = Column(Integer, nullable=False, default=1)
    
    # Skill mix requirements (JSON: {"chemo_certified": 1, "transplant_certified": 0, ...})
    skill_requirements = Column(JSON, nullable=True)
    
    # Override reason/notes
    notes = Column(Text, nullable=True)
    
    # Compliance tracking
    actual_staff_assigned = Column(Integer, nullable=False, default=0)
    last_calculated_at = Column(DateTime(timezone=True), server_default=func.now())
    
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="schedule_demands")
    shift_code = relationship("ShiftCode", backref="demands")
    
    def __repr__(self):
        return f"<ScheduleDemand {self.date} {self.shift_code_id}: {self.actual_staff_assigned}/{self.min_staff_required}>"


class ShiftTemplate(Base):
    """
    Reusable shift templates for daily, weekly, or monthly scheduling.
    
    Allows bulk creation of recurring shift patterns.
    """
    __tablename__ = "shift_templates"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Template metadata
    name = Column(String(100), nullable=False)  # e.g., "Standard Weekly Rotation"
    description = Column(Text, nullable=True)
    template_type = Column(String(20), nullable=False)  # "daily", "weekly", "monthly"
    
    # Template pattern (JSON: day-of-week -> [shift_code_ids])
    # e.g., {"0": ["Z07"], "1": ["Z07"], "2": ["Z19"], "3": ["OFF"], ...}
    pattern = Column(JSON, nullable=False)
    
    # Applicable units
    applicable_shift_codes = Column(Text, nullable=True)  # Comma-separated IDs
    applicable_roles = Column(Text, nullable=True)  # Comma-separated roles
    
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="shift_templates")
    
    def __repr__(self):
        return f"<ShiftTemplate {self.name}>"
