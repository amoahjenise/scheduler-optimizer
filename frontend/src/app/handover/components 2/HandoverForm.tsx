"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Patient,
  Handover,
  HandoverUpdate,
  PatientStatus,
  AcuityLevel,
  IsolationType,
  ShiftType,
  updateHandoverAPI,
  updatePatientAPI,
  PatientCreate,
} from "../../lib/api";
import SmartTextInput from "../../components/SmartTextInput";

interface HandoverFormProps {
  handover: Handover;
  patient: Patient;
  onSave: (handover: Handover) => void;
  onPreview: () => void;
  onPatientUpdate?: (patient: Patient) => void;
  onShiftChange?: (shiftType: "day" | "night") => void;
  onCopyToNewDay?: () => void;
}

// Form sections for navigation
const FORM_SECTIONS = [
  { id: "patient-info", label: "Patient" },
  { id: "static-info", label: "Static" },
  { id: "labs", label: "Labs" },
  { id: "vs-pain", label: "VS/Pain" },
  { id: "iv", label: "IV" },
  { id: "gu", label: "GU" },
  { id: "neuro", label: "Neuro" },
  { id: "resp-cardio", label: "Resp" },
  { id: "gi", label: "GI" },
  { id: "nutrition", label: "Nutrition" },
  { id: "musculoskeletal", label: "MSK" },
  { id: "skin", label: "Skin" },
  { id: "psychosocial", label: "Psycho" },
  { id: "discharge", label: "D/C" },
  { id: "todo", label: "To Do" },
];

// Real room suggestions for HEMA-ONC unit
const ROOM_SUGGESTIONS = [
  "B7.01",
  "B7.02",
  "B7.03",
  "B7.04",
  "B7.05",
  "B7.06",
  "B7.07",
  "B7.08",
  "B7.09",
  "B7.10",
  "B7.11",
  "B7.12",
  "B7.13",
  "B7.14",
  "B7.15",
  "B7.16",
];

const DIAGNOSIS_SUGGESTIONS = [
  "ALL",
  "AML",
  "Neuroblastoma",
  "Hodgkin Lymphoma",
  "Non-Hodgkin Lymphoma",
  "Brain Tumor",
  "Osteosarcoma",
  "Ewing Sarcoma",
  "Wilms Tumor",
  "BMT - Auto",
  "BMT - Allo",
  "Sickle Cell",
  "Aplastic Anemia",
];

const TEAM_OPTIONS = ["Oncology", "BMT", "Hematology", "Neuro-Onc"];

// Shift codes for scheduling
const SHIFT_CODES = [
  { code: "D8-", start: "07:00", end: "15:15", label: "Day 8hr" },
  { code: "E8-", start: "15:00", end: "23:15", label: "Evening 8hr" },
  { code: "N8-", start: "23:00", end: "07:15", label: "Night 8hr" },
  {
    code: "N8+ZE2-",
    start: "23:00/19:00",
    end: "07:15/23:00",
    label: "Night+Eve",
  },
  { code: "ZD12-", start: "07:00", end: "19:25", label: "Day 12hr" },
  { code: "ZE2-", start: "19:00", end: "23:00", label: "Evening 4hr" },
  { code: "ZN-", start: "23:00", end: "07:25", label: "Night 8hr+" },
  {
    code: "ZN+ZE2-",
    start: "23:00/19:00",
    end: "07:25/23:00",
    label: "Night+Eve+",
  },
  { code: "Z11", start: "11:00", end: "23:25", label: "Mid 12hr" },
  { code: "11", start: "11:00", end: "19:15", label: "Mid 8hr" },
];

// Diet options
const DIET_OPTIONS = [
  "NPO",
  "Clear liquids",
  "Full liquids",
  "Soft diet",
  "Regular diet",
  "Low sodium",
  "Cardiac diet",
  "Neutropenic diet",
  "Diabetic diet",
  "Renal diet",
  "High protein",
  "TPN only",
  "Tube feeds",
  "PO + tube feeds",
];

// Activity levels
const ACTIVITY_OPTIONS = [
  "Bed rest",
  "Bed rest with BRP",
  "Up to chair",
  "Up ad lib",
  "Ambulate with assist",
  "Ambulate independently",
  "Activity as tolerated",
  "Fall precautions",
  "Contact precautions",
  "Strict bed rest",
];

// IV access types
const IV_ACCESS_OPTIONS = [
  "PIV",
  "PICC line",
  "Hickman",
  "Broviac",
  "Port-a-cath",
  "CVC",
  "Midline",
  "PIV + Central line",
  "None",
];

// CVAD types
const CVAD_TYPES = [
  "PICC - Single lumen",
  "PICC - Double lumen",
  "PICC - Triple lumen",
  "Hickman - Single",
  "Hickman - Double",
  "Hickman - Triple",
  "Broviac - Single",
  "Broviac - Double",
  "Port-a-cath",
  "Tunneled CVC",
];

// Common chemotherapy drugs
const CHEMO_SUGGESTIONS = [
  "Methotrexate",
  "Vincristine",
  "Doxorubicin",
  "Cyclophosphamide",
  "Cytarabine (ARA-C)",
  "Etoposide",
  "Cisplatin",
  "Carboplatin",
  "Ifosfamide",
  "Asparaginase",
  "6-MP",
  "Dexamethasone",
  "Prednisone",
  "Rituximab",
];

// Pain scale options
const PAIN_SCALE_OPTIONS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
];

// BPEWS score options
const BPEWS_OPTIONS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13+",
];

// Lung assessment options
const LUNG_OPTIONS = [
  "Clear bilateral",
  "Diminished bilateral",
  "Diminished left",
  "Diminished right",
  "Crackles bilateral",
  "Crackles left base",
  "Crackles right base",
  "Wheezing",
  "Rhonchi",
  "Coarse breath sounds",
];

// Code status options
const CODE_STATUS_OPTIONS = [
  "Full code",
  "DNR",
  "DNR/DNI",
  "Comfort care",
  "Limited code",
];

// Tube types for enteral feeding
const TUBE_TYPES = ["NG tube", "G-tube", "G-J tube", "J-tube", "PEG", "None"];

// Section component for organizing the form
function Section({
  id,
  title,
  children,
  className = "",
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={`border border-gray-300 rounded-lg overflow-hidden ${className}`}
    >
      <div className="bg-blue-600 text-white px-3 py-1.5 font-semibold text-sm">
        {title}
      </div>
      <div className="p-3 bg-white">{children}</div>
    </div>
  );
}

// Checkbox field component
function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// Small input field
function SmallInput({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">
        {label}
      </label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}

// Textarea field
function TextArea({
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-gray-600 mb-0.5">
          {label}
        </label>
      )}
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
      />
    </div>
  );
}

// Select with suggestions - allows both dropdown and free text
function SelectWithSuggestions({
  label,
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  const filteredOptions = options.filter(
    (opt) =>
      !inputValue || opt.toLowerCase().includes(inputValue.toLowerCase()),
  );

  return (
    <div className={`relative ${className}`}>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">
        {label}
      </label>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      {showDropdown && filteredOptions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
          {filteredOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 focus:bg-blue-50"
              onMouseDown={(e) => {
                e.preventDefault();
                setInputValue(opt);
                onChange(opt);
                setShowDropdown(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Quick select buttons (for things like pain scale, BPEWS)
function QuickSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(value === opt ? "" : opt)}
            className={`px-2 py-0.5 text-xs rounded border transition-all ${
              value === opt
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HandoverForm({
  handover,
  patient,
  onSave,
  onPreview,
  onPatientUpdate,
  onShiftChange,
  onCopyToNewDay,
}: HandoverFormProps) {
  // Current shift type (editable)
  const [currentShift, setCurrentShift] = useState<"day" | "night">(
    handover.shift_type as "day" | "night",
  );
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("patient-info");
  const initialDataRef = useRef<string>("");

  // Patient data (editable)
  const [patientData, setPatientData] = useState({
    room_number: patient.room_number || "",
    bed: patient.bed || "",
    diagnosis: patient.diagnosis || "",
    team: "Oncology",
  });
  const [showRoomDropdown, setShowRoomDropdown] = useState(false);
  const [showDiagnosisDropdown, setShowDiagnosisDropdown] = useState(false);

  const [formData, setFormData] = useState<HandoverUpdate>({
    outgoing_nurse: handover.outgoing_nurse || "",
    incoming_nurse: handover.incoming_nurse || "",
    status: handover.status,
    acuity: handover.acuity,
    isolation: handover.isolation,
    code_status: handover.code_status,
    code_status_manual: handover.code_status_manual,
    revision_date: handover.revision_date,
    revision_author: handover.revision_author,
    pertinent_issues: handover.pertinent_issues,
    admit_date: handover.admit_date,
    anticipated_discharge: handover.anticipated_discharge,
    allergies: handover.allergies,
    medications_summary: handover.medications_summary,
    prn_medications: handover.prn_medications,
    chemotherapies: handover.chemotherapies,
    wbc: handover.wbc,
    hgb: handover.hgb,
    plt: handover.plt,
    anc: handover.anc,
    abnormal_labs: handover.abnormal_labs,
    // VS/Pain
    abnormal_vitals: handover.abnormal_vitals,
    bpews_score: handover.bpews_score,
    pain_scale: handover.pain_scale,
    pain_location: handover.pain_location,
    pain_relieved_post_med: handover.pain_relieved_post_med,
    pca_checkbox: handover.pca_checkbox,
    nca_checkbox: handover.nca_checkbox,
    pca_nca_bolus: handover.pca_nca_bolus,
    pain_notes: handover.pain_notes,
    monitoring_cardiac: handover.monitoring_cardiac,
    monitoring_o2_sat: handover.monitoring_o2_sat,
    // IV
    iv_access: handover.iv_access,
    cvad_type: handover.cvad_type,
    cvad_dressing: handover.cvad_dressing,
    iv_infusions: handover.iv_infusions,
    tpn: handover.tpn,
    // G.U.
    urine_output: handover.urine_output,
    strict_io: handover.strict_io,
    io_00: handover.io_00,
    io_06: handover.io_06,
    io_12: handover.io_12,
    io_18: handover.io_18,
    foley: handover.foley,
    urine_sg: handover.urine_sg,
    urine_ph: handover.urine_ph,
    urine_ob: handover.urine_ob,
    urine_glucose: handover.urine_glucose,
    urine_ketones: handover.urine_ketones,
    // Neurological
    neuro_normal: handover.neuro_normal,
    altered_loc: handover.altered_loc,
    speech_changes: handover.speech_changes,
    confusion: handover.confusion,
    vp_shunt: handover.vp_shunt,
    glasgow_score: handover.glasgow_score,
    gcs_score: handover.gcs_score,
    neuro_notes: handover.neuro_notes,
    // Resp/Cardio
    lung_assessment: handover.lung_assessment,
    oxygen: handover.oxygen,
    oxygen_needs: handover.oxygen_needs,
    cardiovascular: handover.cardiovascular,
    chest_tube_left: handover.chest_tube_left,
    chest_tube_right: handover.chest_tube_right,
    chest_tube_type_lws: handover.chest_tube_type_lws,
    chest_tube_type_sd: handover.chest_tube_type_sd,
    heart_rate_notes: handover.heart_rate_notes,
    // G.I.
    gi_tenderness: handover.gi_tenderness,
    gi_distention: handover.gi_distention,
    gi_girth: handover.gi_girth,
    vomiting: handover.vomiting,
    vomiting_quantity: handover.vomiting_quantity,
    nausea: handover.nausea,
    last_bowel_movement: handover.last_bowel_movement,
    constipation: handover.constipation,
    diarrhea: handover.diarrhea,
    diarrhea_quantity: handover.diarrhea_quantity,
    colostomy: handover.colostomy,
    bowel_movements: handover.bowel_movements,
    diet: handover.diet,
    // Nutrition
    po_intake: handover.po_intake,
    fluid_intake_po: handover.fluid_intake_po,
    fluid_intake_iv: handover.fluid_intake_iv,
    fluid_intake_ng: handover.fluid_intake_ng,
    weight: handover.weight,
    formula_checkbox: handover.formula_checkbox,
    formula: handover.formula,
    total_fluid: handover.total_fluid,
    breast_milk: handover.breast_milk,
    continuous_feeding: handover.continuous_feeding,
    continuous_feeding_rate: handover.continuous_feeding_rate,
    bolus_feeding: handover.bolus_feeding,
    bolus_amount: handover.bolus_amount,
    ng_tube: handover.ng_tube,
    nj_tube: handover.nj_tube,
    gt_tube: handover.gt_tube,
    npo: handover.npo,
    feeding_goal: handover.feeding_goal,
    see_feeding_schedule: handover.see_feeding_schedule,
    tube_type: handover.tube_type,
    // Musculoskeletal
    mobility_restrictions: handover.mobility_restrictions,
    positioning: handover.positioning,
    assistive_devices: handover.assistive_devices,
    activity: handover.activity,
    // Skin
    braden_q_score: handover.braden_q_score,
    skin_care_plan: handover.skin_care_plan,
    skin_assessment: handover.skin_assessment,
    pressure_sore_stage: handover.pressure_sore_stage,
    pressure_sore_location: handover.pressure_sore_location,
    pressure_sore_treatment: handover.pressure_sore_treatment,
    pressure_sore_staging: handover.pressure_sore_staging,
    // Psycho-Social
    psychosocial_notes: handover.psychosocial_notes,
    family_notes: handover.family_notes,
    // Discharge Planning
    expected_discharge_date: handover.expected_discharge_date,
    discharge_teaching: handover.discharge_teaching,
    discharge_prescriptions: handover.discharge_prescriptions,
    home_enteral_feeding: handover.home_enteral_feeding,
    followup_appointments: handover.followup_appointments,
    // To Do
    todo_items: handover.todo_items,
    followup_items: handover.followup_items,
  });

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Store initial form data to detect changes
  useEffect(() => {
    initialDataRef.current = JSON.stringify(formData);
  }, []);

  // Handle shift change
  const handleShiftChange = (newShift: "day" | "night") => {
    setCurrentShift(newShift);
    updateField("shift_type", newShift);
    if (onShiftChange) onShiftChange(newShift);
  };

  // Track active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const sections = FORM_SECTIONS.map((s) => document.getElementById(s.id));
      const scrollPos = window.scrollY + 200;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section && section.offsetTop <= scrollPos) {
          setActiveSection(FORM_SECTIONS[i].id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll to section
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const offset = 180; // Account for sticky headers
      const top = element.offsetTop - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  // Update patient data
  const updatePatientField = async (
    field: keyof typeof patientData,
    value: string,
  ) => {
    setPatientData((prev) => ({ ...prev, [field]: value }));

    // Auto-save patient changes
    try {
      const updateData: Partial<PatientCreate> = {};
      if (field === "room_number") updateData.room_number = value;
      if (field === "bed") updateData.bed = value;
      if (field === "diagnosis") updateData.diagnosis = value;

      if (Object.keys(updateData).length > 0) {
        const updated = await updatePatientAPI(patient.id, updateData);
        if (onPatientUpdate) onPatientUpdate(updated);
      }
    } catch (err) {
      console.error("Failed to update patient:", err);
    }
  };

  // Save function
  const saveForm = useCallback(async () => {
    if (!isDirty) return;

    setSaving(true);
    setSaveStatus("saving");
    try {
      const updated = await updateHandoverAPI(handover.id, formData);
      onSave(updated);
      setLastSaved(new Date());
      setSaveStatus("saved");
      setIsDirty(false);
      initialDataRef.current = JSON.stringify(formData);
      // Reset to idle after showing saved message
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      console.error("Save failed");
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }, [handover.id, formData, onSave, isDirty]);

  // Auto-save with debounce - only when dirty
  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      saveForm();
    }, 3000); // 3 second debounce

    return () => clearTimeout(timer);
  }, [isDirty, saveForm]);

  const updateField = <K extends keyof HandoverUpdate>(
    field: K,
    value: HandoverUpdate[K],
  ) => {
    setFormData((prev) => {
      const newData = { ...prev, [field]: value };
      // Check if data actually changed
      if (JSON.stringify(newData) !== initialDataRef.current) {
        setIsDirty(true);
      }
      return newData;
    });
  };

  const calculateAge = (dob?: string) => {
    if (!dob) return "N/A";
    const birth = new Date(dob);
    const now = new Date();
    const years = now.getFullYear() - birth.getFullYear();
    const months = now.getMonth() - birth.getMonth();
    if (years < 2) {
      return `${years * 12 + months} months`;
    }
    return `${years} years`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Sticky Section Navigation */}
      <div className="sticky top-[140px] z-30 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 -mx-4 px-4 py-2 mb-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {FORM_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-all ${
                activeSection === section.id
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {section.label}
            </button>
          ))}
          {/* Dirty indicator */}
          {isDirty && (
            <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 font-medium">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* Save Status Toast */}
      {saveStatus !== "idle" && (
        <div
          className={`fixed top-20 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all ${
            saveStatus === "saving"
              ? "bg-blue-500 text-white"
              : saveStatus === "saved"
                ? "bg-green-500 text-white"
                : "bg-red-500 text-white"
          }`}
        >
          {saveStatus === "saving" && (
            <span className="flex items-center gap-2">
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Saved
            </span>
          )}
          {saveStatus === "error" && "Save failed - will retry"}
        </div>
      )}

      {/* Header */}
      <div
        id="patient-info"
        className="bg-white border border-gray-300 rounded-lg p-4 mb-4"
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Hand-Off Report</h1>
            <p className="text-sm text-gray-500">
              Montreal Children&apos;s Hospital - HEMA-ONCOLOGY
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-sm font-medium">
              {new Date().toLocaleDateString("en-CA")}
            </div>
            {/* Shift indicator (read-only - toggle is in header) */}
            <div
              className={`px-3 py-1 text-xs font-medium rounded-lg ${
                currentShift === "day"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-indigo-100 text-indigo-800"
              }`}
            >
              {currentShift === "day" ? "☀️ Day Shift" : "🌙 Night Shift"}
            </div>
          </div>
        </div>

        {/* Nurse Assignment Row */}
        <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div>
            <label className="block text-xs font-semibold text-blue-700 mb-1">
              Outgoing Nurse (Giving Report)
            </label>
            <input
              type="text"
              value={formData.outgoing_nurse || ""}
              onChange={(e) => updateField("outgoing_nurse", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              placeholder="Your name..."
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-blue-700 mb-1">
              Incoming Nurse (Receiving Report)
            </label>
            <input
              type="text"
              value={formData.incoming_nurse || ""}
              onChange={(e) => updateField("incoming_nurse", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              placeholder="Receiving nurse name..."
            />
          </div>
        </div>

        {/* Patient Info Row - EDITABLE */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          {/* Room # - Editable with dropdown */}
          <div className="border border-gray-300 rounded p-2 relative">
            <div className="text-xs text-gray-500">Room #</div>
            <input
              type="text"
              value={patientData.room_number}
              onChange={(e) =>
                setPatientData((p) => ({ ...p, room_number: e.target.value }))
              }
              onFocus={() => setShowRoomDropdown(true)}
              onBlur={() =>
                setTimeout(() => {
                  setShowRoomDropdown(false);
                  updatePatientField("room_number", patientData.room_number);
                }, 150)
              }
              className="w-full font-semibold text-sm border-0 p-0 focus:ring-0 bg-transparent"
              placeholder="B7.01"
            />
            {showRoomDropdown && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {ROOM_SUGGESTIONS.filter((r) =>
                  r
                    .toLowerCase()
                    .includes(patientData.room_number.toLowerCase()),
                ).map((room) => (
                  <button
                    key={room}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPatientData((p) => ({ ...p, room_number: room }));
                      updatePatientField("room_number", room);
                      setShowRoomDropdown(false);
                    }}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-blue-50"
                  >
                    {room}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Patient Name / Age / Team */}
          <div className="col-span-2 border border-gray-300 rounded p-2">
            <div className="text-xs text-gray-500">
              Patient Name / Age / Team
            </div>
            <div className="flex items-center gap-1">
              <span className="font-semibold text-sm">
                {patient.last_name}, {patient.first_name} /{" "}
                {calculateAge(patient.date_of_birth)} /
              </span>
              <select
                value={patientData.team}
                onChange={(e) =>
                  setPatientData((p) => ({ ...p, team: e.target.value }))
                }
                className="font-semibold text-sm border-0 p-0 focus:ring-0 bg-transparent"
              >
                {TEAM_OPTIONS.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border border-gray-300 rounded p-2">
            <div className="text-xs text-gray-500">MRN</div>
            <div className="font-semibold">{patient.mrn}</div>
          </div>
          <div className="border border-gray-300 rounded p-2">
            <div className="text-xs text-gray-500 mb-1">Code Status</div>
            <select
              value={formData.code_status || ""}
              onChange={(e) => updateField("code_status", e.target.value)}
              className="w-full text-sm border-0 p-0 focus:ring-0 mb-1"
            >
              <option value="">Select...</option>
              {CODE_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={formData.code_status_manual || ""}
              onChange={(e) =>
                updateField("code_status_manual", e.target.value)
              }
              placeholder="Or type manually..."
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Diagnosis and Pertinent Issues - EDITABLE */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-300 rounded p-2 relative">
            <div className="text-xs text-gray-500 mb-1">Diagnosis</div>
            <input
              type="text"
              value={patientData.diagnosis}
              onChange={(e) =>
                setPatientData((p) => ({ ...p, diagnosis: e.target.value }))
              }
              onFocus={() => setShowDiagnosisDropdown(true)}
              onBlur={() =>
                setTimeout(() => {
                  setShowDiagnosisDropdown(false);
                  updatePatientField("diagnosis", patientData.diagnosis);
                }, 150)
              }
              className="w-full font-medium text-sm border-0 p-0 focus:ring-0 bg-transparent"
              placeholder="e.g., ALL, AML, Neuroblastoma"
            />
            {showDiagnosisDropdown && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {DIAGNOSIS_SUGGESTIONS.filter((d) =>
                  d.toLowerCase().includes(patientData.diagnosis.toLowerCase()),
                )
                  .slice(0, 6)
                  .map((diag) => (
                    <button
                      key={diag}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPatientData((p) => ({ ...p, diagnosis: diag }));
                        updatePatientField("diagnosis", diag);
                        setShowDiagnosisDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-blue-50"
                    >
                      {diag}
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="border border-gray-300 rounded p-2">
            <div className="text-xs text-gray-500 mb-1">
              Most Current / Pertinent Issues
            </div>
            <SmartTextInput
              value={formData.pertinent_issues || ""}
              onChange={(v) => updateField("pertinent_issues", v)}
              fieldType="pertinent_issues"
              multiline
              rows={2}
              className="w-full text-sm border-0 p-0 focus:ring-0 resize-none"
              placeholder="e.g., SCT D59, Skin GVHD GR3, HTN... (start typing for suggestions)"
            />
          </div>
        </div>
      </div>

      {/* Static Info Section */}
      <div
        id="static-info"
        className="bg-gray-50 border border-gray-300 rounded-lg p-4 mb-4"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Static Information (carries over between shifts)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Admit Date - Date Picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Admit Date
            </label>
            <input
              type="date"
              value={formData.admit_date || ""}
              onChange={(e) => updateField("admit_date", e.target.value)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {/* Anticipated date of d/c - Date Picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Anticipated date of d/c
            </label>
            <input
              type="date"
              value={formData.anticipated_discharge || ""}
              onChange={(e) =>
                updateField("anticipated_discharge", e.target.value)
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="col-span-2">
            <SmallInput
              label="Allergies"
              value={formData.allergies}
              onChange={(v) => updateField("allergies", v)}
              placeholder="NKDA or list allergies"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <TextArea
            label="Medications"
            value={formData.medications_summary}
            onChange={(v) => updateField("medications_summary", v)}
            placeholder="List current medications..."
            rows={2}
          />
          <TextArea
            label="PRN"
            value={formData.prn_medications}
            onChange={(v) => updateField("prn_medications", v)}
            placeholder="List PRN medications..."
            rows={2}
          />
        </div>
        <div className="mt-3">
          <TextArea
            label="Chemotherapies"
            value={formData.chemotherapies}
            onChange={(v) => updateField("chemotherapies", v)}
            placeholder="Current chemotherapy regimen..."
            rows={2}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Isolation Type
            </label>
            <select
              value={formData.isolation || "none"}
              onChange={(e) =>
                updateField("isolation", e.target.value as IsolationType)
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="none">None</option>
              <option value="contact">Contact</option>
              <option value="droplet">Droplet</option>
              <option value="airborne">Airborne</option>
              <option value="neutropenic">Neutropenic</option>
              <option value="protective">Protective</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Status
            </label>
            <select
              value={formData.status || "stable"}
              onChange={(e) =>
                updateField("status", e.target.value as PatientStatus)
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="stable">Stable</option>
              <option value="improved">Improved</option>
              <option value="unchanged">Unchanged</option>
              <option value="worsening">Worsening</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Acuity
            </label>
            <select
              value={formData.acuity || "moderate"}
              onChange={(e) =>
                updateField("acuity", e.target.value as AcuityLevel)
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
      </div>

      {/* Labs Section */}
      <Section id="labs" title="Labs" className="mb-4">
        <div className="grid grid-cols-5 gap-3">
          <SmallInput
            label="WBC"
            value={formData.wbc}
            onChange={(v) => updateField("wbc", v)}
          />
          <SmallInput
            label="Hgb"
            value={formData.hgb}
            onChange={(v) => updateField("hgb", v)}
          />
          <SmallInput
            label="PLT"
            value={formData.plt}
            onChange={(v) => updateField("plt", v)}
          />
          <SmallInput
            label="ANC"
            value={formData.anc}
            onChange={(v) => updateField("anc", v)}
          />
          <div className="col-span-1">
            <SmallInput
              label="Abnormal Labs"
              value={formData.abnormal_labs}
              onChange={(v) => updateField("abnormal_labs", v)}
            />
          </div>
        </div>
      </Section>

      {/* Dynamic Sections Grid - Per Shift */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* VS/Pain */}
        <Section id="vs-pain" title="VS / Pain">
          <div className="space-y-2">
            <TextArea
              label="Vital signs (abnormal)"
              value={formData.abnormal_vitals}
              onChange={(v) => updateField("abnormal_vitals", v)}
              rows={1}
            />
            <div className="grid grid-cols-2 gap-2">
              <QuickSelect
                label="BPWES"
                value={formData.bpews_score}
                onChange={(v) => updateField("bpews_score", v)}
                options={BPEWS_OPTIONS}
              />
              <QuickSelect
                label="Pain Scale"
                value={formData.pain_scale}
                onChange={(v) => updateField("pain_scale", v)}
                options={PAIN_SCALE_OPTIONS}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SmallInput
                label="Pain Location"
                value={formData.pain_location}
                onChange={(v) => updateField("pain_location", v)}
                placeholder="Location..."
              />
              <SmallInput
                label="Relieved post med"
                value={formData.pain_relieved_post_med}
                onChange={(v) => updateField("pain_relieved_post_med", v)}
                placeholder="Yes/No/Time..."
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-2">
              <CheckField
                label="PCA"
                checked={formData.pca_checkbox}
                onChange={(v) => updateField("pca_checkbox", v)}
              />
              <CheckField
                label="NCA"
                checked={formData.nca_checkbox}
                onChange={(v) => updateField("nca_checkbox", v)}
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-600"># Bolus:</span>
                <input
                  type="text"
                  value={formData.pca_nca_bolus || ""}
                  onChange={(e) => updateField("pca_nca_bolus", e.target.value)}
                  className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                  placeholder="#"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-2 pt-2 border-t border-gray-200">
              <span className="text-xs font-medium text-gray-700">
                Monitoring:
              </span>
              <CheckField
                label="Cardiac"
                checked={formData.monitoring_cardiac}
                onChange={(v) => updateField("monitoring_cardiac", v)}
              />
              <CheckField
                label="O2 Sat"
                checked={formData.monitoring_o2_sat}
                onChange={(v) => updateField("monitoring_o2_sat", v)}
              />
            </div>
          </div>
        </Section>

        {/* IV */}
        <Section id="iv" title="I.V.">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <SelectWithSuggestions
                label="CVAD Type"
                value={formData.cvad_type}
                onChange={(v) => updateField("cvad_type", v)}
                options={CVAD_TYPES}
                placeholder="Select or type..."
              />
              <SmallInput
                label="Dressing"
                value={formData.cvad_dressing}
                onChange={(v) => updateField("cvad_dressing", v)}
                placeholder="Date/Status"
              />
            </div>
            <TextArea
              label="IV Infusions"
              value={formData.iv_infusions}
              onChange={(v) => updateField("iv_infusions", v)}
              rows={1}
            />
            <TextArea
              label="TPN"
              value={formData.tpn}
              onChange={(v) => updateField("tpn", v)}
              rows={1}
            />
          </div>
        </Section>

        {/* G.U. */}
        <Section id="gu" title="G.U.">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4 items-center">
              <TextArea
                label="Urine output"
                value={formData.urine_output}
                onChange={(v) => updateField("urine_output", v)}
                rows={1}
              />
              <CheckField
                label="Strict I&O"
                checked={formData.strict_io}
                onChange={(v) => updateField("strict_io", v)}
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <SmallInput
                label="I/O 00h"
                value={formData.io_00}
                onChange={(v) => updateField("io_00", v)}
              />
              <SmallInput
                label="I/O 06h"
                value={formData.io_06}
                onChange={(v) => updateField("io_06", v)}
              />
              <SmallInput
                label="I/O 12h"
                value={formData.io_12}
                onChange={(v) => updateField("io_12", v)}
              />
              <SmallInput
                label="I/O 18h"
                value={formData.io_18}
                onChange={(v) => updateField("io_18", v)}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <CheckField
                label="Foley"
                checked={formData.foley}
                onChange={(v) => updateField("foley", v)}
              />
              <SmallInput
                label="SG"
                value={formData.urine_sg}
                onChange={(v) => updateField("urine_sg", v)}
                className="w-16"
              />
              <SmallInput
                label="Ph"
                value={formData.urine_ph}
                onChange={(v) => updateField("urine_ph", v)}
                className="w-16"
              />
              <SmallInput
                label="OB"
                value={formData.urine_ob}
                onChange={(v) => updateField("urine_ob", v)}
                className="w-16"
              />
              <SmallInput
                label="Gluc"
                value={formData.urine_glucose}
                onChange={(v) => updateField("urine_glucose", v)}
                className="w-16"
              />
              <SmallInput
                label="Ket"
                value={formData.urine_ketones}
                onChange={(v) => updateField("urine_ketones", v)}
                className="w-16"
              />
            </div>
          </div>
        </Section>

        {/* Neurological */}
        <Section id="neuro" title="Neurological">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4">
              <CheckField
                label="Normal"
                checked={formData.neuro_normal}
                onChange={(v) => updateField("neuro_normal", v)}
              />
              <CheckField
                label="LOC altered"
                checked={formData.altered_loc}
                onChange={(v) => updateField("altered_loc", v)}
              />
              <CheckField
                label="Speech pattern altered"
                checked={formData.speech_changes}
                onChange={(v) => updateField("speech_changes", v)}
              />
              <CheckField
                label="Confusion"
                checked={formData.confusion}
                onChange={(v) => updateField("confusion", v)}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <CheckField
                label="VP shunt/other"
                checked={formData.vp_shunt}
                onChange={(v) => updateField("vp_shunt", v)}
              />
              <SmallInput
                label="Glasgow"
                value={formData.glasgow_score}
                onChange={(v) => updateField("glasgow_score", v)}
                className="w-20"
              />
            </div>
            <TextArea
              label="Notes"
              value={formData.neuro_notes}
              onChange={(v) => updateField("neuro_notes", v)}
              rows={1}
            />
          </div>
        </Section>

        {/* Resp/Cardio */}
        <Section id="resp-cardio" title="Resp / Cardio">
          <div className="space-y-2">
            <SelectWithSuggestions
              label="Lungs"
              value={formData.lung_assessment}
              onChange={(v) => updateField("lung_assessment", v)}
              options={LUNG_OPTIONS}
              placeholder="Select or type..."
            />
            <div className="grid grid-cols-2 gap-2">
              <SmallInput
                label="Oxygen"
                value={formData.oxygen}
                onChange={(v) => updateField("oxygen", v)}
                placeholder="e.g., 2L NC, RA"
              />
              <SmallInput
                label="Cardiovascular"
                value={formData.cardiovascular}
                onChange={(v) => updateField("cardiovascular", v)}
                placeholder="Assessment..."
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-2 pt-2 border-t border-gray-200">
              <span className="text-xs font-medium text-gray-700">
                Chest tube:
              </span>
              <CheckField
                label="L"
                checked={formData.chest_tube_left}
                onChange={(v) => updateField("chest_tube_left", v)}
              />
              <CheckField
                label="R"
                checked={formData.chest_tube_right}
                onChange={(v) => updateField("chest_tube_right", v)}
              />
              <span className="text-xs font-medium text-gray-700 ml-2">
                Type:
              </span>
              <CheckField
                label="LWS"
                checked={formData.chest_tube_type_lws}
                onChange={(v) => updateField("chest_tube_type_lws", v)}
              />
              <CheckField
                label="SD"
                checked={formData.chest_tube_type_sd}
                onChange={(v) => updateField("chest_tube_type_sd", v)}
              />
            </div>
            <TextArea
              label="Heart Rate Notes"
              value={formData.heart_rate_notes}
              onChange={(v) => updateField("heart_rate_notes", v)}
              rows={1}
            />
          </div>
        </Section>

        {/* G.I. */}
        <Section id="gi" title="G.I.">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4">
              <CheckField
                label="Abnormal tenderness"
                checked={formData.gi_tenderness}
                onChange={(v) => updateField("gi_tenderness", v)}
              />
              <CheckField
                label="Distention"
                checked={formData.gi_distention}
                onChange={(v) => updateField("gi_distention", v)}
              />
              <SmallInput
                label="Girth"
                value={formData.gi_girth}
                onChange={(v) => updateField("gi_girth", v)}
                className="w-20"
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <CheckField
                label="Vomiting"
                checked={formData.vomiting}
                onChange={(v) => updateField("vomiting", v)}
              />
              <SmallInput
                label="Quantity"
                value={formData.vomiting_quantity}
                onChange={(v) => updateField("vomiting_quantity", v)}
                className="w-24"
              />
              <CheckField
                label="Nausea"
                checked={formData.nausea}
                onChange={(v) => updateField("nausea", v)}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <SmallInput
                label="Last bowel movement"
                value={formData.last_bowel_movement}
                onChange={(v) => updateField("last_bowel_movement", v)}
                placeholder="Date/Time..."
              />
              <CheckField
                label="Constipation"
                checked={formData.constipation}
                onChange={(v) => updateField("constipation", v)}
              />
              <CheckField
                label="Diarrhea"
                checked={formData.diarrhea}
                onChange={(v) => updateField("diarrhea", v)}
              />
              <SmallInput
                label="Qty"
                value={formData.diarrhea_quantity}
                onChange={(v) => updateField("diarrhea_quantity", v)}
                className="w-20"
              />
              <CheckField
                label="Colostomy"
                checked={formData.colostomy}
                onChange={(v) => updateField("colostomy", v)}
              />
            </div>
          </div>
        </Section>

        {/* Nutrition */}
        <Section id="nutrition" title="Nutrition">
          <div className="space-y-2">
            <SelectWithSuggestions
              label="Diet"
              value={formData.diet}
              onChange={(v) => updateField("diet", v)}
              options={DIET_OPTIONS}
              placeholder="Select or type diet..."
            />
            <div className="grid grid-cols-3 gap-2">
              <SmallInput
                label="PO intake"
                value={formData.po_intake}
                onChange={(v) => updateField("po_intake", v)}
              />
              <SmallInput
                label="Weight"
                value={formData.weight}
                onChange={(v) => updateField("weight", v)}
                placeholder="kg"
              />
              <SmallInput
                label="Total Fluid"
                value={formData.total_fluid}
                onChange={(v) => updateField("total_fluid", v)}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center pt-2 border-t border-gray-200">
              <span className="text-xs font-medium text-gray-700">
                Fluid intake:
              </span>
              <SmallInput
                label="PO"
                value={formData.fluid_intake_po}
                onChange={(v) => updateField("fluid_intake_po", v)}
                className="w-20"
              />
              <SmallInput
                label="IV"
                value={formData.fluid_intake_iv}
                onChange={(v) => updateField("fluid_intake_iv", v)}
                className="w-20"
              />
              <SmallInput
                label="NG"
                value={formData.fluid_intake_ng}
                onChange={(v) => updateField("fluid_intake_ng", v)}
                className="w-20"
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <CheckField
                label="Formula"
                checked={formData.formula_checkbox}
                onChange={(v) => updateField("formula_checkbox", v)}
              />
              <SmallInput
                label=""
                value={formData.formula}
                onChange={(v) => updateField("formula", v)}
                placeholder="Type..."
                className="w-32"
              />
              <CheckField
                label="Breast milk"
                checked={formData.breast_milk}
                onChange={(v) => updateField("breast_milk", v)}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <CheckField
                label="Continuous feeding"
                checked={formData.continuous_feeding}
                onChange={(v) => updateField("continuous_feeding", v)}
              />
              <SmallInput
                label="ml/h"
                value={formData.continuous_feeding_rate}
                onChange={(v) => updateField("continuous_feeding_rate", v)}
                className="w-20"
              />
              <CheckField
                label="Bolus"
                checked={formData.bolus_feeding}
                onChange={(v) => updateField("bolus_feeding", v)}
              />
              <SmallInput
                label="Amount"
                value={formData.bolus_amount}
                onChange={(v) => updateField("bolus_amount", v)}
                className="w-24"
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center pt-2 border-t border-gray-200">
              <CheckField
                label="NG"
                checked={formData.ng_tube}
                onChange={(v) => updateField("ng_tube", v)}
              />
              <CheckField
                label="NJ"
                checked={formData.nj_tube}
                onChange={(v) => updateField("nj_tube", v)}
              />
              <CheckField
                label="GT"
                checked={formData.gt_tube}
                onChange={(v) => updateField("gt_tube", v)}
              />
              <CheckField
                label="NPO"
                checked={formData.npo}
                onChange={(v) => updateField("npo", v)}
              />
              <SmallInput
                label="Goal"
                value={formData.feeding_goal}
                onChange={(v) => updateField("feeding_goal", v)}
                placeholder="ml/kg/day..."
                className="w-28"
              />
              <CheckField
                label="See feeding schedule"
                checked={formData.see_feeding_schedule}
                onChange={(v) => updateField("see_feeding_schedule", v)}
              />
            </div>
          </div>
        </Section>

        {/* Musculoskeletal */}
        <Section id="musculoskeletal" title="Musculoskeletal">
          <div className="space-y-2">
            <SelectWithSuggestions
              label="Activity Level"
              value={formData.activity}
              onChange={(v) => updateField("activity", v)}
              options={ACTIVITY_OPTIONS}
              placeholder="Select or type activity level..."
            />
            <TextArea
              label="Mobility Restrictions"
              value={formData.mobility_restrictions}
              onChange={(v) => updateField("mobility_restrictions", v)}
              rows={1}
            />
            <TextArea
              label="Positioning"
              value={formData.positioning}
              onChange={(v) => updateField("positioning", v)}
              rows={1}
            />
            <TextArea
              label="Assistive Devices"
              value={formData.assistive_devices}
              onChange={(v) => updateField("assistive_devices", v)}
              rows={1}
            />
          </div>
        </Section>

        {/* Skin - Braden/Braden Q */}
        <Section id="skin" title="Braden/Braden Q">
          <div className="space-y-2">
            <SmallInput
              label="Braden Q Score"
              value={formData.braden_q_score}
              onChange={(v) => updateField("braden_q_score", v)}
            />
            <TextArea
              label="Skin assessment"
              value={formData.skin_assessment}
              onChange={(v) => updateField("skin_assessment", v)}
              rows={1}
              placeholder="General skin condition..."
            />
            <TextArea
              label="Skin Care Plan"
              value={formData.skin_care_plan}
              onChange={(v) => updateField("skin_care_plan", v)}
              rows={1}
            />
            <div className="grid grid-cols-3 gap-2">
              <SmallInput
                label="Pressure Sore Stage"
                value={formData.pressure_sore_stage}
                onChange={(v) => updateField("pressure_sore_stage", v)}
                placeholder="I, II, III, IV"
              />
              <SmallInput
                label="Location"
                value={formData.pressure_sore_location}
                onChange={(v) => updateField("pressure_sore_location", v)}
                placeholder="Anatomical location"
              />
              <SmallInput
                label="Treatment"
                value={formData.pressure_sore_treatment}
                onChange={(v) => updateField("pressure_sore_treatment", v)}
                placeholder="Treatment plan"
              />
            </div>
          </div>
        </Section>

        {/* Psycho-Social */}
        <Section id="psychosocial" title="Psycho-Social">
          <div className="space-y-2">
            <TextArea
              label="Patient/Family Concerns"
              value={formData.psychosocial_notes}
              onChange={(v) => updateField("psychosocial_notes", v)}
              rows={2}
            />
            <TextArea
              label="Family Notes"
              value={formData.family_notes}
              onChange={(v) => updateField("family_notes", v)}
              rows={2}
            />
          </div>
        </Section>
      </div>

      {/* Page 2: Discharge Planning */}
      <div
        id="discharge"
        className="bg-white border border-gray-300 rounded-lg p-4 mb-4"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Discharge Planning
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Expected Discharge Date
            </label>
            <input
              type="date"
              value={formData.expected_discharge_date || ""}
              onChange={(e) =>
                updateField("expected_discharge_date", e.target.value)
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <SmallInput
            label="Home Enteral Feeding Program"
            value={formData.home_enteral_feeding}
            onChange={(v) => updateField("home_enteral_feeding", v)}
          />
          <TextArea
            label="Teaching"
            value={formData.discharge_teaching}
            onChange={(v) => updateField("discharge_teaching", v)}
            rows={2}
          />
          <TextArea
            label="D/C Prescriptions"
            value={formData.discharge_prescriptions}
            onChange={(v) => updateField("discharge_prescriptions", v)}
            rows={2}
          />
        </div>
        <div className="mt-3">
          <TextArea
            label="Follow-up Appointments"
            value={formData.followup_appointments}
            onChange={(v) => updateField("followup_appointments", v)}
            rows={2}
          />
        </div>
      </div>

      {/* Page 2: To Do & Follow Up */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Section id="todo" title="To Do">
          <TextArea
            value={formData.todo_items}
            onChange={(v) => updateField("todo_items", v)}
            rows={4}
            placeholder="• Task 1&#10;• Task 2&#10;• Task 3&#10;• Task 4"
          />
        </Section>
        <Section title="Follow Up">
          <TextArea
            value={formData.followup_items}
            onChange={(v) => updateField("followup_items", v)}
            rows={4}
            placeholder="• Pending result 1&#10;• Pending result 2&#10;• Monitor..."
          />
        </Section>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center bg-white border border-gray-300 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
              saveStatus === "saving"
                ? "bg-blue-100 text-blue-700"
                : saveStatus === "saved"
                  ? "bg-green-100 text-green-700"
                  : saveStatus === "error"
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
            }`}
          >
            {saveStatus === "saving" && (
              <>
                <span className="animate-spin h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full" />
                Saving...
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Saved
              </>
            )}
            {saveStatus === "error" && "Save failed"}
            {saveStatus === "idle" && (
              <>
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                Auto-save on
              </>
            )}
          </div>
          {lastSaved && saveStatus === "idle" && (
            <span className="text-xs text-gray-400">
              Last: {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {onCopyToNewDay && (
            <button
              onClick={onCopyToNewDay}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-300 rounded-lg hover:bg-green-100"
              title="Create hand-off for next shift with this data as template"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                />
              </svg>
              Copy to New Day
            </button>
          )}
          <button
            onClick={onPreview}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
              />
            </svg>
            Preview & Print
          </button>
          <button
            onClick={() => saveForm()}
            disabled={saving || !isDirty}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              isDirty
                ? "text-white bg-blue-600 hover:bg-blue-700"
                : "text-gray-400 bg-gray-100 cursor-not-allowed"
            } disabled:opacity-50`}
          >
            {saving ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                Saving...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Save Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Version footer */}
      {(formData.revision_date || formData.revision_author) && (
        <div className="mt-4 text-xs text-gray-400 text-center">
          {formData.revision_date && `Revised - ${formData.revision_date}`}
          {formData.revision_date && formData.revision_author && ": "}
          {formData.revision_author}
        </div>
      )}
    </div>
  );
}
