// Scheduler types - shared across hooks and components

export interface ShiftEntry {
  date: string;
  shift: string;
  shiftType: "day" | "night" | "combined" | "off";
  hours: number;
  startTime: string;
  endTime: string;
}

export type GridRow = {
  id: string;
  nurse: string;
  employeeId?: string;
  seniority?: string; // e.g., "3Y-283.95D"
  shifts: ShiftEntry[];
};

export type Step = "setup" | "review" | "optimize" | "result";

export interface ManualNurse {
  name: string;
  employeeId?: string;
  seniority?: string; // e.g., "3Y-283.95D"
  chemoCertified?: boolean;
  transplantCertified?: boolean;
  renalCertified?: boolean;
  chargeCertified?: boolean;
  isHeadNurse?: boolean;
  maxHours?: number;
  preferredShiftLengthHours?: number;
  employmentType?: "FT" | "PT";
  offRequests?: string[];
  // Leave status
  isOnMaternityLeave?: boolean;
  isOnSickLeave?: boolean;
  isOnSabbatical?: boolean;
}

export type OCRWarning = {
  name: string;
  issue: string;
  severity: "warning" | "error";
};

export type NewNurseCandidate = {
  name: string;
  employeeId?: string;
  seniority?: string; // e.g., "3Y-283.95D"
  selected: boolean;
  employmentType: "FT" | "PT";
  isChemoCertified: boolean;
  isTransplantCertified: boolean;
  isRenalCertified: boolean;
  isChargeCertified: boolean;
  maxHours: number;
  targetBiWeeklyHours?: number;
};

export interface NurseHourStats {
  name: string;
  totalHours: number;
  workingDays: number;
  targetHours: number;
  delta: number;
  employmentType: "FT" | "PT";
}

// ============================================================================
// SELF-SCHEDULING / PREFERRED-FIRST OPTIMIZATION TYPES
// ============================================================================

/**
 * Nurse's preferred shift request for a specific date.
 * Part of the self-scheduling submission.
 */
export interface ShiftPreference {
  date: string; // YYYY-MM-DD
  shiftCode?: string; // Preferred shift code (e.g., "Z07", "23")
  priority: "primary" | "secondary" | "flexible"; // How important this request is
  reason?: string; // Optional reason for the preference
}

/**
 * Rotation preference - how the nurse prefers their shifts distributed.
 */
export type RotationPreference = "block" | "spaced" | "flexible";

/**
 * Complete self-scheduling submission from a nurse.
 * This is the "Submission Object" for the preferred-first algorithm.
 */
export interface NurseScheduleSubmission {
  nurseId: string;
  nurseName: string;

  // Primary requests - specific shifts the nurse wants to work
  primaryRequests: ShiftPreference[];

  // Off-requests - days the nurse must be off (vacations, school, etc.)
  offRequests: string[]; // Array of YYYY-MM-DD dates

  // Rotation preference
  rotationPreference: RotationPreference;

  // Shift type preference (8hr vs 12hr)
  preferredShiftLength: "8hr" | "12hr" | "either";

  // Day/Night preference
  shiftTypePreference: "day" | "night" | "either";

  // Permanent night waiver (bypasses 50% day shift rule)
  permanentNightWaiver: boolean;

  // Weekend availability
  weekendAvailability:
    | "both"
    | "saturday"
    | "sunday"
    | "neither"
    | "alternating";

  // Submission timestamp
  submittedAt: string;
}

/**
 * Reason codes for when a preference couldn't be met.
 * Used for transparency in the optimization results.
 */
export type PreferenceReasonCode =
  | "GRANTED" // Preference was met
  | "CONFLICT_SENIORITY" // Given to more senior staff
  | "MIN_STAFFING_GAP" // Assigned to meet minimum unit safety levels
  | "REST_VIOLATION" // Denied to ensure 11-hour mandatory recovery
  | "CONSECUTIVE_LIMIT" // Would exceed max consecutive shifts
  | "FTE_EXCEEDED" // Would exceed FTE target hours
  | "DAY_SHIFT_RULE" // Needed to meet 50% day shift requirement
  | "WEEKEND_FAIRNESS" // Weekend rotation equity
  | "SKILL_REQUIRED" // Specific certification needed
  | "ALREADY_ASSIGNED" // Slot already assigned to another nurse
  | "NO_PREFERENCE"; // No preference was submitted for this slot;

/**
 * Result of processing a nurse's preference for a specific slot.
 */
export interface PreferenceResult {
  date: string;
  requestedShift?: string;
  assignedShift?: string;
  status: "granted" | "modified" | "denied";
  reasonCode: PreferenceReasonCode;
  reasonMessage?: string;
}

/**
 * Complete optimization result for a nurse with preference tracking.
 */
export interface NurseOptimizationResult {
  nurseId: string;
  nurseName: string;
  assignments: ShiftEntry[];
  preferenceResults: PreferenceResult[];
  stats: {
    totalHours: number;
    targetHours: number;
    delta: number;
    preferencesGranted: number;
    preferencesModified: number;
    preferencesDenied: number;
    dayShiftPercentage: number;
    weekendShifts: number;
  };
}

/**
 * Configuration for the optimization algorithm.
 * These are the hard constraints and configurable rules.
 */
export interface OptimizationConfig {
  // Pay period configuration
  payPeriodDays: number; // Default: 14
  ftBiWeeklyTarget: number; // Default: 75.0
  ptBiWeeklyTarget: number; // Default: 63.75

  // Balance window for FTE averaging (days)
  balanceWindowDays: number; // Default: 28

  // Rest rules
  minRestHours: number; // Default: 11

  // Consecutive shift limits
  maxConsecutive8hr: number; // Default: 5
  maxConsecutive12hr: number; // Default: 3

  // Day shift guarantee (unless permanent night waiver)
  minDayShiftPercentage: number; // Default: 50

  // Weekend definition (for fairness calculation)
  weekendStartHour: number; // Default: 19 (Friday 19:00)
  weekendEndHour: number; // Default: 7 (Monday 07:00)

  // Seniority-based conflict resolution
  useSeniorityForConflicts: boolean; // Default: true

  // Equity modifier - limit "top choice" wins per nurse
  maxTopChoicesPerPeriod: number; // Default: 5

  // Patient acuity settings
  basePatientRatio: number; // Default: 5 (1:5 for regular care)
  criticalPatientRatio: number; // Default: 2 (1:2 for critical/transplant)

  // Auto-fill behavior
  autoFillGaps: boolean; // Default: true
  flagUnderHours: boolean; // Default: true
}

// Default optimization configuration
export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  payPeriodDays: 14,
  ftBiWeeklyTarget: 75.0,
  ptBiWeeklyTarget: 63.75,
  balanceWindowDays: 28,
  minRestHours: 11,
  maxConsecutive8hr: 5,
  maxConsecutive12hr: 3,
  minDayShiftPercentage: 50,
  weekendStartHour: 19,
  weekendEndHour: 7,
  useSeniorityForConflicts: true,
  maxTopChoicesPerPeriod: 5,
  basePatientRatio: 5,
  criticalPatientRatio: 2,
  autoFillGaps: true,
  flagUnderHours: true,
};

export interface ShiftCode {
  code: string;
  start: string;
  end: string;
  hours: number;
  type: "day" | "night" | "combined" | "off";
  label: string;
}

// Time slot categories (used in self-scheduling interface)
// These map to actual shift codes but represent categories
export interface TimeSlot {
  slot: string; // e.g., "D8-", "ZD12-"
  category: "Day" | "Evening" | "Night";
  duration: "8hr" | "12hr" | "Split";
  mapsTo: string[]; // Actual shift codes this slot can use
  label: string;
}

export const TIME_SLOTS: TimeSlot[] = [
  {
    slot: "D8-",
    category: "Day",
    duration: "8hr",
    mapsTo: ["07"],
    label: "Day 8hr",
  },
  {
    slot: "E8-",
    category: "Evening",
    duration: "8hr",
    mapsTo: ["E15"],
    label: "Evening 8hr",
  },
  {
    slot: "N8-",
    category: "Night",
    duration: "8hr",
    mapsTo: ["23"],
    label: "Night 8hr",
  },
  {
    slot: "ZD12-",
    category: "Day",
    duration: "12hr",
    mapsTo: ["Z07"],
    label: "Day 12hr",
  },
  {
    slot: "ZE2-",
    category: "Evening",
    duration: "Split",
    mapsTo: ["Z19"],
    label: "Evening Start (19:00-23:00)",
  },
  {
    slot: "ZN-",
    category: "Night",
    duration: "12hr",
    mapsTo: ["Z19", "Z23"],
    label: "Night Split (19:00-07:25)",
  },
  {
    slot: "N8+ZE2-",
    category: "Night",
    duration: "Split",
    mapsTo: ["Z19", "23"],
    label: "Night Combined",
  },
  {
    slot: "ZN+ZE2-",
    category: "Night",
    duration: "12hr",
    mapsTo: ["Z19", "Z23"],
    label: "Night Full",
  },
  {
    slot: "Z11",
    category: "Day",
    duration: "12hr",
    mapsTo: ["Z11"],
    label: "Mid 12hr (11:00-23:25)",
  },
  {
    slot: "I1",
    category: "Day",
    duration: "8hr",
    mapsTo: ["11"],
    label: "Mid 8hr (11:00-19:15)",
  },
];

// Shift codes for the hospital schedule (actual codes used on schedules)
//
// NIGHT SHIFT WRAP-AROUND LOGIC:
// Hospital schedules visually split overnight shifts across two calendar days.
// Z19 (19:00→07:25) appears on the start day only.
// Z23 B (23:00→11:00 next day, "Bilan/Balance") is an 11.25h shift that wraps.
//   It appears on day N as the start, and a ghost Z23/Z23 B appears on day N+1.
// Z23 (23:00→07:25) appearing AFTER a Z19 or Z23 B is just the visual tail —
//   NOT a separate shift. The deduplicateNightShifts() function handles this.
//
// Hours in this table represent the standalone value. The dedup function
// corrects the totals by zeroing out wrap-around tails.
export const SHIFT_CODES: ShiftCode[] = [
  {
    code: "07",
    start: "07:00",
    end: "15:15",
    hours: 7.5,
    type: "day",
    label: "Day 8hr (07:00-15:15)",
  },
  {
    code: "Z07",
    start: "07:00",
    end: "19:25",
    hours: 11.25,
    type: "day",
    label: "Day 12hr (07:00-19:25)",
  },
  {
    code: "11",
    start: "11:00",
    end: "19:15",
    hours: 7.5,
    type: "day",
    label: "Mid 8hr (11:00-19:15)",
  },
  {
    code: "Z11",
    start: "11:00",
    end: "23:25",
    hours: 11.25,
    type: "day",
    label: "Mid 12hr (11:00-23:25)",
  },
  {
    code: "E15",
    start: "15:00",
    end: "23:15",
    hours: 7.5,
    type: "day",
    label: "Evening 8hr (15:00-23:15)",
  },
  {
    code: "23",
    start: "23:00",
    end: "07:15",
    hours: 7.5,
    type: "night",
    label: "Night 8hr (23:00-07:15)",
  },
  {
    code: "Z19",
    start: "19:00",
    end: "07:25",
    hours: 11.25,
    type: "night",
    label: "Night 12hr (19:00-07:25)",
  },
  {
    code: "Z23",
    start: "23:00",
    end: "11:25",
    hours: 11.25,
    type: "night",
    label: "Night 12hr (23:00-11:25)",
  },
  {
    code: "Z23 B",
    start: "23:00",
    end: "11:25",
    hours: 11.25,
    type: "night",
    label: "Night 12hr Balance (23:00-11:25)",
  },
];

/**
 * Off-day and holiday codes - these represent scheduled time off
 * and should appear in schedules but not count as worked hours.
 */
export const OFF_DAY_CODES: ShiftCode[] = [
  // General off codes
  {
    code: "C",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Congé (Off)",
  },
  { code: "OFF", start: "", end: "", hours: 0, type: "off", label: "Off Day" },
  // MUHC Holiday codes (CF = Congé Férié)
  {
    code: "CF-1",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Canada Day",
  },
  {
    code: "CF-2",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Labour Day",
  },
  {
    code: "CF-3",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Thanksgiving",
  },
  {
    code: "CF-4",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Christmas Day",
  },
  {
    code: "CF-5",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Boxing Day",
  },
  {
    code: "CF-6",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "New Year's Day",
  },
  {
    code: "CF-7",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Day after New Year's",
  },
  {
    code: "CF-8",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Good Friday",
  },
  {
    code: "CF-9",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Victoria Day",
  },
  {
    code: "CF-10",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Fête Nationale",
  },
  {
    code: "CF-11",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Easter Monday",
  },
  {
    code: "CF-12",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Mobile Holiday 1",
  },
  {
    code: "CF-13",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Mobile Holiday 2",
  },
  // Generic CF for unspecified holiday
  {
    code: "CF",
    start: "",
    end: "",
    hours: 0,
    type: "off",
    label: "Congé Férié (Holiday)",
  },
];

/** All shift codes including working shifts and off-day codes */
export const ALL_SHIFT_CODES: ShiftCode[] = [...SHIFT_CODES, ...OFF_DAY_CODES];

/**
 * Night shift codes that START an overnight block and wrap into the next day.
 * Kept for reference / backward compat — the dedup logic now uses
 * NIGHT_DEDUP_PAIRS instead.
 */
export const NIGHT_START_CODES = new Set(["Z19", "Z23", "Z23 B"]);

/**
 * Night shift codes that can appear as the "tail" on the next calendar day.
 * Kept for reference — the dedup logic now uses NIGHT_DEDUP_PAIRS.
 */
export const NIGHT_TAIL_CODES = new Set(["Z23", "Z23 B"]);

/**
 * Pair-based dedup map: for each night-start code, which codes on the NEXT
 * calendar day are a wrap-around tail (continuation of the same shift) and
 * should be zeroed out.
 *
 * Rules (from MCH hospital scheduling):
 *   • Z19 (19:00→07:25)  — plain Z23 the next day is a ghost tail.
 *                           Z23 B after Z19 is a NEW shift (16h gap).
 *   • Z23 (23:00→11:25)  — plain Z23 the next day is a ghost tail.
 *   • Z23 B (23:00→11:25, back-at-19:00) — plain Z23 the next day is a
 *     ghost tail.  But Z23 B the next day is a NEW consecutive night
 *     shift (the nurse starts another overnight — the "B" marker means
 *     a real assignment, not a visual continuation).
 *
 * Key insight: ONLY plain Z23 (without "B") is ever a ghost.
 * Z23 B is ALWAYS a real shift.
 *
 * Example: Z19, Z23 B, Z23 B, Z23  →  3 real shifts + 1 ghost (last Z23)
 */
export const NIGHT_DEDUP_PAIRS: Record<string, Set<string>> = {
  Z19: new Set(["Z23"]),
  Z23: new Set(["Z23"]),
  "Z23 B": new Set(["Z23"]),
};

// Scheduler state interface for the main hook
export interface SchedulerState {
  // Step management
  currentStep: Step;
  setCurrentStep: (step: Step) => void;

  // Shift entry mode
  shiftEntryMode: "codes" | "slots"; // "codes" for actual shift codes, "slots" for time slot categories
  setShiftEntryMode: (mode: "codes" | "slots") => void;

  // Step 1: Setup
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  rules: string;
  setRules: (rules: string) => void;
  marker: string;
  setMarker: (marker: string) => void;

  // Step 2: Upload & OCR
  screenshots: File[];
  setScreenshots: (files: File[]) => void;
  ocrLoading: boolean;
  ocrError: string | null;

  // Step 3: Review
  ocrDates: string[];
  setOcrDates: (dates: string[]) => void;
  ocrGrid: GridRow[];
  setOcrGrid: (grid: GridRow[]) => void;
  autoComments: string;
  setAutoComments: (comments: string) => void;
  commentValidationErrors: string[];
  setCommentValidationErrors: (errors: string[]) => void;
  manualNurses: ManualNurse[];
  setManualNurses: (nurses: ManualNurse[]) => void;
  ocrWarnings: OCRWarning[];
  newNurseCandidates: NewNurseCandidate[];
  setNewNurseCandidates: (candidates: NewNurseCandidate[]) => void;

  // Step 4: Optimize
  optimizing: boolean;
  parsedConstraints: any;
  setParsedConstraints: (constraints: any) => void;
  loadingConstraints: boolean;

  // Step 5: Result
  optimizedGrid: GridRow[];
  setOptimizedGrid: (grid: GridRow[]) => void;
  savedScheduleId: string | null;
  setSavedScheduleId: (id: string | null) => void;
  isFinalized: boolean;
  setIsFinalized: (finalized: boolean) => void;
  excludedNurses: Set<string>;
  setExcludedNurses: (nurses: Set<string>) => void;

  // Staff requirements
  requiredStaff: Record<string, Record<string, number>>;
  setRequiredStaff: (staff: Record<string, Record<string, number>>) => void;

  // Computed values
  uniqueNurses: Array<{
    name: string;
    source: "ocr" | "manual" | "both";
    isManual: boolean;
  }>;
  nurseHoursStats: NurseHourStats[];
  filteredOptimizedGrid: GridRow[];

  // Actions
  clearSavedState: () => void;
  runOCR: () => Promise<void>;
  previewConstraints: () => Promise<void>;
  optimizeWithConfirmedConstraints: (constraints: any) => Promise<void>;
}
