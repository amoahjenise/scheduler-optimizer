"""
FHIR R5 Resource Models

HL7 FHIR (Fast Healthcare Interoperability Resources) R5 compliant models.
These models enable data exchange with other healthcare systems per Bill S-5 requirements.

Reference: https://www.hl7.org/fhir/
"""
from datetime import datetime, date
from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from enum import Enum


# ============== FHIR Data Types ==============

class Coding(BaseModel):
    """FHIR Coding data type - reference to a code defined by a terminology system"""
    system: Optional[str] = None  # URI of the terminology system
    version: Optional[str] = None
    code: Optional[str] = None
    display: Optional[str] = None
    userSelected: Optional[bool] = None


class CodeableConcept(BaseModel):
    """FHIR CodeableConcept - a value that is usually supplied by providing a reference to one or more terminologies"""
    coding: List[Coding] = []
    text: Optional[str] = None


class Identifier(BaseModel):
    """FHIR Identifier - a numeric or alphanumeric string that is associated with a single object or entity"""
    use: Optional[Literal["usual", "official", "temp", "secondary", "old"]] = None
    type: Optional[CodeableConcept] = None
    system: Optional[str] = None  # The namespace for the identifier value
    value: Optional[str] = None
    period: Optional[dict] = None  # Time period when id is/was valid


class HumanName(BaseModel):
    """FHIR HumanName - a name of a human"""
    use: Optional[Literal["usual", "official", "temp", "nickname", "anonymous", "old", "maiden"]] = None
    text: Optional[str] = None
    family: Optional[str] = None
    given: List[str] = []
    prefix: List[str] = []
    suffix: List[str] = []
    period: Optional[dict] = None


class ContactPoint(BaseModel):
    """FHIR ContactPoint - details for all kinds of technology-mediated contact points"""
    system: Optional[Literal["phone", "fax", "email", "pager", "url", "sms", "other"]] = None
    value: Optional[str] = None
    use: Optional[Literal["home", "work", "temp", "old", "mobile"]] = None
    rank: Optional[int] = None
    period: Optional[dict] = None


class Address(BaseModel):
    """FHIR Address - an address expressed using postal conventions"""
    use: Optional[Literal["home", "work", "temp", "old", "billing"]] = None
    type: Optional[Literal["postal", "physical", "both"]] = None
    text: Optional[str] = None
    line: List[str] = []
    city: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    postalCode: Optional[str] = None
    country: Optional[str] = None
    period: Optional[dict] = None


class Reference(BaseModel):
    """FHIR Reference - a reference from one resource to another"""
    reference: Optional[str] = None  # Literal reference, Relative, internal or absolute URL
    type: Optional[str] = None  # Type the reference refers to (e.g., "Patient")
    identifier: Optional[Identifier] = None
    display: Optional[str] = None


class Period(BaseModel):
    """FHIR Period - a time period defined by a start and end date/time"""
    start: Optional[datetime] = None
    end: Optional[datetime] = None


class Meta(BaseModel):
    """FHIR Meta - metadata about a resource"""
    versionId: Optional[str] = None
    lastUpdated: Optional[datetime] = None
    source: Optional[str] = None
    profile: List[str] = []
    security: List[Coding] = []
    tag: List[Coding] = []


# ============== FHIR Resource Base ==============

class FHIRResource(BaseModel):
    """Base class for all FHIR resources"""
    resourceType: str
    id: Optional[str] = None
    meta: Optional[Meta] = None
    implicitRules: Optional[str] = None
    language: Optional[str] = "fr-CA"  # Default to Canadian French for Quebec


# ============== Patient Resource ==============

class PatientContact(BaseModel):
    """A contact party (e.g., guardian, partner, friend) for the patient"""
    relationship: List[CodeableConcept] = []
    name: Optional[HumanName] = None
    telecom: List[ContactPoint] = []
    address: Optional[Address] = None
    gender: Optional[Literal["male", "female", "other", "unknown"]] = None
    organization: Optional[Reference] = None
    period: Optional[Period] = None


class PatientCommunication(BaseModel):
    """A language which may be used to communicate with the patient"""
    language: CodeableConcept
    preferred: Optional[bool] = None


class FHIRPatient(FHIRResource):
    """
    FHIR R5 Patient Resource
    
    Demographics and other administrative information about an individual receiving care.
    Reference: https://www.hl7.org/fhir/patient.html
    """
    resourceType: Literal["Patient"] = "Patient"
    identifier: List[Identifier] = []
    active: Optional[bool] = True
    name: List[HumanName] = []
    telecom: List[ContactPoint] = []
    gender: Optional[Literal["male", "female", "other", "unknown"]] = None
    birthDate: Optional[date] = None
    deceasedBoolean: Optional[bool] = None
    deceasedDateTime: Optional[datetime] = None
    address: List[Address] = []
    maritalStatus: Optional[CodeableConcept] = None
    multipleBirthBoolean: Optional[bool] = None
    multipleBirthInteger: Optional[int] = None
    photo: List[dict] = []  # Attachment type
    contact: List[PatientContact] = []
    communication: List[PatientCommunication] = []
    generalPractitioner: List[Reference] = []
    managingOrganization: Optional[Reference] = None
    link: List[dict] = []


# ============== Practitioner Resource ==============

class PractitionerQualification(BaseModel):
    """Qualifications obtained by training and certification"""
    identifier: List[Identifier] = []
    code: CodeableConcept
    period: Optional[Period] = None
    issuer: Optional[Reference] = None


class FHIRPractitioner(FHIRResource):
    """
    FHIR R5 Practitioner Resource
    
    A person who is directly or indirectly involved in the provisioning of healthcare.
    Reference: https://www.hl7.org/fhir/practitioner.html
    """
    resourceType: Literal["Practitioner"] = "Practitioner"
    identifier: List[Identifier] = []
    active: Optional[bool] = True
    name: List[HumanName] = []
    telecom: List[ContactPoint] = []
    gender: Optional[Literal["male", "female", "other", "unknown"]] = None
    birthDate: Optional[date] = None
    deceasedBoolean: Optional[bool] = None
    deceasedDateTime: Optional[datetime] = None
    address: List[Address] = []
    photo: List[dict] = []
    qualification: List[PractitionerQualification] = []
    communication: List[CodeableConcept] = []


# ============== Schedule Resource ==============

class FHIRSchedule(FHIRResource):
    """
    FHIR R5 Schedule Resource
    
    A container for slots of time that may be available for booking appointments.
    Reference: https://www.hl7.org/fhir/schedule.html
    """
    resourceType: Literal["Schedule"] = "Schedule"
    identifier: List[Identifier] = []
    active: Optional[bool] = True
    serviceCategory: List[CodeableConcept] = []
    serviceType: List[CodeableConcept] = []
    specialty: List[CodeableConcept] = []
    name: Optional[str] = None
    actor: List[Reference] = []  # Resource(s) this schedule pertains to
    planningHorizon: Optional[Period] = None
    comment: Optional[str] = None


# ============== Slot Resource ==============

class SlotStatus(str, Enum):
    BUSY = "busy"
    FREE = "free"
    BUSY_UNAVAILABLE = "busy-unavailable"
    BUSY_TENTATIVE = "busy-tentative"
    ENTERED_IN_ERROR = "entered-in-error"


class FHIRSlot(FHIRResource):
    """
    FHIR R5 Slot Resource
    
    A slot of time on a schedule that may be available for booking appointments.
    Reference: https://www.hl7.org/fhir/slot.html
    """
    resourceType: Literal["Slot"] = "Slot"
    identifier: List[Identifier] = []
    serviceCategory: List[CodeableConcept] = []
    serviceType: List[CodeableConcept] = []
    specialty: List[CodeableConcept] = []
    appointmentType: List[CodeableConcept] = []
    schedule: Reference  # Required: The schedule resource this slot defines
    status: SlotStatus
    start: datetime
    end: datetime
    overbooked: Optional[bool] = False
    comment: Optional[str] = None


# ============== Appointment Resource ==============

class AppointmentStatus(str, Enum):
    PROPOSED = "proposed"
    PENDING = "pending"
    BOOKED = "booked"
    ARRIVED = "arrived"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    NOSHOW = "noshow"
    ENTERED_IN_ERROR = "entered-in-error"
    CHECKED_IN = "checked-in"
    WAITLIST = "waitlist"


class AppointmentParticipant(BaseModel):
    """Participants involved in the appointment"""
    type: List[CodeableConcept] = []
    period: Optional[Period] = None
    actor: Optional[Reference] = None
    required: Optional[bool] = True
    status: Literal["accepted", "declined", "tentative", "needs-action"]


class FHIRAppointment(FHIRResource):
    """
    FHIR R5 Appointment Resource
    
    A booking of a healthcare event among patient(s), practitioner(s), related person(s).
    Reference: https://www.hl7.org/fhir/appointment.html
    """
    resourceType: Literal["Appointment"] = "Appointment"
    identifier: List[Identifier] = []
    status: AppointmentStatus
    cancellationReason: Optional[CodeableConcept] = None
    class_: List[CodeableConcept] = Field(default=[], alias="class")
    serviceCategory: List[CodeableConcept] = []
    serviceType: List[CodeableConcept] = []
    specialty: List[CodeableConcept] = []
    appointmentType: Optional[CodeableConcept] = None
    reason: List[CodeableConcept] = []
    priority: Optional[CodeableConcept] = None
    description: Optional[str] = None
    replaces: List[Reference] = []
    virtualService: List[dict] = []
    supportingInformation: List[Reference] = []
    previousAppointment: Optional[Reference] = None
    originatingAppointment: Optional[Reference] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    minutesDuration: Optional[int] = None
    requestedPeriod: List[Period] = []
    slot: List[Reference] = []
    account: List[Reference] = []
    created: Optional[datetime] = None
    cancellationDate: Optional[datetime] = None
    note: List[dict] = []  # Annotation type
    patientInstruction: List[CodeableConcept] = []
    basedOn: List[Reference] = []
    subject: Optional[Reference] = None
    participant: List[AppointmentParticipant] = []
    recurrenceId: Optional[int] = None
    occurrenceChanged: Optional[bool] = None
    recurrenceTemplate: List[dict] = []


# ============== CareTeam Resource ==============

class CareTeamParticipant(BaseModel):
    """Members of the team"""
    role: Optional[CodeableConcept] = None
    member: Optional[Reference] = None
    onBehalfOf: Optional[Reference] = None
    coveragePeriod: Optional[Period] = None
    coverageTiming: Optional[dict] = None  # Timing type


class FHIRCareTeam(FHIRResource):
    """
    FHIR R5 CareTeam Resource
    
    The Care Team includes all the people and organizations who plan to 
    participate in the coordination and delivery of care.
    Reference: https://www.hl7.org/fhir/careteam.html
    """
    resourceType: Literal["CareTeam"] = "CareTeam"
    identifier: List[Identifier] = []
    status: Optional[Literal["proposed", "active", "suspended", "inactive", "entered-in-error"]] = None
    category: List[CodeableConcept] = []
    name: Optional[str] = None
    subject: Optional[Reference] = None
    period: Optional[Period] = None
    participant: List[CareTeamParticipant] = []
    reason: List[CodeableConcept] = []
    managingOrganization: List[Reference] = []
    telecom: List[ContactPoint] = []
    note: List[dict] = []


# ============== Bundle Resource ==============

class BundleEntry(BaseModel):
    """An entry in a bundle resource - will contain resources"""
    fullUrl: Optional[str] = None
    resource: Optional[dict] = None  # The actual resource
    search: Optional[dict] = None
    request: Optional[dict] = None
    response: Optional[dict] = None


class FHIRBundle(FHIRResource):
    """
    FHIR R5 Bundle Resource
    
    A container for a collection of resources.
    Reference: https://www.hl7.org/fhir/bundle.html
    """
    resourceType: Literal["Bundle"] = "Bundle"
    identifier: Optional[Identifier] = None
    type: Literal["document", "message", "transaction", "transaction-response", 
                  "batch", "batch-response", "history", "searchset", "collection",
                  "subscription-notification"]
    timestamp: Optional[datetime] = None
    total: Optional[int] = None
    link: List[dict] = []
    entry: List[BundleEntry] = []
    signature: Optional[dict] = None
    issues: Optional[dict] = None  # OperationOutcome


# ============== OperationOutcome Resource ==============

class OperationOutcomeIssue(BaseModel):
    """An error, warning, or information message"""
    severity: Literal["fatal", "error", "warning", "information"]
    code: str
    details: Optional[CodeableConcept] = None
    diagnostics: Optional[str] = None
    location: List[str] = []
    expression: List[str] = []


class FHIROperationOutcome(FHIRResource):
    """
    FHIR R5 OperationOutcome Resource
    
    A collection of error, warning, or information messages.
    Reference: https://www.hl7.org/fhir/operationoutcome.html
    """
    resourceType: Literal["OperationOutcome"] = "OperationOutcome"
    issue: List[OperationOutcomeIssue] = []


# ============== Consent Resource (Law 25 Compliance) ==============

class ConsentPolicy(BaseModel):
    """The references to the policies that are included in this consent scope"""
    authority: Optional[str] = None  # Enforcement source
    uri: Optional[str] = None  # Specific policy covered


class ConsentProvision(BaseModel):
    """Consent Provisions"""
    period: Optional[Period] = None
    actor: List[dict] = []
    action: List[CodeableConcept] = []
    securityLabel: List[Coding] = []
    purpose: List[Coding] = []
    documentType: List[Coding] = []
    resourceType: List[Coding] = []
    code: List[CodeableConcept] = []
    dataPeriod: Optional[Period] = None
    data: List[dict] = []
    expression: Optional[dict] = None
    provision: List["ConsentProvision"] = []


class FHIRConsent(FHIRResource):
    """
    FHIR R5 Consent Resource
    
    A record of a healthcare consumer's choices regarding how their data 
    may be used/disclosed.
    
    This is critical for Law 25 (Quebec Privacy Law) compliance.
    Reference: https://www.hl7.org/fhir/consent.html
    """
    resourceType: Literal["Consent"] = "Consent"
    identifier: List[Identifier] = []
    status: Literal["draft", "active", "inactive", "not-done", "entered-in-error", "unknown"]
    category: List[CodeableConcept] = []
    subject: Optional[Reference] = None
    date: Optional[datetime] = None
    period: Optional[Period] = None
    grantor: List[Reference] = []
    grantee: List[Reference] = []
    manager: List[Reference] = []
    controller: List[Reference] = []
    sourceAttachment: List[dict] = []
    sourceReference: List[Reference] = []
    regulatoryBasis: List[CodeableConcept] = []
    policyBasis: Optional[dict] = None
    policyText: List[Reference] = []
    verification: List[dict] = []
    decision: Optional[Literal["deny", "permit"]] = None
    provision: List[ConsentProvision] = []


# ============== AuditEvent Resource (Law 25 Compliance) ==============

class AuditEventAgent(BaseModel):
    """Actor involved in the event"""
    type: Optional[CodeableConcept] = None
    role: List[CodeableConcept] = []
    who: Optional[Reference] = None
    requestor: bool = False
    location: Optional[Reference] = None
    policy: List[str] = []
    networkReference: Optional[Reference] = None
    networkUri: Optional[str] = None
    networkString: Optional[str] = None
    authorization: List[CodeableConcept] = []


class AuditEventSource(BaseModel):
    """Audit Event Reporter"""
    site: Optional[Reference] = None
    observer: Reference
    type: List[CodeableConcept] = []


class AuditEventEntity(BaseModel):
    """Data or objects used"""
    what: Optional[Reference] = None
    role: Optional[CodeableConcept] = None
    securityLabel: List[CodeableConcept] = []
    query: Optional[str] = None  # Base64 encoded query parameters
    detail: List[dict] = []
    agent: List[AuditEventAgent] = []


class FHIRAuditEvent(FHIRResource):
    """
    FHIR R5 AuditEvent Resource
    
    A record of an event relevant for audit purposes.
    Critical for Law 25 compliance - tracking all data access.
    Reference: https://www.hl7.org/fhir/auditevent.html
    """
    resourceType: Literal["AuditEvent"] = "AuditEvent"
    category: List[CodeableConcept] = []
    code: CodeableConcept
    action: Optional[Literal["C", "R", "U", "D", "E"]] = None  # Create, Read, Update, Delete, Execute
    severity: Optional[Literal["emergency", "alert", "critical", "error", 
                                "warning", "notice", "informational", "debug"]] = None
    occurredPeriod: Optional[Period] = None
    occurredDateTime: Optional[datetime] = None
    recorded: datetime
    outcome: Optional[dict] = None
    authorization: List[CodeableConcept] = []
    basedOn: List[Reference] = []
    patient: Optional[Reference] = None
    encounter: Optional[Reference] = None
    agent: List[AuditEventAgent] = []
    source: AuditEventSource
    entity: List[AuditEventEntity] = []


# Update forward references
ConsentProvision.model_rebuild()
