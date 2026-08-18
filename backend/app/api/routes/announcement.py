"""Announcement routes: manager-authored org/team broadcasts."""
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.announcement import Announcement
from app.models.nurse import Nurse
from app.models.organization import OrganizationMember
from app.schemas.announcement import (
    AnnouncementCreate,
    AnnouncementUpdate,
    AnnouncementResponse,
)
from app.core.auth import (
    AuthContext,
    get_org_required_auth,
    require_permission,
)

# Publishing / editing announcements is a delegatable action.
get_manager_auth = require_permission("manage_announcements")

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_author_display_name(
    db: Session,
    organization_id: str,
    user_id: Optional[str],
    current_name: Optional[str],
) -> Optional[str]:
    if user_id:
        linked_nurse = (
            db.query(Nurse)
            .filter(
                Nurse.organization_id == organization_id,
                Nurse.user_id == user_id,
            )
            .first()
        )
        if linked_nurse and linked_nurse.name:
            return linked_nurse.name

    if current_name and current_name != user_id:
        return current_name

    if user_id:
        member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
            )
            .first()
        )
        if member and (member.user_name or member.user_email):
            return member.user_name or member.user_email

    return user_id or current_name


def _viewer_team(db: Session, auth: AuthContext) -> Optional[str]:
    """Resolve the requesting user's team from their nurse profile, if any."""
    nurse = (
        db.query(Nurse)
        .filter(
            Nurse.organization_id == auth.organization_id,
            Nurse.user_id == auth.user_id,
        )
        .first()
    )
    return nurse.team if nurse else None


@router.post("", response_model=AnnouncementResponse, status_code=201, include_in_schema=False)
@router.post("/", response_model=AnnouncementResponse, status_code=201)
def create_announcement(
    body: AnnouncementCreate,
    auth: AuthContext = Depends(get_manager_auth),
    db: Session = Depends(get_db),
):
    """Create an announcement. Managers and admins only."""
    author_name = _resolve_author_display_name(
        db,
        auth.organization_id,
        auth.user_id,
        auth.user_name or auth.user_email,
    )

    announcement = Announcement(
        organization_id=auth.organization_id,
        title=body.title,
        body=body.body,
        source_link=body.source_link,
        target_team=body.target_team or None,
        is_pinned=body.is_pinned,
        expires_at=body.expires_at,
        created_by=auth.user_id,
        created_by_name=author_name,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)

    logger.info(
        f"Announcement '{announcement.title}' created in org {auth.organization_id} by {auth.user_id}"
    )
    return announcement


@router.get("", response_model=List[AnnouncementResponse], include_in_schema=False)
@router.get("/", response_model=List[AnnouncementResponse])
def list_announcements(
    include_expired: bool = Query(False),
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
):
    """
    List announcements visible to the caller.

    Members only see org-wide announcements plus those targeted at their team.
    Managers see everything in the organization.
    """
    query = db.query(Announcement).filter(
        Announcement.organization_id == auth.organization_id
    )

    if not include_expired:
        now = datetime.utcnow()
        query = query.filter(
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now)
        )

    if not auth.has_permission("manage_announcements"):
        team = _viewer_team(db, auth)
        if team:
            query = query.filter(
                or_(Announcement.target_team.is_(None), Announcement.target_team == team)
            )
        else:
            # Fallback: if a member has no mapped nurse/team yet, do not hide
            # team-targeted org announcements from them.
            logger.info(
                "Announcement list fallback: no team mapping for user %s in org %s",
                auth.user_id,
                auth.organization_id,
            )

    announcements = query.all()

    for announcement in announcements:
        announcement.created_by_name = _resolve_author_display_name(
            db,
            auth.organization_id,
            announcement.created_by,
            announcement.created_by_name,
        )

    # Pinned first, then newest first.
    announcements.sort(key=lambda a: (not a.is_pinned, -a.created_at.timestamp()))
    return announcements


@router.patch("/{announcement_id}", response_model=AnnouncementResponse)
def update_announcement(
    announcement_id: UUID,
    body: AnnouncementUpdate,
    auth: AuthContext = Depends(get_manager_auth),
    db: Session = Depends(get_db),
):
    """Update an announcement (edit, pin/unpin, retarget, change expiry)."""
    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.organization_id == auth.organization_id,
        )
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(announcement, field, value)

    db.commit()
    db.refresh(announcement)
    return announcement


@router.delete("/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: UUID,
    auth: AuthContext = Depends(get_manager_auth),
    db: Session = Depends(get_db),
):
    """Delete an announcement."""
    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.organization_id == auth.organization_id,
        )
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    db.delete(announcement)
    db.commit()
    return None
