// lib/api.ts
import { getApiBase } from "./runtimeApiBase";

const API_BASE = getApiBase();

const DEFAULT_API_TIMEOUT_MS = 30000;

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
};

type RequestTuningOptions = Pick<
  ApiRequestOptions,
  "timeoutMs" | "retryCount" | "retryDelayMs"
>;

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const candidate = (payload as { detail?: unknown; message?: unknown })
      .detail;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }

    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    retryCount,
    retryDelayMs = 350,
    headers,
    method,
    ...rest
  } = options;

  const normalizedMethod = (method || "GET").toUpperCase();
  const canRetry = ["GET", "HEAD", "OPTIONS"].includes(normalizedMethod);
  const attempts = canRetry ? Math.max(0, retryCount ?? 1) + 1 : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...rest,
        method: normalizedMethod,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const body = await parseResponseBody(response);
      if (!response.ok) {
        const statusMessage =
          response.status >= 500
            ? "Server is temporarily unavailable. Please try again."
            : response.statusText || "Request failed";
        throw new Error(getErrorMessage(body, statusMessage));
      }

      return body as T;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      const isAbortError =
        typeof error === "object" &&
        error !== null &&
        (error as { name?: string }).name === "AbortError";

      if (isAbortError) {
        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      if (attempt < attempts) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unexpected network error. Please try again.");
}

// Types
export interface OptimizedSchedule {
  id: string;
  name?: string;
  organization_id?: string;
  created_by?: string | null;
  created_by_name?: string | null;
  start_date: string;
  end_date: string;
  is_finalized: boolean;
  schedule_data: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DeletionActivity {
  id: string;
  object_type: "handover" | "schedule" | "patient";
  object_id: string;
  object_label: string;
  details?: string | null;
  performed_by_user_id?: string | null;
  performed_by_name?: string | null;
  occurred_at: string;
}

export interface OrganizationConfigOptions {
  team_options: string[];
  staffing_team_options: string[];
  assistant_manager_team_map: Record<string, string>;
  room_options: string[];
}

export async function parseImageWithFastAPI(
  file: File,
  startDate: string,
  endDate: string,
  headers?: Record<string, string>,
): Promise<any> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("start_date", startDate);
  formData.append("end_date", endDate);

  const data = await apiRequest<any>("/schedules/upload-schedule/", {
    method: "POST",
    body: formData,
    headers,
    // OCR upload/parse can take longer for larger screenshots
    timeoutMs: 180000,
  });

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function createScheduleAPI(
  screenshots: File[],
  startDate: string,
  endDate: string,
  notes: string,
  rules: string,
  autoComments: string,
  userId: string,
): Promise<any> {
  const formData = new FormData();

  function parseRulesInput(rulesText: string): Record<string, number | string> {
    const lines = rulesText.split("\n");
    const rulesObj: Record<string, number | string> = {};

    for (const line of lines) {
      const [key, value] = line.split("=").map((part) => part.trim());
      if (key && value !== undefined) {
        const numeric = Number(value);
        rulesObj[key] = isNaN(numeric) ? value : numeric;
      }
    }

    return rulesObj;
  }

  function parseAutoComments(input: string) {
    const lines = input.trim().split("\n");
    const result: Record<string, Record<string, string>> = {};

    for (const line of lines) {
      if (!line.includes("|")) continue;
      const [name, date, comment] = line.split("|").map((part) => part.trim());
      if (!name || !date || !comment) continue;
      if (!result[name]) result[name] = {};
      result[name][date] = comment;
    }

    return result;
  }

  formData.append("period", `${startDate} to ${endDate}`);
  formData.append("user_id", userId);
  formData.append("notes", notes);
  formData.append("rules", JSON.stringify(parseRulesInput(rules)));
  formData.append(
    "employee_comments",
    autoComments.trim()
      ? JSON.stringify(parseAutoComments(autoComments))
      : "{}",
  );

  screenshots.forEach((file) => {
    formData.append("raw_images", file);
  });

  return apiRequest<any>("/schedules/", {
    method: "POST",
    body: formData,
    // Multi-image extraction can exceed 45s on local/dev backends
    timeoutMs: 180000,
  });
}

// Fetch list of saved optimized schedules
export async function fetchOptimizedSchedulesAPI(
  headers?: Record<string, string>,
  options?:
    | (RequestTuningOptions & {
        includeScheduleData?: boolean;
      })
    | undefined,
): Promise<OptimizedSchedule[]> {
  const searchParams = new URLSearchParams();
  if (options?.includeScheduleData === false) {
    searchParams.set("include_schedule_data", "false");
  }
  const query = searchParams.toString();
  const path = query ? `/optimize/?${query}` : "/optimize/";

  return apiRequest<OptimizedSchedule[]>(path, {
    ...options,
    headers: headers || {},
    retryCount: options?.retryCount ?? 2,
  });
}

// Fetch a specific optimized schedule by ID
export async function fetchOptimizedScheduleByIdAPI(
  scheduleId: string,
  headers?: Record<string, string>,
  options?: RequestTuningOptions,
) {
  return apiRequest<any>(`/optimize/${scheduleId}`, {
    ...options,
    headers: headers || {},
    retryCount: options?.retryCount ?? 2,
  });
}

// Save and finalize a draft schedule (used when user clicks Finalize on a new schedule)
export async function saveAndFinalizeScheduleAPI(
  scheduleData: any,
  scheduleId?: string,
  headers?: Record<string, string>,
): Promise<any> {
  return apiRequest<any>("/optimize/save-and-finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify({
      schedule_data: scheduleData,
      schedule_id: scheduleId,
    }),
  });
}

// Create an initial draft schedule (used when starting a brand-new schedule)
export async function createDraftScheduleAPI(
  scheduleData: any,
  headers?: Record<string, string>,
): Promise<any> {
  return apiRequest<any>("/optimize/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(scheduleData),
  });
}

// Update an existing draft schedule (used to persist draft edits like period changes)
export async function updateDraftScheduleAPI(
  scheduleId: string,
  scheduleData: any,
  headers?: Record<string, string>,
): Promise<any> {
  return apiRequest<any>(`/optimize/${scheduleId}/draft`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(scheduleData),
    timeoutMs: 120000,
  });
}

// Delete an optimized schedule
export async function deleteScheduleAPI(
  scheduleId: string,
  headers?: Record<string, string>,
): Promise<any> {
  return apiRequest<any>(`/optimize/${scheduleId}`, {
    method: "DELETE",
    headers,
  });
}

export async function fetchOrganizationConfigOptionsAPI(
  orgId: string,
  headers?: Record<string, string>,
): Promise<OrganizationConfigOptions> {
  return apiRequest<OrganizationConfigOptions>(
    `/organizations/${orgId}/config-options`,
    {
      headers,
      retryCount: 2,
    },
  );
}

export async function updateOrganizationConfigOptionsAPI(
  orgId: string,
  payload: Partial<OrganizationConfigOptions>,
  headers?: Record<string, string>,
): Promise<OrganizationConfigOptions> {
  return apiRequest<OrganizationConfigOptions>(
    `/organizations/${orgId}/config-options`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchDeletionActivitiesAPI(
  headers?: Record<string, string>,
  limit: number = 50,
  options?: RequestTuningOptions,
): Promise<DeletionActivity[]> {
  return apiRequest<DeletionActivity[]>(
    `/deletion-activities/?limit=${limit}`,
    {
      ...options,
      headers,
      retryCount: options?.retryCount ?? 2,
    },
  );
}

// Fetch system prompt
export async function fetchSystemPromptsAPI(headers?: Record<string, string>) {
  return apiRequest<{ id: number; name: string; content: string }>(
    "/system-prompt/",
    {
      retryCount: 2,
      headers: headers || {},
    },
  );
}

// Save a new system prompt with name and content
export async function saveSystemPromptAPI(
  name: string,
  content: string,
  headers?: Record<string, string>,
) {
  return apiRequest<{ id: number; name: string; content: string }>(
    "/system-prompt/",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: JSON.stringify({ name, content }),
    },
  );
}

export async function getSystemPromptById(id: number) {
  return apiRequest<{ id: number; name: string; content: string }>(
    "/system-prompt/",
    { retryCount: 2 },
  );
}

export async function resetSystemPromptAPI(headers?: Record<string, string>) {
  return apiRequest<{ id: number; name: string; content: string }>(
    "/system-prompt/reset",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
    },
  );
}

// ============================================
// PATIENT API FUNCTIONS
// ============================================

export interface Patient {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  age?: string;
  room_number: string;
  bed?: string;
  diagnosis?: string;
  attending_physician?: string;
  admission_date?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientCreate {
  mrn?: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  age?: string;
  room_number: string;
  bed?: string;
  diagnosis?: string;
  attending_physician?: string;
  admission_date?: string;
  is_active?: boolean;
}

export async function fetchPatientsAPI(
  params?: {
    active_only?: boolean;
    search?: string;
  },
  headers?: Record<string, string>,
): Promise<{ patients: Patient[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.active_only !== undefined) {
    searchParams.set("active_only", String(params.active_only));
  }
  if (params?.search) {
    searchParams.set("search", params.search);
  }

  const query = searchParams.toString();
  const path = query ? `/patients/?${query}` : "/patients/";
  return apiRequest<{ patients: Patient[]; total: number }>(path, {
    headers,
    retryCount: 2,
  });
}

export async function createPatientAPI(
  data: PatientCreate,
  headers?: Record<string, string>,
): Promise<Patient> {
  // Clean up empty strings to null for datetime fields
  const cleanedData = {
    ...data,
    date_of_birth: data.date_of_birth || null,
    admission_date: data.admission_date || null,
    age: data.age || null,
  };
  const res = await fetch(`${API_BASE}/patients/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(cleanedData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create patient");
  }
  return res.json();
}

export async function updatePatientAPI(
  id: string,
  data: Partial<PatientCreate>,
  headers?: Record<string, string>,
): Promise<Patient> {
  // Clean up empty strings to null for datetime fields
  const cleanedData = {
    ...data,
    date_of_birth: data.date_of_birth === "" ? null : data.date_of_birth,
    admission_date: data.admission_date === "" ? null : data.admission_date,
    age: data.age === "" ? null : data.age,
  };
  const res = await fetch(`${API_BASE}/patients/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(cleanedData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to update patient");
  }
  return res.json();
}

export async function deletePatientAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/patients/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to delete patient");
  }
}

export async function createBulkPatientsAPI(
  patients: PatientCreate[],
  headers?: Record<string, string>,
): Promise<Patient[]> {
  const res = await fetch(`${API_BASE}/patients/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(patients),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create patients");
  }
  return res.json();
}

// ============================================
// HANDOVER API FUNCTIONS
// ============================================

export type PatientStatus =
  | "stable"
  | "improved"
  | "unchanged"
  | "worsening"
  | "critical";
export type AcuityLevel = "low" | "moderate" | "high" | "critical";
export type IsolationType =
  | "none"
  | "contact"
  | "droplet"
  | "airborne"
  | "neutropenic"
  | "protective"
  | "cytotoxic";
export type ShiftType = "day" | "evening" | "night";

export interface HandoverPatient {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  room_number: string;
  bed?: string;
  diagnosis?: string;
  age?: string;
  date_of_birth?: string;
}

export interface Handover {
  id: string;
  patient_id?: string;
  shift_date: string;
  shift_type: ShiftType;
  outgoing_nurse: string;
  incoming_nurse?: string;
  status: PatientStatus;
  acuity: AcuityLevel;
  isolation: IsolationType;
  code_status?: string;
  code_status_manual?: string;
  revision_date?: string;
  revision_author?: string;

  // Embedded patient demographics (HIPAA: stored on the handover itself)
  p_first_name?: string;
  p_last_name?: string;
  p_room_number?: string;
  p_bed?: string;
  p_mrn?: string;
  p_diagnosis?: string;
  p_date_of_birth?: string;
  p_age?: string;
  p_attending_physician?: string;

  // Header Section (Static)
  pertinent_issues?: string;
  admit_date?: string;
  anticipated_discharge?: string;
  allergies?: string;
  medications_summary?: string;
  prn_medications?: string;
  chemotherapies?: string;
  diagnosis_details?: string;
  summary_assessment?: string;
  treatment_plan?: string;

  // Labs
  wbc?: string;
  hgb?: string;
  plt?: string;
  anc?: string;
  abnormal_labs?: string;

  // VS/Pain
  abnormal_vitals?: string;
  bpews_score?: string;
  pain_scale?: string;
  pain_location?: string;
  pain_relieved_post_med?: string;
  pca_checkbox?: boolean;
  nca_checkbox?: boolean;
  pca_nca_bolus?: string;
  pca_description?: string;
  pain_notes?: string;
  monitoring_cardiac?: boolean;
  monitoring_o2_sat?: boolean;

  // IV
  iv_access?: string;
  cvad_type?: string;
  cvad_dressing?: string;
  iv_infusions?: string;
  tpn?: string;
  iv_access_type?: string;
  iv_access_location?: string;
  iv_access_date?: string;
  iv_access_status?: string;

  // G.U.
  urine_output?: string;
  strict_io?: boolean;
  io_00?: string;
  io_06?: string;
  io_12?: string;
  io_18?: string;
  io_interval?: string;
  io_00_last6h?: string;
  io_06_last6h?: string;
  io_12_last6h?: string;
  io_18_last6h?: string;
  io_00_04?: string;
  io_00_04_last6h?: string;
  io_04_08?: string;
  io_04_08_last6h?: string;
  io_08_12?: string;
  io_08_12_last6h?: string;
  io_12_16?: string;
  io_12_16_last6h?: string;
  io_16_20?: string;
  io_16_20_last6h?: string;
  io_20_24?: string;
  io_20_24_last6h?: string;
  foley?: boolean;
  urine_sg?: string;
  urine_ph?: string;
  urine_ob?: string;
  urine_glucose?: string;
  urine_ketones?: string;

  // Neurological
  neuro_normal?: boolean;
  altered_loc?: boolean;
  speech_changes?: boolean;
  confusion?: boolean;
  vp_shunt?: boolean;
  glasgow_score?: string;
  gcs_score?: string;
  neuro_notes?: string;

  // Resp/Cardio
  lung_assessment?: string;
  oxygen?: string;
  oxygen_needs?: string;
  cardiovascular?: string;
  chest_tube_left?: boolean;
  chest_tube_right?: boolean;
  chest_tube_type_lws?: boolean;
  chest_tube_type_sd?: boolean;
  heart_rate_notes?: string;

  // G.I.
  gi_tenderness?: boolean;
  gi_distention?: boolean;
  gi_girth?: string;
  vomiting?: boolean;
  vomiting_quantity?: string;
  nausea?: boolean;
  last_bowel_movement?: string;
  bowel_amount?: string;
  bowel_description?: string;
  constipation?: boolean;
  diarrhea?: boolean;
  diarrhea_quantity?: string;
  colostomy?: boolean;
  bowel_movements?: string;
  diet?: string;

  // Nutrition
  po_intake?: string;
  fluid_intake_po?: string;
  fluid_intake_iv?: string;
  fluid_intake_ng?: string;
  weight?: string;
  formula_checkbox?: boolean;
  formula?: string;
  total_fluid?: string;
  breast_milk?: boolean;
  continuous_feeding?: boolean;
  continuous_feeding_rate?: string;
  bolus_feeding?: boolean;
  bolus_amount?: string;
  ng_tube?: boolean;
  nj_tube?: boolean;
  gt_tube?: boolean;
  npo?: boolean;
  npo_status?: string;
  feeding_goal?: string;
  see_feeding_schedule?: boolean;
  tube_type?: string;

  // Musculoskeletal
  mobility_restrictions?: string;
  positioning?: string;
  assistive_devices?: string;
  activity?: string;
  activity_level?: string;
  fall_risk?: string;
  fall_precautions?: string;
  restraints?: string;
  mobility_aids?: string;

  // Skin
  braden_q_score?: string;
  skin_care_plan?: string;
  skin_assessment?: string;
  pressure_sore_stage?: string;
  pressure_sore_location?: string;
  pressure_sore_treatment?: string;
  pressure_sore_staging?: string;
  skin_integrity?: string;
  wounds?: string;

  // Psycho-Social
  psychosocial_notes?: string;
  family_notes?: string;

  // Discharge Planning
  expected_discharge_date?: string;
  discharge_teaching?: string;
  discharge_prescriptions?: string;
  home_enteral_feeding?: string;
  followup_appointments?: string;
  discharge_plan?: string;
  discharge_date?: string;
  social_work_needs?: string;
  pt_ot_needs?: string;

  // To Do & Follow Up
  todo_items?: string;
  followup_items?: string;

  // Legacy
  events_this_shift?: string;
  pending_tasks?: string;
  pending_labs?: string;
  consults?: string;
  additional_notes?: string;
  voice_transcription?: string;

  is_draft: boolean;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  patient?: HandoverPatient;
}

export interface HandoverCreate {
  patient_id?: string;
  shift_date: string;
  shift_type: ShiftType;
  outgoing_nurse: string;
  incoming_nurse?: string;
  status?: PatientStatus;
  acuity?: AcuityLevel;
  isolation?: IsolationType;
  code_status?: string;

  // Embedded patient demographics (for creating without a patient record)
  p_first_name?: string;
  p_last_name?: string;
  p_room_number?: string;
  p_bed?: string;
  p_mrn?: string;
  p_diagnosis?: string;
  p_date_of_birth?: string;
  p_age?: string;
  p_attending_physician?: string;

  // Header/Static fields that carry over
  pertinent_issues?: string;
  admit_date?: string;
  anticipated_discharge?: string;
  allergies?: string;
  medications_summary?: string;
  prn_medications?: string;
  chemotherapies?: string;

  // IV Access
  iv_access?: string;
  cvad_type?: string;
  cvad_dressing?: string;
  tpn?: string;

  // Tubes
  foley?: boolean;
  tube_type?: string;

  // Diet/Activity
  diet?: string;
  activity?: string;

  // Oxygen
  oxygen_needs?: string;

  // Skin/Mobility
  braden_q_score?: string;
  skin_care_plan?: string;
  mobility_restrictions?: string;
  assistive_devices?: string;
  positioning?: string;

  // Discharge Planning
  expected_discharge_date?: string;
  discharge_teaching?: string;
  discharge_prescriptions?: string;
  home_enteral_feeding?: string;
  followup_appointments?: string;

  // Legacy fields
  events_this_shift?: string;
  pending_tasks?: string;
  pending_labs?: string;
  consults?: string;
  pain_notes?: string;
  family_notes?: string;
  additional_notes?: string;
  voice_transcription?: string;
}

export interface HandoverUpdate {
  outgoing_nurse?: string;
  incoming_nurse?: string;
  status?: PatientStatus;
  acuity?: AcuityLevel;
  isolation?: IsolationType;
  code_status?: string;
  code_status_manual?: string;
  revision_date?: string;
  revision_author?: string;
  shift_type?: ShiftType;

  // Embedded patient demographics (editable on the handover)
  p_first_name?: string;
  p_last_name?: string;
  p_room_number?: string;
  p_bed?: string;
  p_mrn?: string;
  p_diagnosis?: string;
  p_date_of_birth?: string;
  p_age?: string;
  p_attending_physician?: string;

  // Header Section
  pertinent_issues?: string;
  admit_date?: string;
  anticipated_discharge?: string;
  allergies?: string;
  medications_summary?: string;
  prn_medications?: string;
  chemotherapies?: string;

  // Labs
  wbc?: string;
  hgb?: string;
  plt?: string;
  anc?: string;
  abnormal_labs?: string;

  // VS/Pain
  abnormal_vitals?: string;
  bpews_score?: string;
  pain_scale?: string;
  pain_location?: string;
  pain_relieved_post_med?: string;
  pca_checkbox?: boolean;
  nca_checkbox?: boolean;
  pca_nca_bolus?: string;
  pca_description?: string;
  pain_notes?: string;
  monitoring_cardiac?: boolean;
  monitoring_o2_sat?: boolean;

  // IV
  iv_access?: string;
  cvad_type?: string;
  cvad_dressing?: string;
  iv_infusions?: string;
  tpn?: string;

  // G.U.
  urine_output?: string;
  strict_io?: boolean;
  io_00?: string;
  io_06?: string;
  io_12?: string;
  io_18?: string;
  io_interval?: string;
  io_00_last6h?: string;
  io_06_last6h?: string;
  io_12_last6h?: string;
  io_18_last6h?: string;
  io_00_04?: string;
  io_00_04_last6h?: string;
  io_04_08?: string;
  io_04_08_last6h?: string;
  io_08_12?: string;
  io_08_12_last6h?: string;
  io_12_16?: string;
  io_12_16_last6h?: string;
  io_16_20?: string;
  io_16_20_last6h?: string;
  io_20_24?: string;
  io_20_24_last6h?: string;
  io_00_kghr?: string;
  io_00_last6h_kghr?: string;
  io_06_kghr?: string;
  io_06_last6h_kghr?: string;
  io_12_kghr?: string;
  io_12_last6h_kghr?: string;
  io_18_kghr?: string;
  io_18_last6h_kghr?: string;
  io_00_04_kghr?: string;
  io_00_04_last6h_kghr?: string;
  io_04_08_kghr?: string;
  io_04_08_last6h_kghr?: string;
  io_08_12_kghr?: string;
  io_08_12_last6h_kghr?: string;
  io_12_16_kghr?: string;
  io_12_16_last6h_kghr?: string;
  io_16_20_kghr?: string;
  io_16_20_last6h_kghr?: string;
  io_20_24_kghr?: string;
  io_20_24_last6h_kghr?: string;
  foley?: boolean;
  urine_sg?: string;
  urine_ph?: string;
  urine_ob?: string;
  urine_glucose?: string;
  urine_ketones?: string;

  // Neurological
  neuro_normal?: boolean;
  altered_loc?: boolean;
  speech_changes?: boolean;
  confusion?: boolean;
  vp_shunt?: boolean;
  glasgow_score?: string;
  gcs_score?: string;
  neuro_notes?: string;

  // Resp/Cardio
  lung_assessment?: string;
  oxygen?: string;
  oxygen_needs?: string;
  cardiovascular?: string;
  chest_tube_left?: boolean;
  chest_tube_right?: boolean;
  chest_tube_type_lws?: boolean;
  chest_tube_type_sd?: boolean;
  heart_rate_notes?: string;

  // G.I.
  gi_tenderness?: boolean;
  gi_distention?: boolean;
  gi_girth?: string;
  vomiting?: boolean;
  vomiting_quantity?: string;
  nausea?: boolean;
  last_bowel_movement?: string;
  bowel_amount?: string;
  bowel_description?: string;
  constipation?: boolean;
  diarrhea?: boolean;
  diarrhea_quantity?: string;
  colostomy?: boolean;
  bowel_movements?: string;
  diet?: string;

  // Nutrition
  po_intake?: string;
  fluid_intake_po?: string;
  fluid_intake_iv?: string;
  fluid_intake_ng?: string;
  weight?: string;
  formula_checkbox?: boolean;
  formula?: string;
  total_fluid?: string;
  breast_milk?: boolean;
  continuous_feeding?: boolean;
  continuous_feeding_rate?: string;
  bolus_feeding?: boolean;
  bolus_amount?: string;
  ng_tube?: boolean;
  nj_tube?: boolean;
  gt_tube?: boolean;
  npo?: boolean;
  npo_status?: string;
  feeding_goal?: string;
  see_feeding_schedule?: boolean;
  tube_type?: string;

  // Musculoskeletal
  mobility_restrictions?: string;
  positioning?: string;
  assistive_devices?: string;
  activity?: string;
  activity_level?: string;
  fall_risk?: string;
  fall_precautions?: string;
  restraints?: string;
  mobility_aids?: string;

  // Skin
  braden_q_score?: string;
  skin_care_plan?: string;
  skin_assessment?: string;
  pressure_sore_stage?: string;
  pressure_sore_location?: string;
  pressure_sore_treatment?: string;
  pressure_sore_staging?: string;
  skin_integrity?: string;
  wounds?: string;

  // Psycho-Social
  psychosocial_notes?: string;
  family_notes?: string;

  // Discharge Planning
  expected_discharge_date?: string;
  discharge_teaching?: string;
  discharge_prescriptions?: string;
  home_enteral_feeding?: string;
  followup_appointments?: string;
  discharge_plan?: string;
  discharge_date?: string;
  social_work_needs?: string;
  pt_ot_needs?: string;

  // Static info
  diagnosis_details?: string;
  summary_assessment?: string;
  treatment_plan?: string;
  iv_access_type?: string;
  iv_access_location?: string;
  iv_access_date?: string;
  iv_access_status?: string;

  // To Do & Follow Up
  todo_items?: string;
  followup_items?: string;

  // Legacy
  events_this_shift?: string;
  pending_tasks?: string;
  pending_labs?: string;
  consults?: string;
  additional_notes?: string;
  voice_transcription?: string;

  is_draft?: boolean;
  is_completed?: boolean;
}

export async function fetchHandoversAPI(
  params?: {
    shift_date?: string;
    shift_type?: ShiftType;
    is_completed?: boolean;
    patient_id?: string;
    outgoing_nurse?: string;
  },
  headers?: Record<string, string>,
): Promise<{ handovers: Handover[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.shift_date) searchParams.set("shift_date", params.shift_date);
  if (params?.shift_type) searchParams.set("shift_type", params.shift_type);
  if (params?.is_completed !== undefined)
    searchParams.set("is_completed", String(params.is_completed));
  if (params?.patient_id) searchParams.set("patient_id", params.patient_id);
  if (params?.outgoing_nurse)
    searchParams.set("outgoing_nurse", params.outgoing_nurse);

  const res = await fetch(`${API_BASE}/handovers?${searchParams}`, {
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch handovers");
  }
  return res.json();
}

export async function fetchTodaysHandoversAPI(
  shift_type?: ShiftType,
  headers?: Record<string, string>,
): Promise<{ handovers: Handover[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (shift_type) searchParams.set("shift_type", shift_type);

  const res = await fetch(`${API_BASE}/handovers/today?${searchParams}`, {
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch today's handovers");
  }
  return res.json();
}

export async function fetchYesterdaysHandoversAPI(
  shift_type?: ShiftType,
): Promise<{ handovers: Handover[]; total: number }> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  const searchParams = new URLSearchParams();
  searchParams.set("shift_date", dateStr);
  if (shift_type) searchParams.set("shift_type", shift_type);

  const res = await fetch(`${API_BASE}/handovers?${searchParams}`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch yesterday's handovers");
  }
  return res.json();
}

export async function fetchHandoverAPI(id: string): Promise<Handover> {
  const res = await fetch(`${API_BASE}/handovers/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch handover");
  }
  return res.json();
}

export async function createHandoverAPI(
  data: HandoverCreate,
  headers?: Record<string, string>,
): Promise<Handover> {
  const res = await fetch(`${API_BASE}/handovers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create handover");
  }
  return res.json();
}

export async function updateHandoverAPI(
  id: string,
  data: HandoverUpdate,
  headers?: Record<string, string>,
): Promise<Handover> {
  const res = await fetch(`${API_BASE}/handovers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to update handover");
  }
  return res.json();
}

export async function completeHandoverAPI(
  id: string,
  incoming_nurse: string,
  headers?: Record<string, string>,
): Promise<Handover> {
  const urls = [
    `${API_BASE}/handovers/${id}/complete`,
    `${API_BASE}/handovers/${id}/complete/`,
  ];
  const methods: Array<"POST" | "PATCH"> = ["POST", "PATCH"];

  let lastError: any = null;

  for (const url of urls) {
    for (const method of methods) {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: JSON.stringify({ incoming_nurse }),
      });

      if (res.ok) {
        return res.json();
      }

      const err = await res.json().catch(() => null);
      lastError = err;

      // Stop retrying if the request reached the endpoint but failed for business reasons
      if (res.status !== 404 && res.status !== 405) {
        throw new Error(err?.detail || "Failed to complete handover");
      }
    }
  }

  throw new Error(lastError?.detail || "Failed to complete handover");
}

export async function deleteHandoverAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/handovers/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to delete handover");
  }
}

export interface CleanupResult {
  deleted_count: number;
  cutoff_date: string;
  days_kept: number;
  message: string;
}

export async function cleanupOldHandoversAPI(
  daysToKeep: number = 30,
  headers?: Record<string, string>,
): Promise<CleanupResult> {
  const res = await fetch(
    `${API_BASE}/handovers/cleanup?days_to_keep=${daysToKeep}`,
    {
      method: "DELETE",
      headers,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to cleanup old handovers");
  }
  return res.json();
}

export async function createBulkHandoversAPI(
  data: {
    patient_ids: string[];
    shift_date: string;
    shift_type: ShiftType;
    outgoing_nurse: string;
  },
  headers?: Record<string, string>,
): Promise<Handover[]> {
  const res = await fetch(`${API_BASE}/handovers/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create bulk handovers");
  }
  return res.json();
}

export async function fetchLatestHandoverForPatientAPI(
  patient_id: string,
): Promise<Handover | null> {
  const res = await fetch(`${API_BASE}/handovers/patient/${patient_id}/latest`);
  if (!res.ok) {
    if (res.status === 404) return null;
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch latest handover");
  }
  return res.json();
}

export async function fetchHandoverHistoryForPatientAPI(
  patient_id: string,
  limit: number = 50,
): Promise<{ handovers: Handover[]; total: number }> {
  const res = await fetch(
    `${API_BASE}/handovers/patient/${patient_id}/history?limit=${limit}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch handover history");
  }
  return res.json();
}

// Schedule Optimization APIs
export async function previewConstraintsAPI(payload: any): Promise<any> {
  return apiRequest<any>("/optimize/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  });
}

export async function optimizeWithConstraintsAPI(
  payload: {
    constraints: any;
    assignments?: any;
    nurses?: any;
    schedule_id?: string;
    save_to_db?: boolean;
  },
  headers?: Record<string, string>,
): Promise<any> {
  return apiRequest<any>("/optimize/optimize-with-constraints", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(payload),
    timeoutMs: 300000,
  });
}

export async function refineScheduleAPI(payload: {
  schedule: any;
  refinement_request: string;
  dates: string[];
  nurseHoursStats?: any[];
  fullTimeBiWeeklyTarget?: number;
  partTimeBiWeeklyTarget?: number;
  rules?: string;
}): Promise<any> {
  return apiRequest<any>("/optimize/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 180000,
  });
}

export interface GapFillSuggestion {
  date: string;
  nurse: string;
  shiftCode: string;
  shiftStart: string;
  shiftEnd: string;
  shiftHours: number;
  shiftType: "day" | "night";
  currentHeadcount: number;
  averageHeadcount: number;
  nurseDelta: number;
  nurseCurrentHours: number;
  nurseTargetHours: number;
  nurseEmploymentType: string;
  priority: "high" | "medium";
}

export async function analyzeScheduleInsightsAPI(payload: {
  schedule: any;
  dates: string[];
  nurseHoursStats?: any[];
  coverageSnapshot?: any;
  orgContext?: string;
  staffNotes?: Record<string, string[]>;
  markerComments?: string;
  locale?: string;
}): Promise<{
  summary: string;
  score: number | null;
  issues: {
    severity: "error" | "warning" | "info";
    title: string;
    description: string;
  }[];
  suggestions: { category: string; text: string }[];
  gapFillSuggestions?: GapFillSuggestion[];
}> {
  return apiRequest("/optimize/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  });
}

// ============================================
// NURSE MANAGEMENT API
// ============================================

export type StaffingRole = "nurse" | "assistant_manager";

/** Optional Team A / Team B alternating-weekend rotation group. */
export type WeekendTeam = string | null;

export interface Nurse {
  id: string;
  user_id: string | null;
  name: string;
  employee_id?: string;
  seniority?: string;
  team?: string;
  staffing_role?: StaffingRole;
  weekend_team?: WeekendTeam;
  employment_type: "full-time" | "part-time";
  max_weekly_hours: number;
  bi_weekly_target_hours: number;
  target_weekly_hours?: number;
  preferred_shift_length_hours?: number;
  is_chemo_certified: boolean;
  is_transplant_certified: boolean;
  is_renal_certified: boolean;
  is_charge_certified: boolean;
  other_certifications?: string;
  // Leave status - nurses on leave are excluded from scheduling
  is_on_maternity_leave?: boolean;
  is_on_sick_leave?: boolean;
  is_on_sabbatical?: boolean;
  created_at: string;
  updated_at: string;
}

export interface NurseCreate {
  user_id?: string | null;
  name: string;
  employee_id?: string;
  seniority?: string;
  team?: string;
  staffing_role?: StaffingRole;
  weekend_team?: WeekendTeam;
  employment_type: "full-time" | "part-time";
  max_weekly_hours: number;
  target_weekly_hours?: number;
  preferred_shift_length_hours?: number;
  is_chemo_certified: boolean;
  is_transplant_certified?: boolean;
  is_renal_certified?: boolean;
  is_charge_certified?: boolean;
  other_certifications?: string;
  // Leave status
  is_on_maternity_leave?: boolean;
  is_on_sick_leave?: boolean;
  is_on_sabbatical?: boolean;
}

export interface NurseUpdate {
  user_id?: string | null;
  name?: string;
  employee_id?: string;
  seniority?: string;
  team?: string;
  staffing_role?: StaffingRole;
  weekend_team?: WeekendTeam;
  employment_type?: "full-time" | "part-time";
  max_weekly_hours?: number;
  bi_weekly_target_hours?: number;
  target_weekly_hours?: number;
  preferred_shift_length_hours?: number;
  is_chemo_certified?: boolean;
  is_transplant_certified?: boolean;
  is_renal_certified?: boolean;
  is_charge_certified?: boolean;
  other_certifications?: string;
  // Leave status
  is_on_maternity_leave?: boolean;
  is_on_sick_leave?: boolean;
  is_on_sabbatical?: boolean;
}

export async function listNursesAPI(
  userId: string,
  page = 1,
  pageSize = 50,
  search?: string,
  headers?: Record<string, string>,
): Promise<{
  nurses: Nurse[];
  total: number;
  page: number;
  page_size: number;
}> {
  const params = new URLSearchParams({
    user_id: userId,
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  if (search) params.append("search", search);

  return apiRequest<{
    nurses: Nurse[];
    total: number;
    page: number;
    page_size: number;
  }>(`/nurses?${params.toString()}`, {
    headers,
    timeoutMs: 15000,
    retryCount: 1,
  });
}

export async function getNurseAPI(
  nurseId: string,
  userId: string,
  headers?: Record<string, string>,
): Promise<Nurse> {
  return apiRequest<Nurse>(`/nurses/${nurseId}?user_id=${userId}`, {
    headers,
  });
}

export async function createNurseAPI(
  userId: string,
  nurse: NurseCreate,
  headers?: Record<string, string>,
): Promise<Nurse> {
  return apiRequest<Nurse>(`/nurses?user_id=${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(nurse),
  });
}

export async function updateNurseAPI(
  nurseId: string,
  userId: string,
  nurse: NurseUpdate,
  headers?: Record<string, string>,
): Promise<Nurse> {
  return apiRequest<Nurse>(`/nurses/${nurseId}?user_id=${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(nurse),
  });
}

export async function deleteNurseAPI(
  nurseId: string,
  userId: string,
  headers?: Record<string, string>,
): Promise<void> {
  return apiRequest<void>(`/nurses/${nurseId}?user_id=${userId}`, {
    method: "DELETE",
    headers,
  });
}

export interface OrganizationMemberOption {
  id: string;
  user_id: string;
  user_email?: string | null;
  user_name?: string | null;
  role: "admin" | "manager" | "assistant_manager" | "nurse";
  is_active: boolean;
  is_approved: boolean;
}

export async function listOrganizationMembersAPI(
  orgId: string,
  headers?: Record<string, string>,
): Promise<OrganizationMemberOption[]> {
  return apiRequest<OrganizationMemberOption[]>(
    `/organizations/${orgId}/members`,
    {
      headers,
      timeoutMs: 15000,
      retryCount: 1,
    },
  );
}

// ─────────────────────────────────────────────────────────────
// Shift Codes API
// ─────────────────────────────────────────────────────────────

export interface ShiftCodeAPI {
  code: string;
  start: string;
  end: string;
  hours: number;
  type: "day" | "night" | "combined";
  label: string;
}

export interface TimeSlotAPI {
  slot: string;
  category: "Day" | "Evening" | "Night";
  duration: "8hr" | "12hr" | "Split";
  mapsTo: string[];
  label: string;
}

export interface ShiftCodesResponse {
  shift_codes: ShiftCodeAPI[];
  time_slots: TimeSlotAPI[];
}

export async function getShiftCodesAPI(
  organizationId?: string,
): Promise<ShiftCodesResponse> {
  const params = organizationId ? `?organization_id=${organizationId}` : "";
  const res = await fetch(`${API_BASE}/shift-codes${params}`);

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to fetch shift codes");
  }

  return res.json();
}

export async function createShiftCodeAPI(
  shiftCode: {
    organization_id?: string;
    code: string;
    label: string;
    start_time: string;
    end_time: string;
    hours: number;
    shift_type: "day" | "night" | "combined";
    display_order?: number;
  },
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/shift-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(shiftCode),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create shift code");
  }

  return res.json();
}

export async function deleteShiftCodeAPI(
  shiftCodeId: string,
  headers?: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/shift-codes/${shiftCodeId}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to delete shift code");
  }
}

export async function initializeDefaultShiftCodesAPI(
  organizationId: string,
  headers?: Record<string, string>,
): Promise<{ message: string }> {
  const res = await fetch(
    `${API_BASE}/shift-codes/initialize-defaults?organization_id=${organizationId}`,
    {
      method: "POST",
      headers,
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to initialize shift codes");
  }

  return res.json();
}

// ============= Scheduling Management APIs =============

export async function createScheduleDemandAPI(
  orgId: string,
  demand: {
    shift_code_id: string;
    date: string;
    global_daily_target?: number;
    min_staff_required: number;
    skill_requirements?: Record<string, number>;
    notes?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/demands?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(demand),
    timeoutMs: 15000,
  });
}

export async function listScheduleDemandsAPI(
  orgId: string,
  dateStart: string,
  dateEnd: string,
): Promise<any> {
  return apiRequest(
    `/api/scheduling/demands?org_id=${orgId}&date_start=${dateStart}&date_end=${dateEnd}`,
    {
      timeoutMs: 15000,
    },
  );
}

export async function getScheduleDemandAPI(demandId: string): Promise<any> {
  return apiRequest(`/api/scheduling/demands/${demandId}`, {
    timeoutMs: 10000,
  });
}

export async function updateScheduleDemandAPI(
  demandId: string,
  demand: any,
): Promise<any> {
  return apiRequest(`/api/scheduling/demands/${demandId}`, {
    method: "PUT",
    body: JSON.stringify(demand),
    timeoutMs: 15000,
  });
}

export async function deleteScheduleDemandAPI(demandId: string): Promise<void> {
  return apiRequest(`/api/scheduling/demands/${demandId}`, {
    method: "DELETE",
    timeoutMs: 10000,
  });
}

// ============= Shift Templates =============

export async function createShiftTemplateAPI(
  orgId: string,
  template: {
    name: string;
    description?: string;
    template_type: "daily" | "weekly" | "monthly";
    pattern: Record<string, string[]>;
    applicable_shift_codes?: string;
    applicable_roles?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/templates?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(template),
    timeoutMs: 15000,
  });
}

export async function listShiftTemplatesAPI(
  orgId: string,
  templateType?: string,
): Promise<any> {
  const params = templateType
    ? `?org_id=${orgId}&template_type=${templateType}`
    : `?org_id=${orgId}`;
  return apiRequest(`/api/scheduling/templates${params}`, {
    timeoutMs: 10000,
  });
}

export async function updateShiftTemplateAPI(
  templateId: string,
  template: any,
): Promise<any> {
  return apiRequest(`/api/scheduling/templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(template),
    timeoutMs: 15000,
  });
}

export async function deleteShiftTemplateAPI(
  templateId: string,
): Promise<void> {
  return apiRequest(`/api/scheduling/templates/${templateId}`, {
    method: "DELETE",
    timeoutMs: 10000,
  });
}

// ============= Time-Off Requests =============

export async function createTimeOffRequestAPI(
  orgId: string,
  request: {
    nurse_id: string;
    start_date: string;
    end_date: string;
    reason: "vacation" | "sick" | "personal" | "family";
    notes?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/time-off-requests?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(request),
    timeoutMs: 15000,
  });
}

export async function listTimeOffRequestsAPI(
  orgId: string,
  status?: string,
  nurseId?: string,
): Promise<any> {
  let params = `?org_id=${orgId}`;
  if (status) params += `&status=${status}`;
  if (nurseId) params += `&nurse_id=${nurseId}`;

  return apiRequest(`/api/scheduling/time-off-requests${params}`, {
    timeoutMs: 10000,
  });
}

export async function approveTimeOffRequestAPI(
  requestId: string,
  approval: {
    approved_by_id: string;
    approval_timestamp?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/time-off-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(approval),
    timeoutMs: 15000,
  });
}

export async function denyTimeOffRequestAPI(
  requestId: string,
  denial: {
    approved_by_id: string;
    denial_reason: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/time-off-requests/${requestId}/deny`, {
    method: "POST",
    body: JSON.stringify(denial),
    timeoutMs: 15000,
  });
}

// ============= Reconciliation =============

export async function getComplianceScoreAPI(orgId: string): Promise<any> {
  return apiRequest(
    `/api/scheduling/reconciliation/compliance?org_id=${orgId}`,
    {
      timeoutMs: 10000,
    },
  );
}

export async function getBalancingShiftsAPI(
  orgId: string,
  periodEndDate: string,
): Promise<any> {
  return apiRequest(
    `/api/scheduling/reconciliation/balancing-shifts?org_id=${orgId}&period_end_date=${periodEndDate}`,
    {
      timeoutMs: 15000,
    },
  );
}

export async function getNurseReconciliationAPI(
  orgId: string,
  nurseId: string,
  periodStartDate: string,
): Promise<any> {
  return apiRequest(
    `/api/scheduling/reconciliation/${nurseId}?org_id=${orgId}&period_start_date=${periodStartDate}`,
    {
      timeoutMs: 10000,
    },
  );
}

export async function recalculateAllReconciliationsAPI(
  orgId: string,
  periodEndDate: string,
): Promise<any> {
  return apiRequest(
    `/api/scheduling/reconciliation/calculate-all?org_id=${orgId}&period_end_date=${periodEndDate}`,
    {
      method: "POST",
      timeoutMs: 30000,
    },
  );
}

// ============= Schedule Publishing =============

export async function publishScheduleAPI(
  orgId: string,
  schedule: {
    schedule_dict: Record<string, any[]>;
    dates: string[];
    require_approval?: boolean;
    notes?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/publish?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(schedule),
    timeoutMs: 60000,
  });
}

export async function createShiftAssignmentsAPI(
  orgId: string,
  assignments: {
    assignments: Array<{
      date: string;
      shift_code_id: string;
      nurse_id: string;
    }>;
    reason?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/assignments?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(assignments),
    timeoutMs: 30000,
  });
}

// ============= Recurrence API Functions =============

export async function createRecurrenceAPI(
  orgId: string,
  recurrence: {
    name: string;
    description?: string;
    recurrence_type: string;
    pattern: Record<string, string[]>;
    cycle_length_days: number;
    applicable_nurses?: string[];
    start_date?: string;
    end_date?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/recurrences?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(recurrence),
    timeoutMs: 15000,
  });
}

export async function listRecurrencesAPI(
  orgId: string,
  recurrenceType?: string,
): Promise<any[]> {
  let url = `/api/scheduling/recurrences?org_id=${orgId}`;
  if (recurrenceType) {
    url += `&recurrence_type=${recurrenceType}`;
  }
  return apiRequest(url, {
    method: "GET",
    timeoutMs: 10000,
  });
}

export async function getRecurrenceAPI(recurrenceId: number): Promise<any> {
  return apiRequest(`/api/scheduling/recurrences/${recurrenceId}`, {
    method: "GET",
    timeoutMs: 10000,
  });
}

export async function updateRecurrenceAPI(
  recurrenceId: number,
  recurrence: {
    name: string;
    description?: string;
    recurrence_type: string;
    pattern: Record<string, string[]>;
    cycle_length_days: number;
    applicable_nurses?: string[];
    start_date?: string;
    end_date?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/recurrences/${recurrenceId}`, {
    method: "PUT",
    body: JSON.stringify(recurrence),
    timeoutMs: 15000,
  });
}

export async function generateScheduleFromRecurrenceAPI(
  orgId: string,
  recurrenceId: number,
  request: {
    start_date: string;
    end_date: string;
    override_nurses?: string[];
  },
): Promise<any> {
  return apiRequest(
    `/api/scheduling/recurrences/${recurrenceId}/generate-schedule?org_id=${orgId}`,
    {
      method: "POST",
      body: JSON.stringify(request),
      timeoutMs: 30000,
    },
  );
}

// ============= Employee Preferred Schedule API Functions =============

export async function createEmployeePreferenceAPI(
  orgId: string,
  preference: {
    nurse_id: string;
    preferred_pattern: Record<string, string[]>;
    period_start_date: string;
    period_end_date: string;
    constraints?: Record<string, any>;
    source?: string;
    upload_filename?: string;
  },
): Promise<any> {
  return apiRequest(`/api/scheduling/employee-preferences?org_id=${orgId}`, {
    method: "POST",
    body: JSON.stringify(preference),
    timeoutMs: 15000,
  });
}

export async function getEmployeePreferencesAPI(
  orgId: string,
  nurseId: string,
): Promise<any[]> {
  return apiRequest(
    `/api/scheduling/employee-preferences/${nurseId}?org_id=${orgId}`,
    {
      method: "GET",
      timeoutMs: 10000,
    },
  );
}

export async function updateEmployeePreferenceAPI(
  orgId: string,
  preferenceId: number,
  preference: {
    nurse_id: string;
    preferred_pattern: Record<string, string[]>;
    period_start_date: string;
    period_end_date: string;
    constraints?: Record<string, any>;
    source?: string;
    upload_filename?: string;
  },
): Promise<any> {
  return apiRequest(
    `/api/scheduling/employee-preferences/${preferenceId}?org_id=${orgId}`,
    {
      method: "PUT",
      body: JSON.stringify(preference),
      timeoutMs: 15000,
    },
  );
}

// ── Schedule Rules ─────────────────────────────────────────────────

export interface ScheduleRule {
  id: number;
  organization_id: string;
  name: string;
  rules_text: string;
  created_by?: string;
  updated_at?: string;
  created_at?: string;
}

export async function getLatestScheduleRuleAPI(
  orgId?: string,
  headers?: Record<string, string>,
): Promise<ScheduleRule | null> {
  try {
    const opts: any = { timeoutMs: 10000 };
    const combinedHeaders = { ...(headers || {}) };
    if (orgId) {
      combinedHeaders["X-Organization-ID"] = orgId;
    }
    opts.headers = combinedHeaders;
    return await apiRequest("/schedule-rules/latest", opts);
  } catch {
    return null;
  }
}

export async function saveScheduleRuleAPI(
  payload: {
    name?: string;
    rules_text: string;
  },
  headers?: Record<string, string>,
): Promise<ScheduleRule> {
  return apiRequest("/schedule-rules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify({
      name: payload.name || "default",
      rules_text: payload.rules_text,
    }),
    timeoutMs: 10000,
  });
}

// ═══════════════════════════════════════════════════════════
// Ambient Documentation API
// ═══════════════════════════════════════════════════════════

export interface AmbientSession {
  id: string;
  organization_id: string;
  nurse_id: string;
  patient_mrn: string | null;
  status:
    | "recording"
    | "processing"
    | "draft"
    | "reviewed"
    | "committed"
    | "discarded";
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  extracted_data: Record<string, unknown> | null;
  nurse_corrections: Record<string, unknown> | null;
  confidence_score: number | null;
  reviewed_at: string | null;
  committed_at: string | null;
  created_at: string;
}

export async function startAmbientSessionAPI(
  body: { patient_mrn?: string; interaction_type?: string },
  headers?: Record<string, string>,
): Promise<AmbientSession> {
  return apiRequest("/ambient", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function fetchAmbientSessionsAPI(
  params: { status?: string; patient_mrn?: string; page?: number },
  headers?: Record<string, string>,
): Promise<{ sessions: AmbientSession[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.patient_mrn) qs.set("patient_mrn", params.patient_mrn);
  if (params.page) qs.set("page", String(params.page));
  return apiRequest(`/ambient?${qs.toString()}`, { headers });
}

export async function fetchAmbientSessionAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<AmbientSession> {
  return apiRequest(`/ambient/${id}`, { headers });
}

export async function submitAmbientTranscriptAPI(
  id: string,
  transcript: string,
  headers?: Record<string, string>,
): Promise<AmbientSession> {
  return apiRequest(`/ambient/${id}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ transcript }),
  });
}

export async function reviewAmbientSessionAPI(
  id: string,
  body: { corrections?: Record<string, unknown>; approved: boolean },
  headers?: Record<string, string>,
): Promise<AmbientSession> {
  return apiRequest(`/ambient/${id}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function commitAmbientSessionAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<AmbientSession> {
  return apiRequest(`/ambient/${id}/commit`, {
    method: "POST",
    headers,
  });
}

export async function discardAmbientSessionAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<void> {
  return apiRequest(`/ambient/${id}`, {
    method: "DELETE",
    headers,
  });
}

// ═══════════════════════════════════════════════════════════
// Burnout & Retention Prediction API
// ═══════════════════════════════════════════════════════════

export interface BurnoutSnapshot {
  id: string;
  nurse_id: string;
  overall_risk_score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  overtime_score: number | null;
  schedule_density_score: number | null;
  night_shift_load_score: number | null;
  weekend_load_score: number | null;
  short_rest_score: number | null;
  pattern_disruption_score: number | null;
  tenure_risk_score: number | null;
  metrics: Record<string, unknown> | null;
  previous_risk_score: number | null;
  trend: "improving" | "stable" | "worsening" | null;
  snapshot_date: string;
}

export interface BurnoutAlert {
  id: string;
  nurse_id: string;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  recommendation: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  action_taken: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface BurnoutTopRiskItem {
  id: string;
  nurse_id: string;
  nurse_name: string;
  overall_risk_score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  overtime_score: number | null;
  schedule_density_score: number | null;
  night_shift_load_score: number | null;
  weekend_load_score: number | null;
  short_rest_score: number | null;
  pattern_disruption_score: number | null;
  tenure_risk_score: number | null;
  trend: "improving" | "stable" | "worsening" | null;
  snapshot_date: string;
}

export interface BurnoutRiskBucketItem {
  nurse_id: string;
  nurse_name: string;
  overall_risk_score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
}

export interface BurnoutDashboard {
  total_nurses: number;
  risk_distribution: Record<string, number>;
  risk_buckets: Record<string, BurnoutRiskBucketItem[]>;
  top_risks: BurnoutTopRiskItem[];
  recent_alerts: BurnoutAlert[];
  trend_summary: Record<string, number>;
}

export interface BurnoutNurseDetail {
  nurse_id: string;
  nurse_name: string;
  current_snapshot: BurnoutSnapshot | null;
  history: BurnoutSnapshot[];
  alerts: BurnoutAlert[];
}

export async function fetchBurnoutDashboardAPI(
  headers?: Record<string, string>,
): Promise<BurnoutDashboard> {
  return apiRequest("/burnout/dashboard", { headers });
}

export async function fetchBurnoutNurseDetailAPI(
  nurseId: string,
  days?: number,
  headers?: Record<string, string>,
): Promise<BurnoutNurseDetail> {
  const qs = days ? `?days=${days}` : "";
  return apiRequest(`/burnout/nurses/${nurseId}${qs}`, { headers });
}

export async function runBurnoutAssessmentAPI(
  nurseId?: string,
  headers?: Record<string, string>,
): Promise<{
  assessed: number;
  results: Array<{ nurse_id: string; risk_level: string; score: number }>;
}> {
  const qs = nurseId ? `?nurse_id=${nurseId}` : "";
  return apiRequest(`/burnout/assess${qs}`, {
    method: "POST",
    headers,
  });
}

export async function fetchBurnoutAlertsAPI(
  params?: { acknowledged?: boolean; severity?: string },
  headers?: Record<string, string>,
): Promise<BurnoutAlert[]> {
  const qs = new URLSearchParams();
  if (params?.acknowledged !== undefined)
    qs.set("acknowledged", String(params.acknowledged));
  if (params?.severity) qs.set("severity", params.severity);
  return apiRequest(`/burnout/alerts?${qs.toString()}`, { headers });
}

export async function acknowledgeBurnoutAlertAPI(
  alertId: string,
  actionTaken?: string,
  headers?: Record<string, string>,
): Promise<BurnoutAlert> {
  return apiRequest(`/burnout/alerts/${alertId}/acknowledge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ action_taken: actionTaken || null }),
  });
}

// ═══════════════════════════════════════════════════════════
// Micro-Learning / Onboarding API
// ═══════════════════════════════════════════════════════════

export interface LearningModule {
  id: string;
  organization_id: string | null;
  title: string;
  description: string | null;
  category: string;
  content_type: "interactive" | "video" | "quiz" | "checklist" | "simulation";
  content: Record<string, unknown>;
  estimated_duration_minutes: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  tags: string[] | null;
  prerequisite_module_ids: string[] | null;
  target_roles: string[] | null;
  required_for_onboarding: boolean;
  is_mandatory: boolean;
  is_published: boolean;
  passing_score: number;
  sort_order: number;
  version: number;
  created_at: string;
}

export interface LearningProgress {
  id: string;
  nurse_id: string;
  module_id: string;
  status: "not_started" | "in_progress" | "completed" | "failed" | "expired";
  progress_percentage: number;
  current_step: number;
  quiz_score: number | null;
  quiz_attempts: number;
  passed: boolean | null;
  time_spent_seconds: number;
  started_at: string | null;
  completed_at: string | null;
  last_accessed_at: string | null;
}

export interface LearningPath {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  module_ids: string[];
  target_roles: string[] | null;
  is_required: boolean;
  estimated_total_minutes: number | null;
  is_published: boolean;
  created_at: string;
}

export interface NurseOnboardingStatus {
  nurse_id: string;
  nurse_name: string;
  total_modules: number;
  completed_modules: number;
  in_progress_modules: number;
  completion_percentage: number;
  mandatory_completed: boolean;
  last_activity_at: string | null;
}

export interface LearningDashboard {
  total_nurses: number;
  fully_onboarded: number;
  in_progress: number;
  not_started: number;
  modules_available: number;
  paths_available: number;
  nurse_statuses: NurseOnboardingStatus[];
}

export async function fetchLearningModulesAPI(
  params?: { category?: string; published_only?: boolean },
  headers?: Record<string, string>,
): Promise<{ modules: LearningModule[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.published_only !== undefined)
    qs.set("published_only", String(params.published_only));
  return apiRequest(`/learning/modules?${qs.toString()}`, { headers });
}

export async function fetchLearningModuleAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<LearningModule> {
  return apiRequest(`/learning/modules/${id}`, { headers });
}

export async function createLearningModuleAPI(
  body: Partial<LearningModule>,
  headers?: Record<string, string>,
): Promise<LearningModule> {
  return apiRequest("/learning/modules", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function updateLearningModuleAPI(
  id: string,
  body: Partial<LearningModule>,
  headers?: Record<string, string>,
): Promise<LearningModule> {
  return apiRequest(`/learning/modules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function deleteLearningModuleAPI(
  id: string,
  headers?: Record<string, string>,
): Promise<void> {
  await apiRequest(`/learning/modules/${id}`, {
    method: "DELETE",
    headers,
  });
}

export async function startLearningModuleAPI(
  moduleId: string,
  headers?: Record<string, string>,
): Promise<LearningProgress> {
  return apiRequest(`/learning/modules/${moduleId}/start`, {
    method: "POST",
    headers,
  });
}

export async function updateLearningProgressAPI(
  moduleId: string,
  body: {
    current_step?: number;
    progress_percentage?: number;
    time_spent_seconds?: number;
    quiz_answers?: Record<string, unknown>;
    checklist_state?: Record<string, boolean>;
  },
  headers?: Record<string, string>,
): Promise<LearningProgress> {
  return apiRequest(`/learning/modules/${moduleId}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function fetchMyLearningProgressAPI(
  headers?: Record<string, string>,
): Promise<LearningProgress[]> {
  return apiRequest("/learning/my-progress", { headers });
}

export async function fetchLearningPathsAPI(
  headers?: Record<string, string>,
): Promise<LearningPath[]> {
  return apiRequest("/learning/paths", { headers });
}

export async function fetchLearningDashboardAPI(
  headers?: Record<string, string>,
): Promise<LearningDashboard> {
  return apiRequest("/learning/dashboard", { headers });
}

// ============================================
// LEARNING ASSIGNMENTS
// ============================================

export interface LearningAssignment {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  assignment_type: "module" | "link" | "reading";
  module_id?: string | null;
  url?: string | null;
  target_team?: string | null;
  due_date?: string | null;
  is_mandatory: boolean;
  created_by_name?: string | null;
  created_at: string;
  completed_by_me: boolean;
  completed_count: number;
}

export interface AssignmentCompletion {
  id: string;
  assignment_id: string;
  user_id: string;
  user_name?: string | null;
  completed_at: string;
}

export async function fetchLearningAssignmentsAPI(
  headers?: Record<string, string>,
): Promise<LearningAssignment[]> {
  return apiRequest("/learning/assignments", { headers });
}

export async function createLearningAssignmentAPI(
  body: {
    title: string;
    description?: string;
    assignment_type: "module" | "link" | "reading";
    module_id?: string;
    url?: string;
    target_team?: string | null;
    due_date?: string | null;
    is_mandatory?: boolean;
  },
  headers?: Record<string, string>,
): Promise<LearningAssignment> {
  return apiRequest("/learning/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function deleteLearningAssignmentAPI(
  assignmentId: string,
  headers?: Record<string, string>,
): Promise<void> {
  await apiRequest(`/learning/assignments/${assignmentId}`, {
    method: "DELETE",
    headers,
  });
}

export async function updateLearningAssignmentAPI(
  assignmentId: string,
  body: {
    title?: string;
    description?: string;
    target_team?: string | null;
    due_date?: string | null;
    is_mandatory?: boolean;
    url?: string;
  },
  headers?: Record<string, string>,
): Promise<LearningAssignment> {
  return apiRequest(`/learning/assignments/${assignmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function completeLearningAssignmentAPI(
  assignmentId: string,
  headers?: Record<string, string>,
): Promise<AssignmentCompletion> {
  return apiRequest(`/learning/assignments/${assignmentId}/complete`, {
    method: "POST",
    headers,
  });
}

export async function fetchAssignmentCompletionsAPI(
  assignmentId: string,
  headers?: Record<string, string>,
): Promise<AssignmentCompletion[]> {
  return apiRequest(`/learning/assignments/${assignmentId}/completions`, {
    headers,
  });
}

// ============================================
// ANNOUNCEMENTS
// ============================================

export interface Announcement {
  id: string;
  organization_id: string;
  title: string;
  body: string;
  source_link?: string | null;
  target_team?: string | null;
  is_pinned: boolean;
  expires_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchAnnouncementsAPI(
  headers?: Record<string, string>,
  includeExpired = false,
): Promise<Announcement[]> {
  const query = includeExpired ? "?include_expired=true" : "";
  return apiRequest(`/announcements/${query}`, { headers });
}

export async function createAnnouncementAPI(
  body: {
    title: string;
    body: string;
    source_link?: string | null;
    target_team?: string | null;
    is_pinned?: boolean;
    expires_at?: string | null;
  },
  headers?: Record<string, string>,
): Promise<Announcement> {
  return apiRequest("/announcements/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function updateAnnouncementAPI(
  announcementId: string,
  body: Partial<{
    title: string;
    body: string;
    source_link: string | null;
    target_team: string | null;
    is_pinned: boolean;
    expires_at: string | null;
  }>,
  headers?: Record<string, string>,
): Promise<Announcement> {
  return apiRequest(`/announcements/${announcementId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function deleteAnnouncementAPI(
  announcementId: string,
  headers?: Record<string, string>,
): Promise<void> {
  await apiRequest(`/announcements/${announcementId}`, {
    method: "DELETE",
    headers,
  });
}

// ============================================
// NOTIFICATIONS
// ============================================

export interface AppNotification {
  id: string;
  organization_id?: string | null;
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

export async function fetchNotificationsAPI(
  headers?: Record<string, string>,
  unreadOnly = false,
  options?: RequestTuningOptions,
): Promise<AppNotification[]> {
  const query = unreadOnly ? "?unread_only=true" : "";
  return apiRequest(`/notifications/${query}`, { ...options, headers });
}

export async function markNotificationReadAPI(
  notificationId: string,
  headers?: Record<string, string>,
): Promise<AppNotification> {
  return apiRequest(`/notifications/${notificationId}/read`, {
    method: "POST",
    headers,
  });
}

// ============================================
// SCHEDULE VERSIONS
// ============================================

export interface ScheduleVersion {
  id: string;
  organization_id?: string | null;
  is_finalized: boolean;
  start_date?: string | null;
  end_date?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  is_active: boolean;
}

export async function fetchScheduleVersionsAPI(
  scheduleId: string,
  headers?: Record<string, string>,
): Promise<{
  root_id: string;
  active_id: string | null;
  versions: ScheduleVersion[];
}> {
  return apiRequest(`/optimize/${scheduleId}/versions`, { headers });
}

export async function promoteScheduleVersionAPI(
  scheduleId: string,
  headers?: Record<string, string>,
): Promise<{ success: boolean; active_id: string }> {
  return apiRequest(`/optimize/${scheduleId}/promote`, {
    method: "POST",
    headers,
  });
}
