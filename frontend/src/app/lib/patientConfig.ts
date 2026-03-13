export interface FieldConfig {
  show: boolean;
  required: boolean;
  label: string;
  infoTip?: string;
}

export type ReportMode = "daily" | "shift";

export interface PatientFieldConfig {
  reportMode: ReportMode;
  mrn: FieldConfig;
  date_of_birth: FieldConfig;
  diagnosis: FieldConfig;
  attending_physician: FieldConfig;
  team: FieldConfig;
  bed: FieldConfig;
  admission_date: FieldConfig;
  outgoing_nurse: FieldConfig;
  incoming_nurse: FieldConfig;
}

export const PATIENT_CONFIG_DEFAULTS: PatientFieldConfig = {
  reportMode: "daily",
  mrn: {
    show: true,
    required: false,
    label: "MRN",
    infoTip: "Epic: Patient header, Demographics tab, or Face Sheet",
  },
  date_of_birth: {
    show: true,
    required: false,
    label: "DOB / Age",
    infoTip: "Epic: Patient header or Demographics tab",
  },
  diagnosis: {
    show: true,
    required: false,
    label: "Diagnosis",
    infoTip: "Epic: H&P → Assessment & Plan, or latest attending note",
  },
  attending_physician: {
    show: true,
    required: false,
    label: "Attending Physician",
    infoTip: "Epic: Care Team tab or Patient header banner",
  },
  team: {
    show: true,
    required: true,
    label: "Team",
    infoTip: "Epic: Care Team tab",
  },
  bed: {
    show: true,
    required: false,
    label: "Bed",
    infoTip: "Epic: ADT/Bed Management view or patient banner",
  },
  admission_date: {
    show: true,
    required: false,
    label: "Admission Date",
    infoTip: "Epic: Patient header or Admission/Discharge tab",
  },
  // Hidden by default to preserve current workflow unless enabled in settings
  outgoing_nurse: {
    show: false,
    required: false,
    label: "Outgoing Nurse (Giving Report)",
    infoTip: "Nurse currently giving this hand-off report",
  },
  incoming_nurse: {
    show: false,
    required: false,
    label: "Incoming Nurse (Receiving Report)",
    infoTip: "Nurse receiving and acknowledging this hand-off",
  },
};

const STORAGE_KEY = "patient_field_config_v1";

export function loadPatientConfig(): PatientFieldConfig {
  if (typeof window === "undefined") return PATIENT_CONFIG_DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PATIENT_CONFIG_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PatientFieldConfig>;
    // Merge with defaults so new fields added later always have a value
    const result = {
      reportMode: parsed.reportMode || "daily",
    } as PatientFieldConfig;
    for (const key of Object.keys(
      PATIENT_CONFIG_DEFAULTS,
    ) as (keyof PatientFieldConfig)[]) {
      if (key === "reportMode") continue;
      result[key] = { ...PATIENT_CONFIG_DEFAULTS[key], ...(parsed[key] ?? {}) };
    }
    return result;
  } catch {
    return PATIENT_CONFIG_DEFAULTS;
  }
}

export function savePatientConfig(config: PatientFieldConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
