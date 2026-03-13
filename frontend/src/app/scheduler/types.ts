// Scheduler types - shared across hooks and components

export interface ShiftEntry {
  date: string;
  shift: string;
  shiftType: "day" | "night" | "combined";
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

export type Step = "setup" | "upload" | "review" | "optimize" | "result";

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
  targetWeeklyHours?: number;
  preferredShiftLengthHours?: number;
  employmentType?: "FT" | "PT";
  offRequests?: string[];
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
};

export interface NurseHourStats {
  name: string;
  totalHours: number;
  workingDays: number;
  targetHours: number;
  delta: number;
  employmentType: "FT" | "PT";
}

export interface ShiftCode {
  code: string;
  start: string;
  end: string;
  hours: number;
  type: "day" | "night" | "combined";
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
    end: "07:25",
    hours: 7.5,
    type: "night",
    label: "Night Finish (23:00-07:25)",
  },
  {
    code: "Z23 B",
    start: "23:00",
    end: "07:25",
    hours: 7.5,
    type: "combined",
    label: "Night Finish + Back at 19:00 (23:00-07:25)",
  },
];

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
