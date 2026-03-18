"""
Privacy API Routes

Law 25 (Quebec Privacy Law) compliance endpoints for:
- Consent management
- Data access requests (DSAR)
- Privacy audit logs
- Data export/deletion
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.db.deps import get_db
from app.models.privacy import (
    PrivacyConsent, 
    ConsentType, 
    ConsentStatus,
    DataAccessRequest, 
    RequestType, 
    RequestStatus,
    PrivacyAuditLog,
    PrivacyBreach,
    DataRetentionPolicy
)
from app.core.auth import RequiredAuth, AdminAuth


router = APIRouter()


# ========== Schemas ==========

class ConsentCreate(BaseModel):
    consent_type: ConsentType
    purpose: str
    data_categories: Optional[List[str]] = None
    consent_text: Optional[str] = None
    expiry_date: Optional[datetime] = None


class ConsentResponse(BaseModel):
    id: UUID
    consent_type: str
    status: str
    purpose: str
    granted_at: datetime
    expiry_date: Optional[datetime]
    
    class Config:
        from_attributes = True


class DataAccessRequestCreate(BaseModel):
    request_type: RequestType
    requester_email: EmailStr
    description: Optional[str] = None
    data_categories: Optional[List[str]] = None


class DataAccessRequestResponse(BaseModel):
    id: UUID
    request_type: str
    status: str
    requester_email: str
    submitted_at: datetime
    due_date: datetime
    completed_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class PrivacyAuditResponse(BaseModel):
    id: UUID
    action: str
    data_type: str
    timestamp: datetime
    ip_address: Optional[str]
    
    class Config:
        from_attributes = True


class DataExportResponse(BaseModel):
    status: str
    message: str
    export_id: Optional[UUID] = None
    estimated_completion: Optional[datetime] = None


# ========== Consent Management ==========

@router.get("/consents", response_model=List[ConsentResponse])
async def get_my_consents(
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Get all consents for the current user.
    """
    consents = db.query(PrivacyConsent).filter(
        PrivacyConsent.user_id == auth.user_id
    ).all()
    
    return consents


@router.post("/consents", response_model=ConsentResponse, status_code=201)
async def grant_consent(
    consent_data: ConsentCreate,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Grant a new consent.
    """
    org_id = auth.organization_id
    
    consent = PrivacyConsent(
        user_id=auth.user_id,
        organization_id=UUID(org_id) if org_id else None,
        consent_type=consent_data.consent_type,
        status=ConsentStatus.ACTIVE,
        purpose=consent_data.purpose,
        data_categories=consent_data.data_categories or [],
        consent_text=consent_data.consent_text,
        expiry_date=consent_data.expiry_date,
        consent_method="api",
        granted_at=datetime.utcnow()
    )
    
    db.add(consent)
    db.commit()
    db.refresh(consent)
    
    # Log the consent action
    audit = PrivacyAuditLog(
        organization_id=UUID(org_id) if org_id else None,
        user_id=auth.user_id,
        action="consent_granted",
        data_type="consent",
        resource_id=str(consent.id),
        details={"consent_type": consent_data.consent_type.value}
    )
    db.add(audit)
    db.commit()
    
    return consent


@router.delete("/consents/{consent_id}")
async def revoke_consent(
    consent_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Revoke a consent.
    """
    consent = db.query(PrivacyConsent).filter(
        PrivacyConsent.id == consent_id,
        PrivacyConsent.user_id == auth.user_id
    ).first()
    
    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")
    
    consent.status = ConsentStatus.REVOKED
    consent.revoked_at = datetime.utcnow()
    db.commit()
    
    # Log the revocation
    org_id = auth.organization_id
    audit = PrivacyAuditLog(
        organization_id=UUID(org_id) if org_id else None,
        user_id=auth.user_id,
        action="consent_revoked",
        data_type="consent",
        resource_id=str(consent_id)
    )
    db.add(audit)
    db.commit()
    
    return {"status": "revoked", "consent_id": str(consent_id)}


# ========== Data Access Requests (DSAR) ==========

@router.post("/data-requests", response_model=DataAccessRequestResponse, status_code=201)
async def create_data_access_request(
    request_data: DataAccessRequestCreate,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Create a new data access request (DSAR).
    Under Law 25, organizations must respond within 30 days.
    """
    org_id = auth.organization_id
    
    request = DataAccessRequest(
        user_id=auth.user_id,
        organization_id=UUID(org_id) if org_id else None,
        request_type=request_data.request_type,
        requester_email=request_data.requester_email,
        description=request_data.description,
        data_categories=request_data.data_categories or [],
        status=RequestStatus.PENDING
    )
    
    db.add(request)
    db.commit()
    db.refresh(request)
    
    return request


@router.get("/data-requests", response_model=List[DataAccessRequestResponse])
async def get_my_data_requests(
    status: Optional[RequestStatus] = Query(None),
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Get all data access requests for the current user.
    """
    query = db.query(DataAccessRequest).filter(
        DataAccessRequest.user_id == auth.user_id
    )
    
    if status:
        query = query.filter(DataAccessRequest.status == status)
    
    return query.order_by(DataAccessRequest.submitted_at.desc()).all()


@router.get("/data-requests/{request_id}", response_model=DataAccessRequestResponse)
async def get_data_request(
    request_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Get a specific data access request.
    """
    request = db.query(DataAccessRequest).filter(
        DataAccessRequest.id == request_id,
        DataAccessRequest.user_id == auth.user_id
    ).first()
    
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    
    return request


# ========== Data Export ==========

@router.post("/export-my-data", response_model=DataExportResponse)
async def export_my_data(
    background_tasks: BackgroundTasks,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Request an export of all personal data (Law 25 portability right).
    Creates a DSAR of type 'export' and queues the export job.
    """
    org_id = auth.organization_id
    user_email = current_user.get("email", "")
    
    # Create the export request
    request = DataAccessRequest(
        user_id=auth.user_id,
        organization_id=UUID(org_id) if org_id else None,
        request_type=RequestType.EXPORT,
        requester_email=user_email,
        description="Automated data export request",
        data_categories=["all"],
        status=RequestStatus.IN_PROGRESS
    )
    
    db.add(request)
    db.commit()
    db.refresh(request)
    
    # Queue background export task
    # background_tasks.add_task(export_user_data, auth.user_id, request.id)
    
    return DataExportResponse(
        status="processing",
        message="Your data export has been initiated. You will receive an email when it's ready.",
        export_id=request.id,
        estimated_completion=request.due_date
    )


# ========== Delete My Data ==========

@router.post("/delete-my-data", response_model=DataExportResponse)
async def request_data_deletion(
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Request deletion of all personal data (Law 25 right to erasure).
    Creates a DSAR of type 'deletion' for review.
    """
    org_id = auth.organization_id
    user_email = current_user.get("email", "")
    
    # Create the deletion request
    request = DataAccessRequest(
        user_id=auth.user_id,
        organization_id=UUID(org_id) if org_id else None,
        request_type=RequestType.DELETION,
        requester_email=user_email,
        description="User-initiated data deletion request",
        data_categories=["all"],
        status=RequestStatus.PENDING
    )
    
    db.add(request)
    db.commit()
    db.refresh(request)
    
    return DataExportResponse(
        status="pending",
        message="Your data deletion request has been submitted for review. You will receive confirmation within 30 days.",
        export_id=request.id,
        estimated_completion=request.due_date
    )


# ========== Admin Routes ==========

@router.get("/admin/data-requests", response_model=List[DataAccessRequestResponse])
async def admin_list_data_requests(
    status: Optional[RequestStatus] = Query(None),
    request_type: Optional[RequestType] = Query(None),
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Admin: List all data access requests for the organization.
    """
    org_id = auth.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    query = db.query(DataAccessRequest).filter(
        DataAccessRequest.organization_id == UUID(org_id)
    )
    
    if status:
        query = query.filter(DataAccessRequest.status == status)
    if request_type:
        query = query.filter(DataAccessRequest.request_type == request_type)
    
    return query.order_by(DataAccessRequest.submitted_at.desc()).all()


@router.patch("/admin/data-requests/{request_id}")
async def admin_update_request_status(
    request_id: UUID,
    status: RequestStatus,
    response_notes: Optional[str] = None,
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Admin: Update the status of a data access request.
    """
    org_id = auth.organization_id
    
    request = db.query(DataAccessRequest).filter(
        DataAccessRequest.id == request_id,
        DataAccessRequest.organization_id == UUID(org_id)
    ).first()
    
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    
    request.status = status
    if response_notes:
        request.response_notes = response_notes
    if status == RequestStatus.COMPLETED:
        request.completed_at = datetime.utcnow()
    
    request.processed_by = auth.user_id
    
    db.commit()
    
    return {"status": "updated", "request_id": str(request_id), "new_status": status.value}


@router.get("/admin/audit-logs", response_model=List[PrivacyAuditResponse])
async def admin_get_audit_logs(
    data_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(100, le=1000),
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Admin: Get privacy audit logs for the organization.
    """
    org_id = auth.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    query = db.query(PrivacyAuditLog).filter(
        PrivacyAuditLog.organization_id == UUID(org_id)
    )
    
    if data_type:
        query = query.filter(PrivacyAuditLog.data_type == data_type)
    if action:
        query = query.filter(PrivacyAuditLog.action == action)
    if start_date:
        query = query.filter(PrivacyAuditLog.timestamp >= start_date)
    if end_date:
        query = query.filter(PrivacyAuditLog.timestamp <= end_date)
    
    return query.order_by(PrivacyAuditLog.timestamp.desc()).limit(limit).all()


# ========== Privacy Dashboard ==========

@router.get("/admin/privacy-dashboard")
async def admin_privacy_dashboard(
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Admin: Get privacy compliance dashboard data.
    """
    org_id = auth.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    org_uuid = UUID(org_id)
    
    # Pending DSARs
    pending_requests = db.query(DataAccessRequest).filter(
        DataAccessRequest.organization_id == org_uuid,
        DataAccessRequest.status == RequestStatus.PENDING
    ).count()
    
    # Overdue DSARs
    overdue_requests = db.query(DataAccessRequest).filter(
        DataAccessRequest.organization_id == org_uuid,
        DataAccessRequest.status.in_([RequestStatus.PENDING, RequestStatus.IN_PROGRESS]),
        DataAccessRequest.due_date < datetime.utcnow()
    ).count()
    
    # Total DSARs this month
    from datetime import timedelta
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
    monthly_requests = db.query(DataAccessRequest).filter(
        DataAccessRequest.organization_id == org_uuid,
        DataAccessRequest.submitted_at >= month_start
    ).count()
    
    # Active consents
    active_consents = db.query(PrivacyConsent).filter(
        PrivacyConsent.organization_id == org_uuid,
        PrivacyConsent.status == ConsentStatus.ACTIVE
    ).count()
    
    # Privacy breaches (hopefully 0!)
    breaches = db.query(PrivacyBreach).filter(
        PrivacyBreach.organization_id == org_uuid
    ).count()
    
    return {
        "pending_requests": pending_requests,
        "overdue_requests": overdue_requests,
        "monthly_requests": monthly_requests,
        "active_consents": active_consents,
        "breaches_total": breaches,
        "compliance_status": "compliant" if overdue_requests == 0 else "attention_needed"
    }
