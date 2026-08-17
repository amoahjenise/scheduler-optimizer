"""In-app notification routes."""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.notification import Notification
from app.schemas.notification import NotificationResponse
from app.core.auth import AuthContext, get_required_auth

router = APIRouter()
logger = logging.getLogger(__name__)


def create_notification(
    db: Session,
    *,
    user_id: str,
    title: str,
    body: Optional[str] = None,
    organization_id: Optional[str] = None,
    type: str = "info",
    link: Optional[str] = None,
) -> Notification:
    """
    Create a notification for a user.

    Shared helper so other routes (e.g. admin transfer) can raise alerts
    without duplicating persistence logic. Caller is responsible for commit.
    """
    notification = Notification(
        organization_id=organization_id,
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
    )
    db.add(notification)
    return notification


@router.get("", response_model=List[NotificationResponse], include_in_schema=False)
@router.get("/", response_model=List[NotificationResponse])
def list_my_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db),
):
    """List the caller's notifications, newest first."""
    query = db.query(Notification).filter(Notification.user_id == auth.user_id)

    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712

    return (
        query.order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_read(
    notification_id: UUID,
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db),
):
    """Mark a single notification as read."""
    notification = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.user_id == auth.user_id,
        )
        .first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.post("/read-all")
def mark_all_notifications_read(
    auth: AuthContext = Depends(get_required_auth),
    db: Session = Depends(get_db),
):
    """Mark all of the caller's notifications as read."""
    updated = (
        db.query(Notification)
        .filter(
            Notification.user_id == auth.user_id,
            Notification.is_read == False,  # noqa: E712
        )
        .update({Notification.is_read: True}, synchronize_session=False)
    )
    db.commit()
    return {"message": "Notifications marked as read", "updated": updated}
