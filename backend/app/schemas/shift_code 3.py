"""Pydantic schemas for shift codes and time slots."""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class ShiftTypeEnum(str, Enum):
    day = "day"
    night = "night"
    combined = "combined"


# ShiftCode schemas
class ShiftCodeBase(BaseModel):
    code: str = Field(..., max_length=20, description="Shift code, e.g., '07', 'Z07'")
    label: str = Field(..., max_length=100, description="Human-readable label")
    start_time: str = Field(..., max_length=10, description="Start time, e.g., '07:00'")
    end_time: str = Field(..., max_length=10, description="End time, e.g., '15:15'")
    hours: float = Field(..., description="Total hours for the shift")
    shift_type: ShiftTypeEnum = Field(default=ShiftTypeEnum.day)
    display_order: float = Field(default=0)
    is_active: bool = Field(default=True)


class ShiftCodeCreate(ShiftCodeBase):
    organization_id: Optional[str] = None


class ShiftCodeUpdate(BaseModel):
    code: Optional[str] = Field(None, max_length=20)
    label: Optional[str] = Field(None, max_length=100)
    start_time: Optional[str] = Field(None, max_length=10)
    end_time: Optional[str] = Field(None, max_length=10)
    hours: Optional[float] = None
    shift_type: Optional[ShiftTypeEnum] = None
    display_order: Optional[float] = None
    is_active: Optional[bool] = None


class ShiftCodeResponse(ShiftCodeBase):
    id: str
    organization_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# TimeSlot schemas
class TimeSlotBase(BaseModel):
    slot: str = Field(..., max_length=20, description="Slot code, e.g., 'D8-', 'ZD12-'")
    label: str = Field(..., max_length=100, description="Human-readable label")
    category: str = Field(..., max_length=20, description="Day, Evening, or Night")
    duration: str = Field(..., max_length=20, description="8hr, 12hr, or Split")
    maps_to: str = Field(..., description="Comma-separated shift codes this maps to")
    display_order: float = Field(default=0)
    is_active: bool = Field(default=True)


class TimeSlotCreate(TimeSlotBase):
    organization_id: Optional[str] = None


class TimeSlotUpdate(BaseModel):
    slot: Optional[str] = Field(None, max_length=20)
    label: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=20)
    duration: Optional[str] = Field(None, max_length=20)
    maps_to: Optional[str] = None
    display_order: Optional[float] = None
    is_active: Optional[bool] = None


class TimeSlotResponse(TimeSlotBase):
    id: str
    organization_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    # Computed field for frontend compatibility
    @property
    def maps_to_list(self) -> List[str]:
        return [s.strip() for s in self.maps_to.split(",") if s.strip()]

    class Config:
        from_attributes = True


# Frontend-compatible response format
class ShiftCodeFrontend(BaseModel):
    """Format matching frontend ShiftCode interface."""
    code: str
    start: str
    end: str
    hours: float
    type: str  # "day", "night", "combined"
    label: str


class TimeSlotFrontend(BaseModel):
    """Format matching frontend TimeSlot interface."""
    slot: str
    category: str  # "Day", "Evening", "Night"
    duration: str  # "8hr", "12hr", "Split"
    mapsTo: List[str]
    label: str


class ShiftCodesListResponse(BaseModel):
    """Response with both shift codes and time slots for frontend."""
    shift_codes: List[ShiftCodeFrontend]
    time_slots: List[TimeSlotFrontend]
