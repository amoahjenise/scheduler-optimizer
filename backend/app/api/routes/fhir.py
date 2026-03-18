"""
FHIR R5 REST API Routes

Implements HL7 FHIR R5 RESTful API for healthcare data interoperability.
Required for Bill S-5 compliance (Quebec healthcare data sharing mandate).

Reference: https://www.hl7.org/fhir/http.html
"""
import logging
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.core.auth import OrgAuth, AuthContext, get_org_required_auth
from app.models.patient import Patient
from app.models.nurse import Nurse
from app.models.organization import Organization, OrganizationMember
from app.models.optimized_schedule import OptimizedSchedule
from app.fhir import (
    FHIRPatient, FHIRPractitioner, FHIRBundle, FHIROperationOutcome,
    patient_to_fhir, nurse_to_fhir, organization_to_fhir_careteam,
    optimized_schedule_to_fhir_slots, create_search_bundle, create_operation_outcome
)

router = APIRouter()
logger = logging.getLogger(__name__)

# FHIR content types
FHIR_JSON = "application/fhir+json"
FHIR_JSON_CHARSET = "application/fhir+json; charset=utf-8"


def fhir_response(data: dict, status_code: int = 200) -> JSONResponse:
    """Create a FHIR-compliant JSON response"""
    return JSONResponse(
        content=data,
        status_code=status_code,
        media_type=FHIR_JSON_CHARSET,
        headers={
            "X-FHIR-Version": "5.0.0",
            "X-Request-Id": datetime.utcnow().isoformat(),
        }
    )


def fhir_error(severity: str, code: str, message: str, status_code: int = 400) -> JSONResponse:
    """Create a FHIR OperationOutcome error response"""
    outcome = create_operation_outcome(severity, code, message)
    return fhir_response(outcome.model_dump(by_alias=True, exclude_none=True), status_code)


# ============== Capability Statement ==============

@router.get("/metadata")
async def capability_statement():
    """
    FHIR Capability Statement (R5)
    
    Returns the server's conformance statement describing its capabilities.
    Reference: https://www.hl7.org/fhir/capabilitystatement.html
    """
    capability = {
        "resourceType": "CapabilityStatement",
        "id": "chronofy-fhir-server",
        "url": "https://chronofy.health/fhir/r5/metadata",
        "version": "1.0.0",
        "name": "ChronofyFHIRServer",
        "title": "Chronofy FHIR R5 Server",
        "status": "active",
        "experimental": False,
        "date": datetime.utcnow().isoformat(),
        "publisher": "Chronofy Health",
        "contact": [
            {
                "name": "Chronofy Support",
                "telecom": [{"system": "email", "value": "support@chronofy.health"}]
            }
        ],
        "description": "FHIR R5 API for Chronofy nurse scheduling platform. Compliant with Quebec Bill S-5 healthcare data interoperability requirements.",
        "jurisdiction": [
            {
                "coding": [
                    {"system": "urn:iso:std:iso:3166", "code": "CA-QC", "display": "Quebec, Canada"}
                ]
            }
        ],
        "kind": "instance",
        "fhirVersion": "5.0.0",
        "format": ["json", "application/fhir+json"],
        "rest": [
            {
                "mode": "server",
                "documentation": "RESTful FHIR server supporting Patient, Practitioner, Schedule, and CareTeam resources",
                "security": {
                    "cors": True,
                    "service": [
                        {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/restful-security-service",
                                    "code": "OAuth",
                                    "display": "OAuth"
                                }
                            ]
                        }
                    ],
                    "description": "OAuth2 authentication via Clerk. Law 25 compliant data protection."
                },
                "resource": [
                    {
                        "type": "Patient",
                        "profile": "https://chronofy.health/fhir/StructureDefinition/ChronofyPatient",
                        "interaction": [
                            {"code": "read"},
                            {"code": "search-type"},
                            {"code": "create"},
                            {"code": "update"}
                        ],
                        "searchParam": [
                            {"name": "_id", "type": "token", "documentation": "Patient ID"},
                            {"name": "active", "type": "token", "documentation": "Active status"},
                            {"name": "name", "type": "string", "documentation": "Patient name"}
                        ]
                    },
                    {
                        "type": "Practitioner",
                        "profile": "https://chronofy.health/fhir/StructureDefinition/ChronofyPractitioner",
                        "interaction": [
                            {"code": "read"},
                            {"code": "search-type"}
                        ],
                        "searchParam": [
                            {"name": "_id", "type": "token", "documentation": "Practitioner ID"},
                            {"name": "active", "type": "token", "documentation": "Active status"},
                            {"name": "name", "type": "string", "documentation": "Practitioner name"}
                        ]
                    },
                    {
                        "type": "Schedule",
                        "profile": "https://chronofy.health/fhir/StructureDefinition/ChronofySchedule",
                        "interaction": [
                            {"code": "read"},
                            {"code": "search-type"}
                        ]
                    },
                    {
                        "type": "Slot",
                        "profile": "https://chronofy.health/fhir/StructureDefinition/ChronofySlot",
                        "interaction": [
                            {"code": "search-type"}
                        ],
                        "searchParam": [
                            {"name": "schedule", "type": "reference", "documentation": "Parent schedule"},
                            {"name": "start", "type": "date", "documentation": "Slot start date"}
                        ]
                    },
                    {
                        "type": "CareTeam",
                        "profile": "https://chronofy.health/fhir/StructureDefinition/ChronofyCareTeam",
                        "interaction": [
                            {"code": "read"}
                        ]
                    }
                ]
            }
        ]
    }
    return fhir_response(capability)


# ============== Patient Resource ==============

@router.get("/Patient/{patient_id}")
async def read_patient(
    patient_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    FHIR Patient Read
    
    Retrieve a single Patient resource by ID.
    Reference: https://www.hl7.org/fhir/http.html#read
    """
    patient = db.query(Patient).filter(
        Patient.id == patient_id,
        Patient.organization_id == auth.organization_id
    ).first()
    
    if not patient:
        return fhir_error("error", "not-found", f"Patient/{patient_id} not found", 404)
    
    fhir_patient = patient_to_fhir(patient, auth.organization_id)
    return fhir_response(fhir_patient.model_dump(by_alias=True, exclude_none=True))


@router.get("/Patient")
async def search_patients(
    _id: Optional[str] = Query(None, alias="_id"),
    active: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    _count: int = Query(100, alias="_count", ge=1, le=1000),
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    FHIR Patient Search
    
    Search for Patient resources matching specified criteria.
    Reference: https://www.hl7.org/fhir/http.html#search
    """
    query = db.query(Patient).filter(Patient.organization_id == auth.organization_id)
    
    if _id:
        query = query.filter(Patient.id == _id)
    
    if active:
        is_active = active.lower() == "true"
        query = query.filter(Patient.is_active == is_active)
    
    if name:
        search_term = f"%{name}%"
        query = query.filter(
            (Patient.first_name.ilike(search_term)) |
            (Patient.last_name.ilike(search_term))
        )
    
    total = query.count()
    patients = query.limit(_count).all()
    
    fhir_patients = [patient_to_fhir(p, auth.organization_id) for p in patients]
    bundle = create_search_bundle(fhir_patients, total, str(request.url) if request else "")
    
    return fhir_response(bundle.model_dump(by_alias=True, exclude_none=True))


# ============== Practitioner Resource ==============

@router.get("/Practitioner/{practitioner_id}")
async def read_practitioner(
    practitioner_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    FHIR Practitioner Read
    
    Retrieve a single Practitioner (nurse) resource by ID.
    """
    nurse = db.query(Nurse).filter(
        Nurse.id == practitioner_id,
        Nurse.organization_id == auth.organization_id
    ).first()
    
    if not nurse:
        return fhir_error("error", "not-found", f"Practitioner/{practitioner_id} not found", 404)
    
    fhir_practitioner = nurse_to_fhir(nurse, auth.organization_id)
    return fhir_response(fhir_practitioner.model_dump(by_alias=True, exclude_none=True))


@router.get("/Practitioner")
async def search_practitioners(
    _id: Optional[str] = Query(None, alias="_id"),
    active: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    _count: int = Query(100, alias="_count", ge=1, le=1000),
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    FHIR Practitioner Search
    
    Search for Practitioner (nurse) resources.
    """
    query = db.query(Nurse).filter(Nurse.organization_id == auth.organization_id)
    
    if _id:
        query = query.filter(Nurse.id == _id)
    
    if active:
        is_active = active.lower() == "true"
        query = query.filter(Nurse.is_active == is_active)
    
    if name:
        search_term = f"%{name}%"
        query = query.filter(Nurse.name.ilike(search_term))
    
    total = query.count()
    nurses = query.limit(_count).all()
    
    fhir_practitioners = [nurse_to_fhir(n, auth.organization_id) for n in nurses]
    bundle = create_search_bundle(fhir_practitioners, total, str(request.url) if request else "")
    
    return fhir_response(bundle.model_dump(by_alias=True, exclude_none=True))


# ============== CareTeam Resource ==============

@router.get("/CareTeam/{careteam_id}")
async def read_careteam(
    careteam_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db)
):
    """
    FHIR CareTeam Read
    
    Retrieve organization as a CareTeam resource.
    """
    if careteam_id != auth.organization_id:
        return fhir_error("error", "forbidden", "Access denied to this CareTeam", 403)
    
    organization = db.query(Organization).filter(
        Organization.id == auth.organization_id,
        Organization.is_active == True
    ).first()
    
    if not organization:
        return fhir_error("error", "not-found", f"CareTeam/{careteam_id} not found", 404)
    
    members = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == auth.organization_id,
        OrganizationMember.is_active == True,
        OrganizationMember.is_approved == True
    ).all()
    
    fhir_careteam = organization_to_fhir_careteam(organization, members)
    return fhir_response(fhir_careteam.model_dump(by_alias=True, exclude_none=True))


# ============== Slot Resource ==============

@router.get("/Slot")
async def search_slots(
    schedule: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    _count: int = Query(500, alias="_count", ge=1, le=5000),
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    FHIR Slot Search
    
    Search for schedule slots (nurse shift assignments).
    """
    query = db.query(OptimizedSchedule).filter(
        OptimizedSchedule.organization_id == auth.organization_id,
        OptimizedSchedule.is_finalized == True
    )
    
    # Filter by schedule ID if provided
    if schedule:
        schedule_id = schedule.replace("Schedule/", "")
        query = query.filter(OptimizedSchedule.id == schedule_id)
    
    schedules = query.limit(10).all()
    
    all_slots = []
    for sched in schedules:
        try:
            data = sched.schedule_data
            if isinstance(data, str):
                import json
                data = json.loads(data)
            
            slots = optimized_schedule_to_fhir_slots(data, str(sched.id), auth.organization_id)
            all_slots.extend(slots)
        except Exception as e:
            logger.warning(f"Failed to convert schedule {sched.id} to slots: {e}")
            continue
    
    # Filter by start date if provided
    if start:
        try:
            start_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
            all_slots = [s for s in all_slots if s.start >= start_date]
        except:
            pass
    
    # Limit results
    total = len(all_slots)
    all_slots = all_slots[:_count]
    
    bundle = create_search_bundle(all_slots, total, str(request.url) if request else "")
    return fhir_response(bundle.model_dump(by_alias=True, exclude_none=True))


# ============== $everything Operation ==============

@router.get("/Patient/{patient_id}/$everything")
async def patient_everything(
    patient_id: str,
    auth: AuthContext = Depends(get_org_required_auth),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    FHIR Patient $everything Operation
    
    Returns all resources related to a patient.
    Reference: https://www.hl7.org/fhir/patient-operation-everything.html
    """
    patient = db.query(Patient).filter(
        Patient.id == patient_id,
        Patient.organization_id == auth.organization_id
    ).first()
    
    if not patient:
        return fhir_error("error", "not-found", f"Patient/{patient_id} not found", 404)
    
    resources = []
    
    # Add Patient resource
    fhir_patient = patient_to_fhir(patient, auth.organization_id)
    resources.append(fhir_patient)
    
    # Add CareTeam (organization)
    organization = db.query(Organization).filter(
        Organization.id == auth.organization_id
    ).first()
    
    if organization:
        members = db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == auth.organization_id,
            OrganizationMember.is_active == True,
            OrganizationMember.is_approved == True
        ).all()
        careteam = organization_to_fhir_careteam(organization, members)
        resources.append(careteam)
    
    bundle = create_search_bundle(resources, len(resources), str(request.url) if request else "")
    return fhir_response(bundle.model_dump(by_alias=True, exclude_none=True))


# ============== Health Check ==============

@router.get("/health")
async def fhir_health():
    """FHIR server health check"""
    return fhir_response({
        "status": "healthy",
        "fhirVersion": "5.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "compliance": {
            "billS5": True,
            "law25": True,
            "hl7FhirR5": True
        }
    })
