"""Pydantic schemas for Organization models."""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class MemberRole(str, Enum):
    """Roles for organization members."""
    ADMIN = "admin"
    MANAGER = "manager"
    NURSE = "nurse"


# ============== Organization Schemas ==============

class OrganizationBase(BaseModel):
    """Base schema for organization data."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    timezone: str = "America/Montreal"
    full_time_weekly_target: float = Field(75.0, ge=0, le=336)
    part_time_weekly_target: float = Field(63.75, ge=0, le=336)
    handoff_retention_days: int = Field(30, ge=1, le=365)
    team_options: List[str] = Field(default_factory=lambda: ["Heme-Onc", "ENT", "Pink", "Blue", "Psych", "Renal"])
    room_options: List[str] = Field(default_factory=lambda: [
        "B7.01", "B7.02", "B7.03", "B7.04", "B7.05", "B7.06", "B7.07", "B7.08",
        "B7.09", "B7.10", "B7.11", "B7.12", "B7.13", "B7.14", "B7.15", "B7.16",
    ])


class OrganizationCreate(OrganizationBase):
    """Schema for creating a new organization."""
    slug: Optional[str] = None  # Auto-generated if not provided


class OrganizationUpdate(BaseModel):
    """Schema for updating an organization."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    timezone: Optional[str] = None
    logo_url: Optional[str] = None  # Base64 data URL or external URL
    full_time_weekly_target: Optional[float] = Field(None, ge=0, le=336)
    part_time_weekly_target: Optional[float] = Field(None, ge=0, le=336)
    handoff_retention_days: Optional[int] = Field(None, ge=1, le=365)
    team_options: Optional[List[str]] = None
    room_options: Optional[List[str]] = None


class OrganizationInDB(OrganizationBase):
    """Schema for organization from database."""
    id: str
    slug: str
    is_active: bool
    invite_code: Optional[str] = None
    logo_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class Organization(OrganizationInDB):
    """Public organization schema (without sensitive data)."""
    pass


class OrganizationWithMembers(Organization):
    """Organization with its members list."""
    members: List["OrganizationMember"] = []


# ============== Organization Member Schemas ==============

class OrganizationMemberBase(BaseModel):
    """Base schema for organization member."""
    role: MemberRole = MemberRole.NURSE


class OrganizationMemberCreate(OrganizationMemberBase):
    """Schema for adding a member to organization."""
    user_id: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None


class OrganizationMemberUpdate(BaseModel):
    """Schema for updating a member."""
    role: Optional[MemberRole] = None
    is_active: Optional[bool] = None


class OrganizationMemberInDB(OrganizationMemberBase):
    """Schema for member from database."""
    id: str
    organization_id: str
    user_id: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    is_active: bool
    is_approved: bool = True
    joined_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OrganizationMember(OrganizationMemberInDB):
    """Public member schema."""
    pass


class OrganizationMemberWithOrg(OrganizationMember):
    """Member with organization info."""
    organization: Organization


# ============== Join/Invite Schemas ==============

class JoinOrganization(BaseModel):
    """Schema for joining an organization via invite code."""
    invite_code: str


class InviteResponse(BaseModel):
    """Response after generating invite code."""
    invite_code: str
    organization_id: str
    organization_name: str


# ============== User Context Schemas ==============

class CurrentUserContext(BaseModel):
    """Current user context with organization info."""
    user_id: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    organizations: List[OrganizationMemberWithOrg] = []
    current_organization_id: Optional[str] = None
    current_role: Optional[MemberRole] = None


class OrganizationConfigOptions(BaseModel):
    """Shared org-scoped options used by handover and patient workflows."""
    team_options: List[str]
    room_options: List[str]


class OrganizationConfigOptionsUpdate(BaseModel):
    """Admin updates to shared org-scoped options."""
    team_options: Optional[List[str]] = None
    room_options: Optional[List[str]] = None


# Forward reference resolution
OrganizationWithMembers.model_rebuild()
