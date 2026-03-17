# schedule_rule.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.database import Base


class ScheduleRule(Base):
    """Persisted scheduling rules per organization.

    Rules tend not to change much between scheduling periods, so we store
    the latest version and let the user reload it for new schedules.
    """

    __tablename__ = "schedule_rules"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        String(255), ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String(200), nullable=False, default="default")
    rules_text = Column(Text, nullable=False, default="")
    created_by = Column(String(255), nullable=True)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
