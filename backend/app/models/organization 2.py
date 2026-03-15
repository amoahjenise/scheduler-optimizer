"""Organization models for multi-tenant support."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, Float, ForeignKey, Enum, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
import enum
from app.db.database import Base


class MemberRole(str, enum.Enum):
    """Roles for organization members."""
    ADMIN = "admin"           # Full access, manage users and settings
    MANAGER = "manager"       # Create/edit schedules, manage nurses
    NURSE = "nurse"           # View schedules, create handovers


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
    full_time_weekly_target = Column(Float, nullable=False, default=37.5)
    part_time_weekly_target = Column(Float, nullable=False, default=22.5)
    
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
