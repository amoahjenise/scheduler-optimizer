"""Schemas for in-app notifications."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, UUID4


class NotificationResponse(BaseModel):
    id: UUID4
    organization_id: Optional[str] = None
    user_id: str
    type: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True
