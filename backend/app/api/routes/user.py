import logging
from fastapi import APIRouter, HTTPException, Depends, Header
from app.schemas.user import UserCreate
from app.db.deps import get_db
from app.models.user import User
from app.models.organization import OrganizationMember, Organization, MemberRole
from app.models.schedule import Schedule
from app.models.nurse import Nurse
from app.models.patient import Patient
from app.models.handover import Handover
from app.core.config import settings
from sqlalchemy.orm import Session

router = APIRouter(redirect_slashes=True)
logger = logging.getLogger("users")


def verify_internal_api_secret(x_internal_secret: str = Header(None, alias="X-Internal-Secret")):
    """
    Verify that the request includes a valid internal API secret.
    This protects internal-only routes that should only be called by the webhook handler.
    """
    if not settings.INTERNAL_API_SECRET:
        # If no secret is configured, reject all requests (fail-secure)
        logger.warning("INTERNAL_API_SECRET not configured - rejecting internal API request")
        raise HTTPException(status_code=403, detail="Internal API not configured")
    
    if not x_internal_secret or x_internal_secret != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=403, detail="Invalid or missing internal API secret")
    
    return True


@router.post("/")
def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(verify_internal_api_secret)
):
    """Create a user - internal API only, called by webhook handler."""
    db_user = User(id=user.id)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return {"message": "User created", "user_id": db_user.id}


@router.get("/{user_id}")
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(verify_internal_api_secret)
):
    """Get a user by ID - internal API only, called by webhook handler."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "is_active": user.is_active, "created_at": user.created_at}


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(verify_internal_api_secret)
):
    """
    Delete a user and cascade delete all related data.
    Internal API only - called by Clerk webhook when user.deleted event is received.
    
    If the user is the only admin of an organization:
    - If they're the only member: delete the entire organization
    - If there are other members: promote first manager to admin, or first nurse
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    orgs_deleted = []
    
    # Get all organizations where user is an admin
    admin_memberships = db.query(OrganizationMember).filter(
        OrganizationMember.user_id == user_id,
        OrganizationMember.role == MemberRole.ADMIN
    ).all()
    
    for membership in admin_memberships:
        org = db.query(Organization).filter(Organization.id == membership.organization_id).first()
        if not org:
            continue
            
        # Check if there are other admins in this organization
        other_admins = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id != user_id,
            OrganizationMember.role == MemberRole.ADMIN
        ).count()
        
        if other_admins > 0:
            # Other admins exist, just remove this user's membership (handled below)
            logger.info(f"Org {org.id} has {other_admins} other admins, not deleting org")
            continue
        
        # No other admins - check if there are other members
        other_members = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id != user_id
        ).all()
        
        if len(other_members) == 0:
            # User is the only member - delete the entire organization and all its data
            logger.info(f"Deleting organization {org.id} ({org.name}) - last member leaving")
            
            # Delete all organization data
            handovers_deleted = db.query(Handover).filter(
                Handover.organization_id == org.id
            ).delete(synchronize_session=False)
            
            patients_deleted = db.query(Patient).filter(
                Patient.organization_id == org.id
            ).delete(synchronize_session=False)
            
            schedules_deleted = db.query(Schedule).filter(
                Schedule.organization_id == org.id
            ).delete(synchronize_session=False)
            
            nurses_deleted = db.query(Nurse).filter(
                Nurse.organization_id == org.id
            ).delete(synchronize_session=False)
            
            # Memberships will be cascade deleted with organization
            db.delete(org)
            
            orgs_deleted.append({
                "org_id": org.id,
                "org_name": org.name,
                "handovers": handovers_deleted,
                "patients": patients_deleted,
                "schedules": schedules_deleted,
                "nurses": nurses_deleted
            })
            logger.info(f"Deleted organization {org.name} and all data")
        else:
            # There are other members but no other admins - promote first manager or nurse
            # Try to find a manager first
            new_admin = db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == org.id,
                OrganizationMember.user_id != user_id,
                OrganizationMember.role == MemberRole.MANAGER
            ).first()
            
            if not new_admin:
                # No manager, promote first nurse
                new_admin = other_members[0]
            
            new_admin.role = MemberRole.ADMIN
            db.add(new_admin)
            logger.info(f"Promoted user {new_admin.user_id} to admin in org {org.id}")
    
    # Delete remaining memberships (non-admin orgs)
    memberships_deleted = db.query(OrganizationMember).filter(
        OrganizationMember.user_id == user_id
    ).delete(synchronize_session=False)
    logger.info(f"Deleted {memberships_deleted} organization memberships for user {user_id}")
    
    # Delete schedules created by user (if any remain)
    schedules_deleted = db.query(Schedule).filter(
        Schedule.user_id == user_id
    ).delete(synchronize_session=False)
    logger.info(f"Deleted {schedules_deleted} schedules for user {user_id}")
    
    # Delete nurse profiles linked to user (if any remain)
    nurses_deleted = db.query(Nurse).filter(
        Nurse.user_id == user_id
    ).delete(synchronize_session=False)
    logger.info(f"Deleted {nurses_deleted} nurse profiles for user {user_id}")
    
    # Delete the user
    db.delete(user)
    db.commit()
    
    logger.info(f"User {user_id} and all related data deleted successfully")
    return {
        "message": f"User {user_id} deleted successfully",
        "deleted": {
            "organization_memberships": memberships_deleted,
            "schedules": schedules_deleted,
            "nurse_profiles": nurses_deleted,
            "organizations_deleted": orgs_deleted
        }
    }
