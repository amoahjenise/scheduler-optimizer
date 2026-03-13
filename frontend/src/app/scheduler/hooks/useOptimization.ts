"use client";

import { useState, useCallback } from "react";
import { GridRow, ManualNurse, ShiftEntry } from "../types";
import {
  optimizeWithConstraintsAPI,
  previewConstraintsAPI,
} from "../../lib/api";
import {
  buildSchedulerAssignments,
  buildSchedulerComments,
  buildSchedulerNurses,
  NurseMetadataLookup,
} from "./optimizationPayload";

interface UseOptimizationOptions {
  ocrGrid: GridRow[];
  ocrDates: string[];
  manualNurses: ManualNurse[];
  autoComments: string;
  rules: string;
  savedScheduleId: string | null;
  nurseMetadataByName?: NurseMetadataLookup;
  getDefaultMaxWeeklyHours?: (employmentType?: "FT" | "PT") => number;
  fullTimeWeeklyTarget: number;
  partTimeWeeklyTarget: number;
  requiredStaff?: Record<string, Record<string, number>>;
  startDate?: string;
  endDate?: string;
  onOptimized?: (data: {
    grid: GridRow[];
    scheduleId?: string;
    assignments: Record<string, string[]>;
    rawResponse: any;
  }) => void;
}

/**
 * Custom hook for schedule optimization
 */
export function useOptimization({
  ocrGrid,
  ocrDates,
  manualNurses,
  autoComments,
  rules,
  savedScheduleId,
  nurseMetadataByName,
  getDefaultMaxWeeklyHours,
  fullTimeWeeklyTarget,
  partTimeWeeklyTarget,
  requiredStaff,
  startDate,
  endDate,
  onOptimized,
}: UseOptimizationOptions) {
  const [optimizing, setOptimizing] = useState(false);
  const [loadingConstraints, setLoadingConstraints] = useState(false);
  const [parsedConstraints, setParsedConstraints] = useState<any>(null);
  const [showConstraintsModal, setShowConstraintsModal] = useState(false);

  const resolveDefaultMaxWeeklyHours = useCallback(
    (employmentType?: "FT" | "PT") => {
      if (getDefaultMaxWeeklyHours) {
        return getDefaultMaxWeeklyHours(employmentType);
      }
      return employmentType === "PT" ? 40 : 60;
    },
    [getDefaultMaxWeeklyHours],
  );

  // Preview constraints before optimization
  const previewConstraints = useCallback(async () => {
    setLoadingConstraints(true);
    try {
      const nurses = buildSchedulerNurses({
        ocrGrid,
        manualNurses,
        autoComments,
        nurseMetadataByName,
        getDefaultMaxWeeklyHours: resolveDefaultMaxWeeklyHours,
        fullTimeWeeklyTarget,
        partTimeWeeklyTarget,
      });
      const assignments = buildSchedulerAssignments(ocrGrid);
      const comments = buildSchedulerComments(autoComments);

      const additionalRules = rules.trim();

      const collectPositiveValues = (matcher: (key: string) => boolean) => {
        const values: number[] = [];
        for (const [key, byDate] of Object.entries(requiredStaff || {})) {
          const normalized = key.toLowerCase();
          if (!matcher(normalized)) continue;
          for (const value of Object.values(byDate || {})) {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) values.push(numeric);
          }
        }
        return values;
      };

      const dayValues = collectPositiveValues(
        (key) =>
          key.includes("day") ||
          key.includes("morning") ||
          key.includes("afternoon") ||
          key.includes("evening"),
      );
      const nightValues = collectPositiveValues((key) => key.includes("night"));

      const minDayStaff = dayValues.length > 0 ? Math.min(...dayValues) : 5;
      const minNightStaff =
        nightValues.length > 0 ? Math.min(...nightValues) : 3;

      const payload = {
        schedule_id: savedScheduleId,
        nurses,
        dates: ocrDates,
        assignments,
        comments,
        rules: { text: additionalRules },
        notes: `STAFFING REQUIREMENTS: minDayStaff=${minDayStaff}, minNightStaff=${minNightStaff}`,
        staffRequirements: { minDayStaff, minNightStaff },
      };

      const data = await previewConstraintsAPI(payload);

      let nextConstraints = data.constraints;
      if (nextConstraints?.dateRange && (startDate || endDate)) {
        nextConstraints = {
          ...nextConstraints,
          dateRange: {
            ...nextConstraints.dateRange,
            start: startDate || nextConstraints.dateRange.start,
            end: endDate || nextConstraints.dateRange.end,
          },
        };
      }

      setParsedConstraints(nextConstraints);
      setShowConstraintsModal(true);
    } catch (err) {
      alert(
        "Failed to preview constraints: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setLoadingConstraints(false);
    }
  }, [
    ocrGrid,
    ocrDates,
    manualNurses,
    autoComments,
    rules,
    savedScheduleId,
    nurseMetadataByName,
    resolveDefaultMaxWeeklyHours,
    fullTimeWeeklyTarget,
    partTimeWeeklyTarget,
    requiredStaff,
    startDate,
    endDate,
  ]);

  // Optimize with confirmed constraints
  const optimizeWithConfirmedConstraints = useCallback(
    async (constraints: any) => {
      console.log("🚀 optimizeWithConfirmedConstraints() CALLED");

      setOptimizing(true);
      setShowConstraintsModal(false);

      try {
        const nurses = buildSchedulerNurses({
          ocrGrid,
          manualNurses,
          autoComments,
          nurseMetadataByName,
          getDefaultMaxWeeklyHours: resolveDefaultMaxWeeklyHours,
          fullTimeWeeklyTarget,
          partTimeWeeklyTarget,
        });
        const assignments = buildSchedulerAssignments(ocrGrid);

        const data = await optimizeWithConstraintsAPI({
          constraints,
          assignments,
          nurses,
          schedule_id: savedScheduleId || undefined,
        });

        if (data.optimized_schedule) {
          const newGrid: GridRow[] = Object.entries(
            data.optimized_schedule,
          ).map(([nurse, shifts], idx) => ({
            id: String(idx),
            nurse,
            shifts: shifts as ShiftEntry[],
          }));

          onOptimized?.({
            grid: newGrid,
            scheduleId: data.id,
            assignments,
            rawResponse: data,
          });
        }
      } catch (err) {
        alert(
          "Optimization failed: " +
            (err instanceof Error ? err.message : "Unknown error"),
        );
      } finally {
        setOptimizing(false);
      }
    },
    [
      ocrGrid,
      manualNurses,
      autoComments,
      savedScheduleId,
      nurseMetadataByName,
      resolveDefaultMaxWeeklyHours,
      fullTimeWeeklyTarget,
      partTimeWeeklyTarget,
      onOptimized,
    ],
  );

  // Simple math-based optimization (constraint satisfaction)
  const optimizeWithMath = useCallback((): GridRow[] => {
    const result: GridRow[] = [];

    for (const row of ocrGrid) {
      const optimizedShifts: ShiftEntry[] = [];
      let consecutiveDays = 0;

      for (const shift of row.shifts) {
        if (shift.shift && shift.shift.trim() !== "" && shift.shift !== "OFF") {
          if (consecutiveDays >= 5) {
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
  }, [ocrGrid]);

  return {
    optimizing,
    loadingConstraints,
    parsedConstraints,
    setParsedConstraints,
    showConstraintsModal,
    setShowConstraintsModal,
    previewConstraints,
    optimizeWithConfirmedConstraints,
    optimizeWithMath,
  };
}
