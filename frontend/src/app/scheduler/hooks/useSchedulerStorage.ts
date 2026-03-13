"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface SchedulerPersistentState {
  currentStep: string;
  startDate: string;
  endDate: string;
  rules: string;
  marker: string;
  ocrDates: string[];
  ocrGrid: any[];
  autoComments: string;
  optimizedGrid: any[];
  requiredStaff: Record<string, Record<string, number>>;
  savedScheduleId: string | null;
  isFinalized: boolean;
  manualNurses: any[];
  savedAt?: string;
}

interface UseSchedulerStorageOptions {
  organizationId: string | null;
  onRestore?: (state: SchedulerPersistentState) => void;
  enabled?: boolean;
}

/**
 * Custom hook for managing scheduler localStorage persistence
 */
export function useSchedulerStorage({
  organizationId,
  onRestore,
  enabled = true,
}: UseSchedulerStorageOptions) {
  const isResettingRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  // Auto-save key for localStorage (org-scoped)
  const STORAGE_KEY = organizationId
    ? `scheduler_draft_${organizationId}`
    : "scheduler_draft_state";

  // Load saved state from localStorage on mount or org change
  useEffect(() => {
    if (!enabled) {
      setIsRestored(false);
      return;
    }

    // Don't load until we have the org context
    if (!organizationId) return;

    try {
      const savedState = localStorage.getItem(STORAGE_KEY);
      if (savedState && onRestoreRef.current) {
        const parsed = JSON.parse(savedState) as SchedulerPersistentState;
        console.log("Restoring scheduler state from localStorage...");
        onRestoreRef.current(parsed);
        console.log("Scheduler state restored successfully");
      }
      setIsRestored(true);
    } catch (error) {
      console.error("Error loading saved scheduler state:", error);
      setIsRestored(true);
    }
  }, [STORAGE_KEY, organizationId, enabled]);

  // Save state to localStorage
  const saveState = useCallback(
    (state: Partial<SchedulerPersistentState>) => {
      // Skip saving if we're in the middle of a reset
      if (isResettingRef.current) return;

      try {
        const stateToSave = {
          ...state,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.error("Error saving scheduler state:", error);
      }
    },
    [STORAGE_KEY],
  );

  // Clear saved state
  const clearState = useCallback(() => {
    // Set flag to prevent auto-save during reset
    isResettingRef.current = true;

    // Remove from localStorage
    localStorage.removeItem(STORAGE_KEY);

    // Re-enable auto-save after reset is complete
    setTimeout(() => {
      isResettingRef.current = false;
      // Clear localStorage one more time to be safe
      localStorage.removeItem(STORAGE_KEY);
    }, 700);

    console.log("Scheduler saved state cleared");
  }, [STORAGE_KEY]);

  return {
    saveState,
    clearState,
    isResetting: isResettingRef,
    isRestored,
    storageKey: STORAGE_KEY,
  };
}
