"""Shift code models for configurable hospital shift codes."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, Enum, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
import enum
from app.db.database import Base


class ShiftType(str, enum.Enum):
    """Types of shifts."""
    DAY = "day"
    NIGHT = "night"
    COMBINED = "combined"


class ShiftCode(Base):
    """
    Configurable shift codes per organization.
    Each organization can define their own shift codes with times and hours.
    """
    __tablename__ = "shift_codes"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    # Organization - can be null for system defaults
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    
    # Shift code details
    code = Column(String(20), nullable=False)  # e.g., "07", "Z07", "E15"
    label = Column(String(100), nullable=False)  # e.g., "Day 8hr (07:00-15:15)"
    start_time = Column(String(10), nullable=False)  # e.g., "07:00"
    end_time = Column(String(10), nullable=False)  # e.g., "15:15"
    hours = Column(Float, nullable=False)  # e.g., 7.5
    shift_type = Column(Enum(ShiftType), nullable=False, default=ShiftType.DAY)
    
    # Display order
    display_order = Column(Float, default=0)
    
    # Active flag
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="shift_codes")
    
    def __repr__(self):
        return f"<ShiftCode {self.code} ({self.label})>"


class TimeSlot(Base):
    """
    Time slot categories for self-scheduling.
    These map to actual shift codes but represent categories (D=Day, E=Evening, N=Night).
    """
    __tablename__ = "time_slots"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    # Organization - can be null for system defaults
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    
    # Slot details
    slot = Column(String(20), nullable=False)  # e.g., "D8-", "ZD12-"
    label = Column(String(100), nullable=False)  # e.g., "Day 8hr"
    category = Column(String(20), nullable=False)  # "Day", "Evening", "Night"
    duration = Column(String(20), nullable=False)  # "8hr", "12hr", "Split"
    
    # Maps to shift codes (comma-separated code names)
    maps_to = Column(Text, nullable=False)  # e.g., "07" or "Z19,Z23"
    
    # Display order
    display_order = Column(Float, default=0)
    
    # Active flag
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", backref="time_slots")
    
    def __repr__(self):
        return f"<TimeSlot {self.slot} ({self.label})>"
