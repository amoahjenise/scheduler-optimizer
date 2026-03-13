"""API routes for Handover management."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime, date
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
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
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
    
    total = query.count()
    handovers = query.order_by(Handover.created_at.desc()).offset(skip).limit(limit).all()
    
    return HandoverListResponse(handovers=handovers, total=total)


@router.get("/today", response_model=HandoverListResponse)
def get_todays_handovers(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    shift_type: Optional[str] = Query(None, description="Filter by shift type"),
):
    """
    Get all handovers for today's date.
    """
    today = date.today()
    query = db.query(Handover).options(joinedload(Handover.patient)).filter(
        Handover.shift_date >= datetime.combine(today, datetime.min.time()),
        Handover.shift_date < datetime.combine(today, datetime.max.time())
    )
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
    if shift_type:
        query = query.filter(Handover.shift_type == shift_type)
    
    # Return only the most recent handover per patient + shift for today.
    # This prevents inflated counts when duplicate rows exist.
    ordered = query.order_by(Handover.updated_at.desc(), Handover.created_at.desc()).all()

    deduped: list[Handover] = []
    seen_keys = set()
    for handover in ordered:
        key = (handover.patient_id, handover.shift_type)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(handover)

    return HandoverListResponse(handovers=deduped, total=len(deduped))


@router.get("/{handover_id}", response_model=HandoverResponse)
def get_handover(handover_id: str, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Get a specific handover by ID.
    """
    query = db.query(Handover).options(
        joinedload(Handover.patient)
    ).filter(Handover.id == handover_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
    handover = query.first()
    
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")
    return handover


@router.post("/", response_model=HandoverResponse, status_code=201)
def create_handover(handover_data: HandoverCreate, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Create a new handover record.
    """
    org_id = auth.organization_id if auth.is_authenticated else None
    
    # Verify patient exists
    patient_query = db.query(Patient).filter(Patient.id == handover_data.patient_id)
    if org_id:
        patient_query = patient_query.filter(Patient.organization_id == org_id)
    patient = patient_query.first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Check for existing draft handover for same patient/shift
    existing_query = db.query(Handover).filter(
        Handover.patient_id == handover_data.patient_id,
        Handover.shift_date >= datetime.combine(handover_data.shift_date.date(), datetime.min.time()),
        Handover.shift_date < datetime.combine(handover_data.shift_date.date(), datetime.max.time()),
        Handover.shift_type == handover_data.shift_type.value,
        Handover.is_completed == False
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
    
    return handover


@router.put("/{handover_id}", response_model=HandoverResponse)
def update_handover(
    handover_id: str,
    handover_data: HandoverUpdate,
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Update a handover record.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
    handover = query.first()
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")
    
    if handover.is_completed:
        raise HTTPException(status_code=400, detail="Cannot modify a completed handover")
    
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
    
    return handover


@router.post("/{handover_id}/complete", response_model=HandoverResponse)
def complete_handover(
    handover_id: str,
    complete_data: HandoverComplete,
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Mark a handover as completed.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
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
    
    return handover


@router.delete("/{handover_id}", status_code=204)
def delete_handover(handover_id: str, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Delete a handover record.
    """
    query = db.query(Handover).filter(Handover.id == handover_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
    handover = query.first()
    if not handover:
        raise HTTPException(status_code=404, detail="Handover not found")

    patient_name = handover.patient.full_name if handover.patient else "Unknown patient"
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
    Create handover drafts for multiple patients at once.
    Useful for starting end-of-shift handover process.
    """
    org_id = auth.organization_id if auth.is_authenticated else None
    created_handovers = []
    
    for patient_id in bulk_data.patient_ids:
        # Verify patient exists
        patient_query = db.query(Patient).filter(Patient.id == patient_id)
        if org_id:
            patient_query = patient_query.filter(Patient.organization_id == org_id)
        patient = patient_query.first()
        if not patient:
            continue
        
        # Skip if handover already exists
        existing_query = db.query(Handover).filter(
            Handover.patient_id == patient_id,
            Handover.shift_date >= datetime.combine(bulk_data.shift_date.date(), datetime.min.time()),
            Handover.shift_date < datetime.combine(bulk_data.shift_date.date(), datetime.max.time()),
            Handover.shift_type == bulk_data.shift_type.value,
            Handover.is_completed == False
        )
        if org_id:
            existing_query = existing_query.filter(Handover.organization_id == org_id)
        
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
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Handover.organization_id == auth.organization_id)
    
    handover = query.order_by(
        Handover.shift_date.desc(),
        Handover.updated_at.desc(),
        Handover.created_at.desc(),
    ).first()
    
    return handover


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
