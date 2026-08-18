"""Organization models for multi-tenant support."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, Float, Integer, ForeignKey, Enum, UniqueConstraint, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
import enum
from app.db.database import Base


DEFAULT_TEAMS = ["Heme-Onc", "ENT", "Pink", "Blue", "Psych", "Renal"]
DEFAULT_ROOMS = [
    "B7.01", "B7.02", "B7.03", "B7.04", "B7.05", "B7.06", "B7.07", "B7.08",
    "B7.09", "B7.10", "B7.11", "B7.12", "B7.13", "B7.14", "B7.15", "B7.16",
]


class MemberRole(str, enum.Enum):
    """Roles for organization members."""
    ADMIN = "admin"           # Full access, manage users and settings
    MANAGER = "manager"       # Create/edit schedules, manage nurses
    ASSISTANT_MANAGER = "assistant_manager"  # Stands in for the manager
    NURSE = "nurse"           # View schedules, create handovers


# Actions an admin can delegate. Admins always hold all of them; what a
# manager / assistant manager may do is configured per organization.
# Note: assigning a nurse to a hand-off is deliberately NOT here — every
# member can do that, including nurses.
DELEGATABLE_PERMISSIONS = [
    "manage_nurses",
    "manage_schedules",
    "manage_patients",
    "manage_handovers",
    "manage_announcements",
    "manage_learning",
    "view_burnout",
    "manage_members",
    "manage_org_settings",
]

# Managers get everything by default; assistant managers cover for the manager,
# so they start with the same set and can be narrowed by the admin.
DEFAULT_MANAGER_PERMISSIONS = list(DELEGATABLE_PERMISSIONS)
DEFAULT_ASSISTANT_MANAGER_PERMISSIONS = list(DELEGATABLE_PERMISSIONS)

# Only two assistant managers are allowed per organization.
MAX_ASSISTANT_MANAGERS = 2


class Organization(Base):
    """
    Organization (hospital unit) for multi-tenant data isolation.
    Each organization has its own nurses, schedules, patients, and handovers.
    """
    __tablename__ = "organizations"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    # Basic info
    name = Column(String(255), nullable=False)  # e.g., "Montreal Children's Hospital - Hema-Onc"
    slug = Column(String(100), nullable=False, unique=True, index=True)  # URL-friendly identifier
    description = Column(Text, nullable=True)
    
    # Settings
    timezone = Column(String(50), default="America/Montreal")
    is_active = Column(Boolean, default=True)
    full_time_weekly_target = Column(Float, nullable=False, default=75.0)
    part_time_weekly_target = Column(Float, nullable=False, default=63.75)
    handoff_retention_days = Column(Integer, nullable=False, default=30)
    team_options = Column(JSON, nullable=False, default=lambda: list(DEFAULT_TEAMS))
    room_options = Column(JSON, nullable=False, default=lambda: list(DEFAULT_ROOMS))

    # Which delegatable actions each non-admin leadership role may perform.
    manager_permissions = Column(
        JSON, nullable=False, default=lambda: list(DEFAULT_MANAGER_PERMISSIONS)
    )
    assistant_manager_permissions = Column(
        JSON, nullable=False, default=lambda: list(DEFAULT_ASSISTANT_MANAGER_PERMISSIONS)
    )
    
    # Branding
    logo_url = Column(Text, nullable=True)  # Base64 data URL or external URL
    
    # Invite code for joining
    invite_code = Column(String(20), nullable=True, unique=True, index=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    members = relationship("OrganizationMember", back_populates="organization", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Organization {self.name} ({self.slug})>"


class OrganizationMember(Base):
    """
    Maps users to organizations with roles.
    A user can belong to multiple organizations.
    """
    __tablename__ = "organization_members"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    
    # Foreign keys
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)  # Clerk user ID
    
    # User info (cached from Clerk for display)
    user_email = Column(String(255), nullable=True)
    user_name = Column(String(255), nullable=True)
    
    # Role - use values_callable to ensure we store lowercase values that match the database enum
    role = Column(Enum(MemberRole, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MemberRole.NURSE)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_approved = Column(Boolean, default=False, nullable=False)  # Admin must approve new members
    
    # Timestamps
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", back_populates="members")
    
    # Constraints - user can only be in org once
    __table_args__ = (
        UniqueConstraint('organization_id', 'user_id', name='uq_org_user'),
    )
    
    def __repr__(self):
        return f"<OrgMember {self.user_email} in {self.organization_id} as {self.role}>"
    
    @property
    def is_admin(self) -> bool:
        return self.role == MemberRole.ADMIN
    
    @property
    def can_manage(self) -> bool:
        return self.role in [MemberRole.ADMIN, MemberRole.MANAGER]
