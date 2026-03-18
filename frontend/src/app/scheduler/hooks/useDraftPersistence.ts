"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateDraftScheduleAPI } from "../../lib/api";
import { Step, GridRow, ManualNurse, SHIFT_CODES } from "../types";
import { deduplicateGridGhosts } from "./utils";
import { useSchedulerStorage } from "./useSchedulerStorage";

type RequiredStaff = Record<string, Record<string, number>>;

interface DraftPersistenceState {
  currentStep: Step;
  startDate: string;
  endDate: string;
  rules: string;
  marker: string;
  ocrDates: string[];
  ocrGrid: GridRow[];
  autoComments: string;
  optimizedGrid: GridRow[];
  requiredStaff: RequiredStaff;
  savedScheduleId: string | null;
  isFinalized: boolean;
  manualNurses: ManualNurse[];
}

interface DraftPersistenceSetters {
  setCurrentStep: (value: Step) => void;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  setRules: (value: string) => void;
  setMarker: (value: string) => void;
  setOcrDates: (value: string[]) => void;
  setOcrGrid: (value: GridRow[]) => void;
  setAutoComments: (value: string) => void;
  setOptimizedGrid: (value: GridRow[]) => void;
  setRequiredStaff: (value: RequiredStaff) => void;
  setSavedScheduleId: (value: string | null) => void;
  setIsFinalized: (value: boolean) => void;
  setManualNurses: (value: ManualNurse[]) => void;
}

interface UseDraftPersistenceOptions {
  organizationId: string | null;
  searchParams: { get: (name: string) => string | null };
  getToken: () => Promise<string | null>;
  state: DraftPersistenceState;
  setters: DraftPersistenceSetters;
}

/**
 * Correct shift hours for all shifts in a grid based on the authoritative
 * SHIFT_CODES table.  Previously, a substring-matching bug in parseShiftCode
 * stored wrong hours (e.g. Z07 → 7.5h instead of 11.25h).  This function
 * re-validates stored hours so that cached / persisted grids display correctly.
 */
function correctGridShiftHours(grid: any[]): any[] {
  if (!Array.isArray(grid)) return grid;
  return grid.map((row: any) => {
    if (!row?.shifts || !Array.isArray(row.shifts)) return row;
    return {
      ...row,
      shifts: row.shifts.map((shift: any) => {
        if (!shift?.shift) return shift;
        const code = String(shift.shift)
          .replace(/\s*\*\s*$/, "")
          .trim()
          .toUpperCase();
        const def = SHIFT_CODES.find((s) => s.code.toUpperCase() === code);
        if (def && def.hours !== shift.hours) {
          return {
            ...shift,
            hours: def.hours,
            shiftType: def.type,
            startTime: def.start,
            endTime: def.end,
          };
        }
        return shift;
      }),
    };
  });
}

export function useDraftPersistence({
  organizationId,
  searchParams,
  getToken,
  state,
  setters,
}: UseDraftPersistenceOptions) {
  const {
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
  } = state;

  const [draftSaveStatus, setDraftSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);

  const isResettingRef = useRef(false);
  const isHydratingDraftRef = useRef(false);
  const settersRef = useRef(setters);
  const draftSaveStatusTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const lastLocalSignatureRef = useRef<string | null>(null);
  const lastRemoteSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    settersRef.current = setters;
  }, [setters]);

  const shouldRestoreLocalDraft =
    !!organizationId &&
    searchParams.get("new") !== "1" &&
    !searchParams.get("scheduleId") &&
    !searchParams.get("draft");

  const restoreLocalDraftState = useCallback((parsed: any) => {
    if (!parsed || typeof parsed !== "object") return;

    const currentSetters = settersRef.current;

    if (parsed.currentStep) currentSetters.setCurrentStep(parsed.currentStep);
    if (parsed.startDate) currentSetters.setStartDate(parsed.startDate);
    if (parsed.endDate) currentSetters.setEndDate(parsed.endDate);
    if (parsed.rules) currentSetters.setRules(parsed.rules);
    if (parsed.marker) currentSetters.setMarker(parsed.marker);
    if (Array.isArray(parsed.ocrDates))
      currentSetters.setOcrDates(parsed.ocrDates);
    if (Array.isArray(parsed.ocrGrid))
      currentSetters.setOcrGrid(
        deduplicateGridGhosts(correctGridShiftHours(parsed.ocrGrid)),
      );
    if (parsed.autoComments)
      currentSetters.setAutoComments(parsed.autoComments);
    if (Array.isArray(parsed.optimizedGrid)) {
      currentSetters.setOptimizedGrid(
        correctGridShiftHours(parsed.optimizedGrid),
      );
    }
    if (parsed.requiredStaff && typeof parsed.requiredStaff === "object") {
      currentSetters.setRequiredStaff(parsed.requiredStaff);
    }
    if (parsed.savedScheduleId)
      currentSetters.setSavedScheduleId(parsed.savedScheduleId);
    if (parsed.isFinalized) currentSetters.setIsFinalized(parsed.isFinalized);
    if (Array.isArray(parsed.manualNurses)) {
      currentSetters.setManualNurses(parsed.manualNurses);
    }
  }, []);

  const { saveState: saveLocalDraftState, clearState: clearLocalDraftState } =
    useSchedulerStorage({
      organizationId,
      onRestore: restoreLocalDraftState,
      enabled: shouldRestoreLocalDraft,
    });

  const draftPayload = useMemo(
    () => ({
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
      isFinalized,
      manualNurses,
    }),
    [
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
      isFinalized,
      manualNurses,
    ],
  );

  const localSignature = useMemo(
    () => JSON.stringify({ ...draftPayload, savedScheduleId }),
    [draftPayload, savedScheduleId],
  );

  const remoteSignature = useMemo(
    () => JSON.stringify({ ...draftPayload, savedScheduleId, organizationId }),
    [draftPayload, savedScheduleId, organizationId],
  );

  const markDraftSaved = useCallback(() => {
    setDraftSaveStatus("saved");
    setLastDraftSavedAt(new Date().toISOString());

    if (draftSaveStatusTimeoutRef.current) {
      clearTimeout(draftSaveStatusTimeoutRef.current);
    }

    draftSaveStatusTimeoutRef.current = setTimeout(() => {
      setDraftSaveStatus("idle");
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (draftSaveStatusTimeoutRef.current) {
        clearTimeout(draftSaveStatusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isResettingRef.current) return;
    if (!shouldRestoreLocalDraft) return;
    if (lastLocalSignatureRef.current === localSignature) return;

    const timeoutId = setTimeout(() => {
      if (!isResettingRef.current) {
        saveLocalDraftState({
          ...draftPayload,
          savedScheduleId,
        });
        lastLocalSignatureRef.current = localSignature;
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    shouldRestoreLocalDraft,
    saveLocalDraftState,
    draftPayload,
    savedScheduleId,
    localSignature,
  ]);

  useEffect(() => {
    if (!savedScheduleId || isFinalized) return;
    if (!organizationId) return;
    if (isResettingRef.current) return;
    if (isHydratingDraftRef.current) return;
    if (lastRemoteSignatureRef.current === remoteSignature) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setDraftSaveStatus("idle");
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setDraftSaveStatus("saving");
        const token = await getToken();
        const authHeaders =
          token && organizationId
            ? {
                Authorization: `Bearer ${token}`,
                "X-Organization-ID": organizationId,
              }
            : undefined;

        await updateDraftScheduleAPI(
          savedScheduleId,
          {
            name: `${startDate} - ${endDate}`,
            start_date: startDate,
            end_date: endDate,
            dateRange: { start: startDate, end: endDate },
            dates: ocrDates,
            draft_state: {
              ...draftPayload,
              savedAt: new Date().toISOString(),
            },
          },
          authHeaders,
        );
        lastRemoteSignatureRef.current = remoteSignature;
        markDraftSaved();
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : "";
        const isTimeoutOrAbort =
          message.includes("timed out") || message.includes("abort");

        if (isTimeoutOrAbort) {
          console.warn("Draft auto-save timed out; will retry on next change.");
          setDraftSaveStatus("idle");
        } else {
          console.error("Failed to auto-save draft state:", error);
          setDraftSaveStatus("error");
        }
      }
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [
    organizationId,
    getToken,
    markDraftSaved,
    savedScheduleId,
    draftPayload,
    remoteSignature,
    isFinalized,
    startDate,
    endDate,
    ocrDates,
  ]);

  return {
    clearLocalDraftState,
    draftSaveStatus,
    isHydratingDraftRef,
    isResettingRef,
    lastDraftSavedAt,
    markDraftSaved,
    setDraftSaveStatus,
    shouldRestoreLocalDraft,
  };
}
