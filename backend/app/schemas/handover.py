"""Pydantic schemas for Handover API - Pediatric Oncology Template."""
from pydantic import BaseModel, Field, model_validator, field_validator
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum


class PatientStatusEnum(str, Enum):
    STABLE = "stable"
    IMPROVED = "improved"
    UNCHANGED = "unchanged"
    WORSENING = "worsening"
    CRITICAL = "critical"


class AcuityLevelEnum(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class IsolationTypeEnum(str, Enum):
    NONE = "none"
    CONTACT = "contact"
    DROPLET = "droplet"
    AIRBORNE = "airborne"
    NEUTROPENIC = "neutropenic"
    PROTECTIVE = "protective"
    CYTOTOXIC = "cytotoxic"


class ShiftTypeEnum(str, Enum):
    DAY = "day"
    EVENING = "evening"
    NIGHT = "night"


class HandoverBase(BaseModel):
    """Base handover schema matching pediatric oncology template."""
    patient_id: Optional[str] = None  # Nullable: new handovers embed patient info directly
    shift_date: datetime
    shift_type: ShiftTypeEnum
    outgoing_nurse: Optional[str] = Field(None, max_length=100)
    incoming_nurse: Optional[str] = Field(None, max_length=100)
    
    # Embedded patient demographics (stored on the handover itself)
    p_first_name: Optional[str] = Field(None, max_length=100)
    p_last_name: Optional[str] = Field(None, max_length=100)
    p_room_number: Optional[str] = Field(None, max_length=20)
    p_bed: Optional[str] = Field(None, max_length=10)
    p_mrn: Optional[str] = Field(None, max_length=50)
    p_diagnosis: Optional[str] = Field(None, max_length=255)
    p_date_of_birth: Optional[datetime] = None
    p_age: Optional[str] = Field(None, max_length=50)
    p_attending_physician: Optional[str] = Field(None, max_length=100)

    @field_validator("p_date_of_birth", mode="before")
    @classmethod
    def coerce_empty_dob(cls, v):
        """Convert empty strings to None so Pydantic doesn't try to parse '' as datetime."""
        if v == "" or v is None:
            return None
        return v

    # Patient status
    status: PatientStatusEnum = PatientStatusEnum.STABLE
    acuity: AcuityLevelEnum = AcuityLevelEnum.MODERATE
    isolation: IsolationTypeEnum = IsolationTypeEnum.NONE
    code_status: Optional[str] = Field(None, max_length=50)
    code_status_manual: Optional[str] = Field(None, max_length=100)
    revision_date: Optional[str] = Field(None, max_length=50)
    revision_author: Optional[str] = Field(None, max_length=100)
    
    # === HEADER SECTION (Static fields) ===
    pertinent_issues: Optional[str] = None
    admit_date: Optional[str] = Field(None, max_length=50)
    anticipated_discharge: Optional[str] = Field(None, max_length=50)
    allergies: Optional[str] = None
    medications_summary: Optional[str] = None
    prn_medications: Optional[str] = None
    chemotherapies: Optional[str] = None
    
    # === LABS ===
    wbc: Optional[str] = Field(None, max_length=20)
    hgb: Optional[str] = Field(None, max_length=20)
    plt: Optional[str] = Field(None, max_length=20)
    anc: Optional[str] = Field(None, max_length=20)
    abnormal_labs: Optional[str] = None
    
    # === VS/PAIN ===
    abnormal_vitals: Optional[str] = None
    bpews_score: Optional[str] = Field(None, max_length=10)
    pain_scale: Optional[str] = Field(None, max_length=20)
    pain_location: Optional[str] = Field(None, max_length=100)
    pain_relieved_post_med: Optional[str] = None
    pca_checkbox: Optional[bool] = None
    nca_checkbox: Optional[bool] = None
    pca_nca_bolus: Optional[str] = None
    pain_notes: Optional[str] = None
    monitoring_cardiac: Optional[bool] = None
    monitoring_o2_sat: Optional[bool] = None
    
    # === IV ===
    iv_access: Optional[str] = None
    cvad_type: Optional[str] = Field(None, max_length=50)
    cvad_dressing: Optional[str] = Field(None, max_length=100)
    iv_infusions: Optional[str] = None
    tpn: Optional[str] = None
    
    # === G.U. ===
    urine_output: Optional[str] = None
    strict_io: Optional[bool] = None
    io_interval: Optional[str] = Field(None, max_length=10)
    # 6-hour intervals
    io_00: Optional[str] = Field(None, max_length=50)
    io_00_last6h: Optional[str] = Field(None, max_length=50)
    io_06: Optional[str] = Field(None, max_length=50)
    io_06_last6h: Optional[str] = Field(None, max_length=50)
    io_12: Optional[str] = Field(None, max_length=50)
    io_12_last6h: Optional[str] = Field(None, max_length=50)
    io_18: Optional[str] = Field(None, max_length=50)
    io_18_last6h: Optional[str] = Field(None, max_length=50)
    # 4-hour intervals
    io_00_04: Optional[str] = Field(None, max_length=50)
    io_00_04_last6h: Optional[str] = Field(None, max_length=50)
    io_04_08: Optional[str] = Field(None, max_length=50)
    io_04_08_last6h: Optional[str] = Field(None, max_length=50)
    io_08_12: Optional[str] = Field(None, max_length=50)
    io_08_12_last6h: Optional[str] = Field(None, max_length=50)
    io_12_16: Optional[str] = Field(None, max_length=50)
    io_12_16_last6h: Optional[str] = Field(None, max_length=50)
    io_16_20: Optional[str] = Field(None, max_length=50)
    io_16_20_last6h: Optional[str] = Field(None, max_length=50)
    io_20_24: Optional[str] = Field(None, max_length=50)
    io_20_24_last6h: Optional[str] = Field(None, max_length=50)
    foley: Optional[bool] = None
    urine_sg: Optional[str] = Field(None, max_length=20)
    urine_ph: Optional[str] = Field(None, max_length=20)
    urine_ob: Optional[str] = Field(None, max_length=20)
    urine_glucose: Optional[str] = Field(None, max_length=20)
    urine_ketones: Optional[str] = Field(None, max_length=20)
    
    # === NEUROLOGICAL ===
    neuro_normal: Optional[bool] = None
    altered_loc: Optional[bool] = None
    speech_changes: Optional[bool] = None
    confusion: Optional[bool] = None
    vp_shunt: Optional[bool] = None
    glasgow_score: Optional[str] = Field(None, max_length=10)
    gcs_score: Optional[str] = Field(None, max_length=10)
    neuro_notes: Optional[str] = None
    
    # === RESP/CARDIO ===
    lung_assessment: Optional[str] = None
    oxygen: Optional[str] = None
    oxygen_needs: Optional[str] = Field(None, max_length=100)
    cardiovascular: Optional[str] = None
    chest_tube_left: Optional[bool] = None
    chest_tube_right: Optional[bool] = None
    chest_tube_type_lws: Optional[bool] = None
    chest_tube_type_sd: Optional[bool] = None
    heart_rate_notes: Optional[str] = None
    
    # === G.I. ===
    gi_tenderness: Optional[bool] = None
    gi_distention: Optional[bool] = None
    gi_girth: Optional[str] = Field(None, max_length=20)
    vomiting: Optional[bool] = None
    vomiting_quantity: Optional[str] = Field(None, max_length=50)
    nausea: Optional[bool] = None
    last_bowel_movement: Optional[str] = Field(None, max_length=50)
    constipation: Optional[bool] = None
    diarrhea: Optional[bool] = None
    diarrhea_quantity: Optional[str] = Field(None, max_length=50)
    colostomy: Optional[bool] = None
    bowel_movements: Optional[str] = None
    diet: Optional[str] = Field(None, max_length=100)
    
    # === NUTRITION ===
    po_intake: Optional[str] = None
    fluid_intake_po: Optional[str] = Field(None, max_length=50)
    fluid_intake_iv: Optional[str] = Field(None, max_length=50)
    fluid_intake_ng: Optional[str] = Field(None, max_length=50)
    weight: Optional[str] = Field(None, max_length=20)
    formula_checkbox: Optional[bool] = None
    formula: Optional[str] = None
    total_fluid: Optional[str] = Field(None, max_length=50)
    breast_milk: Optional[bool] = None
    continuous_feeding: Optional[bool] = None
    continuous_feeding_rate: Optional[str] = Field(None, max_length=20)
    bolus_feeding: Optional[bool] = None
    bolus_amount: Optional[str] = Field(None, max_length=50)
    ng_tube: Optional[bool] = None
    nj_tube: Optional[bool] = None
    gt_tube: Optional[bool] = None
    npo: Optional[bool] = None
    feeding_goal: Optional[str] = Field(None, max_length=100)
    see_feeding_schedule: Optional[bool] = None
    tube_type: Optional[str] = Field(None, max_length=20)
    
    # === MUSCULOSKELETAL ===
    mobility_restrictions: Optional[str] = None
    positioning: Optional[str] = None
    assistive_devices: Optional[str] = None
    activity: Optional[str] = Field(None, max_length=100)
    
    # === SKIN ===
    braden_q_score: Optional[str] = Field(None, max_length=20)
    skin_care_plan: Optional[str] = None
    skin_assessment: Optional[str] = None
    pressure_sore_stage: Optional[str] = Field(None, max_length=20)
    pressure_sore_location: Optional[str] = Field(None, max_length=100)
    pressure_sore_treatment: Optional[str] = None
    pressure_sore_staging: Optional[str] = None
    
    # === PSYCHO-SOCIAL ===
    psychosocial_notes: Optional[str] = None
    family_notes: Optional[str] = None
    
    # === DISCHARGE PLANNING ===
    expected_discharge_date: Optional[str] = Field(None, max_length=50)
    discharge_teaching: Optional[str] = None
    discharge_prescriptions: Optional[str] = None
    home_enteral_feeding: Optional[str] = None
    followup_appointments: Optional[str] = None
    
    # === TO DO & FOLLOW UP ===
    todo_items: Optional[str] = None
    followup_items: Optional[str] = None
    
    # Legacy fields
    events_this_shift: Optional[str] = None
    pending_tasks: Optional[str] = None
    pending_labs: Optional[str] = None
    consults: Optional[str] = None
    additional_notes: Optional[str] = None
    voice_transcription: Optional[str] = None


class HandoverCreate(HandoverBase):
    """Schema for creating a new handover."""
    pass


class HandoverUpdate(BaseModel):
    """Schema for updating a handover (all fields optional)."""
    incoming_nurse: Optional[str] = Field(None, max_length=100)
    
    # Embedded patient demographics (editable on the handover)
    p_first_name: Optional[str] = Field(None, max_length=100)
    p_last_name: Optional[str] = Field(None, max_length=100)
    p_room_number: Optional[str] = Field(None, max_length=20)
    p_bed: Optional[str] = Field(None, max_length=10)
    p_mrn: Optional[str] = Field(None, max_length=50)
    p_diagnosis: Optional[str] = Field(None, max_length=255)
    p_date_of_birth: Optional[datetime] = None
    p_age: Optional[str] = Field(None, max_length=50)
    p_attending_physician: Optional[str] = Field(None, max_length=100)

    @field_validator("p_date_of_birth", mode="before")
    @classmethod
    def coerce_empty_dob(cls, v):
        if v == "" or v is None:
            return None
        return v

    status: Optional[PatientStatusEnum] = None
    acuity: Optional[AcuityLevelEnum] = None
    isolation: Optional[IsolationTypeEnum] = None
    code_status: Optional[str] = Field(None, max_length=50)
    code_status_manual: Optional[str] = Field(None, max_length=100)
    revision_date: Optional[str] = Field(None, max_length=50)
    revision_author: Optional[str] = Field(None, max_length=100)
    
    # Header
    pertinent_issues: Optional[str] = None
    admit_date: Optional[str] = Field(None, max_length=50)
    anticipated_discharge: Optional[str] = Field(None, max_length=50)
    allergies: Optional[str] = None
    medications_summary: Optional[str] = None
    prn_medications: Optional[str] = None
    chemotherapies: Optional[str] = None
    
    # Labs
    wbc: Optional[str] = Field(None, max_length=20)
    hgb: Optional[str] = Field(None, max_length=20)
    plt: Optional[str] = Field(None, max_length=20)
    anc: Optional[str] = Field(None, max_length=20)
    abnormal_labs: Optional[str] = None
    
    # VS/Pain
    abnormal_vitals: Optional[str] = None
    bpews_score: Optional[str] = Field(None, max_length=10)
    pain_scale: Optional[str] = Field(None, max_length=20)
    pain_location: Optional[str] = Field(None, max_length=100)
    pain_relieved_post_med: Optional[str] = None
    pca_checkbox: Optional[bool] = None
    nca_checkbox: Optional[bool] = None
    pca_nca_bolus: Optional[str] = None
    pain_notes: Optional[str] = None
    monitoring_cardiac: Optional[bool] = None
    monitoring_o2_sat: Optional[bool] = None
    
    # IV
    iv_access: Optional[str] = None
    cvad_type: Optional[str] = Field(None, max_length=50)
    cvad_dressing: Optional[str] = Field(None, max_length=100)
    iv_infusions: Optional[str] = None
    tpn: Optional[str] = None
    
    # G.U.
    urine_output: Optional[str] = None
    strict_io: Optional[bool] = None
    io_00: Optional[str] = Field(None, max_length=50)
    io_06: Optional[str] = Field(None, max_length=50)
    io_12: Optional[str] = Field(None, max_length=50)
    io_18: Optional[str] = Field(None, max_length=50)
    foley: Optional[bool] = None
    urine_sg: Optional[str] = Field(None, max_length=20)
    urine_ph: Optional[str] = Field(None, max_length=20)
    urine_ob: Optional[str] = Field(None, max_length=20)
    urine_glucose: Optional[str] = Field(None, max_length=20)
    urine_ketones: Optional[str] = Field(None, max_length=20)
    
    # Neurological
    neuro_normal: Optional[bool] = None
    altered_loc: Optional[bool] = None
    speech_changes: Optional[bool] = None
    confusion: Optional[bool] = None
    vp_shunt: Optional[bool] = None
    glasgow_score: Optional[str] = Field(None, max_length=10)
    gcs_score: Optional[str] = Field(None, max_length=10)
    neuro_notes: Optional[str] = None
    
    # Resp/Cardio
    lung_assessment: Optional[str] = None
    oxygen: Optional[str] = None
    oxygen_needs: Optional[str] = Field(None, max_length=100)
    cardiovascular: Optional[str] = None
    chest_tube_left: Optional[bool] = None
    chest_tube_right: Optional[bool] = None
    chest_tube_type_lws: Optional[bool] = None
    chest_tube_type_sd: Optional[bool] = None
    heart_rate_notes: Optional[str] = None
    
    # G.I.
    gi_tenderness: Optional[bool] = None
    gi_distention: Optional[bool] = None
    gi_girth: Optional[str] = Field(None, max_length=20)
    vomiting: Optional[bool] = None
    vomiting_quantity: Optional[str] = Field(None, max_length=50)
    nausea: Optional[bool] = None
    last_bowel_movement: Optional[str] = Field(None, max_length=50)
    constipation: Optional[bool] = None
    diarrhea: Optional[bool] = None
    diarrhea_quantity: Optional[str] = Field(None, max_length=50)
    colostomy: Optional[bool] = None
    bowel_movements: Optional[str] = None
    diet: Optional[str] = Field(None, max_length=100)
    
    # Nutrition
    po_intake: Optional[str] = None
    fluid_intake_po: Optional[str] = Field(None, max_length=50)
    fluid_intake_iv: Optional[str] = Field(None, max_length=50)
    fluid_intake_ng: Optional[str] = Field(None, max_length=50)
    weight: Optional[str] = Field(None, max_length=20)
    formula_checkbox: Optional[bool] = None
    formula: Optional[str] = None
    total_fluid: Optional[str] = Field(None, max_length=50)
    breast_milk: Optional[bool] = None
    continuous_feeding: Optional[bool] = None
    continuous_feeding_rate: Optional[str] = Field(None, max_length=20)
    bolus_feeding: Optional[bool] = None
    bolus_amount: Optional[str] = Field(None, max_length=50)
    ng_tube: Optional[bool] = None
    nj_tube: Optional[bool] = None
    gt_tube: Optional[bool] = None
    npo: Optional[bool] = None
    feeding_goal: Optional[str] = Field(None, max_length=100)
    see_feeding_schedule: Optional[bool] = None
    tube_type: Optional[str] = Field(None, max_length=20)
    
    # Musculoskeletal
    mobility_restrictions: Optional[str] = None
    positioning: Optional[str] = None
    assistive_devices: Optional[str] = None
    activity: Optional[str] = Field(None, max_length=100)
    
    # Skin
    braden_q_score: Optional[str] = Field(None, max_length=20)
    skin_care_plan: Optional[str] = None
    skin_assessment: Optional[str] = None
    pressure_sore_stage: Optional[str] = Field(None, max_length=20)
    pressure_sore_location: Optional[str] = Field(None, max_length=100)
    pressure_sore_treatment: Optional[str] = None
    pressure_sore_staging: Optional[str] = None
    
    # Psycho-Social
    psychosocial_notes: Optional[str] = None
    family_notes: Optional[str] = None
    
    # Discharge Planning
    expected_discharge_date: Optional[str] = Field(None, max_length=50)
    discharge_teaching: Optional[str] = None
    discharge_prescriptions: Optional[str] = None
    home_enteral_feeding: Optional[str] = None
    followup_appointments: Optional[str] = None
    
    # To Do & Follow Up
    todo_items: Optional[str] = None
    followup_items: Optional[str] = None
    
    # Legacy
    events_this_shift: Optional[str] = None
    pending_tasks: Optional[str] = None
    pending_labs: Optional[str] = None
    consults: Optional[str] = None
    additional_notes: Optional[str] = None
    voice_transcription: Optional[str] = None
    
    is_draft: Optional[bool] = None
    is_completed: Optional[bool] = None


class PatientSummary(BaseModel):
    """Minimal patient info for handover response."""
    id: str
    mrn: Optional[str] = None
    first_name: str
    last_name: str
    room_number: str
    bed: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[str] = None
    date_of_birth: Optional[datetime] = None

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def _coerce_empty_dob(cls, v):
        if v == "" or v is None:
            return None
        return v

    class Config:
        from_attributes = True


class HandoverResponse(BaseModel):
    """Schema for handover response."""
    id: str
    patient_id: Optional[str] = None
    shift_date: datetime
    shift_type: str
    outgoing_nurse: str
    incoming_nurse: Optional[str] = None
    
    status: PatientStatusEnum
    acuity: AcuityLevelEnum
    isolation: IsolationTypeEnum
    code_status: Optional[str] = None
    code_status_manual: Optional[str] = None
    revision_date: Optional[str] = None
    revision_author: Optional[str] = None
    
    # All the template fields
    pertinent_issues: Optional[str] = None
    admit_date: Optional[str] = None
    anticipated_discharge: Optional[str] = None
    allergies: Optional[str] = None
    medications_summary: Optional[str] = None
    prn_medications: Optional[str] = None
    chemotherapies: Optional[str] = None
    
    wbc: Optional[str] = None
    hgb: Optional[str] = None
    plt: Optional[str] = None
    anc: Optional[str] = None
    abnormal_labs: Optional[str] = None
    
    # VS/Pain
    abnormal_vitals: Optional[str] = None
    bpews_score: Optional[str] = None
    pain_scale: Optional[str] = None
    pain_location: Optional[str] = None
    pain_relieved_post_med: Optional[str] = None
    pca_checkbox: Optional[bool] = None
    nca_checkbox: Optional[bool] = None
    pca_nca_bolus: Optional[str] = None
    pain_notes: Optional[str] = None
    monitoring_cardiac: Optional[bool] = None
    monitoring_o2_sat: Optional[bool] = None
    
    iv_access: Optional[str] = None
    cvad_type: Optional[str] = None
    cvad_dressing: Optional[str] = None
    iv_infusions: Optional[str] = None
    tpn: Optional[str] = None
    
    # G.U.
    urine_output: Optional[str] = None
    strict_io: Optional[bool] = None
    io_00: Optional[str] = None
    io_06: Optional[str] = None
    io_12: Optional[str] = None
    io_18: Optional[str] = None
    foley: Optional[bool] = None
    urine_sg: Optional[str] = None
    urine_ph: Optional[str] = None
    urine_ob: Optional[str] = None
    urine_glucose: Optional[str] = None
    urine_ketones: Optional[str] = None
    
    # Neurological
    neuro_normal: Optional[bool] = None
    altered_loc: Optional[bool] = None
    speech_changes: Optional[bool] = None
    confusion: Optional[bool] = None
    vp_shunt: Optional[bool] = None
    glasgow_score: Optional[str] = None
    gcs_score: Optional[str] = None
    neuro_notes: Optional[str] = None
    
    # Resp/Cardio
    lung_assessment: Optional[str] = None
    oxygen: Optional[str] = None
    oxygen_needs: Optional[str] = None
    cardiovascular: Optional[str] = None
    chest_tube_left: Optional[bool] = None
    chest_tube_right: Optional[bool] = None
    chest_tube_type_lws: Optional[bool] = None
    chest_tube_type_sd: Optional[bool] = None
    heart_rate_notes: Optional[str] = None
    
    # G.I.
    gi_tenderness: Optional[bool] = None
    gi_distention: Optional[bool] = None
    gi_girth: Optional[str] = None
    vomiting: Optional[bool] = None
    vomiting_quantity: Optional[str] = None
    nausea: Optional[bool] = None
    last_bowel_movement: Optional[str] = None
    constipation: Optional[bool] = None
    diarrhea: Optional[bool] = None
    diarrhea_quantity: Optional[str] = None
    colostomy: Optional[bool] = None
    bowel_movements: Optional[str] = None
    diet: Optional[str] = None
    
    # Nutrition
    po_intake: Optional[str] = None
    fluid_intake_po: Optional[str] = None
    fluid_intake_iv: Optional[str] = None
    fluid_intake_ng: Optional[str] = None
    weight: Optional[str] = None
    formula_checkbox: Optional[bool] = None
    formula: Optional[str] = None
    total_fluid: Optional[str] = None
    breast_milk: Optional[bool] = None
    continuous_feeding: Optional[bool] = None
    continuous_feeding_rate: Optional[str] = None
    bolus_feeding: Optional[bool] = None
    bolus_amount: Optional[str] = None
    ng_tube: Optional[bool] = None
    nj_tube: Optional[bool] = None
    gt_tube: Optional[bool] = None
    npo: Optional[bool] = None
    feeding_goal: Optional[str] = None
    see_feeding_schedule: Optional[bool] = None
    tube_type: Optional[str] = None
    
    mobility_restrictions: Optional[str] = None
    positioning: Optional[str] = None
    assistive_devices: Optional[str] = None
    activity: Optional[str] = None
    
    # Skin
    braden_q_score: Optional[str] = None
    skin_care_plan: Optional[str] = None
    skin_assessment: Optional[str] = None
    pressure_sore_stage: Optional[str] = None
    pressure_sore_location: Optional[str] = None
    pressure_sore_treatment: Optional[str] = None
    pressure_sore_staging: Optional[str] = None
    
    psychosocial_notes: Optional[str] = None
    family_notes: Optional[str] = None
    
    expected_discharge_date: Optional[str] = None
    discharge_teaching: Optional[str] = None
    discharge_prescriptions: Optional[str] = None
    home_enteral_feeding: Optional[str] = None
    followup_appointments: Optional[str] = None
    
    todo_items: Optional[str] = None
    followup_items: Optional[str] = None
    
    events_this_shift: Optional[str] = None
    pending_tasks: Optional[str] = None
    pending_labs: Optional[str] = None
    consults: Optional[str] = None
    additional_notes: Optional[str] = None
    voice_transcription: Optional[str] = None
    
    # Embedded patient demographics
    p_first_name: Optional[str] = None
    p_last_name: Optional[str] = None
    p_room_number: Optional[str] = None
    p_bed: Optional[str] = None
    p_mrn: Optional[str] = None
    p_diagnosis: Optional[str] = None
    p_date_of_birth: Optional[datetime] = None
    p_age: Optional[str] = None
    p_attending_physician: Optional[str] = None

    @field_validator("p_date_of_birth", mode="before")
    @classmethod
    def _coerce_empty_p_dob(cls, v):
        if v == "" or v is None:
            return None
        return v
    
    is_draft: bool
    is_completed: bool
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    patient: Optional[PatientSummary] = None

    class Config:
        from_attributes = True

    @model_validator(mode="wrap")
    @classmethod
    def _ensure_patient_summary(cls, data: Any, handler):
        """Construct patient summary from embedded fields when no linked patient."""
        instance = handler(data)
        if instance.patient is None and instance.p_first_name:
            instance.patient = PatientSummary(
                id=instance.id,
                mrn=instance.p_mrn,
                first_name=instance.p_first_name or "",
                last_name=instance.p_last_name or "",
                room_number=instance.p_room_number or "",
                bed=instance.p_bed,
                diagnosis=instance.p_diagnosis,
                age=instance.p_age,
                date_of_birth=instance.p_date_of_birth,
            )
        return instance


class HandoverListResponse(BaseModel):
    """Schema for list of handovers response."""
    handovers: List[HandoverResponse]
    total: int


class HandoverComplete(BaseModel):
    """Schema for completing a handover."""
    incoming_nurse: str = Field(..., min_length=1, max_length=100)


class BulkHandoverCreate(BaseModel):
    """Schema for creating handovers for multiple patients at once."""
    patient_ids: List[str]
    shift_date: datetime
    shift_type: ShiftTypeEnum
    outgoing_nurse: str = Field(..., min_length=1, max_length=100)
