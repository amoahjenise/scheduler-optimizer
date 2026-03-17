"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createDraftScheduleAPI,
  deleteScheduleAPI,
  fetchOptimizedScheduleByIdAPI,
} from "../../lib/api";
import { GridRow, ManualNurse, ShiftEntry, Step, SHIFT_CODES } from "../types";
import { getDefaultDates } from "./utils";

type RequiredStaff = Record<string, Record<string, number>>;

interface DraftLifecycleState {
  savedScheduleId: string | null;
  isFinalized: boolean;
}

interface DraftLifecycleHydratedState {
  currentStep: Step;
  startDate: string;
  endDate: string;
  rules: string;
  marker: string;
  autoComments: string;
  ocrDates: string[];
  ocrGrid: GridRow[];
  optimizedGrid: GridRow[];
  requiredStaff: RequiredStaff;
  manualNurses: ManualNurse[];
  savedScheduleId: string | null;
  isFinalized: boolean;
}

interface UseDraftRouteLifecycleOptions {
  organizationId: string | null;
  getToken: () => Promise<string | null>;
  searchParams: { get: (name: string) => string | null };
  state: DraftLifecycleState;
  isCreatingNewDraftRef: React.MutableRefObject<boolean>;
  isHydratingDraftRef: React.MutableRefObject<boolean>;
  isResettingRef: React.MutableRefObject<boolean>;
  clearLocalDraftState: () => void;
  markDraftSaved: () => void;
  applyHydratedState: (state: DraftLifecycleHydratedState) => void;
  resetLocalState: () => void;
}

const VALID_STEPS: Step[] = ["setup", "upload", "review", "optimize", "result"];

function normalizeShiftEntry(
  shift: Partial<ShiftEntry>,
  date: string,
): ShiftEntry {
  const shiftCode = String(shift.shift || "")
    .replace(/\s*\*\s*$/, "")
    .trim();
  const normalizedType = shift.shiftType === "night" ? "night" : "day";

  // Re-validate hours against SHIFT_CODES to correct any previously stored
  // wrong values (e.g. Z07 stored as 7.5h instead of 11.25h due to a
  // substring-matching bug in parseShiftCode).
  let hours = Number(shift.hours || 0);
  let startTime = String(shift.startTime || "");
  let endTime = String(shift.endTime || "");
  let shiftType = normalizedType;

  if (shiftCode) {
    const codeUpper = shiftCode.toUpperCase();
    const exactDef = SHIFT_CODES.find(
      (s) => s.code.toUpperCase() === codeUpper,
    );
    if (exactDef) {
      hours = exactDef.hours;
      startTime = exactDef.start;
      endTime = exactDef.end;
      shiftType = exactDef.type;
    }
  }

  return {
    date,
    shift: String(shift.shift || ""),
    shiftType: shiftType,
    hours,
    startTime,
    endTime,
  };
}

function normalizeGridRow(
  row: Record<string, any>,
  index: number,
): GridRow | null {
  const nurse = typeof row?.nurse === "string" ? row.nurse : row?.name;
  if (!nurse || typeof nurse !== "string") return null;

  const shifts = Array.isArray(row?.shifts)
    ? row.shifts
        .map((shift: Record<string, any>, shiftIndex: number) => {
          const date =
            typeof shift?.date === "string"
              ? shift.date
              : `${index}-${shiftIndex}`;
          return normalizeShiftEntry(shift, date);
        })
        .filter(Boolean)
    : [];

  return {
    id:
      typeof row?.id === "string" && row.id.trim().length > 0
        ? row.id
        : `loaded-${index}`,
    nurse,
    employeeId:
      typeof row?.employeeId === "string"
        ? row.employeeId
        : typeof row?.employee_id === "string"
          ? row.employee_id
          : undefined,
    seniority: typeof row?.seniority === "string" ? row.seniority : undefined,
    shifts,
  };
}

function parseSchedulePayload(schedule: any): DraftLifecycleHydratedState {
  const rawData =
    typeof schedule?.schedule_data === "string"
      ? JSON.parse(schedule.schedule_data)
      : schedule?.schedule_data || {};

  const rows = Array.isArray(rawData?.schedule)
    ? rawData.schedule
    : Array.isArray(rawData?.grid)
      ? rawData.grid
      : [];
  const normalizedGrid = rows
    .map((row: Record<string, any>, index: number) =>
      normalizeGridRow(row, index),
    )
    .filter(Boolean) as GridRow[];

  let dates = Array.isArray(rawData?.dates)
    ? rawData.dates.filter(
        (date: unknown): date is string => typeof date === "string",
      )
    : [];

  if (!dates.length) {
    const uniqueDates = new Set<string>();
    normalizedGrid.forEach((row) => {
      row.shifts.forEach((shift) => {
        if (shift?.date) uniqueDates.add(shift.date);
      });
    });
    dates = Array.from(uniqueDates).sort();
  }

  const { today, twoWeeksLater } = getDefaultDates();
  const draftState =
    rawData && typeof rawData.draft_state === "object" && rawData.draft_state
      ? (rawData.draft_state as Record<string, any>)
      : null;

  const start =
    schedule?.start_date ||
    rawData?.start_date ||
    rawData?.dateRange?.start ||
    (dates.length ? dates[0] : today);
  const end =
    schedule?.end_date ||
    rawData?.end_date ||
    rawData?.dateRange?.end ||
    (dates.length ? dates[dates.length - 1] : twoWeeksLater);

  const resolvedOcrDates =
    draftState && Array.isArray(draftState.ocrDates)
      ? draftState.ocrDates
      : dates;
  const resolvedOcrGrid =
    draftState && Array.isArray(draftState.ocrGrid)
      ? (draftState.ocrGrid as GridRow[])
      : normalizedGrid;
  const resolvedOptimizedGrid =
    draftState && Array.isArray(draftState.optimizedGrid)
      ? (draftState.optimizedGrid as GridRow[])
      : normalizedGrid;

  const stepFromDraft = draftState?.currentStep;
  const hasReviewData =
    resolvedOcrGrid.length > 0 || resolvedOcrDates.length > 0;
  const hasResultData = resolvedOptimizedGrid.length > 0;
  const resolvedStep: Step =
    !hasReviewData && !hasResultData
      ? "setup"
      : VALID_STEPS.includes(stepFromDraft)
        ? stepFromDraft
        : resolvedOptimizedGrid.length > 0
          ? "result"
          : resolvedOcrGrid.length > 0
            ? "review"
            : "setup";

  return {
    currentStep: resolvedStep,
    startDate: draftState?.startDate || start,
    endDate: draftState?.endDate || end,
    rules: draftState?.rules || "",
    marker: draftState?.marker || "",
    autoComments: draftState?.autoComments || "",
    ocrDates: resolvedOcrDates,
    ocrGrid: resolvedOcrGrid,
    optimizedGrid: resolvedOptimizedGrid,
    requiredStaff:
      draftState?.requiredStaff && typeof draftState.requiredStaff === "object"
        ? (draftState.requiredStaff as RequiredStaff)
        : {},
    manualNurses: Array.isArray(draftState?.manualNurses)
      ? (draftState.manualNurses as ManualNurse[])
      : [],
    savedScheduleId: schedule?.id || null,
    isFinalized: !!schedule?.is_finalized || !!draftState?.isFinalized,
  };
}

export function useDraftRouteLifecycle({
  organizationId,
  getToken,
  searchParams,
  state,
  isCreatingNewDraftRef,
  isHydratingDraftRef,
  isResettingRef,
  clearLocalDraftState,
  markDraftSaved,
  applyHydratedState,
  resetLocalState,
}: UseDraftRouteLifecycleOptions) {
  const hasInitializedNewDraftRef = useRef(false);
  const loadedScheduleIdRef = useRef<string | null>(null);

  const isNewDraftRoute = searchParams.get("new") === "1";
  // Support both ?scheduleId= and ?draft= for loading existing schedules
  const scheduleIdFromRoute =
    searchParams.get("scheduleId") || searchParams.get("draft");

  useEffect(() => {
    if (!isNewDraftRoute) {
      hasInitializedNewDraftRef.current = false;
    }
  }, [isNewDraftRoute]);

  useEffect(() => {
    if (!scheduleIdFromRoute) {
      loadedScheduleIdRef.current = null;
    }
  }, [scheduleIdFromRoute]);

  /**
   * Clear local state only — the backend draft is preserved.
   * Use this when the user navigates away ("Start New", clear cache, etc.).
   */
  const resetSchedulerState = useCallback(async () => {
    isResettingRef.current = true;

    clearLocalDraftState();
    resetLocalState();

    setTimeout(() => {
      isResettingRef.current = false;
    }, 0);
  }, [clearLocalDraftState, isResettingRef, resetLocalState]);

  /**
   * Explicitly delete the backend draft AND clear local state.
   * Use this only when the user intentionally discards / deletes a draft.
   */
  const deleteDraftAndReset = useCallback(async () => {
    isResettingRef.current = true;
    const draftIdToDelete = state.savedScheduleId || scheduleIdFromRoute;

    clearLocalDraftState();
    resetLocalState();

    if (draftIdToDelete && !state.isFinalized) {
      try {
        const token = await getToken();
        const authHeaders = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;
        await deleteScheduleAPI(draftIdToDelete, authHeaders);
      } catch (error) {
        console.error("Failed to delete draft:", error);
      }
    }

    setTimeout(() => {
      isResettingRef.current = false;
    }, 0);
  }, [
    clearLocalDraftState,
    getToken,
    isResettingRef,
    resetLocalState,
    scheduleIdFromRoute,
    state.isFinalized,
    state.savedScheduleId,
  ]);

  useEffect(() => {
    async function createNewDraft() {
      if (!organizationId) return;
      if (!isNewDraftRoute) return;
      if (isCreatingNewDraftRef.current) return;
      if (hasInitializedNewDraftRef.current) return;

      hasInitializedNewDraftRef.current = true;
      isCreatingNewDraftRef.current = true;
      isResettingRef.current = true;

      try {
        clearLocalDraftState();
        resetLocalState();

        const { today, twoWeeksLater } = getDefaultDates();
        const token = await getToken();
        const authHeaders = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;

        const result = await createDraftScheduleAPI(
          {
            name: `${today} - ${twoWeeksLater}`,
            start_date: today,
            end_date: twoWeeksLater,
            dateRange: { start: today, end: twoWeeksLater },
            dates: [],
            draft_state: {
              currentStep: "setup",
              startDate: today,
              endDate: twoWeeksLater,
              rules: "",
              marker: "",
              ocrDates: [],
              ocrGrid: [],
              autoComments: "",
              optimizedGrid: [],
              requiredStaff: {},
              isFinalized: false,
              manualNurses: [],
              savedAt: new Date().toISOString(),
            },
          },
          authHeaders,
        );

        applyHydratedState({
          currentStep: "setup",
          startDate: today,
          endDate: twoWeeksLater,
          rules: "",
          marker: "",
          autoComments: "",
          ocrDates: [],
          ocrGrid: [],
          optimizedGrid: [],
          requiredStaff: {},
          manualNurses: [],
          savedScheduleId: result?.id || null,
          isFinalized: false,
        });
        markDraftSaved();
      } catch (error) {
        console.error("Failed to create new draft:", error);
        hasInitializedNewDraftRef.current = false;
      } finally {
        isCreatingNewDraftRef.current = false;
        setTimeout(() => {
          isResettingRef.current = false;
        }, 0);
      }
    }

    createNewDraft();
  }, [
    organizationId,
    isNewDraftRoute,
    getToken,
    clearLocalDraftState,
    resetLocalState,
    applyHydratedState,
    isCreatingNewDraftRef,
    isResettingRef,
    markDraftSaved,
  ]);

  useEffect(() => {
    async function loadScheduleForEditing() {
      if (!organizationId || !scheduleIdFromRoute) return;
      if (isNewDraftRoute) return;
      if (isHydratingDraftRef.current) return;
      if (loadedScheduleIdRef.current === scheduleIdFromRoute) return;

      loadedScheduleIdRef.current = scheduleIdFromRoute;
      isHydratingDraftRef.current = true;
      isResettingRef.current = true;

      try {
        clearLocalDraftState();
        const schedule =
          await fetchOptimizedScheduleByIdAPI(scheduleIdFromRoute);
        const hydratedState = parseSchedulePayload(schedule);
        applyHydratedState(hydratedState);
      } catch (error) {
        console.error("Failed to load schedule for editing:", error);
        loadedScheduleIdRef.current = null;
      } finally {
        setTimeout(() => {
          isHydratingDraftRef.current = false;
          isResettingRef.current = false;
        }, 0);
      }
    }

    loadScheduleForEditing();
  }, [
    organizationId,
    scheduleIdFromRoute,
    isNewDraftRoute,
    clearLocalDraftState,
    applyHydratedState,
    isHydratingDraftRef,
    isResettingRef,
  ]);

  return {
    resetSchedulerState,
    deleteDraftAndReset,
  };
}
