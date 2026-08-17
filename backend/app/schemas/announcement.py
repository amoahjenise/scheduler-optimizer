"""Schemas for organization announcements."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, UUID4


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    target_team: Optional[str] = None
    is_pinned: bool = False
    expires_at: Optional[datetime] = None


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    body: Optional[str] = Field(None, min_length=1)
    target_team: Optional[str] = None
    is_pinned: Optional[bool] = None
    expires_at: Optional[datetime] = None


class AnnouncementResponse(BaseModel):
    id: UUID4
    organization_id: str
    title: str
    body: str
    target_team: Optional[str] = None
    is_pinned: bool
    expires_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
