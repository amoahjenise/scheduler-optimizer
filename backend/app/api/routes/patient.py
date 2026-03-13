"""API routes for Patient management."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.deps import get_db
from app.models.patient import Patient
from app.schemas.patient import (
    PatientCreate,
    PatientUpdate,
    PatientResponse,
    PatientListResponse,
)
from app.core.auth import OptionalAuth
from app.services.deletion_activity import record_deletion_activity

router = APIRouter()


@router.get("/", response_model=PatientListResponse)
def get_patients(
    auth: OptionalAuth,
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    active_only: bool = Query(True, description="Only return active patients"),
    search: Optional[str] = Query(None, description="Search by name or MRN"),
):
    """
    Get all patients with optional filtering.
    """
    query = db.query(Patient)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Patient.organization_id == auth.organization_id)
    
    if active_only:
        query = query.filter(Patient.is_active == True)
    
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (Patient.first_name.ilike(search_term)) |
            (Patient.last_name.ilike(search_term)) |
            (Patient.mrn.ilike(search_term))
        )
    
    total = query.count()
    patients = query.order_by(Patient.room_number).offset(skip).limit(limit).all()
    
    return PatientListResponse(patients=patients, total=total)


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: str, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Get a specific patient by ID.
    """
    query = db.query(Patient).filter(Patient.id == patient_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Patient.organization_id == auth.organization_id)
    
    patient = query.first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@router.post("/", response_model=PatientResponse, status_code=201)
def create_patient(patient_data: PatientCreate, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Create a new patient.
    """
    org_id = auth.organization_id if auth.is_authenticated else None
    
    # Check if MRN already exists for active patient (only when MRN is provided)
    if patient_data.mrn and patient_data.mrn.strip():
        existing_query = db.query(Patient).filter(
            Patient.mrn == patient_data.mrn,
            Patient.is_active == True
        )
        if org_id:
            existing_query = existing_query.filter(Patient.organization_id == org_id)
        
        if existing_query.first():
            raise HTTPException(
                status_code=400,
                detail=f"Active patient with MRN {patient_data.mrn} already exists"
            )
    
    patient = Patient(**patient_data.model_dump(), organization_id=org_id)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@router.put("/{patient_id}", response_model=PatientResponse)
def update_patient(
    patient_id: str,
    patient_data: PatientUpdate,
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Update a patient's information.
    """
    query = db.query(Patient).filter(Patient.id == patient_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Patient.organization_id == auth.organization_id)
    
    patient = query.first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    update_data = patient_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(patient, field, value)
    
    db.commit()
    db.refresh(patient)
    return patient


@router.delete("/{patient_id}", status_code=204)
def delete_patient(patient_id: str, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Soft delete a patient (mark as inactive).
    """
    query = db.query(Patient).filter(Patient.id == patient_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Patient.organization_id == auth.organization_id)
    
    patient = query.first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    room_details = f"Room {patient.room_number}"
    if patient.bed:
        room_details += f" • Bed {patient.bed}"

    record_deletion_activity(
        db,
        object_type="patient",
        object_id=patient.id,
        object_label=patient.full_name,
        details=room_details,
        auth=auth,
        organization_id=patient.organization_id,
    )
    patient.is_active = False
    db.commit()
    return None


@router.post("/{patient_id}/reactivate", response_model=PatientResponse)
def reactivate_patient(patient_id: str, auth: OptionalAuth, db: Session = Depends(get_db)):
    """
    Reactivate a discharged patient.
    """
    query = db.query(Patient).filter(Patient.id == patient_id)
    
    # Filter by organization if available
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Patient.organization_id == auth.organization_id)
    
    patient = query.first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    patient.is_active = True
    db.commit()
    db.refresh(patient)
    return patient


@router.post("/bulk", response_model=List[PatientResponse], status_code=201)
def create_patients_bulk(
    patients_data: List[PatientCreate],
    auth: OptionalAuth,
    db: Session = Depends(get_db)
):
    """
    Create multiple patients at once.
    Useful for initial data import.
    """
    org_id = auth.organization_id if auth.is_authenticated else None
    created_patients = []
    
    for patient_data in patients_data:
        # Skip if MRN already exists
        existing_query = db.query(Patient).filter(
            Patient.mrn == patient_data.mrn,
            Patient.is_active == True
        )
        if org_id:
            existing_query = existing_query.filter(Patient.organization_id == org_id)
        
        existing = existing_query.first()
        
        if existing:
            continue
        
        patient = Patient(**patient_data.model_dump(), organization_id=org_id)
        db.add(patient)
        created_patients.append(patient)
    
    db.commit()
    
    for patient in created_patients:
        db.refresh(patient)
    
    return created_patients
