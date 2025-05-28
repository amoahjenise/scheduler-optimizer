## models/optimized_schedule.py
from sqlalchemy import Column, String, ForeignKey, JSON, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from uuid import uuid4
from datetime import datetime
from app.db.database import Base

class OptimizedSchedule(Base):
    __tablename__ = "optimized_schedules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedules.id"), nullable=False)
    result = Column(JSON)
    finalized = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)