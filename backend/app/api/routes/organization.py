"""Organization management routes."""
import logging
import secrets
import re
from typing import Any, Dict, List
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from clerk_backend_api import Clerk

from app.db.deps import get_db
from app.models.organization import (
    Organization,
    OrganizationMember,
    MemberRole,
    DELEGATABLE_PERMISSIONS,
    MAX_ASSISTANT_MANAGERS,
)
from app.schemas.organization import (
    OrganizationCreate, OrganizationUpdate, Organization as OrganizationSchema,
    OrganizationWithMembers, OrganizationMember as MemberSchema,
    OrganizationMemberCreate, OrganizationMemberUpdate,
    JoinOrganization, InviteResponse, CurrentUserContext,
    OrganizationMemberWithOrg, OrganizationConfigOptions, OrganizationConfigOptionsUpdate
)
from app.core.auth import (
    RequiredAuth, OrgAuth, AdminAuth, AuthContext,
    get_required_auth, get_org_required_auth, get_admin_auth, require_permission
)
from app.api.routes.notification import create_notification
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_TEAMS = ["Heme-Onc", "ENT", "Pink", "Blue", "Psych", "Renal"]
DEFAULT_ROOMS = [
    "B7.01", "B7.02", "B7.03", "B7.04", "B7.05", "B7.06", "B7.07", "B7.08",
    "B7.09", "B7.10", "B7.11", "B7.12", "B7.13", "B7.14", "B7.15", "B7.16",
]

# Initialize Clerk client
clerk_client = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


def generate_slug(name: str, db: Session) -> str:
    """Generate a unique URL-friendly slug from organization name."""
    # Convert to lowercase, replace spaces with hyphens, remove special chars
    base_slug = re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))
    base_slug = re.sub(r'-+', '-', base_slug).strip('-')
    
    if not base_slug:
        base_slug = 'org'
    
    # Check uniqueness and add number if needed
    slug = base_slug
    counter = 1
    while db.query(Organization).filter(Organization.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    return slug


def generate_invite_code() -> str:
    """Generate a random invite code."""
    return secrets.token_urlsafe(12)[:16].upper()


def _normalize_option_list(values, default_values):
    if not isinstance(values, list):
        return list(default_values)

    cleaned = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        item = value.strip()
        if not item:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)

    return cleaned or list(default_values)


def _current_org_config(org: Organization) -> OrganizationConfigOptions:
    return OrganizationConfigOptions(
        team_options=_normalize_option_list(org.team_options, DEFAULT_TEAMS),
        room_options=_normalize_option_list(org.room_options, DEFAULT_ROOMS),
    )


# ============== Organization CRUD ==============

@router.post("", response_model=OrganizationSchema, include_in_schema=False)
@router.post("/", response_model=OrganizationSchema)
def create_organization(
    org_in: OrganizationCreate,
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db)
):
    """
    Create a new organization. The creating user becomes the admin.
    """
    try:
        # Generate slug if not provided
        slug = org_in.slug or generate_slug(org_in.name, db)
        
        # Check slug uniqueness
        if db.query(Organization).filter(Organization.slug == slug).first():
            raise HTTPException(status_code=400, detail="Organization slug already exists")
        
        # Create organization
        org = Organization(
            name=org_in.name,
            slug=slug,
            description=org_in.description,
            timezone=org_in.timezone,
            full_time_weekly_target=org_in.full_time_weekly_target,
            part_time_weekly_target=org_in.part_time_weekly_target,
            handoff_retention_days=org_in.handoff_retention_days,
            team_options=_normalize_option_list(org_in.team_options, DEFAULT_TEAMS),
            room_options=_normalize_option_list(org_in.room_options, DEFAULT_ROOMS),
            invite_code=generate_invite_code()
        )
        db.add(org)
        db.flush()  # Get the org ID
        
        # Add creator as admin (auto-approved)
        member = OrganizationMember(
            organization_id=org.id,
            user_id=auth.user_id,
            user_email=auth.user_email,
            user_name=auth.user_name,
            role=MemberRole.ADMIN,
            is_approved=True
        )
        db.add(member)
        db.commit()
        db.refresh(org)
        
        logger.info(f"Created organization '{org.name}' (id={org.id}) by user {auth.user_id}")
        return org
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create organization: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create organization")


@router.get("", response_model=List[OrganizationMemberWithOrg], include_in_schema=False)
@router.get("/", response_model=List[OrganizationMemberWithOrg])
def list_my_organizations(
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db)
):
    """
    List all organizations the current user is a member of.
    Handles the case where organization_members records have NULL email/name
    by updating them with current Clerk user data.
    """
    memberships = db.query(OrganizationMember).filter(
        OrganizationMember.user_id == auth.user_id,
        OrganizationMember.is_active == True
    ).all()
    
    # Sync user data to organization_members if NULL
    if memberships and (auth.user_email or auth.user_name):
        for m in memberships:
            if not m.user_email or not m.user_name:
                m.user_email = auth.user_email
                m.user_name = auth.user_name
                db.add(m)
        db.commit()
    
    # Load organization for each membership
    result = []
    for m in memberships:
        org = db.query(Organization).filter(
            Organization.id == m.organization_id,
            Organization.is_active == True
        ).first()
        if org:
            result.append({
                **m.__dict__,
                "organization": org
            })
    
    return result


@router.get("/current", response_model=OrganizationSchema)
def get_current_organization(
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    Get the current organization (from X-Organization-ID header).
    """
    if not auth.organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    return auth.organization


@router.get("/{org_id}", response_model=OrganizationWithMembers)
def get_organization(
    org_id: str,
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db)
):
    """
    Get organization details. Must be a member to view.
    """
    org = db.query(Organization).filter(
        Organization.id == org_id,
        Organization.is_active == True
    ).first()
    
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Check membership
    membership = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id,
        OrganizationMember.user_id == auth.user_id,
        OrganizationMember.is_active == True
    ).first()
    
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this organization")
    
    # Load members
    members = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id,
        OrganizationMember.is_active == True
    ).all()
    
    return {
        **org.__dict__,
        "members": members
    }


@router.patch("/{org_id}", response_model=OrganizationSchema)
def update_organization(
    org_id: str,
    org_in: OrganizationUpdate,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Update organization details. Admin only.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot update a different organization")
    
    org = auth.organization
    
    if org_in.name is not None:
        org.name = org_in.name
    if org_in.description is not None:
        org.description = org_in.description
    if org_in.timezone is not None:
        org.timezone = org_in.timezone
    if org_in.logo_url is not None:
        org.logo_url = org_in.logo_url
    if org_in.full_time_weekly_target is not None:
        org.full_time_weekly_target = org_in.full_time_weekly_target
    if org_in.part_time_weekly_target is not None:
        org.part_time_weekly_target = org_in.part_time_weekly_target
    if org_in.handoff_retention_days is not None:
        org.handoff_retention_days = org_in.handoff_retention_days
    if org_in.team_options is not None:
        org.team_options = _normalize_option_list(org_in.team_options, DEFAULT_TEAMS)
    if org_in.room_options is not None:
        org.room_options = _normalize_option_list(org_in.room_options, DEFAULT_ROOMS)
    
    db.commit()
    db.refresh(org)
    
    return org


@router.get("/{org_id}/role-permissions")
def get_role_permissions(
    org_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
):
    """Which delegatable actions each role may perform in this organization.

    Readable by any member so the UI can hide controls the caller can't use.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot view a different organization")

    org = auth.organization
    return {
        "available_permissions": DELEGATABLE_PERMISSIONS,
        "manager_permissions": list(org.manager_permissions or []),
        "assistant_manager_permissions": list(org.assistant_manager_permissions or []),
        "max_assistant_managers": MAX_ASSISTANT_MANAGERS,
        # Effective permissions for the caller, so the frontend doesn't have to
        # re-derive the role rules.
        "my_permissions": auth.permissions,
        "my_role": auth.membership.role.value if auth.membership else None,
    }


@router.patch("/{org_id}/role-permissions")
def update_role_permissions(
    org_id: str,
    payload: Dict[str, Any] = Body(...),
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db),
):
    """Admin-only: choose what managers and assistant managers can do."""
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage a different organization")

    org = auth.organization

    def clean(values) -> List[str]:
        if not isinstance(values, list):
            raise HTTPException(status_code=400, detail="Permissions must be a list")
        unknown = [v for v in values if v not in DELEGATABLE_PERMISSIONS]
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"Unknown permission(s): {', '.join(map(str, unknown))}"
            )
        # Preserve catalog order so the stored value is stable.
        return [p for p in DELEGATABLE_PERMISSIONS if p in values]

    if "manager_permissions" in payload:
        org.manager_permissions = clean(payload["manager_permissions"])
    if "assistant_manager_permissions" in payload:
        org.assistant_manager_permissions = clean(payload["assistant_manager_permissions"])

    db.commit()
    db.refresh(org)

    return {
        "available_permissions": DELEGATABLE_PERMISSIONS,
        "manager_permissions": list(org.manager_permissions or []),
        "assistant_manager_permissions": list(org.assistant_manager_permissions or []),
        "max_assistant_managers": MAX_ASSISTANT_MANAGERS,
    }


@router.get("/{org_id}/config-options", response_model=OrganizationConfigOptions)
def get_organization_config_options(
    org_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """Get shared org-scoped teams and rooms options for members."""
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot view a different organization")

    return _current_org_config(auth.organization)


@router.patch("/{org_id}/config-options", response_model=OrganizationConfigOptions)
def update_organization_config_options(
    org_id: str,
    config_in: OrganizationConfigOptionsUpdate,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """Update shared org-scoped teams and rooms options. Admin only."""
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot update a different organization")

    org = auth.organization

    if config_in.team_options is not None:
        org.team_options = _normalize_option_list(config_in.team_options, DEFAULT_TEAMS)
    if config_in.room_options is not None:
        org.room_options = _normalize_option_list(config_in.room_options, DEFAULT_ROOMS)

    db.commit()
    db.refresh(org)
    return _current_org_config(org)


@router.delete("/{org_id}")
def delete_organization(
    org_id: str,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Soft-delete organization. Admin only.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot delete a different organization")
    
    org = auth.organization
    org.is_active = False
    db.commit()
    
    logger.info(f"Organization '{org.name}' (id={org.id}) deleted by user {auth.user_id}")
    return {"message": "Organization deleted"}


# ============== Membership Management ==============

@router.post("/join", response_model=MemberSchema)
def join_organization(
    join_in: JoinOrganization,
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db)
):
    """
    Join an organization using an invite code.
    """
    # Find organization by invite code
    org = db.query(Organization).filter(
        Organization.invite_code == join_in.invite_code.upper(),
        Organization.is_active == True
    ).first()
    
    if not org:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    
    # Check if already a member
    existing = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org.id,
        OrganizationMember.user_id == auth.user_id
    ).first()
    
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="You are already a member of this organization")
        else:
            # Reactivate membership
            existing.is_active = True
            db.commit()
            db.refresh(existing)
            return existing
    
    # Create membership with default nurse role — pending admin approval
    member = OrganizationMember(
        organization_id=org.id,
        user_id=auth.user_id,
        user_email=auth.user_email,
        user_name=auth.user_name,
        role=MemberRole.NURSE,
        is_approved=False
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    
    logger.info(f"User {auth.user_id} requested to join organization '{org.name}' (pending approval)")
    return member


@router.post("/{org_id}/invite", response_model=InviteResponse)
def regenerate_invite_code(
    org_id: str,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Generate a new invite code for the organization. Admin only.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage a different organization")
    
    org = auth.organization
    org.invite_code = generate_invite_code()
    db.commit()
    
    return {
        "invite_code": org.invite_code,
        "organization_id": org.id,
        "organization_name": org.name
    }


@router.get("/{org_id}/members", response_model=List[MemberSchema])
def list_members(
    org_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    List all members of an organization (including pending approval).
    Enriches member data with user information from Clerk.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot view members of a different organization")
    
    members = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id,
        OrganizationMember.is_active == True
    ).all()
    
    # Enrich only members missing cached identity data. Calling Clerk for every
    # member on every request adds a network round-trip per member and makes
    # member-backed pages noticeably slow.
    stale_members = [m for m in members if not m.user_email or not m.user_name]
    enriched = False

    for member in stale_members:
        try:
            clerk_user = clerk_client.users.get(user_id=member.user_id)
            # Build full name from first and last name
            first_name = clerk_user.first_name or ""
            last_name = clerk_user.last_name or ""
            full_name = f"{first_name} {last_name}".strip()
            
            # Update member data
            if full_name:
                member.user_name = full_name
            
            # Get primary email
            if clerk_user.email_addresses:
                for email in clerk_user.email_addresses:
                    if hasattr(email, 'id') and email.id == clerk_user.primary_email_address_id:
                        member.user_email = email.email_address
                        break
                # Fallback to first email if primary not found
                if not member.user_email and clerk_user.email_addresses:
                    member.user_email = clerk_user.email_addresses[0].email_address

            enriched = True

        except Exception as e:
            logger.warning(f"Failed to fetch Clerk user data for {member.user_id}: {e}")
            # Keep existing data if Clerk fetch fails
            pass

    # Persist so subsequent requests skip the Clerk round-trips entirely.
    if enriched:
        db.commit()

    return members


@router.post("/{org_id}/members/{member_id}/approve", response_model=MemberSchema)
def approve_member(
    org_id: str,
    member_id: str,
    auth: AuthContext = Depends(require_permission("manage_members")),
    db: Session = Depends(get_db)
):
    """
    Approve a pending member. Requires the manage_members permission.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage members of a different organization")
    
    member = db.query(OrganizationMember).filter(
        OrganizationMember.id == member_id,
        OrganizationMember.organization_id == org_id,
        OrganizationMember.is_active == True
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    if member.is_approved:
        raise HTTPException(status_code=400, detail="Member is already approved")
    
    member.is_approved = True
    db.commit()
    db.refresh(member)
    
    logger.info(f"Admin {auth.user_id} approved member {member.user_email or member.user_id} in org {org_id}")
    return member


@router.post("/{org_id}/members/{member_id}/reject")
def reject_member(
    org_id: str,
    member_id: str,
    auth: AuthContext = Depends(require_permission("manage_members")),
    db: Session = Depends(get_db)
):
    """
    Reject (remove) a pending member. Requires the manage_members permission.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage members of a different organization")
    
    member = db.query(OrganizationMember).filter(
        OrganizationMember.id == member_id,
        OrganizationMember.organization_id == org_id,
        OrganizationMember.is_active == True
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    if member.is_approved:
        raise HTTPException(status_code=400, detail="Cannot reject an already approved member. Use remove instead.")
    
    member.is_active = False
    db.commit()
    
    logger.info(f"Admin {auth.user_id} rejected member {member.user_email or member.user_id} in org {org_id}")
    return {"message": "Member request rejected"}


@router.patch("/{org_id}/members/{member_id}", response_model=MemberSchema)
def update_member(
    org_id: str,
    member_id: str,
    member_in: OrganizationMemberUpdate,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Update a member's role or status. Admin only.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage members of a different organization")
    
    member = db.query(OrganizationMember).filter(
        OrganizationMember.id == member_id,
        OrganizationMember.organization_id == org_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # Prevent removing the last admin
    if member_in.role and member_in.role != MemberRole.ADMIN:
        if member.role == MemberRole.ADMIN:
            admin_count = db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.role == MemberRole.ADMIN,
                OrganizationMember.is_active == True
            ).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    # An organization runs with one manager and at most two assistant managers.
    if member_in.role == MemberRole.MANAGER and member.role != MemberRole.MANAGER:
        existing_manager = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.role == MemberRole.MANAGER,
            OrganizationMember.is_active == True,
            OrganizationMember.id != member_id,
        ).first()
        if existing_manager:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{existing_manager.user_name or 'Another member'} is already the manager. "
                    "Change their role first."
                ),
            )

    if (
        member_in.role == MemberRole.ASSISTANT_MANAGER
        and member.role != MemberRole.ASSISTANT_MANAGER
    ):
        assistant_count = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.role == MemberRole.ASSISTANT_MANAGER,
            OrganizationMember.is_active == True,
            OrganizationMember.id != member_id,
        ).count()
        if assistant_count >= MAX_ASSISTANT_MANAGERS:
            raise HTTPException(
                status_code=400,
                detail=f"Only {MAX_ASSISTANT_MANAGERS} assistant managers are allowed",
            )

    if member_in.role is not None:
        member.role = member_in.role
    if member_in.is_active is not None:
        member.is_active = member_in.is_active
    
    db.commit()
    db.refresh(member)
    
    return member


@router.post("/{org_id}/members/{member_id}/transfer-admin")
def transfer_admin_role(
    org_id: str,
    member_id: str,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Transfer admin role from current admin to another approved active member.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage members of a different organization")

    target_member = db.query(OrganizationMember).filter(
        OrganizationMember.id == member_id,
        OrganizationMember.organization_id == org_id,
        OrganizationMember.is_active == True,
    ).first()

    if not target_member:
        raise HTTPException(status_code=404, detail="Target member not found")

    if not target_member.is_approved:
        raise HTTPException(status_code=400, detail="Target member must be approved before admin transfer")

    if target_member.role == MemberRole.ADMIN:
        raise HTTPException(status_code=400, detail="Target member is already an admin")

    current_admin_membership = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id,
        OrganizationMember.user_id == auth.user_id,
        OrganizationMember.is_active == True,
    ).first()

    if not current_admin_membership or current_admin_membership.role != MemberRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only current admins can transfer admin role")

    # Promote target to admin and demote current admin to nurse by default.
    target_member.role = MemberRole.ADMIN
    current_admin_membership.role = MemberRole.NURSE

    # Alert the incoming admin, and leave a record for the outgoing admin.
    org_name = auth.organization.name if auth.organization else "your organization"
    create_notification(
        db,
        user_id=target_member.user_id,
        organization_id=org_id,
        type="admin_transfer",
        title="You are now an admin",
        body=(
            f"{auth.user_name or auth.user_email or 'An admin'} transferred the admin role "
            f"for {org_name} to you. You can now manage members and organization settings."
        ),
        link="/settings",
    )
    create_notification(
        db,
        user_id=auth.user_id,
        organization_id=org_id,
        type="admin_transfer",
        title="Admin role transferred",
        body=(
            f"You transferred the admin role for {org_name} to "
            f"{target_member.user_name or target_member.user_email or 'another member'}. "
            "Your role is now nurse."
        ),
        link="/settings",
    )

    db.commit()
    db.refresh(target_member)

    logger.info(
        f"Admin role transferred in org {org_id}: {auth.user_id} -> {target_member.user_id}"
    )

    return {
        "message": "Admin role transferred",
        "new_admin_member_id": str(target_member.id),
        "previous_admin_member_id": str(current_admin_membership.id),
        "previous_admin_new_role": MemberRole.NURSE.value,
    }


@router.delete("/{org_id}/members/{member_id}")
def remove_member(
    org_id: str,
    member_id: str,
    auth: AuthContext = Depends(get_admin_auth),
    db: Session = Depends(get_db)
):
    """
    Remove a member from the organization. Admin only.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot manage members of a different organization")
    
    member = db.query(OrganizationMember).filter(
        OrganizationMember.id == member_id,
        OrganizationMember.organization_id == org_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # Prevent removing the last admin
    if member.role == MemberRole.ADMIN:
        admin_count = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.role == MemberRole.ADMIN,
            OrganizationMember.is_active == True
        ).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    
    # Soft delete
    member.is_active = False
    db.commit()
    
    return {"message": "Member removed"}


@router.post("/{org_id}/leave")
def leave_organization(
    org_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    Leave an organization.
    """
    if auth.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot leave a different organization")

    # Only admins can self-remove. Nurses/managers must be removed by an admin.
    if auth.membership.role != MemberRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only admins can remove members from this organization.",
        )
    
    # Prevent leaving if you're the last admin
    admin_count = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id,
        OrganizationMember.role == MemberRole.ADMIN,
        OrganizationMember.is_active == True
    ).count()
    if admin_count <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot leave: you are the last admin. Transfer admin role first or delete the organization."
        )
    
    auth.membership.is_active = False
    db.commit()
    
    return {"message": "Left organization"}


# ============== User Context ==============

@router.get("/me/context", response_model=CurrentUserContext)
def get_user_context(
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db)
):
    """
    Get the current user's context including all organization memberships.
    Useful for frontend to initialize user state.
    """
    memberships = db.query(OrganizationMember).filter(
        OrganizationMember.user_id == auth.user_id,
        OrganizationMember.is_active == True
    ).all()
    
    result = []
    for m in memberships:
        org = db.query(Organization).filter(
            Organization.id == m.organization_id,
            Organization.is_active == True
        ).first()
        if org:
            result.append({
                **m.__dict__,
                "organization": org.__dict__
            })
    
    return {
        "user_id": auth.user_id,
        "user_email": auth.user_email,
        "user_name": auth.user_name,
        "organizations": result,
        "current_organization_id": auth.organization_id,
        "current_role": auth.role.value if auth.role else None
    }
