"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Patient,
  Handover,
  HandoverUpdate,
  PatientStatus,
  AcuityLevel,
  IsolationType,
  ShiftType,
  updateHandoverAPI,
  completeHandoverAPI,
  updatePatientAPI,
  PatientCreate,
} from "../../lib/api";
import SmartTextInput from "../../components/SmartTextInput";
import { loadPatientConfig, PatientFieldConfig } from "../../lib/patientConfig";
import { loadRooms } from "../../lib/roomsConfig";
import { loadTeams, DEFAULT_TEAMS } from "../../lib/teamsConfig";

interface HandoverFormProps {
  handover: Handover;
  patient: Patient;
  onSave: (handover: Handover) => void;
  onPreview: (handover: Handover, patient: Patient) => void;
  onPatientUpdate?: (patient: Patient) => void;
  onShiftChange?: (shiftType: "day" | "night") => void;
  readOnly?: boolean;
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

// Real room suggestions for HEMA-ONC unit (loaded from config)

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
  "SCIDS",
];

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
  "PIV",
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
  "Jugular",
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
  "Goal A (Full Code)",
  "Goal B (Prolong life with some limitations to care)",
  "Goal C (Ensure Comfort as a priority over prolonging life)",
  "Goal D (DNR)",
];

// Tube types for enteral feeding
const TUBE_TYPES = ["NG tube", "G-tube", "G-J tube", "J-tube", "PEG", "None"];

// Common allergies
const COMMON_ALLERGIES = [
  "NKA (No Known Allergies)",
  "Penicillin",
  "Sulfa drugs",
  "Latex",
  "Iodine",
  "Aspirin",
  "NSAIDs",
  "Codeine",
  "Morphine",
  "Eggs",
  "Peanuts",
  "Tree nuts",
  "Shellfish",
  "Contrast dye",
];

// InfoTip: hoverable info icon showing where to find a field's data
function InfoTip({ tip, light = false }: { tip?: string; light?: boolean }) {
  if (!tip) return null;
  return (
    <span
      className="relative inline-block group align-middle ml-1"
      style={{ lineHeight: 0 }}
    >
      <span
        className={`cursor-help text-xs font-normal select-none ${
          light ? "text-blue-200" : "text-blue-400"
        }`}
      >
        ⓘ
      </span>
      <span
        className="absolute z-50 bottom-full left-0 mb-1.5 w-64 bg-gray-900 text-white text-xs rounded-md px-2.5 py-2
                   opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-xl whitespace-normal"
        style={{ minWidth: "14rem" }}
      >
        {tip}
        <span className="absolute top-full left-3 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  );
}

// Section component for organizing the form
function Section({
  id,
  title,
  infoTip,
  children,
  className = "",
  allowOverflow = false,
}: {
  id?: string;
  title: string;
  infoTip?: string;
  children: React.ReactNode;
  className?: string;
  allowOverflow?: boolean;
}) {
  return (
    <div
      id={id}
      className={`border border-gray-300 rounded-lg ${allowOverflow ? "overflow-visible" : "overflow-hidden"} ${className}`}
    >
      <div className="bg-blue-600 text-white px-3 py-1.5 font-semibold text-sm flex items-center gap-0.5">
        {title}
        {infoTip && <InfoTip tip={infoTip} light />}
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
  label: React.ReactNode;
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
  infoTip,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  infoTip?: string;
}) {
  return (
    <div className={className}>
      <label className="flex items-center text-xs font-medium text-gray-600 mb-0.5">
        {label}
        {infoTip && <InfoTip tip={infoTip} />}
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
  infoTip,
}: {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  infoTip?: string;
}) {
  return (
    <div>
      {label && (
        <label className="flex items-center text-xs font-medium text-gray-600 mb-0.5">
          {label}
          {infoTip && <InfoTip tip={infoTip} />}
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
  infoTip,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  infoTip?: string;
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
      <label className="flex items-center text-xs font-medium text-gray-600 mb-0.5">
        {label}
        {infoTip && <InfoTip tip={infoTip} />}
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
  infoTip,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: string[];
  infoTip?: string;
}) {
  return (
    <div>
      <label className="flex items-center text-xs font-medium text-gray-600 mb-1">
        {label}
        {infoTip && <InfoTip tip={infoTip} />}
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
  readOnly = false,
}: HandoverFormProps) {
  const { user } = useUser();
  const isFormReadOnly = readOnly || handover.is_completed;
  // Load patient field configuration
  const [patientConfig, setPatientConfig] = useState<PatientFieldConfig>(() =>
    loadPatientConfig(),
  );
  // Current shift type (editable)
  const [currentShift, setCurrentShift] = useState<"day" | "night">(
    handover.shift_type as "day" | "night",
  );
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [completing, setCompleting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("patient-info");
  const initialDataRef = useRef<string>("");

  // Reload patient config when settings change
  useEffect(() => {
    const handleStorageChange = () => {
      setPatientConfig(loadPatientConfig());
    };
    window.addEventListener("storage", handleStorageChange);
    // Also listen for custom event for same-window updates
    window.addEventListener("patientConfigChanged", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("patientConfigChanged", handleStorageChange);
    };
  }, []);

  // Patient data (editable)
  const [patientData, setPatientData] = useState({
    room_number: patient.room_number || "",
    bed: patient.bed || "",
    diagnosis: patient.diagnosis || "",
    mrn: patient.mrn || "",
    first_name: patient.first_name || "",
    last_name: patient.last_name || "",
    date_of_birth: patient.date_of_birth || "",
    age: patient.age || "",
    team: loadTeams()[0] || DEFAULT_TEAMS[0],
  });
  const [teamOptions, setTeamOptions] = useState<string[]>(loadTeams());
  const [showRoomDropdown, setShowRoomDropdown] = useState(false);
  const [showDiagnosisDropdown, setShowDiagnosisDropdown] = useState(false);
  const [showBowelDropdown, setShowBowelDropdown] = useState(false);
  const bowelDropdownRef = useRef<HTMLDivElement>(null);
  const [roomSuggestions, setRoomSuggestions] = useState<string[]>(loadRooms());

  // Load rooms from config and listen for changes
  useEffect(() => {
    setRoomSuggestions(loadRooms());

    const handleRoomsChange = () => {
      setRoomSuggestions(loadRooms());
    };

    window.addEventListener("roomsConfigChanged", handleRoomsChange);
    return () => {
      window.removeEventListener("roomsConfigChanged", handleRoomsChange);
    };
  }, []);

  useEffect(() => {
    const syncTeams = () => {
      const nextTeams = loadTeams();
      setTeamOptions(nextTeams);
      setPatientData((prev) => {
        if (nextTeams.length === 0) {
          return { ...prev, team: DEFAULT_TEAMS[0] };
        }
        if (nextTeams.includes(prev.team)) {
          return prev;
        }
        return { ...prev, team: nextTeams[0] };
      });
    };

    syncTeams();
    window.addEventListener("teamsConfigChanged", syncTeams);
    return () => {
      window.removeEventListener("teamsConfigChanged", syncTeams);
    };
  }, []);

  // Handle click outside for bowel dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        bowelDropdownRef.current &&
        !bowelDropdownRef.current.contains(event.target as Node)
      ) {
        // Small delay to prevent race conditions with checkbox clicks
        setTimeout(() => setShowBowelDropdown(false), 50);
      }
    };

    if (showBowelDropdown) {
      // Use setTimeout to avoid immediate closure on the same click that opened it
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showBowelDropdown]);

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
    io_interval: handover.io_interval,
    io_00: handover.io_00,
    io_00_last6h: handover.io_00_last6h,
    io_06: handover.io_06,
    io_06_last6h: handover.io_06_last6h,
    io_12: handover.io_12,
    io_12_last6h: handover.io_12_last6h,
    io_18: handover.io_18,
    io_18_last6h: handover.io_18_last6h,
    io_00_04: handover.io_00_04,
    io_00_04_last6h: handover.io_00_04_last6h,
    io_04_08: handover.io_04_08,
    io_04_08_last6h: handover.io_04_08_last6h,
    io_08_12: handover.io_08_12,
    io_08_12_last6h: handover.io_08_12_last6h,
    io_12_16: handover.io_12_16,
    io_12_16_last6h: handover.io_12_16_last6h,
    io_16_20: handover.io_16_20,
    io_16_20_last6h: handover.io_16_20_last6h,
    io_20_24: handover.io_20_24,
    io_20_24_last6h: handover.io_20_24_last6h,
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
    last_bowel_movement: handover.last_bowel_movement || "",
    bowel_amount: handover.bowel_amount || "",
    bowel_description: handover.bowel_description || "",
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
    // Don't allow updates in read-only mode
    if (isFormReadOnly) return;

    let newValue = value;
    if (field === "room_number") {
      newValue = value.toUpperCase();
    }
    setPatientData((prev) => ({ ...prev, [field]: newValue }));

    // Auto-save patient changes
    try {
      const updateData: Partial<PatientCreate> = {};
      if (field === "room_number") updateData.room_number = value;
      if (field === "bed") updateData.bed = value;
      if (field === "diagnosis") updateData.diagnosis = value;
      if (field === "mrn") updateData.mrn = value;
      if (field === "first_name") updateData.first_name = value;
      if (field === "last_name") updateData.last_name = value;
      if (field === "date_of_birth") updateData.date_of_birth = value;
      if (field === "age") updateData.age = value;

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
    if (!isDirty || isFormReadOnly) return;

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
  }, [handover.id, formData, onSave, isDirty, isFormReadOnly]);

  // Auto-save with debounce - only when dirty and editable
  useEffect(() => {
    if (!isDirty || isFormReadOnly) return;

    const timer = setTimeout(() => {
      saveForm();
    }, 1000); // 1 second debounce for faster saves

    return () => clearTimeout(timer);
  }, [isDirty, saveForm, isFormReadOnly]);

  const updateField = <K extends keyof HandoverUpdate>(
    field: K,
    value: HandoverUpdate[K],
  ) => {
    // Don't allow updates in read-only mode
    if (isFormReadOnly) return;

    setFormData((prev) => {
      const newData = { ...prev, [field]: value };
      // Check if data actually changed
      if (JSON.stringify(newData) !== initialDataRef.current) {
        setIsDirty(true);
      }
      return newData;
    });
  };

  const handleMarkComplete = async () => {
    if (isFormReadOnly || completing) return;

    if (
      patientConfig.outgoing_nurse.required &&
      !(formData.outgoing_nurse || "").trim()
    ) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
      alert(`Please enter ${patientConfig.outgoing_nurse.label}.`);
      return;
    }

    const incomingNurse = (formData.incoming_nurse || "").trim();
    const resolvedIncomingNurse =
      incomingNurse ||
      user?.fullName ||
      user?.firstName ||
      formData.outgoing_nurse?.trim() ||
      handover.outgoing_nurse ||
      "Nurse";
    if (patientConfig.incoming_nurse.required && !incomingNurse) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
      alert(`Please enter ${patientConfig.incoming_nurse.label}.`);
      return;
    }

    setCompleting(true);
    try {
      // Persist unsaved form changes first
      if (isDirty) {
        const updated = await updateHandoverAPI(handover.id, formData);
        onSave(updated);
        setLastSaved(new Date());
        setIsDirty(false);
        initialDataRef.current = JSON.stringify(formData);
      }

      const completed = await completeHandoverAPI(
        handover.id,
        resolvedIncomingNurse,
      );
      onSave(completed);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
      alert("Failed to mark hand-off as complete.");
    } finally {
      setCompleting(false);
    }
  };

  // Auto-calculate Total Fluid from PO + IV + NG
  useEffect(() => {
    const po = formData.fluid_intake_po || "";
    const iv = formData.fluid_intake_iv || "";
    const ng = formData.fluid_intake_ng || "";

    // Extract numeric values (handle "ml", "mL", numbers, etc.)
    const extractNumber = (str: string): number => {
      const match = str.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    };

    const poNum = extractNumber(po);
    const ivNum = extractNumber(iv);
    const ngNum = extractNumber(ng);

    const total = poNum + ivNum + ngNum;

    if (total > 0 && (po || iv || ng)) {
      const newTotal = `${total} ml`;
      if (formData.total_fluid !== newTotal) {
        setFormData((prev) => ({ ...prev, total_fluid: newTotal }));
      }
    }
  }, [
    formData.fluid_intake_po,
    formData.fluid_intake_iv,
    formData.fluid_intake_ng,
  ]);

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
      {/* ReadOnly overlay indicator */}
      {isFormReadOnly && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center gap-3">
          <svg
            className="w-5 h-5 text-amber-600 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm text-amber-800">
            {handover.is_completed
              ? "This hand-off has been marked complete and is now read-only. You can view and print it, but cannot make changes."
              : "This report is from a previous date and is read-only. You can view and print it, but cannot make changes."}
          </p>
        </div>
      )}
      {/* Sticky Section Navigation */}
      <div className="sticky top-[140px] z-30 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 -mx-4 px-4 py-2 mb-4 print-hide">
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
          {isDirty && !isFormReadOnly && (
            <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 font-medium">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* Save Status Toast - Hidden in print */}
      {saveStatus !== "idle" && (
        <div
          className={`fixed top-20 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all print-hide ${
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

      <div className={isFormReadOnly ? "pointer-events-none select-none" : ""}>
        {/* Header */}
        <div
          id="patient-info"
          className="bg-white border border-gray-300 rounded-lg p-4 mb-4"
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                Hand-Off Report
              </h1>
              <p className="text-sm text-gray-500">
                Montreal Children&apos;s Hospital - HEMA-ONCOLOGY
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-sm font-medium">
                {new Date().toLocaleDateString("en-CA")}
              </div>
              <div
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                  currentShift === "day"
                    ? "bg-amber-100 text-amber-800 border-amber-200"
                    : "bg-indigo-100 text-indigo-800 border-indigo-200"
                }`}
              >
                {currentShift === "day"
                  ? "☀️ Day Shift (7AM - 7PM)"
                  : "🌙 Night Shift (7PM - 7AM)"}
              </div>
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
                  {roomSuggestions
                    .filter((r) =>
                      r
                        .toLowerCase()
                        .includes(patientData.room_number.toLowerCase()),
                    )
                    .map((room) => (
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
                {patientConfig.date_of_birth.show && patientConfig.team.show
                  ? `Patient Name / Age / ${patientConfig.team.label}`
                  : patientConfig.date_of_birth.show
                    ? "Patient Name / Age"
                    : patientConfig.team.show
                      ? `Patient Name / ${patientConfig.team.label}`
                      : "Patient Name"}
              </div>
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">
                  {patient.last_name}, {patient.first_name}{" "}
                  {patientConfig.date_of_birth.show && (
                    <>/ {calculateAge(patient.date_of_birth)} </>
                  )}
                </span>
                {patientConfig.team.show && (
                  <>
                    <span className="font-semibold text-sm">/</span>
                    <select
                      value={patientData.team}
                      onChange={(e) =>
                        setPatientData((p) => ({ ...p, team: e.target.value }))
                      }
                      className="font-semibold text-sm border-0 p-0 focus:ring-0 bg-transparent"
                    >
                      {(teamOptions.length ? teamOptions : DEFAULT_TEAMS).map(
                        (team) => (
                          <option key={team} value={team}>
                            {team}
                          </option>
                        ),
                      )}
                    </select>
                  </>
                )}
              </div>
            </div>

            {patientConfig.mrn.show && (
              <div className="border border-gray-300 rounded p-2">
                <div className="text-xs text-gray-500 mb-1 flex items-center">
                  {patientConfig.mrn.label}
                  {patientConfig.mrn.infoTip && (
                    <InfoTip tip={patientConfig.mrn.infoTip} />
                  )}
                </div>
                <input
                  type="text"
                  value={patientData.mrn || ""}
                  onChange={(e) => updatePatientField("mrn", e.target.value)}
                  placeholder={`Enter ${patientConfig.mrn.label}`}
                  className="w-full text-sm font-semibold border-0 p-0 focus:ring-0 bg-transparent"
                />
              </div>
            )}
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
              <div className="text-xs text-gray-500 mb-1 flex items-center">
                Diagnosis
                {patientConfig.diagnosis.infoTip && (
                  <InfoTip tip={patientConfig.diagnosis.infoTip} />
                )}
              </div>
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
                    d
                      .toLowerCase()
                      .includes(patientData.diagnosis.toLowerCase()),
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
              <textarea
                value={formData.pertinent_issues || ""}
                onChange={(e) =>
                  updateField("pertinent_issues", e.target.value)
                }
                rows={2}
                className="w-full text-sm border-0 p-0 focus:ring-0 resize-none"
                placeholder="e.g., SCT D59, Skin GVHD GR3, HTN..."
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
              <SelectWithSuggestions
                label="Allergies"
                value={formData.allergies}
                onChange={(v) => updateField("allergies", v)}
                options={COMMON_ALLERGIES}
                placeholder="Type or select allergies..."
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
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">
                Isolation Type
              </label>
              <div className="border border-gray-300 rounded p-2 bg-white max-h-32 overflow-y-auto">
                <div className="space-y-1">
                  {[
                    "none",
                    "contact",
                    "droplet",
                    "airborne",
                    "neutropenic",
                    "protective",
                    "cytotoxic",
                    "universal",
                  ].map((type) => {
                    const selected = (formData.isolation || "none")
                      .split(", ")
                      .filter(Boolean);
                    const isChecked = selected.includes(type);
                    const displayName =
                      type.charAt(0).toUpperCase() + type.slice(1);
                    return (
                      <label
                        key={type}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-0.5 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            let current = (formData.isolation || "none")
                              .split(", ")
                              .filter(Boolean);
                            // If checking "none", clear all others
                            if (type === "none" && e.target.checked) {
                              updateField("isolation", "none" as IsolationType);
                              return;
                            }
                            // If checking anything else, remove "none"
                            if (type !== "none" && e.target.checked) {
                              current = current.filter((t) => t !== "none");
                            }
                            let updated: string[];
                            if (e.target.checked) {
                              updated = [...current, type];
                            } else {
                              updated = current.filter((t) => t !== type);
                            }
                            // If nothing selected, default to "none"
                            if (updated.length === 0) {
                              updateField("isolation", "none" as IsolationType);
                            } else {
                              updateField(
                                "isolation",
                                updated.join(", ") as IsolationType,
                              );
                            }
                          }}
                          className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <span className="text-xs">{displayName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
                className={`w-full px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-500 font-medium ${
                  formData.status === "improved"
                    ? "bg-green-50 border-green-300 text-green-700"
                    : formData.status === "critical"
                      ? "bg-red-50 border-red-300 text-red-700"
                      : "bg-blue-50 border-blue-300 text-blue-700"
                }`}
              >
                <option value="stable">Stable</option>
                <option value="improved">Improved</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>

        {/* Labs Section */}
        <Section
          id="labs"
          title="Labs"
          infoTip="Epic: Results Review tab or Flowsheet. Check today's AM labs (CBC, BMP, etc.)"
          className="mb-4"
        >
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
          <Section
            id="vs-pain"
            title="VS / Pain"
            infoTip="Epic: Flowsheet → Vitals column. BPEWS auto-calculated from flowsheet entries."
          >
            <div className="space-y-2">
              <TextArea
                label="Vital signs (abnormal)"
                value={formData.abnormal_vitals}
                onChange={(v) => updateField("abnormal_vitals", v)}
                rows={1}
              />
              <div className="grid grid-cols-2 gap-2">
                <QuickSelect
                  label="BPEWS Score"
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
                  onChange={(v) => {
                    updateField("pca_checkbox", v);
                    if (v && formData.nca_checkbox) {
                      updateField("nca_checkbox", false);
                    }
                  }}
                />
                <CheckField
                  label="NCA"
                  checked={formData.nca_checkbox}
                  onChange={(v) => {
                    updateField("nca_checkbox", v);
                    if (v && formData.pca_checkbox) {
                      updateField("pca_checkbox", false);
                    }
                  }}
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600">
                    Bolus (successful/failed):
                  </span>
                  <input
                    type="text"
                    value={formData.pca_nca_bolus || ""}
                    onChange={(e) =>
                      updateField("pca_nca_bolus", e.target.value)
                    }
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 3/5"
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
                  label={
                    <>
                      O<sub>2</sub> Sat
                    </>
                  }
                  checked={formData.monitoring_o2_sat}
                  onChange={(v) => updateField("monitoring_o2_sat", v)}
                />
              </div>
            </div>
          </Section>

          {/* IV */}
          <Section
            id="iv"
            title="I.V."
            infoTip="Epic: MAR (Medication Administration Record) for IV infusions; I&O flowsheet for access details."
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    CVAD Type
                  </label>
                  <div className="border border-gray-300 rounded p-2 bg-white max-h-40 overflow-y-auto">
                    <div className="space-y-1.5">
                      {CVAD_TYPES.map((type) => {
                        const selected = (formData.cvad_type || "")
                          .split(", ")
                          .filter(Boolean);
                        const isChecked = selected.includes(type);
                        return (
                          <label
                            key={type}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const current = (formData.cvad_type || "")
                                  .split(", ")
                                  .filter(Boolean);
                                let updated: string[];
                                if (e.target.checked) {
                                  updated = [...current, type];
                                } else {
                                  updated = current.filter((t) => t !== type);
                                }
                                updateField("cvad_type", updated.join(", "));
                              }}
                              className="w-4 h-4 text-blue-600 rounded focus:ring-1 focus:ring-blue-500"
                            />
                            <span className="text-xs">{type}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {formData.cvad_type && (
                    <div className="text-xs text-gray-500 mt-1">
                      Selected: {formData.cvad_type}
                    </div>
                  )}
                </div>
                <SmallInput
                  label="Dressing"
                  value={formData.cvad_dressing}
                  onChange={(v) => updateField("cvad_dressing", v)}
                  placeholder="Type (e.g. tegaderm, IV 3000)"
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
          <Section
            id="gu"
            title="G.U."
            infoTip="Epic: I&O flowsheet → Urine output columns. Strict I&O orders found in Orders tab."
          >
            <div className="space-y-3">
              {/* Interval selector */}
              <div className="flex items-center gap-4 pb-2 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-700">
                  Interval:
                </span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gu-interval"
                    value="4h"
                    checked={formData.io_interval === "4h"}
                    onChange={() => updateField("io_interval", "4h")}
                    className="w-3.5 h-3.5 text-blue-600"
                  />
                  <span className="text-xs">4 hours</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gu-interval"
                    value="6h"
                    checked={
                      !formData.io_interval || formData.io_interval === "6h"
                    }
                    onChange={() => updateField("io_interval", "6h")}
                    className="w-3.5 h-3.5 text-blue-600"
                  />
                  <span className="text-xs">6 hours</span>
                </label>
              </div>

              {/* Urine output with time intervals */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Urine output (I/O)
                  </label>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <span className="w-[60px] text-center text-gray-400">
                      ml
                    </span>
                    <span className="w-[60px] text-center text-gray-400">
                      ml/kg/hr
                    </span>
                    <span className="w-[60px] text-center text-gray-400">
                      ml
                    </span>
                    <span className="w-[60px] text-center text-gray-400">
                      ml/kg/hr
                    </span>
                  </div>
                </div>
                {!formData.io_interval || formData.io_interval === "6h" ? (
                  // 6-hour intervals - 2x2 grid for compact horizontal layout
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {/* 00-06h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        00-06h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_00 || ""}
                          onChange={(e) => updateField("io_00", e.target.value)}
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_00_kghr || ""}
                          onChange={(e) =>
                            updateField("io_00_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_00_last6h || ""}
                          onChange={(e) =>
                            updateField("io_00_last6h", e.target.value)
                          }
                          placeholder="last 6h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_00_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_00_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 06-12h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        06-12h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_06 || ""}
                          onChange={(e) => updateField("io_06", e.target.value)}
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_06_kghr || ""}
                          onChange={(e) =>
                            updateField("io_06_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_06_last6h || ""}
                          onChange={(e) =>
                            updateField("io_06_last6h", e.target.value)
                          }
                          placeholder="last 6h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_06_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_06_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 12-18h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        12-18h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_12 || ""}
                          onChange={(e) => updateField("io_12", e.target.value)}
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_12_kghr || ""}
                          onChange={(e) =>
                            updateField("io_12_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_12_last6h || ""}
                          onChange={(e) =>
                            updateField("io_12_last6h", e.target.value)
                          }
                          placeholder="last 6h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_12_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_12_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 18-24h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        18-24h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_18 || ""}
                          onChange={(e) => updateField("io_18", e.target.value)}
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_18_kghr || ""}
                          onChange={(e) =>
                            updateField("io_18_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_18_last6h || ""}
                          onChange={(e) =>
                            updateField("io_18_last6h", e.target.value)
                          }
                          placeholder="last 6h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_18_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_18_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  // 4-hour intervals - 2x3 grid for compact horizontal layout
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {/* 00-04h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        00-04h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_00_04 || ""}
                          onChange={(e) =>
                            updateField("io_00_04", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_00_04_kghr || ""}
                          onChange={(e) =>
                            updateField("io_00_04_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_00_04_last6h || ""}
                          onChange={(e) =>
                            updateField("io_00_04_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_00_04_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_00_04_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 04-08h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        04-08h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_04_08 || ""}
                          onChange={(e) =>
                            updateField("io_04_08", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_04_08_kghr || ""}
                          onChange={(e) =>
                            updateField("io_04_08_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_04_08_last6h || ""}
                          onChange={(e) =>
                            updateField("io_04_08_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_04_08_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_04_08_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 08-12h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        08-12h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_08_12 || ""}
                          onChange={(e) =>
                            updateField("io_08_12", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_08_12_kghr || ""}
                          onChange={(e) =>
                            updateField("io_08_12_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_08_12_last6h || ""}
                          onChange={(e) =>
                            updateField("io_08_12_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_08_12_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_08_12_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 12-16h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        12-16h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_12_16 || ""}
                          onChange={(e) =>
                            updateField("io_12_16", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_12_16_kghr || ""}
                          onChange={(e) =>
                            updateField("io_12_16_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_12_16_last6h || ""}
                          onChange={(e) =>
                            updateField("io_12_16_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_12_16_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_12_16_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 16-20h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        16-20h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_16_20 || ""}
                          onChange={(e) =>
                            updateField("io_16_20", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_16_20_kghr || ""}
                          onChange={(e) =>
                            updateField("io_16_20_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_16_20_last6h || ""}
                          onChange={(e) =>
                            updateField("io_16_20_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_16_20_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_16_20_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* 20-24h */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-600">
                        20-24h
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_20_24 || ""}
                          onChange={(e) =>
                            updateField("io_20_24", e.target.value)
                          }
                          placeholder="ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_20_24_kghr || ""}
                          onChange={(e) =>
                            updateField("io_20_24_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          value={formData.io_20_24_last6h || ""}
                          onChange={(e) =>
                            updateField("io_20_24_last6h", e.target.value)
                          }
                          placeholder="last 4h ml"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={formData.io_20_24_last6h_kghr || ""}
                          onChange={(e) =>
                            updateField("io_20_24_last6h_kghr", e.target.value)
                          }
                          placeholder="ml/kg/hr"
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Additional urine details */}
              <div className="flex flex-wrap gap-4 items-center pt-2 border-t border-gray-200">
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
          <Section
            id="neuro"
            title="Neurological"
            infoTip="Epic: Nursing Assessment flowsheet → Neurological section. GCS documented there."
          >
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
          <Section
            id="resp-cardio"
            title="Resp / Cardio"
            infoTip="Epic: Nursing Assessment flowsheet → Respiratory & Cardiovascular sections. O2 orders in Orders tab."
          >
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
          <Section
            id="gi"
            title="G.I."
            infoTip="Epic: Nursing Assessment flowsheet → GI section. Last BM documented in I&O or Assessment."
            allowOverflow={true}
          >
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
              {/* Last Bowel Movement Section */}
              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-700 mb-2">
                  Last Bowel Movement
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">
                      Date
                    </label>
                    <input
                      type="date"
                      value={formData.last_bowel_movement || ""}
                      onChange={(e) =>
                        updateField("last_bowel_movement", e.target.value)
                      }
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">
                      Amount
                    </label>
                    <input
                      type="number"
                      value={formData.bowel_amount || ""}
                      onChange={(e) =>
                        updateField("bowel_amount", e.target.value)
                      }
                      placeholder="Numeric value"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Description
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.bowel_description || ""}
                      onChange={(e) =>
                        updateField("bowel_description", e.target.value)
                      }
                      placeholder="Type or select from dropdown"
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="relative" ref={bowelDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowBowelDropdown(!showBowelDropdown)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-blue-500 bg-white whitespace-nowrap"
                      >
                        + Add ▾
                      </button>
                      {showBowelDropdown && (
                        <div
                          className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="p-2 space-y-2">
                            <div className="border-b pb-2">
                              <div className="text-xs font-semibold text-gray-500 mb-1.5">
                                Size
                              </div>
                              {["Small", "Medium", "Large", "Normal"].map(
                                (option) => {
                                  const isSelected =
                                    formData.bowel_description
                                      ?.toLowerCase()
                                      .includes(option.toLowerCase()) || false;
                                  return (
                                    <label
                                      key={option}
                                      className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          const current =
                                            formData.bowel_description || "";
                                          const terms = current
                                            .split(",")
                                            .map((t) => t.trim())
                                            .filter((t) => t);

                                          if (e.target.checked) {
                                            if (
                                              !terms.some(
                                                (t) =>
                                                  t.toLowerCase() ===
                                                  option.toLowerCase(),
                                              )
                                            ) {
                                              terms.push(option);
                                            }
                                          } else {
                                            const index = terms.findIndex(
                                              (t) =>
                                                t.toLowerCase() ===
                                                option.toLowerCase(),
                                            );
                                            if (index !== -1) {
                                              terms.splice(index, 1);
                                            }
                                          }

                                          updateField(
                                            "bowel_description",
                                            terms.join(", "),
                                          );
                                        }}
                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                      />
                                      <span className="text-sm text-gray-700">
                                        {option}
                                      </span>
                                    </label>
                                  );
                                },
                              )}
                            </div>
                            <div className="border-b pb-2">
                              <div className="text-xs font-semibold text-gray-500 mb-1.5">
                                Consistency
                              </div>
                              {[
                                "Liquid",
                                "Pasty",
                                "Hard",
                                "Seedy",
                                "Soft",
                                "Mucousy",
                              ].map((option) => {
                                const isSelected =
                                  formData.bowel_description
                                    ?.toLowerCase()
                                    .includes(option.toLowerCase()) || false;
                                return (
                                  <label
                                    key={option}
                                    className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        const current =
                                          formData.bowel_description || "";
                                        const terms = current
                                          .split(",")
                                          .map((t) => t.trim())
                                          .filter((t) => t);

                                        if (e.target.checked) {
                                          if (
                                            !terms.some(
                                              (t) =>
                                                t.toLowerCase() ===
                                                option.toLowerCase(),
                                            )
                                          ) {
                                            terms.push(option);
                                          }
                                        } else {
                                          const index = terms.findIndex(
                                            (t) =>
                                              t.toLowerCase() ===
                                              option.toLowerCase(),
                                          );
                                          if (index !== -1) {
                                            terms.splice(index, 1);
                                          }
                                        }

                                        updateField(
                                          "bowel_description",
                                          terms.join(", "),
                                        );
                                      }}
                                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                      {option}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-gray-500 mb-1.5">
                                Color
                              </div>
                              {["Brown", "Green", "Black", "Bloody"].map(
                                (option) => {
                                  const isSelected =
                                    formData.bowel_description
                                      ?.toLowerCase()
                                      .includes(option.toLowerCase()) || false;
                                  return (
                                    <label
                                      key={option}
                                      className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          const current =
                                            formData.bowel_description || "";
                                          const terms = current
                                            .split(",")
                                            .map((t) => t.trim())
                                            .filter((t) => t);

                                          if (e.target.checked) {
                                            if (
                                              !terms.some(
                                                (t) =>
                                                  t.toLowerCase() ===
                                                  option.toLowerCase(),
                                              )
                                            ) {
                                              terms.push(option);
                                            }
                                          } else {
                                            const index = terms.findIndex(
                                              (t) =>
                                                t.toLowerCase() ===
                                                option.toLowerCase(),
                                            );
                                            if (index !== -1) {
                                              terms.splice(index, 1);
                                            }
                                          }

                                          updateField(
                                            "bowel_description",
                                            terms.join(", "),
                                          );
                                        }}
                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                      />
                                      <span className="text-sm text-gray-700">
                                        {option}
                                      </span>
                                    </label>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 items-center">
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
          <Section
            id="nutrition"
            title="Nutrition"
            infoTip="Epic: Nutrition Orders tab for formula/TPN. I&O flowsheet for PO/tube feed volumes. Weight in Flowsheet."
          >
            <div className="space-y-2">
              <SelectWithSuggestions
                label="Diet"
                value={formData.diet}
                onChange={(v) => updateField("diet", v)}
                options={DIET_OPTIONS}
                placeholder="Select or type diet..."
              />
              <div className="grid grid-cols-1 gap-2">
                <SmallInput
                  label="Weight"
                  value={formData.weight}
                  onChange={(v) => updateField("weight", v)}
                  placeholder="kg"
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
                  placeholder="ml"
                  className="w-20"
                />
                <SmallInput
                  label="IV"
                  value={formData.fluid_intake_iv}
                  onChange={(v) => updateField("fluid_intake_iv", v)}
                  placeholder="ml"
                  className="w-20"
                />
                <SmallInput
                  label="NG"
                  value={formData.fluid_intake_ng}
                  onChange={(v) => updateField("fluid_intake_ng", v)}
                  placeholder="ml"
                  className="w-20"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">=</span>
                  <div className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                    Total: {formData.total_fluid || "0 ml"}
                  </div>
                </div>
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
                  placeholder="ml/day"
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
                label="Assistive Devices"
                value={formData.assistive_devices}
                onChange={(v) => updateField("assistive_devices", v)}
                rows={1}
                placeholder="e.g., crutches, walker, wheelchair..."
              />
            </div>
          </Section>

          {/* Skin */}
          <Section
            id="skin"
            title="Skin"
            infoTip="Epic: Nursing Assessment flowsheet → Skin/Wound section. Braden Q calculated from assessment fields."
          >
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
          <Section
            id="psychosocial"
            title="Psycho-Social"
            infoTip="Epic: Social Work notes and Nursing Assessment → Psychosocial section. Family contact in Demographics."
          >
            <div className="space-y-2">
              <TextArea
                label="Patient/Family Concerns"
                value={formData.psychosocial_notes}
                onChange={(v) => updateField("psychosocial_notes", v)}
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
            <textarea
              value={formData.todo_items || ""}
              onChange={(e) => updateField("todo_items", e.target.value)}
              onFocus={(e) => {
                if (!e.target.value) updateField("todo_items", "• ");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart ?? 0;
                  const end = ta.selectionEnd ?? 0;
                  const val = ta.value;
                  const newVal =
                    val.substring(0, start) + "\n• " + val.substring(end);
                  updateField("todo_items", newVal);
                  setTimeout(() => {
                    ta.selectionStart = ta.selectionEnd = start + 3;
                  }, 0);
                }
              }}
              rows={4}
              placeholder="• Task 1&#10;• Task 2&#10;• Task 3"
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </Section>
          <Section title="Follow Up">
            <textarea
              value={formData.followup_items || ""}
              onChange={(e) => updateField("followup_items", e.target.value)}
              onFocus={(e) => {
                if (!e.target.value) updateField("followup_items", "• ");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart ?? 0;
                  const end = ta.selectionEnd ?? 0;
                  const val = ta.value;
                  const newVal =
                    val.substring(0, start) + "\n• " + val.substring(end);
                  updateField("followup_items", newVal);
                  setTimeout(() => {
                    ta.selectionStart = ta.selectionEnd = start + 3;
                  }, 0);
                }
              }}
              rows={4}
              placeholder="• Pending result 1&#10;• Pending result 2&#10;• Monitor..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </Section>
        </div>

        {(patientConfig.outgoing_nurse.show ||
          patientConfig.incoming_nurse.show) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 print-hide">
            {patientConfig.outgoing_nurse.show && (
              <div>
                <label className="block text-xs font-semibold text-blue-700 mb-1">
                  {patientConfig.outgoing_nurse.label}
                  {patientConfig.outgoing_nurse.required && (
                    <span className="text-red-600 ml-1">*</span>
                  )}
                </label>
                <input
                  type="text"
                  value={formData.outgoing_nurse || ""}
                  onChange={(e) =>
                    updateField("outgoing_nurse", e.target.value)
                  }
                  className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  placeholder={`Enter ${patientConfig.outgoing_nurse.label.toLowerCase()}...`}
                />
              </div>
            )}

            {patientConfig.incoming_nurse.show && (
              <div>
                <label className="block text-xs font-semibold text-blue-700 mb-1">
                  {patientConfig.incoming_nurse.label}
                  {patientConfig.incoming_nurse.required && (
                    <span className="text-red-600 ml-1">*</span>
                  )}
                </label>
                <input
                  type="text"
                  value={formData.incoming_nurse || ""}
                  onChange={(e) =>
                    updateField("incoming_nurse", e.target.value)
                  }
                  className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  placeholder={`Enter ${patientConfig.incoming_nurse.label.toLowerCase()}...`}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer - Hidden in print */}
      <div className="flex justify-between items-center bg-white border border-gray-300 rounded-lg p-4 print-hide">
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
          <button
            onClick={handleMarkComplete}
            disabled={readOnly || handover.is_completed || completing}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              handover.is_completed
                ? "text-green-700 bg-green-100 cursor-not-allowed"
                : "text-white bg-green-600 hover:bg-green-700"
            } disabled:opacity-60`}
          >
            {handover.is_completed ? (
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
                Completed
              </>
            ) : completing ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                Completing...
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
                Mark Complete
              </>
            )}
          </button>
          <button
            onClick={() => {
              // Build the current handover state with form data
              const currentHandover: Handover = {
                ...handover,
                ...formData,
              };
              // Build the current patient state with patient data
              const currentPatient: Patient = {
                ...patient,
                room_number: patientData.room_number,
                bed: patientData.bed,
                diagnosis: patientData.diagnosis,
              };
              onPreview(currentHandover, currentPatient);
            }}
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
            Preview &amp; Print
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
