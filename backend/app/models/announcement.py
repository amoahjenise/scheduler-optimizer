"""Announcement model for org-wide and team-targeted manager broadcasts."""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.db.database import Base


class Announcement(Base):
    """
    A manager-authored announcement shown to organization members.

    target_team = None means the announcement targets the whole organization.
    """
    __tablename__ = "announcements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)

    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    source_link = Column(String, nullable=True)

    # Targeting: null = entire organization, otherwise a team name
    target_team = Column(String, nullable=True, index=True)

    # Presentation / lifecycle
    is_pinned = Column(Boolean, nullable=False, default=False)
    expires_at = Column(DateTime, nullable=True)

    created_by = Column(String, nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def __repr__(self):
        return f"<Announcement {self.title} org={self.organization_id}>"
