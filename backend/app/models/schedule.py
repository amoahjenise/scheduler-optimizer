## models/schedule.py
from sqlalchemy import Column, String, ForeignKey, JSON, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from uuid import uuid4
from datetime import datetime
from app.db.database import Base

class Schedule(Base):
    __tablename__ = "schedules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String, nullable=False)
    period = Column(String, nullable=False)
    rules = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    raw_images = Column(JSON, default=list)
    employee_comments = Column(JSON, default=dict)  # {"Jane Doe": {"2025-06-02": "comment"}}
    created_at = Column(DateTime, default=datetime.utcnow)
