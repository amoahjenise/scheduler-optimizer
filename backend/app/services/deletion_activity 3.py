from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.auth import AuthContext
from app.models.deletion_activity import DeletionActivity


def get_actor_display_name(auth: Optional[AuthContext]) -> str:
    if auth and auth.is_authenticated:
        return auth.user_name or auth.user_email or auth.user_id
    return "Anonymous"


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
        performed_by_name=get_actor_display_name(auth),
    )
    db.add(activity)
    return activity
