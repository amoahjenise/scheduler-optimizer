from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.auth import AuthContext
from app.models.deletion_activity import DeletionActivity
from app.models.organization import OrganizationMember


def get_actor_display_name(
    db: Session,
    auth: Optional[AuthContext],
    organization_id: Optional[str] = None,
) -> str:
    if not auth or not auth.is_authenticated:
        return "Anonymous"

    membership_name = auth.membership.user_name if auth.membership else None
    membership_email = auth.membership.user_email if auth.membership else None

    direct_name = (
        membership_name
        or auth.user_name
        or membership_email
        or auth.user_email
    )
    if direct_name:
        return direct_name

    resolved_org_id = organization_id or auth.organization_id
    if resolved_org_id and auth.user_id:
        org_member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == resolved_org_id,
                OrganizationMember.user_id == auth.user_id,
            )
            .first()
        )
        if org_member:
            return org_member.user_name or org_member.user_email or "Unknown user"

    return "Unknown user"


def record_deletion_activity(
    db: Session,
    *,
    object_type: str,
    object_id: str,
    object_label: str,
    details: Optional[str] = None,
    auth: Optional[AuthContext] = None,
    organization_id: Optional[str] = None,
) -> DeletionActivity:
    activity = DeletionActivity(
        organization_id=organization_id or (auth.organization_id if auth and auth.is_authenticated else None),
        object_type=object_type,
        object_id=object_id,
        object_label=object_label,
        details=details,
        performed_by_user_id=auth.user_id if auth and auth.is_authenticated else None,
        performed_by_name=get_actor_display_name(db, auth, organization_id),
    )
    db.add(activity)
    return activity
