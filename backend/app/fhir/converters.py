"""
FHIR Resource Converters

Convert between internal Chronofy models and FHIR R5 resources.
This enables interoperability with other healthcare systems per Bill S-5.
"""
from datetime import datetime
from typing import Optional, List
from uuid import uuid4

from app.fhir.resources import (
    FHIRPatient, FHIRPractitioner, FHIRSchedule, FHIRSlot,
    FHIRAppointment, FHIRCareTeam, FHIRBundle, FHIRConsent,
    FHIRAuditEvent, FHIROperationOutcome,
    Identifier, HumanName, ContactPoint, CodeableConcept, Coding,
    Reference, Period, Meta, BundleEntry, SlotStatus, AppointmentStatus,
    CareTeamParticipant, AuditEventAgent, AuditEventSource, AuditEventEntity,
    OperationOutcomeIssue
)
from app.models.patient import Patient
from app.models.nurse import Nurse
from app.models.organization import Organization, OrganizationMember

# Quebec-specific FHIR profiles and systems
QUEBEC_HEALTH_ID_SYSTEM = "urn:oid:2.16.124.10.101.1.60.100"  # Placeholder for RAMQ
CHRONOFY_SYSTEM = "https://chronofy.health/fhir"


def generate_fhir_id() -> str:
    """Generate a FHIR-compliant resource ID"""
    return str(uuid4())


def to_fhir_datetime(dt: datetime) -> str:
    """Convert datetime to FHIR instant format"""
    return dt.isoformat() if dt else None


# ============== Patient Conversions ==============

def patient_to_fhir(patient: Patient, organization_id: Optional[str] = None) -> FHIRPatient:
    """Convert internal Patient model to FHIR Patient resource"""
    return FHIRPatient(
        id=str(patient.id),
        meta=Meta(
            lastUpdated=patient.updated_at or patient.created_at,
            source=f"{CHRONOFY_SYSTEM}/organizations/{organization_id}" if organization_id else CHRONOFY_SYSTEM,
            profile=[f"{CHRONOFY_SYSTEM}/StructureDefinition/ChronofyPatient"]
        ),
        identifier=[
            Identifier(
                use="usual",
                system=CHRONOFY_SYSTEM,
                value=str(patient.id)
            )
        ],
        active=patient.is_active,
        name=[
            HumanName(
                use="official",
                family=patient.last_name,
                given=[patient.first_name] if patient.first_name else [],
                text=f"{patient.first_name} {patient.last_name}".strip()
            )
        ],
        communication=[
            {
                "language": CodeableConcept(
                    coding=[Coding(system="urn:ietf:bcp:47", code="fr-CA", display="French (Canada)")],
                    text="French (Canada)"
                ),
                "preferred": True
            }
        ],
        managingOrganization=Reference(
            reference=f"Organization/{organization_id}",
            type="Organization"
        ) if organization_id else None
    )


def fhir_to_patient(fhir_patient: FHIRPatient) -> dict:
    """Convert FHIR Patient resource to internal patient data dict"""
    name = fhir_patient.name[0] if fhir_patient.name else None
    return {
        "first_name": name.given[0] if name and name.given else "",
        "last_name": name.family if name else "",
        "is_active": fhir_patient.active if fhir_patient.active is not None else True,
    }


# ============== Practitioner (Nurse) Conversions ==============

def nurse_to_fhir(nurse: Nurse, organization_id: Optional[str] = None) -> FHIRPractitioner:
    """Convert internal Nurse model to FHIR Practitioner resource"""
    name_parts = nurse.name.split(" ", 1) if nurse.name else ["", ""]
    given_name = name_parts[0]
    family_name = name_parts[1] if len(name_parts) > 1 else ""
    
    telecom = []
    if nurse.phone:
        telecom.append(ContactPoint(system="phone", value=nurse.phone, use="work"))
    if nurse.email:
        telecom.append(ContactPoint(system="email", value=nurse.email, use="work"))
    
    qualifications = []
    # Add nursing qualification
    qualifications.append({
        "code": CodeableConcept(
            coding=[Coding(
                system="http://terminology.hl7.org/CodeSystem/v2-0360",
                code="RN",
                display="Registered Nurse"
            )],
            text="Infirmière autorisée" if nurse.employment_type else "Registered Nurse"
        )
    })
    
    return FHIRPractitioner(
        id=str(nurse.id),
        meta=Meta(
            lastUpdated=nurse.updated_at or nurse.created_at,
            source=f"{CHRONOFY_SYSTEM}/organizations/{organization_id}" if organization_id else CHRONOFY_SYSTEM,
            profile=[f"{CHRONOFY_SYSTEM}/StructureDefinition/ChronofyPractitioner"]
        ),
        identifier=[
            Identifier(
                use="usual",
                system=CHRONOFY_SYSTEM,
                value=str(nurse.id)
            )
        ],
        active=nurse.is_active,
        name=[
            HumanName(
                use="official",
                family=family_name,
                given=[given_name] if given_name else [],
                text=nurse.name
            )
        ],
        telecom=telecom,
        qualification=qualifications,
        communication=[
            CodeableConcept(
                coding=[Coding(system="urn:ietf:bcp:47", code="fr-CA", display="French (Canada)")],
                text="French (Canada)"
            )
        ]
    )


# ============== Schedule Conversions ==============

def optimized_schedule_to_fhir_slots(
    schedule_data: dict,
    schedule_id: str,
    organization_id: Optional[str] = None
) -> List[FHIRSlot]:
    """Convert optimized schedule data to FHIR Slot resources"""
    slots = []
    
    grid = schedule_data.get("grid", [])
    for row in grid:
        nurse_name = row.get("nurse", "")
        shifts = row.get("shifts", [])
        
        for shift in shifts:
            date_str = shift.get("date", "")
            shift_code = shift.get("code", "")
            
            if not date_str or not shift_code or shift_code in ["OFF", "RDO", "VAC"]:
                continue
            
            # Determine shift times based on code
            start_hour = 7 if shift_code.startswith("D") else 19
            end_hour = 19 if shift_code.startswith("D") else 7
            
            try:
                start_dt = datetime.fromisoformat(f"{date_str}T{start_hour:02d}:00:00")
                if end_hour < start_hour:
                    # Night shift ends next day
                    end_date = datetime.fromisoformat(date_str) 
                    end_date = end_date.replace(day=end_date.day + 1)
                    end_dt = datetime.fromisoformat(f"{end_date.date()}T{end_hour:02d}:00:00")
                else:
                    end_dt = datetime.fromisoformat(f"{date_str}T{end_hour:02d}:00:00")
            except:
                continue
            
            slots.append(FHIRSlot(
                id=f"{schedule_id}-{nurse_name.replace(' ', '-')}-{date_str}",
                meta=Meta(
                    source=f"{CHRONOFY_SYSTEM}/organizations/{organization_id}" if organization_id else CHRONOFY_SYSTEM
                ),
                identifier=[
                    Identifier(system=CHRONOFY_SYSTEM, value=f"{schedule_id}-{date_str}-{shift_code}")
                ],
                serviceType=[
                    CodeableConcept(
                        coding=[Coding(
                            system=f"{CHRONOFY_SYSTEM}/CodeSystem/shift-type",
                            code=shift_code,
                            display="Day Shift" if shift_code.startswith("D") else "Night Shift"
                        )]
                    )
                ],
                schedule=Reference(reference=f"Schedule/{schedule_id}", type="Schedule"),
                status=SlotStatus.BUSY,
                start=start_dt,
                end=end_dt,
                comment=f"Assigned to {nurse_name}"
            ))
    
    return slots


# ============== CareTeam Conversions ==============

def organization_to_fhir_careteam(
    organization: Organization,
    members: List[OrganizationMember]
) -> FHIRCareTeam:
    """Convert organization and members to FHIR CareTeam resource"""
    participants = []
    
    for member in members:
        if not member.is_approved or not member.is_active:
            continue
            
        role_code = "admin" if member.role.value == "admin" else "nurse"
        participants.append(CareTeamParticipant(
            role=CodeableConcept(
                coding=[Coding(
                    system=f"{CHRONOFY_SYSTEM}/CodeSystem/care-team-role",
                    code=role_code,
                    display="Administrator" if role_code == "admin" else "Nurse"
                )]
            ),
            member=Reference(
                reference=f"Practitioner/{member.user_id}",
                display=member.user_name or member.user_email
            )
        ))
    
    return FHIRCareTeam(
        id=str(organization.id),
        meta=Meta(
            lastUpdated=organization.updated_at or organization.created_at,
            source=CHRONOFY_SYSTEM
        ),
        identifier=[
            Identifier(system=CHRONOFY_SYSTEM, value=str(organization.id))
        ],
        status="active" if organization.is_active else "inactive",
        name=organization.name,
        participant=participants,
        telecom=[],
        managingOrganization=[
            Reference(reference=f"Organization/{organization.id}", display=organization.name)
        ]
    )


# ============== Bundle Helpers ==============

def create_search_bundle(
    resources: List[any],
    total: int,
    self_link: str
) -> FHIRBundle:
    """Create a FHIR searchset Bundle"""
    entries = []
    for resource in resources:
        entries.append(BundleEntry(
            fullUrl=f"{CHRONOFY_SYSTEM}/{resource.resourceType}/{resource.id}",
            resource=resource.model_dump(by_alias=True, exclude_none=True),
            search={"mode": "match"}
        ))
    
    return FHIRBundle(
        id=generate_fhir_id(),
        type="searchset",
        timestamp=datetime.utcnow(),
        total=total,
        link=[{"relation": "self", "url": self_link}],
        entry=entries
    )


# ============== Audit Event Helpers (Law 25 Compliance) ==============

def create_audit_event(
    action: str,  # C, R, U, D, E
    resource_type: str,
    resource_id: str,
    user_id: str,
    user_name: Optional[str],
    organization_id: Optional[str],
    outcome_success: bool = True,
    details: Optional[str] = None
) -> FHIRAuditEvent:
    """Create a FHIR AuditEvent for Law 25 compliance tracking"""
    
    action_display = {
        "C": "Create",
        "R": "Read",
        "U": "Update",
        "D": "Delete",
        "E": "Execute"
    }
    
    return FHIRAuditEvent(
        id=generate_fhir_id(),
        meta=Meta(source=CHRONOFY_SYSTEM),
        category=[
            CodeableConcept(
                coding=[Coding(
                    system="http://terminology.hl7.org/CodeSystem/audit-event-type",
                    code="rest",
                    display="RESTful Operation"
                )]
            )
        ],
        code=CodeableConcept(
            coding=[Coding(
                system="http://hl7.org/fhir/restful-interaction",
                code=action.lower(),
                display=action_display.get(action, action)
            )]
        ),
        action=action,
        severity="informational" if outcome_success else "error",
        recorded=datetime.utcnow(),
        outcome={
            "code": {
                "system": "http://terminology.hl7.org/CodeSystem/audit-event-outcome",
                "code": "0" if outcome_success else "4",
                "display": "Success" if outcome_success else "Minor failure"
            },
            "detail": [{"text": details}] if details else []
        },
        agent=[
            AuditEventAgent(
                type=CodeableConcept(
                    coding=[Coding(
                        system="http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                        code="AUT",
                        display="Author"
                    )]
                ),
                who=Reference(reference=f"Practitioner/{user_id}", display=user_name),
                requestor=True
            )
        ],
        source=AuditEventSource(
            observer=Reference(
                reference=f"Organization/{organization_id}" if organization_id else "Organization/chronofy",
                display="Chronofy Health Platform"
            ),
            type=[CodeableConcept(
                coding=[Coding(
                    system="http://terminology.hl7.org/CodeSystem/security-source-type",
                    code="4",
                    display="Application Server"
                )]
            )]
        ),
        entity=[
            AuditEventEntity(
                what=Reference(
                    reference=f"{resource_type}/{resource_id}",
                    type=resource_type
                ),
                role=CodeableConcept(
                    coding=[Coding(
                        system="http://terminology.hl7.org/CodeSystem/object-role",
                        code="4",
                        display="Domain Resource"
                    )]
                )
            )
        ]
    )


# ============== Error Responses ==============

def create_operation_outcome(
    severity: str,
    code: str,
    diagnostics: str,
    location: Optional[List[str]] = None
) -> FHIROperationOutcome:
    """Create a FHIR OperationOutcome for error responses"""
    return FHIROperationOutcome(
        id=generate_fhir_id(),
        issue=[
            OperationOutcomeIssue(
                severity=severity,
                code=code,
                diagnostics=diagnostics,
                location=location or []
            )
        ]
    )
