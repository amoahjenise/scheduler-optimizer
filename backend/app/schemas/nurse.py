# /backend/app/schemas/nurse.py
from pydantic import BaseModel, UUID4, Field
from typing import Optional, List
from datetime import datetime


class NurseBase(BaseModel):
    """Base nurse schema with common fields"""
    name: str = Field(..., min_length=1, max_length=200)
    employee_id: Optional[str] = Field(None, max_length=100)
    seniority: Optional[str] = Field(None, max_length=50)  # e.g., "3Y-283.95D"
    employment_type: str = Field("full-time", pattern="^(full-time|part-time)$")
    max_weekly_hours: float = Field(37.5, ge=0, le=168)
    target_weekly_hours: Optional[float] = Field(None, ge=0, le=168)
    preferred_shift_length_hours: Optional[float] = Field(None, ge=0, le=24)
    is_chemo_certified: bool = False
    is_transplant_certified: bool = False
    is_renal_certified: bool = False
    is_charge_certified: bool = False
    other_certifications: Optional[str] = None
    # Leave status - nurses on leave are excluded from scheduling
    is_on_maternity_leave: bool = False
    is_on_sick_leave: bool = False
    is_on_sabbatical: bool = False


class NurseCreate(NurseBase):
    """Schema for creating a nurse"""
    pass


class NurseUpdate(BaseModel):
    """Schema for updating a nurse (all fields optional)"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    employee_id: Optional[str] = Field(None, max_length=100)
    seniority: Optional[str] = Field(None, max_length=50)
    employment_type: Optional[str] = Field(None, pattern="^(full-time|part-time)$")
    max_weekly_hours: Optional[float] = Field(None, ge=0, le=168)
    target_weekly_hours: Optional[float] = Field(None, ge=0, le=168)
    preferred_shift_length_hours: Optional[float] = Field(None, ge=0, le=24)
    is_chemo_certified: Optional[bool] = None
    is_transplant_certified: Optional[bool] = None
    is_renal_certified: Optional[bool] = None
    is_charge_certified: Optional[bool] = None
    other_certifications: Optional[str] = None
    # Leave status
    is_on_maternity_leave: Optional[bool] = None
    is_on_sick_leave: Optional[bool] = None
    is_on_sabbatical: Optional[bool] = None


class NurseResponse(NurseBase):
    """Schema for nurse responses"""
    id: UUID4
    user_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NurseListResponse(BaseModel):
    """Schema for paginated nurse list"""
    nurses: List[NurseResponse]
    total: int
    page: int
    page_size: int
