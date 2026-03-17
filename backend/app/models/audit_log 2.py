"""Audit log model for HIPAA-compliant access tracking."""
from sqlalchemy import Column, BigInteger, String, Text, DateTime, func
from app.db.database import Base


class AuditLog(Base):
    """
    Immutable audit trail for every action on protected health information.
    Records who viewed, created, updated, or deleted a resource, when, and from where.
    This satisfies the HIPAA requirement for access logging.
    """
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    user_name = Column(String(200), nullable=True)
    action = Column(String(20), nullable=False, index=True)  # view | create | update | delete | complete
    resource_type = Column(String(50), nullable=False, index=True)  # handover | patient | schedule
    resource_id = Column(String, nullable=True, index=True)
    detail = Column(Text, nullable=True)  # Human-readable change summary
    changed_fields = Column(Text, nullable=True)  # JSON list of changed field names
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    def __repr__(self):
        return f"<AuditLog {self.id} {self.action} {self.resource_type}/{self.resource_id} by {self.user_id}>"
