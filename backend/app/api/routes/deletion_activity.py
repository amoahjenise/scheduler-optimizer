from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import OptionalAuth
from app.db.deps import get_db
from app.models.deletion_activity import DeletionActivity
from app.models.organization import OrganizationMember

router = APIRouter()


@router.get("/")
def list_deletion_activities(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
):
    query = db.query(DeletionActivity)

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(DeletionActivity.organization_id == auth.organization_id)

    activities = (
        query.order_by(DeletionActivity.occurred_at.desc()).limit(limit).all()
    )

    user_ids = {
        activity.performed_by_user_id
        for activity in activities
        if activity.performed_by_user_id
    }

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
        name = (activity.performed_by_name or "").strip()
        user_id = activity.performed_by_user_id

        looks_like_raw_user_id = (
            name == ""
            or (user_id is not None and name == user_id)
            or name.startswith("user_")
        )

        if looks_like_raw_user_id and user_id:
            return member_name_by_user_id.get(user_id) or "Unknown user"

        return name or "Unknown user"

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
