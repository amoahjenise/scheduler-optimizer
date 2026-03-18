from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from clerk_backend_api import Clerk
import logging

from app.core.auth import OptionalAuth
from app.db.deps import get_db
from app.models.deletion_activity import DeletionActivity
from app.models.organization import OrganizationMember
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Initialize Clerk client
clerk_client = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


@router.get("/")
def list_deletion_activities(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
):
    query = db.query(DeletionActivity)

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(DeletionActivity.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> return empty list to prevent data leakage
        return []

    activities = (
        query.order_by(DeletionActivity.occurred_at.desc()).limit(limit).all()
    )

    user_ids = {
        activity.performed_by_user_id
        for activity in activities
        if activity.performed_by_user_id
    }

    # Fetch user data from Clerk
    clerk_user_names = {}
    for user_id in user_ids:
        try:
            clerk_user = clerk_client.users.get(user_id=user_id)
            first_name = clerk_user.first_name or ""
            last_name = clerk_user.last_name or ""
            full_name = f"{first_name} {last_name}".strip()
            if full_name:
                clerk_user_names[user_id] = full_name
            # Fallback to email if no name
            elif clerk_user.email_addresses:
                for email in clerk_user.email_addresses:
                    if hasattr(email, 'id') and email.id == clerk_user.primary_email_address_id:
                        clerk_user_names[user_id] = email.email_address
                        break
        except Exception as e:
            logger.warning(f"Failed to fetch Clerk user data for {user_id}: {e}")
            pass

    # Fallback to organization members table
    member_name_by_user_id = {}
    if user_ids and auth.is_authenticated and auth.organization_id:
        members = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == auth.organization_id,
                OrganizationMember.user_id.in_(list(user_ids)),
            )
            .all()
        )
        member_name_by_user_id = {
            member.user_id: (member.user_name or member.user_email)
            for member in members
        }

    def resolve_display_name(activity: DeletionActivity) -> str:
        user_id = activity.performed_by_user_id
        
        # Priority 1: Clerk user data (most up-to-date)
        if user_id and user_id in clerk_user_names:
            return clerk_user_names[user_id]
        
        # Priority 2: Stored name if it looks valid
        name = (activity.performed_by_name or "").strip()
        if name and not name.startswith("user_") and name != user_id:
            return name

        # Priority 3: Organization member lookup
        if user_id and member_name_by_user_id:
            member_name = member_name_by_user_id.get(user_id)
            if member_name:
                return member_name

        # Fallback: return user_id if present
        if user_id:
            return user_id

        return "Unknown user"

    return [
        {
            "id": activity.id,
            "object_type": activity.object_type,
            "object_id": activity.object_id,
            "object_label": activity.object_label,
            "details": activity.details,
            "performed_by_user_id": activity.performed_by_user_id,
            "performed_by_name": resolve_display_name(activity),
            "occurred_at": activity.occurred_at.isoformat() if activity.occurred_at else None,
        }
        for activity in activities
    ]
