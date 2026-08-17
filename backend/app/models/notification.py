"""In-app notification model for per-user alerts (e.g. admin role transfer)."""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.db.database import Base


class Notification(Base):
    """A single in-app notification targeted at one user."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=False, index=True)

    # e.g. admin_transfer, join_request, info
    type = Column(String, nullable=False, default="info")
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String, nullable=True)

    is_read = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return f"<Notification {self.type} user={self.user_id} read={self.is_read}>"
