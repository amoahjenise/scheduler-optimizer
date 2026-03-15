"""Handover model for shift handover tool."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
import enum
from app.db.database import Base


class PatientStatus(str, enum.Enum):
    """Patient status categories for handover."""
    STABLE = "stable"
    IMPROVED = "improved"
    UNCHANGED = "unchanged"
    WORSENING = "worsening"
    CRITICAL = "critical"


class AcuityLevel(str, enum.Enum):
    """Patient acuity levels."""
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class IsolationType(str, enum.Enum):
    """Isolation precaution types."""
    NONE = "none"
    CONTACT = "contact"
    DROPLET = "droplet"
    AIRBORNE = "airborne"
    NEUTROPENIC = "neutropenic"
    PROTECTIVE = "protective"


class Handover(Base):
    """
    Shift handover record for a patient.
    Matches the Montreal Children's Hospital pediatric oncology hand-off template.
    """
    __tablename__ = "handovers"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    organization_id = Column(String, nullable=True, index=True)  # Multi-tenant org ID
    
    # Patient reference (nullable – new handovers embed patient info directly)
    patient_id = Column(String, ForeignKey("patients.id", ondelete="SET NULL"), nullable=True)
    
    # Embedded patient demographics (HIPAA: stored on the transient handover, not a permanent patient record)
    p_first_name = Column(String(100), nullable=True)
    p_last_name = Column(String(100), nullable=True)
    p_room_number = Column(String(20), nullable=True)
    p_bed = Column(String(10), nullable=True)
    p_mrn = Column(String(50), nullable=True)
    p_diagnosis = Column(String(255), nullable=True)
    p_date_of_birth = Column(DateTime, nullable=True)
    p_age = Column(String(50), nullable=True)
    p_attending_physician = Column(String(100), nullable=True)
    
    # Shift info
    shift_date = Column(DateTime, nullable=False)
    shift_type = Column(String(20), nullable=False)  # "day", "evening", "night"
    outgoing_nurse = Column(String(100), nullable=False)
    incoming_nurse = Column(String(100), nullable=True)
    
    # Patient status
    status = Column(Enum(PatientStatus), default=PatientStatus.STABLE)
    acuity = Column(Enum(AcuityLevel), default=AcuityLevel.MODERATE)
    isolation = Column(Enum(IsolationType), default=IsolationType.NONE)
    
    # Code status
    code_status = Column(String(50), nullable=True)
    code_status_manual = Column(String(100), nullable=True)
    
    # Revision tracking
    revision_date = Column(String(50), nullable=True)
    revision_author = Column(String(100), nullable=True)
    
    # === HEADER SECTION (Static fields) ===
    pertinent_issues = Column(Text, nullable=True)
    admit_date = Column(String(50), nullable=True)
    anticipated_discharge = Column(String(50), nullable=True)
    allergies = Column(Text, nullable=True)
    medications_summary = Column(Text, nullable=True)
    prn_medications = Column(Text, nullable=True)
    chemotherapies = Column(Text, nullable=True)
    
    # === LABS ===
    wbc = Column(String(20), nullable=True)
    hgb = Column(String(20), nullable=True)
    plt = Column(String(20), nullable=True)
    anc = Column(String(20), nullable=True)
    abnormal_labs = Column(Text, nullable=True)
    
    # === VS/PAIN (Dynamic per shift) ===
    abnormal_vitals = Column(Text, nullable=True)
    bpews_score = Column(String(10), nullable=True)
    pain_scale = Column(String(20), nullable=True)
    pain_location = Column(String(100), nullable=True)
    pain_relieved_post_med = Column(Text, nullable=True)
    pca_checkbox = Column(Boolean, nullable=True)
    nca_checkbox = Column(Boolean, nullable=True)
    pca_nca_bolus = Column(Text, nullable=True)
    pain_notes = Column(Text, nullable=True)
    monitoring_cardiac = Column(Boolean, nullable=True)
    monitoring_o2_sat = Column(Boolean, nullable=True)
    
    # === IV (Dynamic per shift) ===
    iv_access = Column(Text, nullable=True)
    cvad_type = Column(String(50), nullable=True)
    cvad_dressing = Column(String(100), nullable=True)
    iv_infusions = Column(Text, nullable=True)
    tpn = Column(Text, nullable=True)
    
    # === G.U. (Dynamic per shift) ===
    urine_output = Column(Text, nullable=True)
    strict_io = Column(Boolean, nullable=True)
    io_interval = Column(String(10), nullable=True)  # "4h" or "6h"
    # 6-hour intervals
    io_00 = Column(String(50), nullable=True)
    io_00_last6h = Column(String(50), nullable=True)
    io_06 = Column(String(50), nullable=True)
    io_06_last6h = Column(String(50), nullable=True)
    io_12 = Column(String(50), nullable=True)
    io_12_last6h = Column(String(50), nullable=True)
    io_18 = Column(String(50), nullable=True)
    io_18_last6h = Column(String(50), nullable=True)
    # 4-hour intervals
    io_00_04 = Column(String(50), nullable=True)
    io_00_04_last6h = Column(String(50), nullable=True)
    io_04_08 = Column(String(50), nullable=True)
    io_04_08_last6h = Column(String(50), nullable=True)
    io_08_12 = Column(String(50), nullable=True)
    io_08_12_last6h = Column(String(50), nullable=True)
    io_12_16 = Column(String(50), nullable=True)
    io_12_16_last6h = Column(String(50), nullable=True)
    io_16_20 = Column(String(50), nullable=True)
    io_16_20_last6h = Column(String(50), nullable=True)
    io_20_24 = Column(String(50), nullable=True)
    io_20_24_last6h = Column(String(50), nullable=True)
    foley = Column(Boolean, nullable=True)
    urine_sg = Column(String(20), nullable=True)
    urine_ph = Column(String(20), nullable=True)
    urine_ob = Column(String(20), nullable=True)
    urine_glucose = Column(String(20), nullable=True)
    urine_ketones = Column(String(20), nullable=True)
    
    # === NEUROLOGICAL (Dynamic per shift) ===
    neuro_normal = Column(Boolean, nullable=True)
    altered_loc = Column(Boolean, nullable=True)
    speech_changes = Column(Boolean, nullable=True)
    confusion = Column(Boolean, nullable=True)
    vp_shunt = Column(Boolean, nullable=True)
    glasgow_score = Column(String(10), nullable=True)
    gcs_score = Column(String(10), nullable=True)
    neuro_notes = Column(Text, nullable=True)
    
    # === RESP/CARDIO (Dynamic per shift) ===
    lung_assessment = Column(Text, nullable=True)
    oxygen = Column(Text, nullable=True)
    oxygen_needs = Column(String(100), nullable=True)
    cardiovascular = Column(Text, nullable=True)
    chest_tube_left = Column(Boolean, nullable=True)
    chest_tube_right = Column(Boolean, nullable=True)
    chest_tube_type_lws = Column(Boolean, nullable=True)
    chest_tube_type_sd = Column(Boolean, nullable=True)
    heart_rate_notes = Column(Text, nullable=True)
    
    # === G.I. (Dynamic per shift) ===
    gi_tenderness = Column(Boolean, nullable=True)
    gi_distention = Column(Boolean, nullable=True)
    gi_girth = Column(String(20), nullable=True)
    vomiting = Column(Boolean, nullable=True)
    vomiting_quantity = Column(String(50), nullable=True)
    nausea = Column(Boolean, nullable=True)
    last_bowel_movement = Column(String(50), nullable=True)
    constipation = Column(Boolean, nullable=True)
    diarrhea = Column(Boolean, nullable=True)
    diarrhea_quantity = Column(String(50), nullable=True)
    colostomy = Column(Boolean, nullable=True)
    bowel_movements = Column(Text, nullable=True)
    diet = Column(String(100), nullable=True)
    
    # === NUTRITION (Dynamic per shift) ===
    po_intake = Column(Text, nullable=True)
    fluid_intake_po = Column(String(50), nullable=True)
    fluid_intake_iv = Column(String(50), nullable=True)
    fluid_intake_ng = Column(String(50), nullable=True)
    weight = Column(String(20), nullable=True)
    formula_checkbox = Column(Boolean, nullable=True)
    formula = Column(Text, nullable=True)
    total_fluid = Column(String(50), nullable=True)
    breast_milk = Column(Boolean, nullable=True)
    continuous_feeding = Column(Boolean, nullable=True)
    continuous_feeding_rate = Column(String(20), nullable=True)
    bolus_feeding = Column(Boolean, nullable=True)
    bolus_amount = Column(String(50), nullable=True)
    ng_tube = Column(Boolean, nullable=True)
    nj_tube = Column(Boolean, nullable=True)
    gt_tube = Column(Boolean, nullable=True)
    npo = Column(Boolean, nullable=True)
    feeding_goal = Column(String(100), nullable=True)
    see_feeding_schedule = Column(Boolean, nullable=True)
    tube_type = Column(String(20), nullable=True)
    
    # === MUSCULOSKELETAL (Dynamic per shift) ===
    mobility_restrictions = Column(Text, nullable=True)
    positioning = Column(Text, nullable=True)
    assistive_devices = Column(Text, nullable=True)
    activity = Column(String(100), nullable=True)
    
    # === SKIN (Dynamic per shift) ===
    braden_q_score = Column(String(20), nullable=True)
    skin_care_plan = Column(Text, nullable=True)
    skin_assessment = Column(Text, nullable=True)
    pressure_sore_stage = Column(String(20), nullable=True)
    pressure_sore_location = Column(String(100), nullable=True)
    pressure_sore_treatment = Column(Text, nullable=True)
    pressure_sore_staging = Column(Text, nullable=True)
    
    # === PSYCHO-SOCIAL (Dynamic per shift) ===
    psychosocial_notes = Column(Text, nullable=True)
    family_notes = Column(Text, nullable=True)
    
    # === PAGE 2: DISCHARGE PLANNING (Static) ===
    expected_discharge_date = Column(String(50), nullable=True)
    discharge_teaching = Column(Text, nullable=True)
    discharge_prescriptions = Column(Text, nullable=True)
    home_enteral_feeding = Column(Text, nullable=True)
    followup_appointments = Column(Text, nullable=True)
    
    # === PAGE 2: TO DO & FOLLOW UP (Dynamic per shift) ===
    todo_items = Column(Text, nullable=True)
    followup_items = Column(Text, nullable=True)
    
    # Legacy fields
    events_this_shift = Column(Text, nullable=True)
    pending_tasks = Column(Text, nullable=True)
    pending_labs = Column(Text, nullable=True)
    consults = Column(Text, nullable=True)
    additional_notes = Column(Text, nullable=True)
    voice_transcription = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Status flags
    is_draft = Column(Boolean, default=True)
    is_completed = Column(Boolean, default=False)
    
    # Relationships
    patient = relationship("Patient", back_populates="handovers")

    def __repr__(self):
        return f"<Handover {self.id} - Patient {self.patient_id} - {self.shift_date}>"
