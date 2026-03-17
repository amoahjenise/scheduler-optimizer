"""Pydantic schemas for Schedule Rules API."""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ScheduleRuleBase(BaseModel):
    name: str = Field(default="default", max_length=200)
    rules_text: str = ""


class ScheduleRuleCreate(ScheduleRuleBase):
    pass


class ScheduleRuleUpdate(BaseModel):
    name: Optional[str] = None
    rules_text: Optional[str] = None


class ScheduleRuleResponse(ScheduleRuleBase):
    id: int
    organization_id: str
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
