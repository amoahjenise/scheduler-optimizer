"""Pydantic schemas for Patient API."""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class PatientBase(BaseModel):
    """Base patient schema with common fields."""
    mrn: Optional[str] = Field(None, max_length=50, description="Medical Record Number")
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    date_of_birth: Optional[datetime] = None
    age: Optional[str] = Field(None, max_length=50, description="Age as entered, e.g. '12 months' or '5 years'")
    room_number: str = Field(..., min_length=1, max_length=20)
    bed: Optional[str] = Field(None, max_length=10)
    diagnosis: Optional[str] = Field(None, max_length=255)
    attending_physician: Optional[str] = Field(None, max_length=100)
    admission_date: Optional[datetime] = None


class PatientCreate(PatientBase):
    """Schema for creating a new patient."""
    pass


class PatientUpdate(BaseModel):
    """Schema for updating a patient (all fields optional)."""
    mrn: Optional[str] = Field(None, max_length=50)
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    date_of_birth: Optional[datetime] = None
    age: Optional[str] = Field(None, max_length=50)
    room_number: Optional[str] = Field(None, min_length=1, max_length=20)
    bed: Optional[str] = Field(None, max_length=10)
    diagnosis: Optional[str] = Field(None, max_length=255)
    attending_physician: Optional[str] = Field(None, max_length=100)
    admission_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class PatientResponse(PatientBase):
    """Schema for patient response."""
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PatientListResponse(BaseModel):
    """Schema for list of patients response."""
    patients: List[PatientResponse]
    total: int
