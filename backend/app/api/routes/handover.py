"""API routes for Handover management."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta
from app.db.deps import get_db
from app.models.patient import Patient
from app.models.handover import Handover, PatientStatus, AcuityLevel, IsolationType
from app.schemas.handover import (
    HandoverCreate,
    HandoverUpdate,
    HandoverResponse,
    HandoverListResponse,
    HandoverComplete,
    BulkHandoverCreate,
)
from app.core.auth import OptionalAuth
from app.utils.audit import log_audit, diff_fields
from app.services.deletion_activity import record_deletion_activity

router = APIRouter()


@router.get("/", response_model=HandoverListResponse)
def get_handovers(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    shift_date: Optional[date] = Query(None, description="Filter by shift date"),
    shift_type: Optional[str] = Query(None, description="Filter by shift type"),
    is_completed: Optional[bool] = Query(None, description="Filter by completion status"),
    patient_id: Optional[str] = Query(None, description="Filter by patient ID"),
    outgoing_nurse: Optional[str] = Query(None, description="Filter by outgoing nurse"),
):
    """
    Get all handovers with optional filtering.
    """
    query = db.query(Handover).options(joinedload(Handover.patient))
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> return empty list to prevent data leakage
        return HandoverListResponse(handovers=[], total=0)
    
    if shift_date:
        # Filter by date portion
        query = query.filter(
            Handover.shift_date >= datetime.combine(shift_date, datetime.min.time()),
            Handover.shift_date < datetime.combine(shift_date, datetime.max.time())
        )
    
    if shift_type:
        query = query.filter(Handover.shift_type == shift_type)
    
    if is_completed is not None:
        query = query.filter(Handover.is_completed == is_completed)
    
    if patient_id:
        query = query.filter(Handover.patient_id == patient_id)
    
    if outgoing_nurse:
        query = query.filter(Handover.outgoing_nurse.ilike(f"%{outgoing_nurse}%"))
    
    # Deduplicate: keep only the most recent handover per patient identity.
    ordered = query.order_by(Handover.updated_at.desc(), Handover.created_at.desc()).all()

    deduped: list[Handover] = []
    seen_keys: set[tuple] = set()
    for handover in ordered:
        if handover.patient_id:
            key = (handover.patient_id,)
        else:
            key = (
                (handover.p_first_name or "").strip().lower(),
                (handover.p_last_name or "").strip().lower(),
                (handover.p_room_number or "").strip(),
            )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(handover)

    total = len(deduped)
    paginated = deduped[skip : skip + limit]

    return HandoverListResponse(handovers=paginated, total=total)


@router.get("/today", response_model=HandoverListResponse)
def get_todays_handovers(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    shift_type: Optional[str] = Query(None, description="Filter by shift type"),
):
    """
    Get all handovers for today's date.
    Uses UTC to match frontend's new Date().toISOString() timestamps.
    """
    now_utc = datetime.now(timezone.utc)
    today_utc = now_utc.date()
    # Use a tight window for today: from yesterday 18:00 UTC (to catch evening
    # shifts stored near midnight in local-tz) through end of today UTC+1.
    # This is narrower than the old 3-day window which pulled stale records.
    start = datetime.combine(today_utc - timedelta(days=1), datetime.min.time().replace(hour=18))
    end = datetime.combine(today_utc + timedelta(days=1), datetime.min.time())
    query = db.query(Handover).options(joinedload(Handover.patient)).filter(
        Handover.shift_date >= start,
        Handover.shift_date < end
    )
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> return empty list to prevent data leakage
        return HandoverListResponse(handovers=[], total=0)
    
    if shift_type:
        query = query.filter(Handover.shift_type == shift_type)
    
    # Return only the most recent handover per patient for today.
    # This prevents inflated counts when duplicate rows exist.
    # Dedup key = patient identity only (NOT shift_type), so each patient
    # appears at most once in the list regardless of day/night handovers.
    ordered = query.order_by(Handover.updated_at.desc(), Handover.created_at.desc()).all()

    deduped: list[Handover] = []
    seen_keys: set[tuple] = set()
    for handover in ordered:
        # Use patient_id when available, otherwise use embedded name+room
        if handover.patient_id:
            key = (handover.patient_id,)
        else:
            key = (
                (handover.p_first_name or "").strip().lower(),
                (handover.p_last_name or "").strip().lower(),
                (handover.p_room_number or "").strip(),
            )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(handover)

    return HandoverListResponse(handovers=deduped, total=len(deduped))


@router.get("/{handover_id}", response_model=HandoverResponse)
def get_handover(handover_id: str, auth: OptionalAuth, request: Request, db: Session = Depends(get_db)):
    """
    Get a specific handover by ID.
    """
    query = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(Handover.id == handover_id)
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot access any handover
        raise HTTPException(status_code=404, detail="Handover not found")
    
    handover = query.first()
    
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    # Audit: log view
    if auth.is_authenticated:
        patient_label = f"{handover.p_last_name}, {handover.p_first_name}" if handover.p_last_name else handover.patient_id or "unknown"
        log_audit(
            db, request,
            user_id=auth.user_id,
            organization_id=auth.organization_id,
            action="view",
            resource_type="handover",
            resource_id=handover_id,
            detail=f"Viewed handover for {patient_label}",
        )
        db.commit()

    return handover


@router.post("/", response_model=HandoverResponse, status_code=201)
def create_handover(handover_data: HandoverCreate, auth: OptionalAuth, request: Request, db: Session = Depends(get_db)):
    """
    Create a new handover record. Requires authentication.
    
    Supports two modes:
    1. Legacy: provide patient_id to link to an existing patient row.
    2. Embedded (preferred): provide p_first_name, p_last_name, p_room_number etc.
       directly.  No patient row is created — all PII lives on the handover itself,
       which is treated as temporary shift communication.
    """
    if not auth.is_authenticated or not auth.organization_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    org_id = auth.organization_id
    
    # If patient_id is provided, verify the patient exists (backward compat)
    if handover_data.patient_id:
        patient_query = db.query(Patient).filter(
            Patient.id == handover_data.patient_id,
            Patient.organization_id == org_id
        )
        patient = patient_query.first()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        # Auto-fill embedded fields from the patient record so responses are consistent
        if not handover_data.p_first_name:
            handover_data.p_first_name = patient.first_name
        if not handover_data.p_last_name:
            handover_data.p_last_name = patient.last_name
        if not handover_data.p_room_number:
            handover_data.p_room_number = patient.room_number
        if handover_data.p_bed is None:
            handover_data.p_bed = patient.bed
        if not handover_data.p_mrn:
            handover_data.p_mrn = patient.mrn
        if not handover_data.p_diagnosis:
            handover_data.p_diagnosis = patient.diagnosis
        if handover_data.p_date_of_birth is None:
            handover_data.p_date_of_birth = patient.date_of_birth
        if not handover_data.p_age:
            handover_data.p_age = patient.age
        if not handover_data.p_attending_physician:
            handover_data.p_attending_physician = patient.attending_physician
    else:
        # Embedded mode — require at minimum a name and room
        if not handover_data.p_first_name or not handover_data.p_last_name:
            raise HTTPException(
                status_code=400,
                detail="Either patient_id or patient name (p_first_name, p_last_name) is required"
            )
    
    # Build a dedup key from embedded patient info or patient_id
    dedup_patient_key = handover_data.patient_id
    if not dedup_patient_key:
        # Use name+room as dedup key when there's no patient_id
        dedup_patient_key = f"{handover_data.p_first_name}_{handover_data.p_last_name}_{handover_data.p_room_number}"
    
    # Check for existing draft handover for same patient/shift
    existing_query = db.query(Handover).filter(
        Handover.shift_date >= datetime.combine(handover_data.shift_date.date(), datetime.min.time()),
        Handover.shift_date < datetime.combine(handover_data.shift_date.date(), datetime.max.time()),
        Handover.shift_type == handover_data.shift_type.value,
        Handover.is_completed == False
    )
    
    if handover_data.patient_id:
        existing_query = existing_query.filter(Handover.patient_id == handover_data.patient_id)
    else:
        existing_query = existing_query.filter(
            Handover.p_first_name == handover_data.p_first_name,
            Handover.p_last_name == handover_data.p_last_name,
            Handover.p_room_number == handover_data.p_room_number,
        )
    
    if org_id:
        existing_query = existing_query.filter(Handover.organization_id == org_id)
    
    if existing_query.first():
        raise HTTPException(
            status_code=400,
            detail="A draft handover already exists for this patient and shift"
        )
    
    # Handle optional acuity field (provide default if not present)
    acuity_value = AcuityLevel.MODERATE
    if handover_data.acuity:
        # Convert schema enum to model enum
        acuity_value = AcuityLevel(handover_data.acuity.value)
    
    handover = Handover(
        **handover_data.model_dump(exclude={'status', 'acuity', 'isolation', 'shift_type'}),
        organization_id=org_id,
        status=PatientStatus(handover_data.status.value),
        acuity=acuity_value,
        isolation=IsolationType(handover_data.isolation.value),
        shift_type=handover_data.shift_type.value,
    )
    db.add(handover)
    db.commit()
    db.refresh(handover)
    
    # Load patient relationship
    handover = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(Handover.id == handover.id).first()

    # Audit: log creation
    if auth.is_authenticated:
        patient_label = f"{handover.p_last_name}, {handover.p_first_name}" if handover.p_last_name else handover.patient_id or "unknown"
        log_audit(
            db, request,
            user_id=auth.user_id,
            organization_id=org_id,
            action="create",
            resource_type="handover",
            resource_id=handover.id,
            detail=f"Created {handover.shift_type} handover for {patient_label}",
        )
        db.commit()
    
    return handover


@router.put("/{handover_id}", response_model=HandoverResponse)
def update_handover(
    handover_id: str,
    handover_data: HandoverUpdate,
    auth: OptionalAuth,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Update a handover record.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot access any handover
        raise HTTPException(status_code=404, detail="Handover not found")
    
    handover = query.first()
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")
    
    if handover.is_completed:
        raise HTTPException(status_code=400, detail="Cannot modify a completed handover")
    
    # Capture old field values for audit diff
    old_values = {c.key: getattr(handover, c.key) for c in Handover.__table__.columns}
    
    update_data = handover_data.model_dump(exclude_unset=True)
    
    # Handle enum conversions
    if 'status' in update_data and update_data['status']:
        update_data['status'] = PatientStatus(update_data['status'].value)
    if 'acuity' in update_data and update_data['acuity']:
        update_data['acuity'] = AcuityLevel(update_data['acuity'].value)
    if 'isolation' in update_data and update_data['isolation']:
        update_data['isolation'] = IsolationType(update_data['isolation'].value)
    
    for field, value in update_data.items():
        setattr(handover, field, value)
    
    db.commit()
    db.refresh(handover)
    
    # Load patient relationship
    handover = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(Handover.id == handover.id).first()

    # Audit: log update with diff
    if auth.is_authenticated:
        new_values = {k: update_data.get(k) for k in update_data}
        changed, summary = diff_fields(old_values, new_values)
        if changed:
            log_audit(
                db, request,
                user_id=auth.user_id,
                organization_id=auth.organization_id,
                action="update",
                resource_type="handover",
                resource_id=handover_id,
                detail=summary or "Fields updated",
                changed_fields=changed,
            )
            db.commit()
    
    return handover


@router.post("/{handover_id}/complete", response_model=HandoverResponse)
def complete_handover(
    handover_id: str,
    complete_data: HandoverComplete,
    auth: OptionalAuth,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Mark a handover as completed.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter strictly by organization - no access without auth
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot access any handover
        raise HTTPException(status_code=404, detail="Handover not found")
    
    handover = query.first()
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")
    
    if handover.is_completed:
        raise HTTPException(status_code=400, detail="Handover already completed")
    
    handover.incoming_nurse = complete_data.incoming_nurse
    handover.is_completed = True
    handover.is_draft = False
    handover.completed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(handover)
    
    # Load patient relationship
    handover = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(Handover.id == handover.id).first()

    # Audit: log completion
    if auth.is_authenticated:
        patient_label = f"{handover.p_last_name}, {handover.p_first_name}" if handover.p_last_name else handover.patient_id or "unknown"
        log_audit(
            db, request,
            user_id=auth.user_id,
            organization_id=auth.organization_id,
            action="complete",
            resource_type="handover",
            resource_id=handover_id,
            detail=f"Completed handover for {patient_label}, incoming: {complete_data.incoming_nurse}",
        )
        db.commit()
    
    return handover


@router.delete("/{handover_id}", status_code=204)
def delete_handover(handover_id: str, auth: OptionalAuth, request: Request, db: Session = Depends(get_db)):
    """
    Delete a handover record.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot access any handover
        raise HTTPException(status_code=404, detail="Handover not found")
    
    handover = query.first()
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    patient_name = "Unknown patient"
    if handover.patient:
        patient_name = handover.patient.full_name
    elif handover.p_first_name:
        patient_name = f"{handover.p_last_name}, {handover.p_first_name}"
    
    shift_label = (handover.shift_type or "Unknown").capitalize()
    shift_date = handover.shift_date.strftime("%m/%d/%Y") if handover.shift_date else "Unknown date"

    record_deletion_activity(
        db,
        object_type="handover",
        object_id=handover.id,
        object_label=patient_name,
        details=f"{shift_label} shift • {shift_date}",
        auth=auth,
        organization_id=handover.organization_id,
    )
    # Audit: log deletion
    if auth.is_authenticated:
        log_audit(
            db, request,
            user_id=auth.user_id,
            organization_id=auth.organization_id,
            action="delete",
            resource_type="handover",
            resource_id=handover.id,
            detail=f"Deleted {shift_label} handover for {patient_name} ({shift_date})",
        )
    db.delete(handover)
    db.commit()
    return None


@router.post("/bulk", response_model=List[HandoverResponse], status_code=201)
def create_handovers_bulk(
    bulk_data: BulkHandoverCreate,
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Create handover drafts for multiple patients at once. Requires authentication.
    Useful for starting end-of-shift handover process.
    """
    if not auth.is_authenticated or not auth.organization_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    org_id = auth.organization_id
    created_handovers = []
    
    for patient_id in bulk_data.patient_ids:
        # Verify patient exists
        patient_query = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.organization_id == org_id
        )
        patient = patient_query.first()
        if not patient:
            continue
        
        # Skip if handover already exists
        existing_query = db.query(Handover).filter(
            Handover.patient_id == patient_id,
            Handover.shift_date >= datetime.combine(bulk_data.shift_date.date(), datetime.min.time()),
            Handover.shift_date < datetime.combine(bulk_data.shift_date.date(), datetime.max.time()),
            Handover.shift_type == bulk_data.shift_type.value,
            Handover.is_completed == False,
            Handover.organization_id == org_id
        )
        
        if existing_query.first():
            continue
        
        handover = Handover(
            patient_id=patient_id,
            organization_id=org_id,
            shift_date=bulk_data.shift_date,
            shift_type=bulk_data.shift_type.value,
            outgoing_nurse=bulk_data.outgoing_nurse,
        )
        db.add(handover)
        created_handovers.append(handover)
    
    db.commit()
    
    # Refresh and load relationships
    result = []
    for handover in created_handovers:
        db.refresh(handover)
        h = db.query(Handover).options(
            joinedload(Handover.patient)
        ).filter(Handover.id == handover.id).first()
        result.append(h)
    
    return result


@router.get("/patient/{patient_id}/latest", response_model=Optional[HandoverResponse])
def get_latest_handover_for_patient(
    patient_id: str,
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Get the most recent handover for a specific patient.
    Useful for pre-populating new handover with previous data.
    """
    query = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(
        Handover.patient_id == patient_id
    )
    
    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot access any handover
        return None
    
    handover = query.order_by(
        Handover.shift_date.desc(),
        Handover.updated_at.desc(),
        Handover.created_at.desc(),
    ).first()
    
    return handover


@router.get("/patient/{patient_id}/history", response_model=HandoverListResponse)
def get_handover_history_for_patient(
    patient_id: str,
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of historical handovers to return"),
):
    """
    Get all handovers for a specific patient, ordered by most recent first.
    Used for the 'View History' feature in the hand-off report page.
    """
    query = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(
        Handover.patient_id == patient_id
    )

    # Filter strictly by organization - no legacy NULL fallback to prevent data leakage
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> return empty list
        return HandoverListResponse(handovers=[], total=0)

    total = query.count()
    handovers = query.order_by(
        Handover.shift_date.desc(),
        Handover.updated_at.desc(),
        Handover.created_at.desc(),
    ).limit(limit).all()

    return HandoverListResponse(handovers=handovers, total=total)


@router.delete("/cleanup", status_code=200)
def cleanup_old_handovers(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    days_to_keep: int = Query(30, ge=1, le=365, description="Delete handovers older than this many days")
):
    """
    Delete handovers older than a specified number of days.
    This helps prevent database overflow from old records.
    
    Args:
        days_to_keep: Number of days to keep handovers (default: 30, min: 1, max: 365)
    
    Returns:
        Number of deleted handovers
    """
    from datetime import timedelta
    
    cutoff_date = datetime.now() - timedelta(days=days_to_keep)
    
    # Build query for handovers to delete
    query = db.query(Handover).filter(
        Handover.shift_date < cutoff_date
    )
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    else:
        # No auth or no organization -> cannot perform cleanup
        raise HTTPException(status_code=403, detail="Organization membership required for cleanup")
    
    # Count before deleting
    count = query.count()
    
    # Delete the handovers
    query.delete(synchronize_session=False)
    db.commit()
    
    return {
        "deleted_count": count,
        "cutoff_date": cutoff_date.isoformat(),
        "days_kept": days_to_keep,
        "message": f"Deleted {count} handovers older than {days_to_keep} days"
    }
