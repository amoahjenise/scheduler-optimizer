"""FHIR module for HL7 FHIR R5 compliance"""
from app.fhir.resources import (
    FHIRPatient,
    FHIRPractitioner,
    FHIRSchedule,
    FHIRSlot,
    FHIRAppointment,
    FHIRCareTeam,
    FHIRBundle,
    FHIRConsent,
    FHIRAuditEvent,
    FHIROperationOutcome
)
from app.fhir.converters import (
    patient_to_fhir,
    fhir_to_patient,
    nurse_to_fhir,
    optimized_schedule_to_fhir_slots,
    organization_to_fhir_careteam,
    create_search_bundle,
    create_audit_event,
    create_operation_outcome
)

__all__ = [
    # Resources
    "FHIRPatient",
    "FHIRPractitioner", 
    "FHIRSchedule",
    "FHIRSlot",
    "FHIRAppointment",
    "FHIRCareTeam",
    "FHIRBundle",
    "FHIRConsent",
    "FHIRAuditEvent",
    "FHIROperationOutcome",
    # Converters
    "patient_to_fhir",
    "fhir_to_patient",
    "nurse_to_fhir",
    "optimized_schedule_to_fhir_slots",
    "organization_to_fhir_careteam",
    "create_search_bundle",
    "create_audit_event",
    "create_operation_outcome"
]
