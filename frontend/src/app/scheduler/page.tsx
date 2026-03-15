"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import UploadInput from "../components/UploadInput";
import EditableOCRGrid from "../components/EditableOCRGrid";
import SchedulePreview from "../components/SchedulePreview";
import StaffRequirementsEditor, {
  loadStaffingCategories,
} from "../components/StaffRequirementsEditor";
import SystemPrompt from "../components/SystemPrompt";
import AutoCommentsBox from "../components/AutoCommentsBox";
import ConstraintsConfirmation from "../components/ConstraintsConfirmation";
import ShiftCodesPopover from "../components/ShiftCodesPopover";
import { useOrganization } from "../context/OrganizationContext";
import {
  optimizeScheduleAPI,
  finalizeScheduleAPI,
  refineScheduleAPI,
  analyzeScheduleInsightsAPI,
  saveAndFinalizeScheduleAPI,
  listNursesAPI,
  createNurseAPI,
  updateNurseAPI,
  getLatestScheduleRuleAPI,
  saveScheduleRuleAPI,
  Nurse,
  NurseCreate,
  GapFillSuggestion,
} from "../lib/api";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

// Import reusable scheduler components
import {
  ClearCacheButton,
  ProgressSteps,
  SchedulePeriodInput,
  StaffRequirementsInput,
} from "./components";

// Import step components
import { SetupStep } from "./steps";

// Import types and constants
import {
  ShiftEntry,
  GridRow,
  Step,
  ManualNurse,
  OCRWarning,
  NewNurseCandidate,
  SHIFT_CODES,
  TIME_SLOTS,
} from "./types";

// Import utility functions from hooks
import {
  useDraftPersistence,
  useDraftRouteLifecycle,
  useSchedulerOCRWorkflow,
  useOptimization,
  parseShiftCode,
  cleanNurseName,
  normalizeNurseName,
  extractOffDatesFromComments,
  getDefaultDates,
  deduplicateNightShifts,
  deduplicateGridGhosts,
} from "./hooks";

const SCREENSHOT_DB_NAME = "scheduler_uploads_db";
const SCREENSHOT_STORE_NAME = "screenshots";

type PersistedScreenshots = {
  key: string;
  files: File[];
  updatedAt: string;
};

function openScreenshotDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SCREENSHOT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE_NAME)) {
        db.createObjectStore(SCREENSHOT_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadPersistedScreenshots(key: string): Promise<File[]> {
  if (typeof window === "undefined" || !key) return [];

  const db = await openScreenshotDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE_NAME, "readonly");
    const store = tx.objectStore(SCREENSHOT_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const payload = request.result as PersistedScreenshots | undefined;
      resolve(Array.isArray(payload?.files) ? payload.files : []);
    };
    request.onerror = () => reject(request.error);
  });
}

async function savePersistedScreenshots(key: string, files: File[]) {
  if (typeof window === "undefined" || !key) return;

  const db = await openScreenshotDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE_NAME, "readwrite");
    const store = tx.objectStore(SCREENSHOT_STORE_NAME);
    const payload: PersistedScreenshots = {
      key,
      files,
      updatedAt: new Date().toISOString(),
    };
    const request = store.put(payload);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearPersistedScreenshots(key: string) {
  if (typeof window === "undefined" || !key) return;

  const db = await openScreenshotDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE_NAME, "readwrite");
    const store = tx.objectStore(SCREENSHOT_STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export default function SchedulerPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const userId = user?.id || "";

  // Step management
  const [currentStep, setCurrentStep] = useState<Step>("setup");

  // Step 1: Setup
  const { today, twoWeeksLater } = getDefaultDates();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeksLater);
  const [rules, setRules] = useState("");
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [marker, setMarker] = useState("");

  // Step 2: Upload & OCR
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Step 3: Review
  const [ocrDates, setOcrDates] = useState<string[]>([]);
  const [ocrGrid, setOcrGrid] = useState<GridRow[]>([]);
  const [autoComments, setAutoComments] = useState<string>("");
  const [commentValidationErrors, setCommentValidationErrors] = useState<
    string[]
  >([]);
  const [manualNurses, setManualNurses] = useState<ManualNurse[]>([]);
  const [organizationNurses, setOrganizationNurses] = useState<Nurse[]>([]);
  const [organizationNursesLoading, setOrganizationNursesLoading] =
    useState(false);
  const [showNurseModal, setShowNurseModal] = useState(false);

  // OCR name warnings - potential corrupted/incomplete names
  type OCRWarning = {
    name: string;
    issue: string;
    severity: "warning" | "error";
  };
  const [ocrWarnings, setOcrWarnings] = useState<OCRWarning[]>([]);

  // New-nurse detection from OCR
  type PotentialMatch = {
    dbNurse: {
      id: string;
      name: string;
      employee_id?: string;
      seniority?: string;
      employment_type: "full-time" | "part-time";
      max_weekly_hours: number;
      target_weekly_hours?: number;
      preferred_shift_length_hours?: number;
      is_chemo_certified: boolean;
      is_transplant_certified?: boolean;
      is_renal_certified?: boolean;
      is_charge_certified?: boolean;
    };
    score: number;
  };

  type NewNurseCandidate = {
    originalName: string;
    name: string;
    employeeId?: string;
    seniority?: string;
    selected: boolean;
    employmentType: "FT" | "PT";
    isChemoCertified: boolean;
    isTransplantCertified: boolean;
    isRenalCertified: boolean;
    isChargeCertified: boolean;
    maxHours: number;
    // New fields for matching UI
    potentialMatches?: PotentialMatch[];
    selectedMatchId?: string; // If set, use this existing nurse instead of creating new
    matchAction: "create" | "link" | "skip"; // What to do with this nurse
  };
  const [newNurseCandidates, setNewNurseCandidates] = useState<
    NewNurseCandidate[]
  >([]);
  const [showCreateNursesModal, setShowCreateNursesModal] = useState(false);
  const [creatingNurses, setCreatingNurses] = useState(false);

  // Step 4: Optimize
  // Step 5: Result
  const [optimizedGrid, setOptimizedGrid] = useState<GridRow[]>([]);
  const [savedScheduleId, setSavedScheduleId] = useState<string | null>(null);
  const [isFinalized, setIsFinalized] = useState(false);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refineRequest, setRefineRequest] = useState("");
  const [refining, setRefining] = useState(false);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);
  const [changesAppliedCount, setChangesAppliedCount] = useState(0);
  const [rawAiResponse, setRawAiResponse] = useState<string>("");
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [showHoursBreakdown, setShowHoursBreakdown] = useState(false);
  const [excludedNurses, setExcludedNurses] = useState<Set<string>>(new Set());

  // AI Schedule Insights
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const [insightsData, setInsightsData] = useState<{
    summary: string;
    score: number | null;
    issues: {
      severity: "error" | "warning" | "info";
      title: string;
      description: string;
    }[];
    suggestions: { category: string; text: string }[];
    gapFillSuggestions?: GapFillSuggestion[];
  } | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [selectedGapFills, setSelectedGapFills] = useState<Set<number>>(
    new Set(),
  );

  // Staff requirements
  const [requiredStaff, setRequiredStaff] = useState<
    Record<string, Record<string, number>>
  >({});

  // Load configurable staffing categories (can be customized per org)
  const shiftTypes = useMemo(() => loadStaffingCategories(), []);

  // Get organization context for org-scoped storage and access control
  const {
    currentOrganization,
    isAdmin,
    isLoading: orgLoading,
  } = useOrganization();
  const fullTimeBiWeeklyTarget =
    currentOrganization?.full_time_weekly_target ?? 75;
  const partTimeBiWeeklyTarget =
    currentOrganization?.part_time_weekly_target ?? 63.75;
  const defaultFullTimeMaxWeeklyHours = 120;
  const defaultPartTimeMaxWeeklyHours = 80;

  const getDefaultMaxWeeklyHours = useCallback(
    (employmentType?: "FT" | "PT") =>
      employmentType === "PT"
        ? defaultPartTimeMaxWeeklyHours
        : defaultFullTimeMaxWeeklyHours,
    [],
  );
  const router = useRouter();
  const searchParams = useMemo(
    () => ({
      get: (name: string) => {
        if (typeof window === "undefined") return null;
        return new URLSearchParams(window.location.search).get(name);
      },
    }),
    [],
  );
  const shouldRestoreLocalDraftForScreenshots =
    !!currentOrganization?.id &&
    searchParams.get("new") !== "1" &&
    !searchParams.get("scheduleId");
  const screenshotStorageKey = useMemo(
    () => `scheduler_upload_screenshots_${currentOrganization?.id || "global"}`,
    [currentOrganization?.id],
  );
  const hasRestoredScreenshotsRef = useRef(false);

  const toQuarterHour = useCallback((value: number) => {
    return Math.round((Number(value || 0) + Number.EPSILON) * 4) / 4;
  }, []);

  const formatQuarterHours = useCallback(
    (value: number) => {
      const q = toQuarterHour(value);
      const absFrac = Math.abs(q % 1);

      if (absFrac === 0) return q.toFixed(0);
      if (absFrac === 0.5) return q.toFixed(1);
      return q.toFixed(2);
    },
    [toQuarterHour],
  );

  const formatPercent = useCallback((value: number) => {
    if (!Number.isFinite(value)) return "0.0%";
    return `${value.toFixed(1)}%`;
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    (async () => {
      setOrganizationNursesLoading(true);
      try {
        const { nurses } = await listNursesAPI(userId, 1, 1000);
        if (!cancelled) {
          setOrganizationNurses(Array.isArray(nurses) ? nurses : []);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Non-blocking on setup screen: allow user to continue even if nurse list call times out.
        if (message.toLowerCase().includes("timed out")) {
          console.warn(
            "Organization nurses request timed out; continuing with empty nurse list.",
          );
        } else {
          console.warn("Failed to load organization nurses:", error);
        }
        if (!cancelled) {
          setOrganizationNurses([]);
        }
      } finally {
        if (!cancelled) {
          setOrganizationNursesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load saved scheduling rules from DB on mount
  useEffect(() => {
    if (rulesLoaded || !currentOrganization?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await getLatestScheduleRuleAPI(currentOrganization.id);
        if (!cancelled && saved?.rules_text && !rules.trim()) {
          setRules(saved.rules_text);
        }
      } catch {
        // No saved rules yet — that's fine
      } finally {
        if (!cancelled) setRulesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rulesLoaded, currentOrganization?.id, rules]);

  // Wrap setOcrGrid to detect nurse-name edits and sync manualNurses
  const handleSetOcrGrid: React.Dispatch<React.SetStateAction<GridRow[]>> =
    useCallback(
      (action) => {
        setOcrGrid((prev) => {
          const next = typeof action === "function" ? action(prev) : action;

          // Detect per-row nurse name renames
          for (let i = 0; i < prev.length && i < next.length; i++) {
            const oldName = prev[i].nurse;
            const newName = next[i].nurse;
            if (oldName && newName && oldName !== newName) {
              const oldKey = normalizeNurseName(oldName);
              const newKey = normalizeNurseName(newName);
              if (oldKey !== newKey) {
                // Rename or remove the stale manualNurses entry
                setManualNurses((prevNurses) =>
                  prevNurses.map((n) =>
                    normalizeNurseName(n.name) === oldKey
                      ? { ...n, name: newName }
                      : n,
                  ),
                );
              }
            }
          }

          return next;
        });
      },
      [setManualNurses],
    );

  // Compute unique nurses (deduplicate OCR nurses and manual nurses by name)
  const uniqueNurses = useMemo(() => {
    const nurseMap = new Map<
      string,
      { name: string; source: "ocr" | "manual" | "both"; isManual: boolean }
    >();

    // Add OCR nurses first
    for (const row of ocrGrid) {
      nurseMap.set(normalizeNurseName(row.nurse), {
        name: row.nurse,
        source: "ocr",
        isManual: false,
      });
    }

    // Add/merge manual nurses (they take precedence)
    for (const nurse of manualNurses) {
      const key = normalizeNurseName(nurse.name);
      const existing = nurseMap.get(key);
      if (existing) {
        // Nurse exists in both - mark as manual (has been confirmed/edited)
        nurseMap.set(key, { ...existing, source: "both", isManual: true });
      } else {
        // Only in manual list
        nurseMap.set(key, {
          name: nurse.name,
          source: "manual",
          isManual: true,
        });
      }
    }

    return Array.from(nurseMap.values());
  }, [ocrGrid, manualNurses]);

  const nurseMetadataByName = useMemo(() => {
    const metadata = new Map<string, ManualNurse>();

    // Start with manual entries; DB values will override stale core fields below.
    for (const nurse of manualNurses) {
      metadata.set(normalizeNurseName(nurse.name), nurse);
    }

    for (const nurse of organizationNurses) {
      const isPartTime = nurse.employment_type === "part-time";
      const configuredMaxWeeklyHours = isPartTime
        ? defaultPartTimeMaxWeeklyHours
        : defaultFullTimeMaxWeeklyHours;
      const dbMaxWeeklyHours =
        typeof nurse.max_weekly_hours === "number"
          ? nurse.max_weekly_hours
          : undefined;

      const resolvedMaxHours =
        dbMaxWeeklyHours == null ? configuredMaxWeeklyHours : dbMaxWeeklyHours;

      const key = normalizeNurseName(nurse.name);
      const existing = metadata.get(key);

      metadata.set(key, {
        name: nurse.name,
        employeeId: nurse.employee_id ?? existing?.employeeId,
        seniority: nurse.seniority ?? existing?.seniority,
        chemoCertified: nurse.is_chemo_certified,
        transplantCertified: nurse.is_transplant_certified,
        renalCertified: nurse.is_renal_certified,
        chargeCertified: nurse.is_charge_certified,
        isHeadNurse: existing?.isHeadNurse,
        offRequests: existing?.offRequests,
        maxHours: resolvedMaxHours,
        targetWeeklyHours:
          typeof nurse.target_weekly_hours === "number"
            ? nurse.target_weekly_hours
            : existing?.targetWeeklyHours,
        preferredShiftLengthHours:
          typeof nurse.preferred_shift_length_hours === "number"
            ? nurse.preferred_shift_length_hours
            : existing?.preferredShiftLengthHours,
        employmentType: isPartTime ? "PT" : "FT",
      });
    }

    return metadata;
  }, [
    organizationNurses,
    manualNurses,
    defaultFullTimeMaxWeeklyHours,
    defaultPartTimeMaxWeeklyHours,
  ]);

  // Filtered optimized grid (excluding removed nurses)
  const filteredOptimizedGrid = useMemo(() => {
    return optimizedGrid.filter((row) => !excludedNurses.has(row.nurse));
  }, [optimizedGrid, excludedNurses]);

  // Compute nurse hours statistics from optimized grid
  const scheduleDatesForStats = useMemo(() => {
    const dates = new Set<string>();

    for (const row of optimizedGrid) {
      if (excludedNurses.has(row.nurse)) continue;
      for (const shift of row.shifts) {
        if (shift?.date) {
          dates.add(shift.date);
        }
      }
    }

    if (dates.size === 0) {
      for (const date of ocrDates) {
        dates.add(date);
      }
    }

    return Array.from(dates).sort();
  }, [optimizedGrid, excludedNurses, ocrDates]);

  const nurseHoursStats = useMemo(() => {
    const totalDays = scheduleDatesForStats.length;
    const numBiWeeks = totalDays / 14.0;
    const dateSet = new Set(scheduleDatesForStats);

    // Pre-build a map of OCR off-day dates per nurse (from the original OCR
    // grid).  Only genuine vacation/off codes (C, OFF) reduce the target.
    //
    // NOT counted as off days:
    //  - "*" = comment marker (the actual off determination is in
    //    autoComments / Employee Notes & Time-Off Requests).
    //  - "CF-*" = paid continuing-education/formation. CF hours are already
    //    included in the paid-hours total, so deducting them from the target
    //    as well would double-penalise the nurse.
    const ocrOffDatesByNurse = new Map<string, Set<string>>();
    for (const ocrRow of ocrGrid) {
      const normName = normalizeNurseName(ocrRow.nurse);
      if (!ocrOffDatesByNurse.has(normName)) {
        ocrOffDatesByNurse.set(normName, new Set<string>());
      }
      const offSet = ocrOffDatesByNurse.get(normName)!;
      for (const shift of ocrRow.shifts) {
        if (!shift?.shift || !shift.date || !dateSet.has(shift.date)) continue;
        const code = shift.shift
          .replace(/\s*\*\s*$/, "")
          .trim()
          .toUpperCase();
        // Only C (congé/vacation) and OFF are genuine off days for target
        // reduction.  Skip empty codes (bare "*" after stripping).
        if (code && (code === "C" || code === "OFF")) {
          offSet.add(shift.date);
        }
      }
    }

    // Pre-build a map of off-dates from autoComments (Employee Notes &
    // Time-Off Requests).  These are pipe-delimited entries like
    // "nurseName|date|OFF Time Off Request".  extractOffDatesFromComments
    // already knows the keywords to look for.
    const commentOffDatesByNurse = extractOffDatesFromComments(autoComments);

    return filteredOptimizedGrid
      .map((row) => {
        // ── Step 1: Correct stored hours using SHIFT_CODES as authority ──
        const correctedShifts = row.shifts.map((s) => {
          if (!s.shift) return s;
          const code = s.shift
            .replace(/\s*\*\s*$/, "")
            .trim()
            .toUpperCase();
          const def = SHIFT_CODES.find((sc) => sc.code.toUpperCase() === code);
          if (def && def.hours !== s.hours) {
            return { ...s, hours: def.hours, shiftType: def.type };
          }
          return s;
        });

        // ── Step 2: Deduplicate night-shift wrap-around tails ──
        const deduplicatedShifts = deduplicateNightShifts(
          [...correctedShifts].sort((a, b) => a.date.localeCompare(b.date)),
        );

        // ── Step 3: Compute total hours (sum of shift code values) ──
        const totalHours = deduplicatedShifts.reduce(
          (sum, shift) => sum + (shift.hours || 0),
          0,
        );

        // ── Step 4: Count shifts by type ──
        // 12h shifts (Z-codes ≥ 11h) and 8h shifts (< 11h) are counted
        // separately. CF-* (training/leave) excluded from worked shifts.
        let count12h = 0;
        let count8h = 0;
        const workingShifts = deduplicatedShifts.filter((s) => {
          if (s.hours <= 0) return false;
          const code = (s.shift || "")
            .replace(/\s*\*\s*$/, "")
            .replace(/\s*↩\s*$/, "")
            .trim()
            .toUpperCase();
          if (code.startsWith("CF")) return false;
          return true;
        });
        for (const s of workingShifts) {
          if (s.hours >= 11) count12h++;
          else count8h++;
        }
        const workingDays = workingShifts.length;

        // ── Step 5: Validate shift composition ──
        // Total hours must equal (count12h × 11.25) + (count8h × 7.5)
        // plus any CF/training hours.  Flag if it doesn't match.
        const cfShifts = deduplicatedShifts.filter((s) => {
          const code = (s.shift || "")
            .replace(/\s*\*\s*$/, "")
            .replace(/\s*↩\s*$/, "")
            .trim()
            .toUpperCase();
          return s.hours > 0 && code.startsWith("CF");
        });
        const cfHours = cfShifts.reduce((sum, s) => sum + (s.hours || 0), 0);
        const cfShiftCount = cfShifts.length;
        const expectedHours = toQuarterHour(
          count12h * 11.25 + count8h * 7.5 + cfHours,
        );
        const hoursValid = Math.abs(totalHours - expectedHours) < 0.1;

        // ── Step 6: Contract-based target (no reconciliation inflation) ──
        const nurseMetadata = nurseMetadataByName.get(
          normalizeNurseName(row.nurse),
        );
        const biWeeklyHours =
          typeof nurseMetadata?.targetWeeklyHours === "number" &&
          nurseMetadata.targetWeeklyHours > 0
            ? nurseMetadata.targetWeeklyHours
            : nurseMetadata?.employmentType === "PT"
              ? partTimeBiWeeklyTarget
              : fullTimeBiWeeklyTarget;

        const requestedOffDaysInPeriod = Array.from(
          new Set(
            (nurseMetadata?.offRequests || []).filter((date) =>
              dateSet.has(date),
            ),
          ),
        ).length;

        // Also count OCR-sourced OFF days (C, CF, *, OFF codes) from the
        // ORIGINAL OCR grid.  The optimized grid may not carry these entries
        // (e.g. a nurse on 10-day vacation simply has 2 shifts in the
        // optimized grid with no OFF entries).  Going back to the OCR
        // source ensures the target reduction is correct.
        const normName = normalizeNurseName(row.nurse);
        const ocrOffForNurse =
          ocrOffDatesByNurse.get(normName) || new Set<string>();

        // Optimized grid off codes (fallback for manually-set C/OFF in editor)
        const optimizedOffDays = new Set(
          deduplicatedShifts
            .filter((s) => {
              if (!dateSet.has(s.date)) return false;
              const code = (s.shift || "")
                .replace(/\s*\*\s*$/, "")
                .trim()
                .toUpperCase();
              return code === "C" || code === "OFF";
            })
            .map((s) => s.date),
        );

        // Merge all off-day sources: metadata offRequests + OCR off codes
        // + optimized off codes + autoComments (Employee Notes & Time-Off Requests)
        //
        // For autoComments, use fuzzy name matching (same logic as
        // getMatchedCommentOffDates in optimizationPayload.ts) so that
        // "Demitra" in comments matches "Demitra Sita" in the grid.
        const commentOffDates: string[] = [];
        const nurseLower = row.nurse.toLowerCase();
        const nurseFirst = row.nurse.split(" ")[0].toLowerCase();
        for (const [commentNurse, dates] of Object.entries(
          commentOffDatesByNurse,
        )) {
          const commentLower = commentNurse.toLowerCase();
          if (
            commentLower.includes(nurseLower) ||
            nurseLower.includes(commentLower) ||
            commentNurse.split(" ")[0].toLowerCase() === nurseFirst
          ) {
            commentOffDates.push(...dates);
          }
        }

        const allOffDates = new Set<string>([
          ...(nurseMetadata?.offRequests || []).filter((d) => dateSet.has(d)),
          ...Array.from(ocrOffForNurse).filter((d) => dateSet.has(d)),
          ...Array.from(optimizedOffDays),
          ...commentOffDates.filter((d) => dateSet.has(d)),
        ]);

        const totalOffDays = allOffDates.size;
        // Use the "Vacation Offset" rule: each off day reduces the target
        // by exactly 7.5h (one standard paid shift).  This is cleaner than
        // the proportional ratio method and matches how payroll actually
        // credits vacation days.
        const baseTarget = toQuarterHour(biWeeklyHours * numBiWeeks);
        const vacationCreditHours = totalOffDays * 7.5;
        const contractTargetHours = toQuarterHour(
          Math.max(0, baseTarget - vacationCreditHours),
        );

        // ── Step 7: Shift-count target (informational only) ──
        const targetShiftHours =
          typeof nurseMetadata?.preferredShiftLengthHours === "number" &&
          nurseMetadata.preferredShiftLengthHours > 0
            ? nurseMetadata.preferredShiftLengthHours
            : 11.25;
        const targetDaysExact =
          targetShiftHours > 0 ? contractTargetHours / targetShiftHours : 0;
        const targetDaysMin = Math.floor(targetDaysExact);
        const targetDaysMax = Math.ceil(targetDaysExact);
        const roundedTargetDays = Math.round(targetDaysExact);
        const targetDaysDisplay = `${roundedTargetDays}`;

        // ── Step 8: Delta = actual paid hours − contract target ──
        // This is the ONLY delta.  No shift-based inflation.
        const delta = toQuarterHour(totalHours - contractTargetHours);
        const dayDelta = workingDays - roundedTargetDays;
        const utilizationPct =
          contractTargetHours > 0
            ? (totalHours / contractTargetHours) * 100
            : 0;

        return {
          name: row.nurse,
          totalHours: toQuarterHour(totalHours),
          workingDays,
          count12h,
          count8h,
          cfHours: toQuarterHour(cfHours),
          cfShiftCount,
          hoursValid,
          expectedHours,
          targetHours: contractTargetHours,
          contractTargetHours,
          targetDaysExact,
          targetDaysMin,
          targetDaysMax,
          targetDaysDisplay,
          delta,
          dayDelta,
          biWeeklyHours: toQuarterHour(biWeeklyHours),
          utilizationPct,
          employmentType: nurseMetadata?.employmentType || "FT",
          requestedOffDaysInPeriod: totalOffDays,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    nurseMetadataByName,
    filteredOptimizedGrid,
    ocrGrid,
    autoComments,
    scheduleDatesForStats,
    fullTimeBiWeeklyTarget,
    partTimeBiWeeklyTarget,
    toQuarterHour,
  ]);

  const operationalQualitySnapshot = useMemo(() => {
    const defaultDayMin = 5;
    const defaultNightMin = 4;
    const dateSet = new Set(scheduleDatesForStats);
    const coverageByDate = new Map<string, { day: number; night: number }>();

    const getDateRequirement = (date: string, kind: "day" | "night") => {
      const entries = Object.entries(requiredStaff || {});
      const relevantEntries = entries.filter(([key]) => {
        const normalized = key.toLowerCase();
        if (kind === "night") {
          return (
            normalized.includes("night") ||
            normalized.includes("23") ||
            normalized.includes("19")
          );
        }
        return (
          normalized.includes("day") ||
          normalized.includes("morning") ||
          normalized.includes("afternoon") ||
          normalized.includes("evening") ||
          normalized.includes("07") ||
          normalized.includes("15")
        );
      });

      if (relevantEntries.length === 0) {
        return kind === "day" ? defaultDayMin : defaultNightMin;
      }

      // Use the MAX across matching categories, not the SUM.
      // Categories like 07(G)=5 and 15(G)=5 represent overlapping time
      // windows (a Z07 nurse covers both).  Summing them would produce
      // an impossibly high requirement (10 day nurses) when the real
      // need is "at least 5 day nurses on the floor at any given time".
      let maxValue = 0;
      for (const [, byDate] of relevantEntries) {
        const n = Number(byDate?.[date] ?? 0);
        if (Number.isFinite(n) && n > maxValue) {
          maxValue = n;
        }
      }

      if (maxValue <= 0) {
        return kind === "day" ? defaultDayMin : defaultNightMin;
      }

      return maxValue;
    };

    for (const row of filteredOptimizedGrid) {
      for (const shift of row.shifts) {
        if (
          !shift?.date ||
          !dateSet.has(shift.date) ||
          (shift.hours || 0) <= 0
        ) {
          continue;
        }

        const parsed = parseShiftCode(shift.shift || "", shift.date);
        const normalizedShiftType =
          shift.shiftType === "day" || shift.shiftType === "night"
            ? shift.shiftType
            : parsed?.shiftType === "day"
              ? "day"
              : parsed?.shiftType === "night" ||
                  parsed?.shiftType === "combined"
                ? "night"
                : null;

        if (!normalizedShiftType) continue;

        const bucket = coverageByDate.get(shift.date) || { day: 0, night: 0 };
        if (normalizedShiftType === "day") bucket.day += 1;
        if (normalizedShiftType === "night") bucket.night += 1;
        coverageByDate.set(shift.date, bucket);
      }
    }

    let daysMeetingCoverage = 0;
    const totalDates = scheduleDatesForStats.length;
    for (const date of scheduleDatesForStats) {
      const covered = coverageByDate.get(date) || { day: 0, night: 0 };
      const requiredDay = getDateRequirement(date, "day");
      const requiredNight = getDateRequirement(date, "night");
      if (covered.day >= requiredDay && covered.night >= requiredNight) {
        daysMeetingCoverage += 1;
      }
    }

    let totalOffRequests = 0;
    let respectedOffRequests = 0;

    for (const row of filteredOptimizedGrid) {
      const metadata = nurseMetadataByName.get(normalizeNurseName(row.nurse));
      const offDates = new Set(
        (metadata?.offRequests || []).filter((date) => dateSet.has(date)),
      );

      if (offDates.size === 0) continue;
      totalOffRequests += offDates.size;

      const workedOnOffDate = new Set(
        row.shifts
          .filter((s) => (s.hours || 0) > 0 && offDates.has(s.date))
          .map((s) => s.date),
      );

      respectedOffRequests += Math.max(0, offDates.size - workedOnOffDate.size);
    }

    const avgAbsoluteHourDelta =
      nurseHoursStats.length > 0
        ? nurseHoursStats.reduce((sum, n) => sum + Math.abs(n.delta), 0) /
          nurseHoursStats.length
        : 0;

    return {
      totalDates,
      daysMeetingCoverage,
      coveragePct:
        totalDates > 0 ? (daysMeetingCoverage / totalDates) * 100 : 100,
      totalOffRequests,
      respectedOffRequests,
      offRequestRespectPct:
        totalOffRequests > 0
          ? (respectedOffRequests / totalOffRequests) * 100
          : 100,
      avgAbsoluteHourDelta,
    };
  }, [
    scheduleDatesForStats,
    requiredStaff,
    filteredOptimizedGrid,
    nurseMetadataByName,
    nurseHoursStats,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!shouldRestoreLocalDraftForScreenshots) {
      hasRestoredScreenshotsRef.current = false;
      return;
    }

    if (hasRestoredScreenshotsRef.current || screenshots.length > 0) {
      return;
    }

    (async () => {
      try {
        const restoredFiles =
          await loadPersistedScreenshots(screenshotStorageKey);
        if (!cancelled && restoredFiles.length > 0) {
          setScreenshots(restoredFiles);
        }
      } catch (error) {
        console.error("Failed to restore screenshot attachments:", error);
      } finally {
        if (!cancelled) {
          hasRestoredScreenshotsRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    shouldRestoreLocalDraftForScreenshots,
    screenshotStorageKey,
    screenshots.length,
    setScreenshots,
  ]);

  useEffect(() => {
    if (!shouldRestoreLocalDraftForScreenshots) return;

    const timeoutId = setTimeout(() => {
      if (screenshots.length > 0) {
        savePersistedScreenshots(screenshotStorageKey, screenshots).catch(
          (error) => {
            console.error("Failed to persist screenshot attachments:", error);
          },
        );
      } else {
        clearPersistedScreenshots(screenshotStorageKey).catch((error) => {
          console.error(
            "Failed to clear persisted screenshot attachments:",
            error,
          );
        });
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [
    shouldRestoreLocalDraftForScreenshots,
    screenshotStorageKey,
    screenshots,
  ]);

  const handleOptimizedSchedule = useCallback(
    ({
      grid,
      scheduleId,
      assignments,
    }: {
      grid: GridRow[];
      scheduleId?: string;
      assignments: Record<string, string[]>;
      rawResponse: any;
    }) => {
      let newGrid = grid;

      const normalizeNurseKey = (name: string) =>
        String(name || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      const ocrByNorm = new Map<string, GridRow>();
      for (const row of ocrGrid) {
        ocrByNorm.set(normalizeNurseKey(row.nurse), row);
      }

      const gridByNorm = new Map<string, GridRow>();
      for (const row of newGrid) {
        gridByNorm.set(normalizeNurseKey(row.nurse), row);
      }

      for (const [normName, ocrRow] of ocrByNorm.entries()) {
        const baseRow = gridByNorm.get(normName) || {
          id: `ocr-fallback-${normName}`,
          nurse: ocrRow.nurse,
          shifts: [],
        };

        const byDate = new Map<string, ShiftEntry>();
        for (const shift of baseRow.shifts || []) {
          if (shift?.date) byDate.set(shift.date, shift);
        }

        const ocrShiftsRaw = assignments[ocrRow.nurse] || [];

        // ── Ghost dedup: clean phantom Z23 tails before overlay ──
        // Night-start codes whose next-day column is a visual artefact.
        const NIGHT_STARTS = new Set(["Z19", "Z23", "Z23 B", "23"]);
        const GHOST_TAILS = new Set(["Z23"]);
        const ocrShifts = [...ocrShiftsRaw];
        for (let i = 0; i < ocrShifts.length - 1; i++) {
          const code = (ocrShifts[i] || "").trim().toUpperCase();
          if (!code || !NIGHT_STARTS.has(code)) continue;
          const next = (ocrShifts[i + 1] || "").trim().toUpperCase();
          if (GHOST_TAILS.has(next)) {
            ocrShifts[i + 1] = ""; // null out ghost tail
          }
        }

        for (let dayIdx = 0; dayIdx < ocrDates.length; dayIdx++) {
          const date = ocrDates[dayIdx];
          const raw = (ocrShifts[dayIdx] || "").trim();
          if (!raw || raw === "*") continue;

          // Only fill in OCR data for days where the backend didn't
          // already supply a non-empty shift.  The backend's
          // apply_authoritative_ocr_overlay already merges OCR codes
          // into the optimized result with correct hours & metadata.
          // Re-parsing raw OCR codes via parseShiftCode would
          // clobber hours (e.g. Z07→11.25h becomes 07→7.5h).
          const existingBackend = byDate.get(date);
          if (
            existingBackend &&
            existingBackend.shift &&
            existingBackend.hours > 0
          ) {
            continue; // keep backend shift — it already has correct metadata
          }

          byDate.set(date, parseShiftCode(raw, date));
        }

        baseRow.shifts = ocrDates.map((date) => {
          const existing = byDate.get(date);
          if (existing) return existing;
          return {
            date,
            shift: "",
            shiftType: "day",
            hours: 0,
            startTime: "",
            endTime: "",
          };
        });

        gridByNorm.set(normName, baseRow);
      }

      newGrid = Array.from(gridByNorm.values());

      setOptimizedGrid(newGrid);
      if (scheduleId) {
        setSavedScheduleId(scheduleId);
      }
      setIsFinalized(false);
      setCurrentStep("result");
    },
    [ocrGrid, ocrDates],
  );

  const {
    optimizing,
    loadingConstraints,
    parsedConstraints,
    setParsedConstraints,
    showConstraintsModal,
    setShowConstraintsModal,
    previewConstraints,
    optimizeWithConfirmedConstraints,
  } = useOptimization({
    ocrGrid,
    ocrDates,
    manualNurses,
    autoComments,
    rules,
    savedScheduleId,
    nurseMetadataByName,
    getDefaultMaxWeeklyHours,
    fullTimeBiWeeklyTarget,
    partTimeBiWeeklyTarget,
    requiredStaff,
    startDate,
    endDate,
    onOptimized: handleOptimizedSchedule,
  });

  // Memoized callback for SchedulePreview onChange to prevent infinite loops
  const handleSchedulePreviewChange = useCallback(
    (updatedGrid: { nurse: string; shifts: ShiftEntry[] }[]) => {
      // Merge updated grid with excluded nurses
      const excludedRows = optimizedGrid.filter((row) =>
        excludedNurses.has(row.nurse),
      );
      // Add id to each row from updatedGrid
      const gridWithIds: GridRow[] = updatedGrid.map((row, idx) => ({
        id: `updated-${idx}`,
        nurse: row.nurse,
        shifts: row.shifts,
      }));
      setOptimizedGrid([...gridWithIds, ...excludedRows]);
    },
    [excludedNurses], // Note: We intentionally exclude optimizedGrid to prevent loops
  );

  // Apply selected gap-fill suggestions to the optimized grid
  const applySelectedGapFills = useCallback(() => {
    if (!insightsData?.gapFillSuggestions || selectedGapFills.size === 0)
      return;
    const suggestions = insightsData.gapFillSuggestions.filter((_, idx) =>
      selectedGapFills.has(idx),
    );
    if (suggestions.length === 0) return;

    setOptimizedGrid((prev) => {
      const updatedGrid = prev.map((row) => ({
        ...row,
        shifts: [...row.shifts],
      }));
      for (const gf of suggestions) {
        let nurseRow = updatedGrid.find(
          (r) => r.nurse.toLowerCase() === gf.nurse.toLowerCase(),
        );
        if (!nurseRow) {
          nurseRow = {
            id: `gapfill-${gf.nurse}`,
            nurse: gf.nurse,
            shifts: [],
          };
          updatedGrid.push(nurseRow);
        }
        // Check if the nurse already has a shift on this date
        const existingIdx = nurseRow.shifts.findIndex(
          (s) => s.date === gf.date,
        );
        const newShift: ShiftEntry = {
          date: gf.date,
          shift: gf.shiftCode,
          shiftType: gf.shiftType,
          hours: gf.shiftHours,
          startTime: gf.shiftStart,
          endTime: gf.shiftEnd,
        };
        if (existingIdx >= 0) {
          nurseRow.shifts[existingIdx] = newShift;
        } else {
          nurseRow.shifts.push(newShift);
        }
      }
      return updatedGrid;
    });
    setSelectedGapFills(new Set());
    setShowInsightsPanel(false);
  }, [insightsData, selectedGapFills]);

  // Handler for when user enters "*" in a schedule cell
  const handleAsteriskDetected = useCallback(
    (nurse: string, date: string) => {
      // Parse existing autoComments
      const entries = autoComments
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [name = "", dateStr = "", comment = ""] = line.split("|");
          return {
            name: name.trim(),
            date: dateStr.trim(),
            comment: comment.trim(),
          };
        });

      // Check if entry already exists for this nurse and date
      const existingIndex = entries.findIndex(
        (entry) => entry.name === nurse && entry.date === date,
      );

      if (existingIndex === -1) {
        // Add new entry with OFF prefix
        entries.push({
          name: nurse,
          date: date,
          comment: "OFF Time Off Request",
        });
        // Sort entries by date then by name
        entries.sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          return dateCompare !== 0 ? dateCompare : a.name.localeCompare(b.name);
        });
      }

      // Serialize back to string
      const newAutoComments = entries
        .map((entry) => `${entry.name}|${entry.date}|${entry.comment}`)
        .join("\n");

      setAutoComments(newAutoComments);
    },
    [autoComments],
  );

  // Redirect non-admins away from scheduler
  useEffect(() => {
    if (!orgLoading && !isAdmin) {
      router.replace("/schedules");
    }
  }, [orgLoading, isAdmin, router]);

  const isCreatingNewDraftRef = useRef(false);
  const {
    clearLocalDraftState,
    draftSaveStatus,
    isHydratingDraftRef,
    isResettingRef,
    lastDraftSavedAt,
    markDraftSaved,
  } = useDraftPersistence({
    organizationId: currentOrganization?.id || null,
    searchParams,
    getToken,
    state: {
      currentStep,
      startDate,
      endDate,
      rules,
      marker,
      ocrDates,
      ocrGrid,
      autoComments,
      optimizedGrid,
      requiredStaff,
      savedScheduleId,
      isFinalized,
      manualNurses,
    },
    setters: {
      setCurrentStep,
      setStartDate,
      setEndDate,
      setRules,
      setMarker,
      setOcrDates,
      setOcrGrid,
      setAutoComments,
      setOptimizedGrid,
      setRequiredStaff,
      setSavedScheduleId,
      setIsFinalized,
      setManualNurses,
    },
  });

  const applyHydratedDraftState = useCallback(
    ({
      currentStep: nextStep,
      startDate: nextStartDate,
      endDate: nextEndDate,
      rules: nextRules,
      marker: nextMarker,
      autoComments: nextAutoComments,
      ocrDates: nextOcrDates,
      ocrGrid: nextOcrGrid,
      optimizedGrid: nextOptimizedGrid,
      requiredStaff: nextRequiredStaff,
      manualNurses: nextManualNurses,
      savedScheduleId: nextSavedScheduleId,
      isFinalized: nextIsFinalized,
    }: {
      currentStep: Step;
      startDate: string;
      endDate: string;
      rules: string;
      marker: string;
      autoComments: string;
      ocrDates: string[];
      ocrGrid: GridRow[];
      optimizedGrid: GridRow[];
      requiredStaff: Record<string, Record<string, number>>;
      manualNurses: ManualNurse[];
      savedScheduleId: string | null;
      isFinalized: boolean;
    }) => {
      setCurrentStep(nextStep);
      setStartDate(nextStartDate);
      setEndDate(nextEndDate);
      setRules(nextRules);
      setMarker(nextMarker);
      setAutoComments(nextAutoComments);
      setOcrDates(nextOcrDates);
      setOcrGrid(deduplicateGridGhosts(nextOcrGrid));
      setOptimizedGrid(nextOptimizedGrid);
      setRequiredStaff(nextRequiredStaff);
      setManualNurses(nextManualNurses);
      setSavedScheduleId(nextSavedScheduleId);
      setIsFinalized(nextIsFinalized);
    },
    [],
  );

  const resetLocalDraftState = useCallback(() => {
    const defaults = getDefaultDates();

    setCurrentStep("setup");
    setStartDate(defaults.today);
    setEndDate(defaults.twoWeeksLater);
    setRules("");
    setMarker("");
    setScreenshots([]);
    setOcrLoading(false);
    setOcrError(null);
    setOcrDates([]);
    setOcrGrid([]);
    setAutoComments("");
    setCommentValidationErrors([]);
    setManualNurses([]);
    setShowNurseModal(false);
    setOcrWarnings([]);
    setNewNurseCandidates([]);
    setShowCreateNursesModal(false);
    setCreatingNurses(false);
    setOptimizedGrid([]);
    setSavedScheduleId(null);
    setIsFinalized(false);
    setRequiredStaff({});
    setShowRefineModal(false);
    setRefineRequest("");
    setRefining(false);
    setShowSuggestionsModal(false);
    setAiSuggestions(null);
    setChangesAppliedCount(0);
    setRawAiResponse("");
    setShowDebugInfo(false);
    setShowHoursBreakdown(false);
    setExcludedNurses(new Set());
    setShowInsightsPanel(false);
    setInsightsData(null);
    setInsightsLoading(false);

    clearPersistedScreenshots(screenshotStorageKey).catch((error) => {
      console.error("Failed to clear persisted screenshot attachments:", error);
    });
    hasRestoredScreenshotsRef.current = false;
  }, [screenshotStorageKey]);

  const { resetSchedulerState } = useDraftRouteLifecycle({
    organizationId: currentOrganization?.id || null,
    getToken,
    searchParams,
    state: {
      savedScheduleId,
      isFinalized,
    },
    isCreatingNewDraftRef,
    isHydratingDraftRef,
    isResettingRef,
    clearLocalDraftState,
    markDraftSaved,
    applyHydratedState: applyHydratedDraftState,
    resetLocalState: resetLocalDraftState,
  });

  // Clear saved state when user explicitly starts new
  function clearSavedState() {
    resetSchedulerState();

    // Remove query params (e.g., scheduleId/new) so reload won't rehydrate stale step.
    router.replace("/scheduler");

    console.log("Scheduler saved state cleared - all data reset");
  }

  const { runOCR } = useSchedulerOCRWorkflow({
    screenshots,
    startDate,
    endDate,
    userId,
    organizationNurses,
    getDefaultMaxWeeklyHours,
    fullTimeBiWeeklyTarget,
    partTimeBiWeeklyTarget,
    setOcrLoading,
    setOcrError,
    setAutoComments,
    setOcrWarnings,
    setOcrDates,
    setOcrGrid,
    setCurrentStep,
    setManualNurses,
    setNewNurseCandidates,
    setShowCreateNursesModal,
  });

  // Math-based optimization (constraint satisfaction)
  function optimizeWithMath(): GridRow[] {
    const result: GridRow[] = [];

    // Simple constraint-based assignment
    // Rules: 1) No more than 5 consecutive days, 2) Balance workload
    for (const row of ocrGrid) {
      const optimizedShifts: ShiftEntry[] = [];
      let consecutiveDays = 0;

      for (const shift of row.shifts) {
        if (shift.shift && shift.shift.trim() !== "" && shift.shift !== "OFF") {
          // Check consecutive days constraint
          if (consecutiveDays >= 5) {
            // Force a day off after 5 consecutive days
            optimizedShifts.push({
              ...shift,
              shift: "OFF",
              hours: 0,
            });
            consecutiveDays = 0;
          } else {
            optimizedShifts.push(shift);
            consecutiveDays++;
          }
        } else {
          optimizedShifts.push(shift);
          if (shift.shift === "OFF" || !shift.shift) {
            consecutiveDays = 0;
          }
        }
      }

      result.push({
        id: row.id,
        nurse: row.nurse,
        shifts: optimizedShifts,
      });
    }

    return result;
  }

  // NEW: Refine schedule with AI
  async function refineScheduleWithAI() {
    if (!refineRequest.trim()) {
      alert("Please enter refinement instructions");
      return;
    }

    setRefining(true);
    try {
      const scheduleDict: Record<string, any[]> = {};
      optimizedGrid.forEach((row) => {
        scheduleDict[row.nurse] = row.shifts;
      });

      // Extract actual dates from the shifts being sent (not stale ocrDates)
      const actualDatesSet = new Set<string>();
      Object.values(scheduleDict).forEach((shifts) => {
        shifts.forEach((shift) => {
          if (shift.date) {
            actualDatesSet.add(shift.date);
          }
        });
      });
      const actualDates = Array.from(actualDatesSet).sort();

      // DEBUG: Log exactly what we're sending to backend
      console.log("=== SENDING TO BACKEND ===");
      console.log("First nurse:", Object.keys(scheduleDict)[0]);
      const firstNurse = Object.keys(scheduleDict)[0];
      if (firstNurse) {
        console.log(
          "First nurse shifts:",
          scheduleDict[firstNurse].slice(0, 3),
        );
        console.log("First shift date:", scheduleDict[firstNurse][0]?.date);
      }
      console.log("Actual dates from shifts:", actualDates.slice(0, 10));
      console.log("(Old ocrDates were:", ocrDates.slice(0, 5), ")");

      // Build nurse hours info with actual stats (delta, target, current)
      const nurseHoursInfo = nurseHoursStats.map((n) => ({
        name: n.name,
        totalHours: n.totalHours,
        targetHours: n.targetHours,
        delta: n.delta,
        employmentType: n.employmentType,
        workingDays: n.workingDays,
      }));

      const data = await refineScheduleAPI({
        schedule: scheduleDict,
        refinement_request: refineRequest,
        dates: actualDates,
        nurseHoursStats: nurseHoursInfo,
        fullTimeBiWeeklyTarget,
        partTimeBiWeeklyTarget,
        rules: rules.trim() || undefined,
      });

      console.log("=== AI REFINEMENT RESPONSE ===");
      console.log("Changes applied:", data.changes_applied);
      console.log(
        "All nurses in refined_schedule:",
        Object.keys(data.refined_schedule || {}),
      );

      // Log shift counts per nurse
      if (data.refined_schedule) {
        Object.entries(data.refined_schedule).forEach(([nurse, shifts]) => {
          console.log(`  ${nurse}: ${(shifts as any[]).length} shifts`);
        });
      }

      // Update the optimized grid with the refined schedule
      if (data.refined_schedule) {
        const refinedGrid = Object.entries(data.refined_schedule)
          .map(([nurse, shifts], index) => ({
            id: `refined-${index}`,
            nurse,
            shifts: shifts as any[],
          }))
          .filter((row) => row.shifts && row.shifts.length > 0); // Filter out nurses with no shifts

        console.log("=== REFINED GRID AFTER FILTERING ===");
        console.log("Total nurses with shifts:", refinedGrid.length);
        refinedGrid.forEach((row) => {
          console.log(`  ${row.nurse}: ${row.shifts.length} shifts`);
        });

        // CRITICAL: Update ocrDates to include any new dates from the refined schedule
        // This ensures the UI shows columns for newly added shifts
        const allDatesFromRefined = new Set<string>();
        refinedGrid.forEach((row) => {
          row.shifts.forEach((shift: any) => {
            if (shift.date) {
              allDatesFromRefined.add(shift.date);
            }
          });
        });
        const sortedDates = Array.from(allDatesFromRefined).sort();
        console.log("=== UPDATING ocrDates ===");
        console.log("Old ocrDates count:", ocrDates.length);
        console.log("New dates from refined schedule:", sortedDates.length);
        console.log("New dates:", sortedDates);
        setOcrDates(sortedDates);

        setOptimizedGrid(refinedGrid);
        console.log("=== setOptimizedGrid CALLED ===");
      }

      // Show suggestions in modal instead of alert
      setAiSuggestions(data.suggestions);
      setChangesAppliedCount(data.changes_applied || 0);
      setRawAiResponse(data.raw_ai_response || "");
      setShowSuggestionsModal(true);
      setShowRefineModal(false);
      setRefineRequest("");
    } catch (err) {
      alert(
        "Refinement failed: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setRefining(false);
    }
  }

  // AI Schedule Insights
  async function analyzeScheduleInsights() {
    setInsightsLoading(true);
    setShowInsightsPanel(true);
    setInsightsData(null);
    try {
      const scheduleDict: Record<string, any[]> = {};
      optimizedGrid.forEach((row) => {
        scheduleDict[row.nurse] = row.shifts;
      });

      const actualDates = Array.from(
        new Set(
          Object.values(scheduleDict).flatMap((shifts) =>
            shifts.map((s) => s.date).filter(Boolean),
          ),
        ),
      ).sort();

      // Build per-nurse staff notes: off-requests, CF/vacation codes, shift targets
      const staffNotes: Record<string, string[]> = {};
      for (const row of optimizedGrid) {
        const notes: string[] = [];
        const meta = nurseMetadataByName.get(normalizeNurseName(row.nurse));
        const stat = nurseHoursStats.find((s) => s.name === row.nurse);

        // Off-request dates within the schedule period
        if (stat && stat.requestedOffDaysInPeriod > 0) {
          const offDates = (meta?.offRequests || []).filter((d: string) =>
            actualDates.includes(d),
          );
          notes.push(
            `Has ${stat.requestedOffDaysInPeriod} approved off-request(s)` +
              (offDates.length > 0 ? `: ${offDates.join(", ")}` : ""),
          );
        }

        // Off/leave codes (C, OFF, CF, JF, FE, MA) from the actual shift grid
        const cfShifts = row.shifts.filter(
          (s) =>
            s.shift &&
            (s.shift.toUpperCase() === "C" ||
              s.shift.toUpperCase() === "OFF" ||
              s.shift.toUpperCase().startsWith("CF") ||
              s.shift.toUpperCase().startsWith("JF") ||
              s.shift.toUpperCase().startsWith("FE") ||
              s.shift.toUpperCase().startsWith("MA")),
        );
        if (cfShifts.length > 0) {
          const cfCodes = [...new Set(cfShifts.map((s) => s.shift))];
          notes.push(
            `${cfShifts.length} leave/vacation day(s): ${cfCodes.join(", ")}`,
          );
        }

        // Wrap-around tail markers (deduped night shifts)
        const tailShifts = row.shifts.filter(
          (s) => s.shift && s.shift.includes("↩"),
        );
        if (tailShifts.length > 0) {
          notes.push(
            `${tailShifts.length} night-shift wrap-around tail(s) (0h — counted on start day)`,
          );
        }

        if (notes.length > 0) {
          staffNotes[row.nurse] = notes;
        }
      }

      const data = await analyzeScheduleInsightsAPI({
        schedule: scheduleDict,
        dates: actualDates.length > 0 ? actualDates : ocrDates,
        nurseHoursStats: nurseHoursStats as any[],
        coverageSnapshot: operationalQualitySnapshot,
        orgContext: currentOrganization?.name,
        staffNotes: Object.keys(staffNotes).length > 0 ? staffNotes : undefined,
        markerComments: autoComments || undefined,
      });

      setInsightsData(data);
    } catch (err) {
      setInsightsData({
        summary:
          "Failed to generate insights: " +
          (err instanceof Error ? err.message : "Unknown error"),
        score: null,
        issues: [],
        suggestions: [],
      });
    } finally {
      setInsightsLoading(false);
    }
  }

  const handleFinalizeSchedule = useCallback(async () => {
    try {
      const scheduleRows = optimizedGrid.map((row) => ({
        id: row.id,
        nurse: row.nurse,
        shifts: row.shifts,
      }));

      const dateSet = new Set<string>();
      optimizedGrid.forEach((row) => {
        row.shifts.forEach((shift) => {
          if (shift.date) dateSet.add(shift.date);
        });
      });
      const sortedDates = Array.from(dateSet).sort();

      const scheduleData = {
        name: `${startDate} - ${endDate}`,
        start_date: startDate,
        end_date: endDate,
        dateRange: { start: startDate, end: endDate },
        dates: sortedDates.length > 0 ? sortedDates : ocrDates,
        schedule: scheduleRows,
        grid: scheduleRows,
      };

      const token = await getToken();
      const authHeaders = token
        ? { Authorization: `Bearer ${token}` }
        : undefined;

      const result = await saveAndFinalizeScheduleAPI(
        scheduleData,
        savedScheduleId || undefined,
        authHeaders,
      );
      setSavedScheduleId(result.id);
      setIsFinalized(true);
      alert("Schedule has been finalized and saved!");
    } catch (err) {
      alert(
        "Failed to finalize schedule: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    }
  }, [endDate, getToken, ocrDates, optimizedGrid, savedScheduleId, startDate]);

  // Step indicators
  const steps: { key: Step; label: string }[] = [
    { key: "setup", label: "Setup & Upload" },
    { key: "review", label: "Review" },
    { key: "optimize", label: "Optimize" },
    { key: "result", label: "Result" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);
  const progressStepIndex = isFinalized ? steps.length : currentStepIndex;

  // Nurse Management Modal Component
  const handleCreateSelectedNurses = async () => {
    // Separate candidates by action
    const toCreate = newNurseCandidates.filter(
      (n) => n.matchAction === "create",
    );
    const toLink = newNurseCandidates.filter(
      (n) => n.matchAction === "link" && n.selectedMatchId,
    );

    if (toCreate.length === 0 && toLink.length === 0) {
      setShowCreateNursesModal(false);
      setNewNurseCandidates([]);
      return;
    }

    setCreatingNurses(true);
    const created: ManualNurse[] = [];
    const linked: ManualNurse[] = [];

    // Create new nurses
    for (const candidate of toCreate) {
      try {
        const employmentType =
          candidate.employmentType === "FT" ? "full-time" : "part-time";
        const resolvedTargetWeeklyHours =
          employmentType === "part-time" &&
          Number.isFinite(candidate.maxHours) &&
          candidate.maxHours > 0 &&
          candidate.maxHours <= 60
            ? candidate.maxHours
            : employmentType === "part-time"
              ? partTimeBiWeeklyTarget
              : fullTimeBiWeeklyTarget;

        const nurseData: NurseCreate = {
          name: candidate.name,
          employee_id: candidate.employeeId,
          seniority: candidate.seniority,
          employment_type: employmentType,
          max_weekly_hours: candidate.maxHours,
          target_weekly_hours: resolvedTargetWeeklyHours,
          preferred_shift_length_hours: 11.25,
          is_chemo_certified: candidate.isChemoCertified,
          is_transplant_certified: candidate.isTransplantCertified,
          is_renal_certified: candidate.isRenalCertified,
          is_charge_certified: candidate.isChargeCertified,
        };
        await createNurseAPI(userId, nurseData);
        created.push({
          name: candidate.name,
          employeeId: candidate.employeeId,
          seniority: candidate.seniority,
          chemoCertified: candidate.isChemoCertified,
          transplantCertified: candidate.isTransplantCertified,
          renalCertified: candidate.isRenalCertified,
          chargeCertified: candidate.isChargeCertified,
          maxHours: candidate.maxHours,
          targetWeeklyHours:
            candidate.employmentType === "PT" && candidate.maxHours <= 60
              ? candidate.maxHours
              : candidate.employmentType === "PT"
                ? partTimeBiWeeklyTarget
                : fullTimeBiWeeklyTarget,
          preferredShiftLengthHours: 11.25,
          employmentType: candidate.employmentType,
        });
      } catch {
        // skip failed ones
      }
    }

    // Build a map of old names to new names for BOTH linked and newly created nurses
    const nameReplacements = new Map<string, string>();

    // Newly created nurses may have manually adjusted names in the modal
    for (const candidate of toCreate) {
      const oldName = (candidate.originalName || candidate.name).trim();
      const newName = candidate.name.trim();
      if (
        oldName &&
        newName &&
        oldName.toLowerCase() !== newName.toLowerCase()
      ) {
        nameReplacements.set(oldName.toLowerCase(), newName);
      }
    }

    for (const candidate of toLink) {
      const selectedMatch = candidate.potentialMatches?.find(
        (m) => m.dbNurse.id === candidate.selectedMatchId,
      );
      if (selectedMatch) {
        nameReplacements.set(
          (candidate.originalName || candidate.name).toLowerCase(),
          selectedMatch.dbNurse.name,
        );

        linked.push({
          name: selectedMatch.dbNurse.name,
          employeeId: selectedMatch.dbNurse.employee_id,
          seniority: selectedMatch.dbNurse.seniority,
          chemoCertified: selectedMatch.dbNurse.is_chemo_certified,
          transplantCertified:
            selectedMatch.dbNurse.is_transplant_certified || false,
          renalCertified: selectedMatch.dbNurse.is_renal_certified || false,
          chargeCertified: selectedMatch.dbNurse.is_charge_certified || false,
          maxHours: selectedMatch.dbNurse.max_weekly_hours,
          targetWeeklyHours: selectedMatch.dbNurse.target_weekly_hours,
          preferredShiftLengthHours:
            selectedMatch.dbNurse.preferred_shift_length_hours,
          employmentType:
            selectedMatch.dbNurse.employment_type === "full-time" ? "FT" : "PT",
        });
      }
    }

    // Update the grid state immutably
    if (nameReplacements.size > 0) {
      setOcrGrid((prevGrid) =>
        prevGrid.map((row) => {
          const newName = nameReplacements.get(row.nurse.toLowerCase());
          if (newName) {
            const matchedCandidate = toLink.find(
              (c) => c.name.toLowerCase() === row.nurse.toLowerCase(),
            );
            const selectedMatch = matchedCandidate?.potentialMatches?.find(
              (m) => m.dbNurse.id === matchedCandidate.selectedMatchId,
            );

            return {
              ...row,
              nurse: newName,
              employeeId: selectedMatch?.dbNurse.employee_id || row.employeeId,
              seniority: selectedMatch?.dbNurse.seniority || row.seniority,
            };
          }
          return row;
        }),
      );
    }

    // Update autoComments to use corrected names
    if (nameReplacements.size > 0) {
      setAutoComments((prev) => {
        let updated = prev;
        nameReplacements.forEach((newName, oldNameLower) => {
          // Find the original candidate name (with proper case)
          const candidate = [...toCreate, ...toLink].find(
            (c) => (c.originalName || c.name).toLowerCase() === oldNameLower,
          );
          const originalName = candidate?.originalName || candidate?.name;
          if (originalName && originalName !== newName) {
            // Replace all occurrences of OCR name with DB name at the start of lines (before |)
            const escapedName = originalName.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const regex = new RegExp(`^${escapedName}(?=\\|)`, "gim");
            updated = updated.replace(regex, newName);
          }
        });
        return updated;
      });
    }

    if (created.length > 0 || linked.length > 0) {
      setManualNurses((prev) => {
        const existingNames = new Set(
          prev.map((n) => normalizeNurseName(n.name)),
        );
        const newNurses = [...created, ...linked].filter(
          (n) => !existingNames.has(normalizeNurseName(n.name)),
        );
        return [...prev, ...newNurses];
      });
    }

    setCreatingNurses(false);
    setShowCreateNursesModal(false);
    setNewNurseCandidates([]);
  };

  const handleSelectAllNurseCandidates = () => {
    setNewNurseCandidates((prev) =>
      prev.map((candidate) => {
        const bestMatch = candidate.potentialMatches?.[0];

        if (bestMatch) {
          return {
            ...candidate,
            selected: true,
            matchAction: "link" as const,
            selectedMatchId: candidate.selectedMatchId || bestMatch.dbNurse.id,
          };
        }

        return {
          ...candidate,
          selected: true,
          matchAction: "create" as const,
          selectedMatchId: undefined,
        };
      }),
    );
  };

  const NurseManagerModal = () => {
    const [nurseName, setNurseName] = useState("");
    const [employeeId, setEmployeeId] = useState("");
    const [seniority, setSeniority] = useState("");
    const [employmentType, setEmploymentType] = useState<"FT" | "PT">("FT");
    const [maxHours, setMaxHours] = useState("");

    if (!showNurseModal) return null;

    const closeModal = () => {
      setShowNurseModal(false);
      setNurseName("");
      setEmployeeId("");
      setSeniority("");
      setEmploymentType("FT");
      setMaxHours("");
    };

    const handleAdd = () => {
      if (!nurseName.trim()) return;
      const newNurse: ManualNurse = {
        name: nurseName.trim(),
        employeeId: employeeId.trim() || undefined,
        seniority: seniority.trim() || undefined,
        employmentType,
        maxHours: maxHours ? parseFloat(maxHours) : undefined,
        offRequests: [],
      };
      setManualNurses((prev) => [...prev, newNurse]);
      setNurseName("");
      setEmployeeId("");
      setSeniority("");
      setEmploymentType("FT");
      setMaxHours("");
    };

    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">
              Manage Nurses
            </h3>
            <button
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <input
                type="text"
                value={nurseName}
                onChange={(e) => setNurseName(e.target.value)}
                placeholder="Nurse name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="Employee ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  placeholder="Seniority"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={employmentType}
                  onChange={(e) =>
                    setEmploymentType(e.target.value as "FT" | "PT")
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="FT">Full-Time</option>
                  <option value="PT">Part-Time</option>
                </select>
                <input
                  type="number"
                  value={maxHours}
                  onChange={(e) => setMaxHours(e.target.value)}
                  placeholder="Max hours/week"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <button
                onClick={handleAdd}
                className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Add Nurse
              </button>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 mb-3">
                Manual Nurses ({manualNurses.length})
              </h4>
              <div className="space-y-2">
                {manualNurses.map((nurse, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-white border border-gray-200 rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{nurse.name}</p>
                      <p className="text-sm text-gray-500">
                        {nurse.employmentType || "FT"}
                        {nurse.employeeId && ` • ID: ${nurse.employeeId}`}
                        {nurse.seniority && ` • ${nurse.seniority}`}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setManualNurses((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 bg-gray-50">
            <button
              onClick={closeModal}
              className="w-full px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page-frame">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="page-container py-6">
          <div className="flex items-center justify-between">
            <div>
              <a
                href="/dashboard"
                className="text-sm text-blue-600 hover:underline mb-1 inline-block"
              >
                ← Back to Dashboard
              </a>
              <h1 className="text-2xl font-semibold text-gray-900">
                Schedule Optimizer
              </h1>
            </div>

            <div className="flex items-center gap-4">
              {savedScheduleId && !isFinalized && (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                    draftSaveStatus === "saving"
                      ? "bg-blue-100 text-blue-700"
                      : draftSaveStatus === "saved"
                        ? "bg-emerald-100 text-emerald-700"
                        : draftSaveStatus === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {draftSaveStatus === "saving" && (
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="opacity-25"
                      />
                      <path
                        d="M22 12a10 10 0 00-10-10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {draftSaveStatus === "saving" && "Saving draft..."}
                  {draftSaveStatus === "saved" && (
                    <>
                      <span>✓ Draft saved</span>
                      {lastDraftSavedAt && (
                        <span className="opacity-70">
                          {new Date(lastDraftSavedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </>
                  )}
                  {draftSaveStatus === "error" && "Save failed"}
                  {draftSaveStatus === "idle" && "Draft"}
                </div>
              )}

              {/* Progress Steps - Reusable Component */}
              <ProgressSteps
                steps={steps}
                currentStepIndex={progressStepIndex}
              />

              {/* Clear Cache Button - moved to header */}
              <ClearCacheButton onClick={clearSavedState} />
            </div>
          </div>
        </div>
      </div>

      <div className="page-container py-8">
        {/* Main Optimizer */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">
                Guided workflow
              </p>
              <p className="text-xs text-blue-700">
                Follow the next action below to complete scheduling with fewer
                clicks.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCurrentStep("setup")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  currentStep === "setup"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-blue-700 border border-blue-300 hover:bg-blue-100"
                }`}
              >
                1) Setup &amp; Upload
              </button>
              <button
                onClick={() => setCurrentStep("review")}
                disabled={ocrGrid.length === 0}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  currentStep === "review"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-blue-700 border border-blue-300 hover:bg-blue-100"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                2) Review
              </button>
              <button
                onClick={() => setCurrentStep("optimize")}
                disabled={ocrGrid.length === 0}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  currentStep === "optimize"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-blue-700 border border-blue-300 hover:bg-blue-100"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                3) Optimize
              </button>
              <button
                onClick={() => setCurrentStep("result")}
                disabled={optimizedGrid.length === 0}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  currentStep === "result"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-blue-700 border border-blue-300 hover:bg-blue-100"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                4) Result
              </button>
            </div>
          </div>
        </div>

        {/* Step 1: Setup & Upload - Combined */}
        {currentStep === "setup" && (
          <SetupStep
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            screenshots={screenshots}
            setScreenshots={setScreenshots}
            ocrLoading={ocrLoading}
            ocrError={ocrError}
            onExtract={runOCR}
            nursesLoadedCount={organizationNurses.length}
            nursesLoading={organizationNursesLoading}
          />
        )}

        {/* Step 2: Review */}
        {currentStep === "review" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Review Extracted Data
                  </h2>
                  <ShiftCodesPopover
                    shiftCodes={SHIFT_CODES}
                    timeSlots={TIME_SLOTS.map((ts) => ({
                      slot: ts.slot,
                      category: ts.category,
                      duration: ts.duration,
                      label: ts.label,
                      mapsTo: ts.mapsTo,
                    }))}
                    label="Shift Codes"
                  />
                </div>
                <p className="text-gray-500 text-sm mt-1">
                  Review and edit the extracted schedule data. Click any cell to
                  modify.
                </p>
              </div>

              {/* OCR Warnings Banner */}
              {ocrWarnings.length > 0 && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-amber-800">
                        Potential OCR Issues Detected ({ocrWarnings.length})
                      </h3>
                      <p className="text-xs text-amber-700 mt-1 mb-2">
                        The following names may have been misread by OCR. Please
                        review and correct if needed:
                      </p>
                      <ul className="space-y-1.5">
                        {ocrWarnings.map((warning, idx) => (
                          <li
                            key={idx}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                warning.severity === "error"
                                  ? "bg-red-500"
                                  : "bg-amber-500"
                              }`}
                            />
                            <span className="font-medium text-amber-900">
                              &quot;{warning.name}&quot;
                            </span>
                            <span className="text-amber-700">—</span>
                            <span className="text-amber-700">
                              {warning.issue}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-amber-600 mt-3 italic">
                        💡 Tip: Click on a nurse name in the grid below to edit
                        it directly.
                      </p>
                    </div>
                    <button
                      onClick={() => setOcrWarnings([])}
                      className="text-amber-600 hover:text-amber-800 p-1"
                      title="Dismiss warnings"
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
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {manualNurses.length > 0 && (
                <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm font-medium text-purple-900 mb-2">
                    Manual Nurses Added ({manualNurses.length}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {manualNurses.map((nurse, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-white border border-purple-300 rounded text-sm text-purple-700"
                      >
                        {nurse.name}
                        {nurse.chemoCertified && " 💉"}
                        {nurse.employmentType && ` (${nurse.employmentType})`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <EditableOCRGrid
                  ocrDates={ocrDates}
                  ocrGrid={ocrGrid}
                  setOcrGrid={handleSetOcrGrid}
                  marker={marker}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Staff Requirements (Optional)
              </h2>
              <StaffRequirementsEditor
                ocrDates={ocrDates}
                shiftTypes={shiftTypes}
                requiredStaff={requiredStaff}
                setRequiredStaff={setRequiredStaff}
              />
            </div>

            {/* Auto-detected marker comments from OCR */}
            {autoComments && (
              <AutoCommentsBox
                autoComments={autoComments}
                setAutoComments={setAutoComments}
                validationErrors={commentValidationErrors}
              />
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("setup")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={() => setCurrentStep("optimize")}
                disabled={ocrGrid.length === 0}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Continue to Optimize
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Optimize */}
        {currentStep === "optimize" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Ready to Optimize
              </h2>

              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      Smart Scheduler
                    </h3>
                    <span className="text-xs text-blue-600 font-medium">
                      Constraint-based optimization
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  The scheduler will: honor Time Off Request from comments,
                  preserve existing shift codes from OCR, fill gaps to meet
                  staffing requirements, balance hours fairly across nurses, and
                  enforce consecutive work day limits.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div>
                  <span className="text-gray-500">Period:</span>
                  <p className="font-medium">
                    {startDate} to {endDate}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Total Nurses:</span>
                  <p className="font-medium text-blue-600">
                    {uniqueNurses.length}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Days:</span>
                  <p className="font-medium">{ocrDates.length}</p>
                </div>
              </div>

              {/* Visual nurse list for debugging */}
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Nurses to be Scheduled: {uniqueNurses.length}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {/* Deduplicated nurse list */}
                  {uniqueNurses.map((nurse, idx) => (
                    <span
                      key={`nurse-${idx}`}
                      className={`px-2 py-1 text-xs rounded-full ${
                        nurse.isManual
                          ? "bg-green-100 text-green-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {nurse.name}
                      {nurse.isManual && " ✓"}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("review")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={previewConstraints}
                disabled={loadingConstraints}
                className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loadingConstraints ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Preview & Optimize
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 5: Result */}
        {currentStep === "result" && optimizedGrid.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <svg
                className="w-6 h-6 text-green-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1">
                <h3 className="font-semibold text-green-800">
                  Optimization Complete!
                </h3>
                <p className="text-sm text-green-700">
                  {isFinalized
                    ? "Your schedule has been finalized and saved to the database."
                    : savedScheduleId
                      ? "Draft saved. You can leave now and continue later from Schedule Management."
                      : "Review your optimized schedule below. Click 'Finalize & Save' to save it permanently."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isFinalized ? (
                  <span className="px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-full">
                    ✓ Finalized
                  </span>
                ) : (
                  <button
                    onClick={handleFinalizeSchedule}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                  >
                    Finalize & Save
                  </button>
                )}
              </div>
            </div>

            {savedScheduleId && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-700">
                  <span className="font-medium">Schedule ID:</span>{" "}
                  {savedScheduleId}
                  <span className="ml-4 text-blue-600">
                    {isFinalized
                      ? "(Finalized and saved to database)"
                      : "(Saved as draft - you can close this page and continue later)"}
                  </span>
                </p>
              </div>
            )}

            {/* Debug: Show optimization stats */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700">
                  Optimization Results
                </h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowHoursBreakdown(!showHoursBreakdown)}
                    className={`text-xs px-3 py-1 rounded-full transition-colors ${
                      showHoursBreakdown
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                    }`}
                  >
                    {showHoursBreakdown ? "Hide" : "Show"} Hours Breakdown
                  </button>
                  <span className="text-xs text-gray-500">
                    {filteredOptimizedGrid.length} nurses scheduled over{" "}
                    {scheduleDatesForStats.length} days
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mb-4">
                <div className="bg-white p-3 rounded-lg border">
                  <span className="text-gray-500 text-xs">Visible Nurses</span>
                  <p className="text-xl font-bold text-gray-900">
                    {filteredOptimizedGrid.length}
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <span className="text-gray-500 text-xs">Hidden</span>
                  <p className="text-xl font-bold text-gray-400">
                    {excludedNurses.size}
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <span className="text-gray-500 text-xs">From OCR</span>
                  <p className="text-xl font-bold text-blue-600">
                    {filteredOptimizedGrid.length +
                      excludedNurses.size -
                      manualNurses.length}
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <span className="text-gray-500 text-xs">Manual Nurses</span>
                  <p className="text-xl font-bold text-green-600">
                    {manualNurses.length}
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <span className="text-gray-500 text-xs">Total Hours</span>
                  <p className="text-xl font-bold text-purple-600">
                    {formatQuarterHours(
                      nurseHoursStats.reduce((sum, n) => sum + n.totalHours, 0),
                    )}
                    h
                  </p>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border">
                  <p className="text-xs text-gray-500">Coverage Compliance</p>
                  <p className="text-lg font-semibold text-emerald-600">
                    {formatPercent(operationalQualitySnapshot.coveragePct)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {operationalQualitySnapshot.daysMeetingCoverage}/
                    {operationalQualitySnapshot.totalDates} days met minimum
                    staffing
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <p className="text-xs text-gray-500">
                    Off-Request Protection
                  </p>
                  <p className="text-lg font-semibold text-blue-600">
                    {formatPercent(
                      operationalQualitySnapshot.offRequestRespectPct,
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {operationalQualitySnapshot.respectedOffRequests}/
                    {operationalQualitySnapshot.totalOffRequests} requested days
                    respected
                  </p>
                </div>
                <div className="bg-white p-3 rounded-lg border">
                  <p className="text-xs text-gray-500">Avg Hour Delta</p>
                  <p className="text-lg font-semibold text-purple-600">
                    {formatQuarterHours(
                      operationalQualitySnapshot.avgAbsoluteHourDelta,
                    )}
                    h
                  </p>
                  <p className="text-xs text-gray-500">
                    vs contract target · lower is better
                  </p>
                </div>
              </div>

              {/* Hours Breakdown Table */}
              {showHoursBreakdown && (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left p-2 border-b font-medium">
                          Nurse
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Type
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Shifts
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Paid Hours
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Hour Target
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Delta
                        </th>
                        <th className="text-center p-2 border-b font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {nurseHoursStats.map((nurse, idx) => (
                        <tr
                          key={idx}
                          className={`hover:bg-gray-50 border-b ${!nurse.hoursValid ? "bg-red-50/40" : ""}`}
                        >
                          <td className="p-2 font-medium">
                            {nurse.name}
                            {!nurse.hoursValid && (
                              <span
                                className="ml-1 text-red-500 cursor-help"
                                title={`Hour mismatch: ${formatQuarterHours(nurse.totalHours)}h actual vs ${formatQuarterHours(nurse.expectedHours)}h expected from ${nurse.count12h}×12h + ${nurse.count8h}×8h shifts`}
                              >
                                ⚠
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${
                                nurse.employmentType === "PT"
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {nurse.employmentType}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <div className="font-medium">
                              {nurse.workingDays + (nurse.cfShiftCount || 0)}{" "}
                              shift
                              {nurse.workingDays + (nurse.cfShiftCount || 0) !==
                              1
                                ? "s"
                                : ""}
                            </div>
                            <div className="text-xs text-gray-500">
                              {nurse.count12h > 0 && (
                                <span>{nurse.count12h}×12h</span>
                              )}
                              {nurse.count12h > 0 && nurse.count8h > 0 && (
                                <span> + </span>
                              )}
                              {nurse.count8h > 0 && (
                                <span>{nurse.count8h}×8h</span>
                              )}
                              {nurse.cfHours > 0 && (
                                <span className="text-purple-500 ml-1">
                                  +{formatQuarterHours(nurse.cfHours)}h CF
                                </span>
                              )}
                              {nurse.requestedOffDaysInPeriod > 0 && (
                                <span className="ml-1">
                                  • {nurse.requestedOffDaysInPeriod} off
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-center font-medium">
                            <div>{formatQuarterHours(nurse.totalHours)}h</div>
                          </td>
                          <td className="p-2 text-center text-gray-600">
                            <div>
                              {formatQuarterHours(nurse.contractTargetHours)}h
                            </div>
                            {(() => {
                              const numBiWeeks =
                                scheduleDatesForStats.length / 14.0;
                              // If exactly 2 weeks (1 bi-weekly period), show simplified text
                              if (Math.abs(numBiWeeks - 1) < 0.01) {
                                return null; // Don't show redundant "75h/2wk" when target is already 75h
                              }
                              return (
                                <div className="text-xs text-gray-400">
                                  {formatQuarterHours(nurse.biWeeklyHours)}h/2wk
                                </div>
                              );
                            })()}
                          </td>
                          <td className="p-2 text-center">
                            <span
                              className={`font-medium ${
                                Math.abs(nurse.delta) <= 0.5
                                  ? "text-green-600"
                                  : Math.abs(nurse.delta) <=
                                      nurse.contractTargetHours * 0.05
                                    ? "text-amber-600"
                                    : "text-red-600"
                              }`}
                            >
                              {nurse.delta > 0 ? "+" : ""}
                              {formatQuarterHours(nurse.delta)}h
                            </span>
                            <div className="mt-0.5">
                              {nurse.utilizationPct >= 110 ? (
                                <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 text-red-700">
                                  OT {formatPercent(nurse.utilizationPct)}
                                </span>
                              ) : nurse.utilizationPct <= 55 ? (
                                <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700">
                                  Under {formatPercent(nurse.utilizationPct)}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-500">
                                  {formatPercent(nurse.utilizationPct)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => {
                                setExcludedNurses((prev) => {
                                  const next = new Set(prev);
                                  next.add(nurse.name);
                                  return next;
                                });
                              }}
                              className="text-xs text-red-500 hover:text-red-700 hover:underline"
                            >
                              Hide
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-medium">
                        <td className="p-2">
                          Total ({nurseHoursStats.length} nurses)
                          {nurseHoursStats.filter((n) => !n.hoursValid).length >
                            0 && (
                            <span className="text-red-500 font-normal text-xs ml-1">
                              ⚠{" "}
                              {
                                nurseHoursStats.filter((n) => !n.hoursValid)
                                  .length
                              }{" "}
                              with hour mismatches
                            </span>
                          )}
                        </td>
                        <td className="p-2"></td>
                        <td className="p-2 text-center">
                          <div className="font-medium">
                            {nurseHoursStats.reduce(
                              (sum, n) =>
                                sum + n.workingDays + (n.cfShiftCount || 0),
                              0,
                            )}{" "}
                            shifts
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          {formatQuarterHours(
                            nurseHoursStats.reduce(
                              (sum, n) => sum + n.totalHours,
                              0,
                            ),
                          )}
                          h
                        </td>
                        <td className="p-2 text-center text-gray-500">
                          {formatQuarterHours(
                            nurseHoursStats.reduce(
                              (sum, n) => sum + n.contractTargetHours,
                              0,
                            ),
                          )}
                          h
                        </td>
                        <td className="p-2 text-center">
                          {(() => {
                            const totalDelta = nurseHoursStats.reduce(
                              (sum, n) => sum + n.delta,
                              0,
                            );
                            const overCount = nurseHoursStats.filter(
                              (n) => n.utilizationPct >= 110,
                            ).length;
                            const underCount = nurseHoursStats.filter(
                              (n) => n.utilizationPct <= 55,
                            ).length;
                            return (
                              <div>
                                <span
                                  className={`font-medium ${
                                    Math.abs(totalDelta) <=
                                    nurseHoursStats.length
                                      ? "text-green-600"
                                      : totalDelta > 0
                                        ? "text-red-600"
                                        : "text-amber-600"
                                  }`}
                                >
                                  {totalDelta > 0 ? "+" : ""}
                                  {formatQuarterHours(totalDelta)}h
                                </span>
                                {(overCount > 0 || underCount > 0) && (
                                  <div className="text-[10px] mt-0.5 text-gray-500">
                                    {overCount > 0 && (
                                      <span className="text-red-600">
                                        {overCount} OT
                                      </span>
                                    )}
                                    {overCount > 0 && underCount > 0 && " · "}
                                    {underCount > 0 && (
                                      <span className="text-amber-600">
                                        {underCount} under-FTE
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="p-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <p className="text-xs text-blue-700">
                      <span className="font-medium">📋 How to read</span>:{" "}
                      <strong>Paid Hours</strong> = sum of each shift&apos;s
                      fixed value (12h codes = 11.25h, 8h codes = 7.5h).{" "}
                      <strong>Hour Target</strong> = bi-weekly contract hours ×
                      number of bi-weekly periods, adjusted for approved
                      off-requests. <strong>Delta</strong> = Paid Hours − Hour
                      Target. Positive = overtime to balance in next period,
                      negative = under-hours.{" "}
                      <span className="inline-block px-1 py-0 text-[10px] font-medium rounded bg-red-100 text-red-700">
                        OT
                      </span>{" "}
                      = over 110% utilization (union flag),{" "}
                      <span className="inline-block px-1 py-0 text-[10px] font-medium rounded bg-amber-100 text-amber-700">
                        Under
                      </span>{" "}
                      = below 55% (FTE shortfall). ⚠ flags invalid hour math.
                    </p>
                  </div>
                </div>
              )}

              {/* Hidden nurses - show option to restore */}
              {excludedNurses.size > 0 && (
                <div className="mb-4 p-3 bg-gray-100 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      Hidden Nurses ({excludedNurses.size})
                    </span>
                    <button
                      onClick={() => setExcludedNurses(new Set())}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Restore All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(excludedNurses).map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full"
                      >
                        {name}
                        <button
                          onClick={() => {
                            setExcludedNurses((prev) => {
                              const next = new Set(prev);
                              next.delete(name);
                              return next;
                            });
                          }}
                          className="ml-1 text-gray-400 hover:text-gray-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Visual check: all nurses should be in optimized grid */}
              <div className="flex flex-wrap gap-2">
                {filteredOptimizedGrid.map((row, idx) => {
                  // Check if nurse is from OCR or manual
                  const isOCR = ocrGrid.some((r) => r.nurse === row.nurse);
                  const isManual = manualNurses.some(
                    (n) => n.name === row.nurse,
                  );
                  return (
                    <span
                      key={idx}
                      className={`px-2 py-1 text-xs rounded-full cursor-pointer hover:opacity-75 ${
                        isOCR
                          ? "bg-blue-100 text-blue-700"
                          : isManual
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                      }`}
                      onClick={() => {
                        setExcludedNurses((prev) => {
                          const next = new Set(prev);
                          next.add(row.nurse);
                          return next;
                        });
                      }}
                      title="Click to hide nurse"
                    >
                      {row.nurse}
                    </span>
                  );
                })}
              </div>

              {filteredOptimizedGrid.length <
                uniqueNurses.length - excludedNurses.size && (
                <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-sm">
                  ⚠️ Warning: Expected{" "}
                  {uniqueNurses.length - excludedNurses.size} nurses but only{" "}
                  {filteredOptimizedGrid.length} in result.
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Optimized Schedule
              </h2>
              {/* Inject OFF entries from Employee Notes & Time-Off Requests
                  into the grid so they appear in the Schedule Calendar */}
              {(() => {
                const commentOffs = extractOffDatesFromComments(autoComments);
                // Build a grid with comment OFF entries merged in
                const gridWithOffs = filteredOptimizedGrid.map((row) => {
                  const nurseLower = row.nurse.toLowerCase();
                  const nurseFirst = row.nurse.split(" ")[0].toLowerCase();
                  // Find matching comment off dates for this nurse (fuzzy)
                  const offDates: string[] = [];
                  for (const [commentNurse, dates] of Object.entries(
                    commentOffs,
                  )) {
                    const commentLower = commentNurse.toLowerCase();
                    if (
                      commentLower.includes(nurseLower) ||
                      nurseLower.includes(commentLower) ||
                      commentNurse.split(" ")[0].toLowerCase() === nurseFirst
                    ) {
                      offDates.push(...dates);
                    }
                  }
                  if (offDates.length === 0) return row;
                  // Merge OFF entries from comments into the grid.
                  // The backend may already have blank off-entries (shift:"")
                  // for off-request dates. Those are hidden by the calendar
                  // filter, so we need to upgrade them to code "OFF".
                  const offDateSet = new Set(offDates);
                  const upgradedShifts = row.shifts.map((s) => {
                    if (
                      offDateSet.has(s.date) &&
                      s.hours === 0 &&
                      (!s.shift || s.shift.trim() === "")
                    ) {
                      // Upgrade blank off → visible "OFF"
                      return { ...s, shift: "OFF", shiftType: "off" as const };
                    }
                    return s;
                  });
                  // For any off dates that had NO entry at all, add new ones
                  const existingDates = new Set(
                    upgradedShifts.map((s) => s.date),
                  );
                  const newOffShifts: ShiftEntry[] = offDates
                    .filter((d) => !existingDates.has(d))
                    .map((d) => ({
                      date: d,
                      shift: "OFF",
                      shiftType: "off" as const,
                      hours: 0,
                      startTime: "",
                      endTime: "",
                    }));
                  return {
                    ...row,
                    shifts: [...upgradedShifts, ...newOffShifts],
                  };
                });
                return (
                  <SchedulePreview
                    key={`schedule-${filteredOptimizedGrid.length}-${ocrDates.length}-${autoComments.length}`}
                    ocrGrid={gridWithOffs}
                    ocrDates={ocrDates}
                    nurseMetadata={manualNurses}
                    onChange={handleSchedulePreviewChange}
                    onAsteriskDetected={handleAsteriskDetected}
                  />
                );
              })()}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => {
                  if (isFinalized) {
                    alert(
                      "Cannot edit a finalized schedule. Please create a new schedule.",
                    );
                    return;
                  }
                  setCurrentStep("optimize");
                }}
                disabled={isFinalized}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Back to Optimize
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (isFinalized) {
                      alert(
                        "Cannot refine a finalized schedule. Please create a new schedule.",
                      );
                      return;
                    }
                    setShowRefineModal(true);
                  }}
                  disabled={isFinalized}
                  className="px-6 py-2 text-blue-600 font-medium border border-blue-300 rounded-lg hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  Refine with AI
                </button>
                <button
                  onClick={analyzeScheduleInsights}
                  disabled={insightsLoading}
                  className="px-6 py-2 text-emerald-600 font-medium border border-emerald-300 rounded-lg hover:bg-emerald-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {insightsLoading ? (
                    <>
                      <svg
                        className="animate-spin w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                      Analyzing…
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
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      AI Insights
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (isFinalized) {
                      alert(
                        "Cannot edit a finalized schedule. Please create a new schedule.",
                      );
                      return;
                    }
                    // Go back to review to adjust nurses or requirements, then re-optimize
                    setCurrentStep("review");
                  }}
                  disabled={isFinalized}
                  className="px-6 py-2 text-purple-600 font-medium border border-purple-300 rounded-lg hover:bg-purple-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Re-optimize
                </button>
                <button
                  onClick={() => {
                    clearSavedState();
                  }}
                  className="px-6 py-2 text-gray-600 font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Start New
                </button>
                <button
                  onClick={async () => {
                    // Export as Excel with calendar-like formatting using ExcelJS
                    const workbook = new ExcelJS.Workbook();
                    workbook.creator = "Schedule Optimizer";
                    workbook.created = new Date();

                    const worksheet = workbook.addWorksheet("Schedule", {
                      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
                    });

                    // Define colors for shift types
                    const dayColor = { argb: "FFFEF3C7" }; // Amber-100
                    const nightColor = { argb: "FFE0E7FF" }; // Indigo-100
                    const offColor = { argb: "FFF3F4F6" }; // Gray-100
                    const headerColor = { argb: "FF3B82F6" }; // Blue-500
                    const totalRowColor = { argb: "FFDBEAFE" }; // Blue-100

                    // Create header row
                    const headerRow = worksheet.addRow([
                      "Nurse",
                      ...ocrDates.map((d) => {
                        const date = new Date(d);
                        const dayName = date.toLocaleDateString("en-US", {
                          weekday: "short",
                        });
                        const dayNum = date.getDate();
                        const month = date.toLocaleDateString("en-US", {
                          month: "short",
                        });
                        return `${dayName}\n${month} ${dayNum}`;
                      }),
                    ]);

                    // Style header row
                    headerRow.height = 35;
                    headerRow.eachCell((cell, colNumber) => {
                      cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: headerColor,
                      };
                      cell.font = {
                        bold: true,
                        color: { argb: "FFFFFFFF" },
                        size: 11,
                      };
                      cell.alignment = {
                        vertical: "middle",
                        horizontal: "center",
                        wrapText: true,
                      };
                      cell.border = {
                        top: { style: "thin" },
                        left: { style: "thin" },
                        bottom: { style: "thin" },
                        right: { style: "thin" },
                      };
                    });

                    // Add data rows
                    optimizedGrid.forEach((row) => {
                      const shiftByDate: Record<
                        string,
                        { shift: string; type: string }
                      > = {};
                      row.shifts.forEach((s) => {
                        shiftByDate[s.date] = {
                          shift: s.shift || "OFF",
                          type: s.shiftType,
                        };
                      });

                      const dataRow = worksheet.addRow([
                        row.nurse,
                        ...ocrDates.map((d) => shiftByDate[d]?.shift || "OFF"),
                      ]);

                      // Style data cells
                      dataRow.eachCell((cell, colNumber) => {
                        cell.border = {
                          top: { style: "thin", color: { argb: "FFE5E7EB" } },
                          left: { style: "thin", color: { argb: "FFE5E7EB" } },
                          bottom: {
                            style: "thin",
                            color: { argb: "FFE5E7EB" },
                          },
                          right: { style: "thin", color: { argb: "FFE5E7EB" } },
                        };
                        cell.alignment = {
                          vertical: "middle",
                          horizontal: "center",
                        };

                        if (colNumber === 1) {
                          // Nurse name column
                          cell.font = { bold: true };
                          cell.alignment = {
                            vertical: "middle",
                            horizontal: "left",
                          };
                        } else {
                          // Shift cells - color based on type
                          const dateIdx = colNumber - 2;
                          const date = ocrDates[dateIdx];
                          const shiftInfo = shiftByDate[date];

                          if (
                            !shiftInfo ||
                            !shiftInfo.shift ||
                            shiftInfo.shift === "OFF" ||
                            shiftInfo.shift === ""
                          ) {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: offColor,
                            };
                            cell.font = {
                              color: { argb: "FF9CA3AF" },
                              italic: true,
                            };
                          } else if (shiftInfo.type === "night") {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: nightColor,
                            };
                            cell.font = {
                              color: { argb: "FF4338CA" },
                              bold: true,
                            };
                          } else {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: dayColor,
                            };
                            cell.font = {
                              color: { argb: "FFD97706" },
                              bold: true,
                            };
                          }
                        }
                      });
                    });

                    // Add empty row
                    worksheet.addRow([]);

                    // Add totals row
                    const totalsData = [
                      "TOTAL STAFF",
                      ...ocrDates.map((d) => {
                        let dayCount = 0;
                        let nightCount = 0;
                        optimizedGrid.forEach((row) => {
                          const shift = row.shifts.find((s) => s.date === d);
                          if (
                            shift &&
                            shift.shift &&
                            shift.shift !== "OFF" &&
                            shift.hours > 0
                          ) {
                            if (shift.shiftType === "day") dayCount++;
                            else nightCount++;
                          }
                        });
                        return `D:${dayCount} N:${nightCount}`;
                      }),
                    ];
                    const totalsRow = worksheet.addRow(totalsData);
                    totalsRow.eachCell((cell) => {
                      cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: totalRowColor,
                      };
                      cell.font = { bold: true, size: 11 };
                      cell.alignment = {
                        vertical: "middle",
                        horizontal: "center",
                      };
                      cell.border = {
                        top: { style: "medium" },
                        left: { style: "thin" },
                        bottom: { style: "medium" },
                        right: { style: "thin" },
                      };
                    });

                    // Set column widths
                    worksheet.getColumn(1).width = 25; // Nurse name
                    for (let i = 2; i <= ocrDates.length + 1; i++) {
                      worksheet.getColumn(i).width = 12;
                    }

                    // Generate and download file
                    const buffer = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([buffer], {
                      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    });
                    const startDateStr = ocrDates[0] || "schedule";
                    const endDateStr = ocrDates[ocrDates.length - 1] || "";
                    saveAs(
                      blob,
                      `schedule_${startDateStr}_to_${endDateStr}.xlsx`,
                    );
                  }}
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2"
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
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export Excel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Nurse Management Modal */}
      <NurseManagerModal />

      {/* Nurse Matching Modal - Enhanced UI for matching OCR nurses to DB */}
      {showCreateNursesModal && newNurseCandidates.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Match Nurses from Schedule
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {newNurseCandidates.length} nurse name(s) need your
                    attention. Link to existing staff or add new.
                  </p>
                  <button
                    onClick={handleSelectAllNurseCandidates}
                    className="mt-3 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    Select All
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowCreateNursesModal(false);
                    setNewNurseCandidates([]);
                  }}
                  className="ml-auto p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {newNurseCandidates.map((candidate, idx) => (
                <div
                  key={idx}
                  className={`border-2 rounded-xl overflow-hidden transition-all ${
                    candidate.matchAction === "skip"
                      ? "border-gray-200 bg-gray-50 opacity-60"
                      : candidate.matchAction === "link"
                        ? "border-purple-300 bg-purple-50/30"
                        : "border-blue-300 bg-blue-50/30"
                  }`}
                >
                  {/* Candidate Header */}
                  <div className="px-4 py-3 bg-white border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-gray-400 to-gray-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">
                            {candidate.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {candidate.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {candidate.employeeId &&
                              `ID: ${candidate.employeeId}`}
                            {candidate.employeeId &&
                              candidate.seniority &&
                              " • "}
                            {candidate.seniority && `${candidate.seniority}`}
                          </p>
                        </div>
                      </div>

                      {/* Action Toggle */}
                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                        {candidate.potentialMatches &&
                          candidate.potentialMatches.length > 0 && (
                            <button
                              onClick={() =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          matchAction: "link",
                                          selected: true,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                candidate.matchAction === "link"
                                  ? "bg-purple-600 text-white"
                                  : "text-gray-600 hover:text-gray-800"
                              }`}
                            >
                              Link Existing
                            </button>
                          )}
                        <button
                          onClick={() =>
                            setNewNurseCandidates((prev) =>
                              prev.map((c, i) =>
                                i === idx
                                  ? {
                                      ...c,
                                      matchAction: "create",
                                      selected: true,
                                      selectedMatchId: undefined,
                                    }
                                  : c,
                              ),
                            )
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            candidate.matchAction === "create"
                              ? "bg-blue-600 text-white"
                              : "text-gray-600 hover:text-gray-800"
                          }`}
                        >
                          Add New
                        </button>
                        <button
                          onClick={() =>
                            setNewNurseCandidates((prev) =>
                              prev.map((c, i) =>
                                i === idx
                                  ? {
                                      ...c,
                                      matchAction: "skip",
                                      selected: false,
                                      selectedMatchId: undefined,
                                    }
                                  : c,
                              ),
                            )
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            candidate.matchAction === "skip"
                              ? "bg-gray-600 text-white"
                              : "text-gray-600 hover:text-gray-800"
                          }`}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Potential Matches Section */}
                  {candidate.matchAction === "link" &&
                    candidate.potentialMatches &&
                    candidate.potentialMatches.length > 0 && (
                      <div className="px-4 py-3 bg-purple-50/50">
                        <p className="text-xs font-medium text-purple-700 mb-2">
                          🔍 Potential matches found - select the correct nurse:
                        </p>
                        <div className="space-y-2">
                          {candidate.potentialMatches.map((match, matchIdx) => (
                            <label
                              key={matchIdx}
                              className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                candidate.selectedMatchId === match.dbNurse.id
                                  ? "border-purple-500 bg-white"
                                  : "border-gray-200 bg-white/50 hover:border-purple-300"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`match-${idx}`}
                                checked={
                                  candidate.selectedMatchId === match.dbNurse.id
                                }
                                onChange={() =>
                                  setNewNurseCandidates((prev) =>
                                    prev.map((c, i) =>
                                      i === idx
                                        ? {
                                            ...c,
                                            selectedMatchId: match.dbNurse.id,
                                          }
                                        : c,
                                    ),
                                  )
                                }
                                className="sr-only"
                              />
                              <div
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                  candidate.selectedMatchId === match.dbNurse.id
                                    ? "border-purple-500 bg-purple-500"
                                    : "border-gray-300"
                                }`}
                              >
                                {candidate.selectedMatchId ===
                                  match.dbNurse.id && (
                                  <div className="w-2 h-2 bg-white rounded-full" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">
                                    {match.dbNurse.name}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                      match.score >= 0.8
                                        ? "bg-green-100 text-green-700"
                                        : match.score >= 0.6
                                          ? "bg-yellow-100 text-yellow-700"
                                          : "bg-orange-100 text-orange-700"
                                    }`}
                                  >
                                    {Math.round(match.score * 100)}% match
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                  {match.dbNurse.employee_id && (
                                    <span>ID: {match.dbNurse.employee_id}</span>
                                  )}
                                  <span
                                    className={
                                      match.dbNurse.employment_type ===
                                      "full-time"
                                        ? "text-blue-600"
                                        : "text-purple-600"
                                    }
                                  >
                                    {match.dbNurse.employment_type ===
                                    "full-time"
                                      ? "Full-Time"
                                      : "Part-Time"}
                                  </span>
                                  <span>
                                    {match.dbNurse.max_weekly_hours}h/2wk
                                  </span>
                                  {match.dbNurse.is_chemo_certified && (
                                    <span>💉</span>
                                  )}
                                  {match.dbNurse.is_transplant_certified && (
                                    <span>🫀</span>
                                  )}
                                  {match.dbNurse.is_renal_certified && (
                                    <span>🩺</span>
                                  )}
                                  {match.dbNurse.is_charge_certified && (
                                    <span>⭐</span>
                                  )}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Create New Nurse Form */}
                  {candidate.matchAction === "create" && (
                    <div className="px-4 py-3 bg-blue-50/50">
                      <p className="text-xs font-medium text-blue-700 mb-3">
                        ✨ Configure the new staff member:
                      </p>
                      <div className="space-y-3">
                        {/* Name & IDs */}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">
                              Name
                            </label>
                            <input
                              type="text"
                              value={candidate.name}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? { ...c, name: e.target.value }
                                      : c,
                                  ),
                                )
                              }
                              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">
                              Employee ID
                            </label>
                            <input
                              type="text"
                              value={candidate.employeeId || ""}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          employeeId:
                                            e.target.value || undefined,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              placeholder="47554"
                              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">
                              Seniority
                            </label>
                            <input
                              type="text"
                              value={candidate.seniority || ""}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          seniority:
                                            e.target.value || undefined,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              placeholder="3Y-283.95D"
                              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>

                        {/* Employment Type & Hours */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          employmentType: "FT",
                                          maxHours: fullTimeBiWeeklyTarget,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                candidate.employmentType === "FT"
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-200 text-gray-600"
                              }`}
                            >
                              Full-Time
                            </button>
                            <button
                              onClick={() =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          employmentType: "PT",
                                          maxHours: partTimeBiWeeklyTarget,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                candidate.employmentType === "PT"
                                  ? "bg-purple-600 text-white"
                                  : "bg-gray-200 text-gray-600"
                              }`}
                            >
                              Part-Time
                            </button>
                          </div>
                          <div className="flex items-center gap-1 text-sm">
                            <span className="text-gray-500">Max:</span>
                            <input
                              type="number"
                              value={candidate.maxHours}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          maxHours:
                                            parseFloat(e.target.value) ||
                                            (c.employmentType === "PT"
                                              ? partTimeBiWeeklyTarget
                                              : fullTimeBiWeeklyTarget),
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className="w-14 px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none focus:border-blue-400"
                            />
                            <span className="text-gray-500">h/2wk</span>
                          </div>
                        </div>

                        {/* Certifications */}
                        <div className="flex flex-wrap gap-2">
                          <label
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 cursor-pointer transition-all ${
                              candidate.isChemoCertified
                                ? "border-green-500 bg-green-50"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={candidate.isChemoCertified}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          isChemoCertified: e.target.checked,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className="sr-only"
                            />
                            <span className="text-sm">💉 Chemo</span>
                            {candidate.isChemoCertified && (
                              <span className="text-green-500">✓</span>
                            )}
                          </label>
                          <label
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 cursor-pointer transition-all ${
                              candidate.isTransplantCertified
                                ? "border-purple-500 bg-purple-50"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={candidate.isTransplantCertified}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          isTransplantCertified:
                                            e.target.checked,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className="sr-only"
                            />
                            <span className="text-sm">🫀 Transplant</span>
                            {candidate.isTransplantCertified && (
                              <span className="text-purple-500">✓</span>
                            )}
                          </label>
                          <label
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 cursor-pointer transition-all ${
                              candidate.isRenalCertified
                                ? "border-blue-500 bg-blue-50"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={candidate.isRenalCertified}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          isRenalCertified: e.target.checked,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className="sr-only"
                            />
                            <span className="text-sm">🩺 Renal</span>
                            {candidate.isRenalCertified && (
                              <span className="text-blue-500">✓</span>
                            )}
                          </label>
                          <label
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 cursor-pointer transition-all ${
                              candidate.isChargeCertified
                                ? "border-amber-500 bg-amber-50"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={candidate.isChargeCertified}
                              onChange={(e) =>
                                setNewNurseCandidates((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          isChargeCertified: e.target.checked,
                                        }
                                      : c,
                                  ),
                                )
                              }
                              className="sr-only"
                            />
                            <span className="text-sm">⭐ Charge</span>
                            {candidate.isChargeCertified && (
                              <span className="text-amber-500">✓</span>
                            )}
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Skip Message */}
                  {candidate.matchAction === "skip" && (
                    <div className="px-4 py-2 text-center text-sm text-gray-500">
                      This nurse will be skipped
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0 bg-gray-50">
              <div className="text-sm text-gray-500">
                <span className="font-medium text-blue-600">
                  {
                    newNurseCandidates.filter((n) => n.matchAction === "create")
                      .length
                  }
                </span>{" "}
                new •
                <span className="font-medium text-purple-600 ml-1">
                  {
                    newNurseCandidates.filter(
                      (n) => n.matchAction === "link" && n.selectedMatchId,
                    ).length
                  }
                </span>{" "}
                linked •
                <span className="font-medium text-gray-600 ml-1">
                  {
                    newNurseCandidates.filter((n) => n.matchAction === "skip")
                      .length
                  }
                </span>{" "}
                skipped
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowCreateNursesModal(false);
                    setNewNurseCandidates([]);
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSelectedNurses}
                  disabled={
                    creatingNurses ||
                    (newNurseCandidates.filter(
                      (n) => n.matchAction === "create",
                    ).length === 0 &&
                      newNurseCandidates.filter(
                        (n) => n.matchAction === "link" && n.selectedMatchId,
                      ).length === 0)
                  }
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {creatingNurses ? (
                    <>
                      <svg
                        className="w-4 h-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                      Processing…
                    </>
                  ) : (
                    "Apply Changes"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Constraints Confirmation Modal */}
      {showConstraintsModal && parsedConstraints && (
        <ConstraintsConfirmation
          constraints={parsedConstraints}
          onConfirm={async (edited) => {
            try {
              await optimizeWithConfirmedConstraints(edited);
            } finally {
              // Ensure UI advances even if hook fallback handled the result.
              setCurrentStep("result");
              setShowConstraintsModal(false);
            }
          }}
          onCancel={() => setShowConstraintsModal(false)}
          onEdit={() => {}}
          fullTimeBiWeeklyTarget={fullTimeBiWeeklyTarget}
          partTimeBiWeeklyTarget={partTimeBiWeeklyTarget}
        />
      )}

      {/* AI Schedule Insights Panel */}
      {showInsightsPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-emerald-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <h3 className="text-xl font-bold text-gray-900">
                  AI Schedule Insights
                </h3>
              </div>
              <button
                onClick={() => setShowInsightsPanel(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {insightsLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <svg
                    className="animate-spin w-10 h-10 text-emerald-500"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  <p className="text-gray-500 text-sm">
                    Analyzing schedule with AI…
                  </p>
                </div>
              )}

              {!insightsLoading && insightsData && (
                <>
                  {/* Score + Summary */}
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="font-semibold text-emerald-900 mb-1">
                          Overall Assessment
                        </h4>
                        <p className="text-emerald-800 text-sm leading-relaxed">
                          {insightsData.summary}
                        </p>
                      </div>
                      {insightsData.score !== null && (
                        <div className="flex-shrink-0 flex flex-col items-center">
                          <div
                            className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-4 ${
                              insightsData.score >= 80
                                ? "border-emerald-400 text-emerald-700 bg-emerald-50"
                                : insightsData.score >= 60
                                  ? "border-yellow-400 text-yellow-700 bg-yellow-50"
                                  : "border-red-400 text-red-700 bg-red-50"
                            }`}
                          >
                            {insightsData.score}
                          </div>
                          <span className="text-xs text-gray-500 mt-1">
                            Score
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Issues */}
                  {insightsData.issues && insightsData.issues.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                        <svg
                          className="w-4 h-4 text-orange-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                        Issues Found ({insightsData.issues.length})
                      </h4>
                      <div className="space-y-2">
                        {insightsData.issues.map((issue, idx) => (
                          <div
                            key={idx}
                            className={`rounded-lg p-3 border flex gap-3 ${
                              issue.severity === "error"
                                ? "bg-red-50 border-red-200"
                                : issue.severity === "warning"
                                  ? "bg-yellow-50 border-yellow-200"
                                  : "bg-blue-50 border-blue-200"
                            }`}
                          >
                            <span className="text-lg flex-shrink-0 leading-tight">
                              {issue.severity === "error"
                                ? "🔴"
                                : issue.severity === "warning"
                                  ? "🟡"
                                  : "🔵"}
                            </span>
                            <div>
                              <div
                                className={`text-sm font-semibold ${
                                  issue.severity === "error"
                                    ? "text-red-800"
                                    : issue.severity === "warning"
                                      ? "text-yellow-800"
                                      : "text-blue-800"
                                }`}
                              >
                                {issue.title}
                              </div>
                              <div
                                className={`text-sm mt-0.5 ${
                                  issue.severity === "error"
                                    ? "text-red-700"
                                    : issue.severity === "warning"
                                      ? "text-yellow-700"
                                      : "text-blue-700"
                                }`}
                              >
                                {issue.description}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {insightsData.suggestions &&
                    insightsData.suggestions.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                          <svg
                            className="w-4 h-4 text-emerald-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                            />
                          </svg>
                          Suggestions ({insightsData.suggestions.length})
                        </h4>
                        <div className="space-y-2">
                          {insightsData.suggestions.map((suggestion, idx) => (
                            <div
                              key={idx}
                              className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex gap-3"
                            >
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 text-emerald-800 flex-shrink-0 h-5 mt-0.5 capitalize">
                                {suggestion.category}
                              </span>
                              <p className="text-sm text-gray-700">
                                {suggestion.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Gap-Fill Suggestions */}
                  {insightsData.gapFillSuggestions &&
                    insightsData.gapFillSuggestions.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                          <svg
                            className="w-4 h-4 text-blue-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                            />
                          </svg>
                          Gap-Fill Recommendations (
                          {insightsData.gapFillSuggestions.length})
                        </h4>
                        <p className="text-xs text-gray-500 mb-2">
                          These dates are understaffed. Suggested nurses have
                          capacity below their target hours.
                        </p>

                        {/* Select all / Apply controls */}
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={
                                selectedGapFills.size ===
                                insightsData.gapFillSuggestions.length
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedGapFills(
                                    new Set(
                                      insightsData.gapFillSuggestions!.map(
                                        (_, i) => i,
                                      ),
                                    ),
                                  );
                                } else {
                                  setSelectedGapFills(new Set());
                                }
                              }}
                              className="rounded border-gray-300"
                            />
                            Select All
                          </label>
                          {selectedGapFills.size > 0 && (
                            <button
                              onClick={applySelectedGapFills}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 transition-colors"
                            >
                              <svg
                                className="w-3.5 h-3.5"
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
                              Apply {selectedGapFills.size} to Calendar
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {insightsData.gapFillSuggestions.map((gf, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                                selectedGapFills.has(idx)
                                  ? "ring-2 ring-blue-400 bg-blue-50 border-blue-300"
                                  : gf.priority === "high"
                                    ? "bg-red-50 border-red-200"
                                    : "bg-amber-50 border-amber-200"
                              }`}
                              onClick={() => {
                                setSelectedGapFills((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={selectedGapFills.has(idx)}
                                    onChange={() => {
                                      setSelectedGapFills((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(idx)) next.delete(idx);
                                        else next.add(idx);
                                        return next;
                                      });
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="mt-1 rounded border-gray-300 flex-shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wide ${
                                          gf.priority === "high"
                                            ? "bg-red-200 text-red-800"
                                            : "bg-amber-200 text-amber-800"
                                        }`}
                                      >
                                        {gf.priority}
                                      </span>
                                      <span className="text-sm font-semibold text-gray-900">
                                        {new Date(
                                          gf.date + "T12:00:00",
                                        ).toLocaleDateString("en-US", {
                                          weekday: "short",
                                          month: "short",
                                          day: "numeric",
                                        })}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        ({gf.currentHeadcount} staff vs{" "}
                                        {gf.averageHeadcount} avg)
                                      </span>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2 text-sm">
                                      <span className="font-medium text-gray-800">
                                        {gf.nurse}
                                      </span>
                                      <span className="text-gray-400">→</span>
                                      <span
                                        className={`font-mono font-bold px-1.5 py-0.5 rounded text-xs ${
                                          gf.shiftType === "day"
                                            ? "bg-amber-100 text-amber-800 border border-amber-200"
                                            : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                        }`}
                                      >
                                        {gf.shiftCode}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {gf.shiftStart}–{gf.shiftEnd} (
                                        {gf.shiftHours}h)
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <div
                                    className={`text-sm font-bold ${
                                      gf.nurseDelta < -5
                                        ? "text-red-600"
                                        : "text-amber-600"
                                    }`}
                                  >
                                    {gf.nurseDelta > 0 ? "+" : ""}
                                    {gf.nurseDelta}h
                                  </div>
                                  <div className="text-[10px] text-gray-500">
                                    {gf.nurseCurrentHours}/{gf.nurseTargetHours}
                                    h
                                  </div>
                                  <div className="text-[10px] text-gray-400">
                                    {gf.nurseEmploymentType}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Refresh button */}
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={analyzeScheduleInsights}
                      className="px-4 py-2 text-sm text-emerald-600 border border-emerald-300 rounded-lg hover:bg-emerald-50 flex items-center gap-2 font-medium"
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
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Re-analyze
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions Results Modal */}
      {showSuggestionsModal && aiSuggestions && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
              <h3 className="text-xl font-bold text-gray-900">
                AI Refinement Results
              </h3>
            </div>

            <div className="p-6 space-y-4">
              {/* Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">Summary</h4>
                <p className="text-blue-800">
                  {aiSuggestions.summary || "No summary provided."}
                </p>
              </div>

              {/* Changes Applied Count */}
              <div
                className={`rounded-lg p-4 ${
                  changesAppliedCount > 0
                    ? "bg-green-50 border border-green-200"
                    : "bg-yellow-50 border border-yellow-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-2xl ${
                      changesAppliedCount > 0
                        ? "text-green-600"
                        : "text-yellow-600"
                    }`}
                  >
                    {changesAppliedCount > 0 ? "✓" : "⚠"}
                  </span>
                  <span
                    className={`font-semibold ${
                      changesAppliedCount > 0
                        ? "text-green-900"
                        : "text-yellow-900"
                    }`}
                  >
                    {changesAppliedCount} change
                    {changesAppliedCount !== 1 ? "s" : ""} applied to the
                    schedule
                  </span>
                </div>
              </div>

              {/* Suggested Changes List */}
              {aiSuggestions.changes && aiSuggestions.changes.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    Suggested Changes
                  </h4>
                  <div className="space-y-2">
                    {aiSuggestions.changes.map((change: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-white rounded p-3 border border-gray-200"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-blue-600 font-mono text-sm mt-0.5">
                            {idx + 1}.
                          </span>
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">
                              {change.nurse} - {change.date}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              Action:{" "}
                              <span className="font-medium">
                                {change.action}
                              </span>
                            </div>
                            {change.reason && (
                              <div className="text-sm text-gray-500 mt-1 italic">
                                {change.reason}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Debug Info */}
              {rawAiResponse && (
                <div className="bg-slate-50 border border-slate-300 rounded-lg">
                  <button
                    onClick={() => setShowDebugInfo(!showDebugInfo)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-100 transition-colors rounded-lg"
                  >
                    <span className="font-semibold text-slate-900 flex items-center gap-2">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                        />
                      </svg>
                      Debug: Raw AI Output
                    </span>
                    <svg
                      className={`w-5 h-5 transition-transform ${showDebugInfo ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {showDebugInfo && (
                    <div className="px-4 pb-4">
                      <pre className="text-xs font-mono bg-slate-900 text-green-400 p-4 rounded overflow-x-auto max-h-96 overflow-y-auto">
                        {rawAiResponse}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                onClick={() => {
                  setShowSuggestionsModal(false);
                  setAiSuggestions(null);
                  setRawAiResponse("");
                  setShowDebugInfo(false);
                }}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refine Modal */}
      {showRefineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-gray-900">
                  Refine Schedule with AI
                </h3>
                <ShiftCodesPopover
                  shiftCodes={SHIFT_CODES}
                  timeSlots={TIME_SLOTS.map((ts) => ({
                    slot: ts.slot,
                    category: ts.category,
                    duration: ts.duration,
                    label: ts.label,
                    mapsTo: ts.mapsTo,
                  }))}
                  label="Shift Codes"
                />
              </div>
              <button
                onClick={() => {
                  setShowRefineModal(false);
                  setRefineRequest("");
                }}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {/* Section 1: Refinement Request */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Refinement Request
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Describe what you'd like to improve. e.g. &quot;Ensure more
                  weekend coverage&quot; or &quot;Give Nurse Jane fewer night
                  shifts&quot;
                </p>
                <textarea
                  value={refineRequest}
                  onChange={(e) => setRefineRequest(e.target.value)}
                  placeholder="Enter your refinement request..."
                  className="w-full h-28 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Section 2: Scheduling Rules */}
              <details className="group border border-gray-200 rounded-lg">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                    <span className="text-sm font-semibold text-gray-700">
                      Scheduling Rules
                    </span>
                    {rules.trim() && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                        Active
                      </span>
                    )}
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div className="px-4 pb-4 pt-1 space-y-2">
                  <p className="text-xs text-gray-500">
                    These rules guide the AI optimizer. One rule per line. They
                    are saved to your organization for reuse.
                  </p>
                  <textarea
                    value={rules}
                    onChange={(e) => setRules(e.target.value)}
                    rows={5}
                    placeholder={
                      "1. No more than 5 consecutive working days\n2. Balance workload across all nurses\n3. Senior nurses get shift preference"
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono resize-y"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await saveScheduleRuleAPI({
                            name: "default",
                            rules_text: rules,
                          });
                        } catch {
                          /* silent */
                        }
                      }}
                      disabled={!rules.trim()}
                      className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
                    >
                      Save Rules
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const saved = await getLatestScheduleRuleAPI(
                            currentOrganization?.id,
                          );
                          if (saved?.rules_text) setRules(saved.rules_text);
                        } catch {
                          /* silent */
                        }
                      }}
                      className="text-xs px-3 py-1 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 font-medium"
                    >
                      Load Last Saved
                    </button>
                  </div>
                </div>
              </details>

              {/* Section 3: System Prompt (Advanced) */}
              <details className="group border border-gray-200 rounded-lg">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-purple-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <span className="text-sm font-semibold text-gray-700">
                      Advanced: System Prompt
                    </span>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div className="px-4 pb-4 pt-1">
                  <SystemPrompt />
                </div>
              </details>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRefineModal(false);
                  setRefineRequest("");
                }}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={refineScheduleWithAI}
                disabled={refining || !refineRequest.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {refining ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Refining...
                  </>
                ) : (
                  "Refine Schedule"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
