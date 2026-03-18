"""
Law 25 Privacy Compliance Models

Quebec Law 25 (Loi modernisant des dispositions législatives en matière 
de protection des renseignements personnels) requires:

1. Privacy by default
2. Consent management
3. Right to access personal data
4. Right to data portability
5. Right to be forgotten
6. Breach notification
7. Privacy impact assessments
8. Designated privacy officer

Reference: https://www.quebec.ca/gouvernement/politiques-orientations/protection-renseignements-personnels/loi-25
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Boolean, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import enum

from app.db.database import Base


class ConsentType(str, enum.Enum):
    """Types of consent that can be given/revoked"""
    DATA_COLLECTION = "data_collection"
    DATA_PROCESSING = "data_processing"
    DATA_SHARING = "data_sharing"
    ANALYTICS = "analytics"
    MARKETING = "marketing"
    RESEARCH = "research"


class ConsentStatus(str, enum.Enum):
    """Status of consent"""
    GRANTED = "granted"
    DENIED = "denied"
    WITHDRAWN = "withdrawn"
    PENDING = "pending"


class PrivacyConsent(Base):
    """
    Privacy Consent Record
    
    Tracks user consent for data collection and processing.
    Required for Law 25 compliance.
    """
    __tablename__ = "privacy_consents"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # User identification
    user_id = Column(String, nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    
    # Consent details
    consent_type = Column(SQLEnum(ConsentType), nullable=False)
    status = Column(SQLEnum(ConsentStatus), nullable=False, default=ConsentStatus.PENDING)
    
    # Consent metadata
    version = Column(String, nullable=False, default="1.0")  # Policy version consented to
    ip_address = Column(String, nullable=True)  # For audit purposes
    user_agent = Column(String, nullable=True)
    
    # Timestamps
    granted_at = Column(DateTime, nullable=True)
    withdrawn_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)  # Some consents may expire
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Audit trail
    granted_by_method = Column(String, nullable=True)  # e.g., "web_form", "api", "verbal"
    withdrawn_by_method = Column(String, nullable=True)
    
    def __repr__(self):
        return f"<PrivacyConsent {self.user_id} - {self.consent_type}: {self.status}>"


class DataAccessRequest(Base):
    """
    Data Subject Access Request (DSAR)
    
    Tracks requests from users to access, export, or delete their personal data.
    Required for Law 25 compliance.
    """
    __tablename__ = "data_access_requests"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Requester identification
    user_id = Column(String, nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    
    # Request type
    request_type = Column(String, nullable=False)  # "access", "export", "deletion", "rectification"
    
    # Status tracking
    status = Column(String, nullable=False, default="pending")  # pending, processing, completed, rejected
    
    # Request details
    description = Column(Text, nullable=True)
    response = Column(Text, nullable=True)
    
    # File references (for exports)
    export_file_url = Column(String, nullable=True)
    export_file_expires_at = Column(DateTime, nullable=True)
    
    # Timestamps (Law 25 requires response within 30 days)
    requested_at = Column(DateTime, default=datetime.utcnow)
    acknowledged_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)  # Must respond within 30 days
    
    # Audit
    processed_by = Column(String, nullable=True)  # User ID of processor
    
    def __repr__(self):
        return f"<DataAccessRequest {self.user_id} - {self.request_type}: {self.status}>"


class PrivacyAuditLog(Base):
    """
    Privacy Audit Log
    
    Tracks all access to personal data for Law 25 compliance.
    """
    __tablename__ = "privacy_audit_logs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Action details
    action = Column(String, nullable=False)  # read, create, update, delete, export, share
    resource_type = Column(String, nullable=False)  # patient, nurse, handover, etc.
    resource_id = Column(String, nullable=True)
    
    # Actor
    actor_user_id = Column(String, nullable=False, index=True)
    actor_name = Column(String, nullable=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    
    # Context
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    request_path = Column(String, nullable=True)
    request_method = Column(String, nullable=True)
    
    # Outcome
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    
    # Data accessed (for sensitive data, store hash only)
    fields_accessed = Column(Text, nullable=True)  # JSON list of field names
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<PrivacyAuditLog {self.action} on {self.resource_type}/{self.resource_id}>"


class PrivacyBreach(Base):
    """
    Privacy Breach Record
    
    Tracks data breaches for Law 25 mandatory notification requirements.
    """
    __tablename__ = "privacy_breaches"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    
    # Breach details
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    severity = Column(String, nullable=False)  # low, medium, high, critical
    
    # Affected data
    affected_records_count = Column(String, nullable=True)
    data_types_affected = Column(Text, nullable=True)  # JSON list
    
    # Timeline
    discovered_at = Column(DateTime, nullable=False)
    occurred_at = Column(DateTime, nullable=True)  # When breach actually happened
    contained_at = Column(DateTime, nullable=True)
    
    # Notification status (Law 25 requires notification)
    cai_notified = Column(Boolean, default=False)  # Commission d'accès à l'information
    cai_notified_at = Column(DateTime, nullable=True)
    affected_notified = Column(Boolean, default=False)
    affected_notified_at = Column(DateTime, nullable=True)
    
    # Response
    remediation_steps = Column(Text, nullable=True)
    root_cause = Column(Text, nullable=True)
    
    # Status
    status = Column(String, default="open")  # open, investigating, contained, closed
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<PrivacyBreach {self.title} - {self.severity}>"


class DataRetentionPolicy(Base):
    """
    Data Retention Policy
    
    Defines how long different types of data are retained.
    Required for Law 25 compliance.
    """
    __tablename__ = "data_retention_policies"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    
    # Policy details
    data_type = Column(String, nullable=False)  # patient_records, schedules, handovers, etc.
    retention_days = Column(String, nullable=False)  # Number of days or "indefinite"
    
    # Legal basis
    legal_basis = Column(Text, nullable=True)  # Why this retention period
    
    # Automatic deletion
    auto_delete = Column(Boolean, default=False)
    
    # Audit
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<DataRetentionPolicy {self.data_type}: {self.retention_days} days>"
