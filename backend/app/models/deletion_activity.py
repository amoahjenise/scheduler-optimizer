from uuid import uuid4

from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class DeletionActivity(Base):
    __tablename__ = "deletion_activities"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    organization_id = Column(String, nullable=True, index=True)
    object_type = Column(String(50), nullable=False, index=True)
    object_id = Column(String(255), nullable=False)
    object_label = Column(String(255), nullable=False)
    details = Column(Text, nullable=True)
    performed_by_user_id = Column(String(255), nullable=True)
    performed_by_name = Column(String(255), nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
