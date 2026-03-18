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
  fullTimeBiWeeklyTarget: number;
  partTimeBiWeeklyTarget: number;
  requiredStaff?: Record<string, Record<string, number>>;
  startDate?: string;
  endDate?: string;
  getAuthHeaders?: () => Promise<Record<string, string>>;
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
  fullTimeBiWeeklyTarget,
  partTimeBiWeeklyTarget,
  requiredStaff,
  startDate,
  endDate,
  getAuthHeaders,
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

  const buildFallbackConstraints = useCallback(
    (
      nurses: ReturnType<typeof buildSchedulerNurses>,
      minDay: number,
      minNight: number,
    ) => {
      const inferredStart =
        startDate || ocrDates[0] || new Date().toISOString().slice(0, 10);
      const inferredEnd =
        endDate || ocrDates[ocrDates.length - 1] || inferredStart;

      return {
        dateRange: {
          start: inferredStart,
          end: inferredEnd,
        },
        shiftRequirements: {
          dayShift: {
            count: minDay,
            minChemoCertified: 1,
            shiftCodes: ["Z07", "07", "Z11", "11", "E15"],
          },
          nightShift: {
            count: minNight,
            minChemoCertified: 0,
            shiftCodes: ["Z19", "Z23", "Z23 B", "23"],
          },
        },
        shiftsInfo: {
          Z07: { type: "day", hours: 11.25 },
          "07": { type: "day", hours: 7.5 },
          Z11: { type: "day", hours: 11.25 },
          "11": { type: "day", hours: 7.5 },
          E15: { type: "day", hours: 7.5 },
          Z19: { type: "night", hours: 11.25 },
          Z23: { type: "night", hours: 11.25 },
          "Z23 B": { type: "night", hours: 11.25 },
          "23": { type: "night", hours: 7.5 },
        },
        nurses,
        constraints: {
          // Use 3 consecutive work days as the default policy (not 5).
          maxConsecutiveWorkDays: 3,
          maxConsecutiveNightShifts: 3,
          alternateWeekendsOff: true,
          respectOffRequests: true,
          respectCurrentAssignments: true,
          // NOTE: We do NOT provide a global `maxHoursPerWeek` here. Hour
          // limits are nurse-specific and represented as bi-weekly targets
          // (`targetWeeklyHours`/bi-weekly targets) in the nurse objects.
          shiftCoherencyRules: true,
          workPatternRules: true,
          seniorityRules: true,
        },
      };
    },
    [endDate, ocrDates, startDate],
  );

  // Preview constraints before optimization
  const previewConstraints = useCallback(async () => {
    if (loadingConstraints || optimizing) {
      return;
    }

    setLoadingConstraints(true);
    try {
      const nurses = buildSchedulerNurses({
        ocrGrid,
        manualNurses,
        autoComments,
        nurseMetadataByName,
        getDefaultMaxWeeklyHours: resolveDefaultMaxWeeklyHours,
        fullTimeBiWeeklyTarget,
        partTimeBiWeeklyTarget,
      });
      const assignments = buildSchedulerAssignments(ocrGrid);
      const comments = buildSchedulerComments(autoComments);

      // Extract staffing requirement values from the requiredStaff matrix.
      // Keys are staffing categories like "07(G)", "15(G)", "19(G)", "23(G)".
      // Map them to day/night by extracting the start-hour prefix:
      //   07, 11, 15 → day shifts;  19, 23 → night shifts.
      const collectPositiveValues = (matcher: (key: string) => boolean) => {
        const values: number[] = [];
        for (const [key, byDate] of Object.entries(requiredStaff || {})) {
          if (!matcher(key)) continue;
          for (const value of Object.values(byDate || {})) {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) values.push(numeric);
          }
        }
        return values;
      };

      // Match staffing categories by their start-hour prefix
      const isDayCategory = (key: string) => {
        const hourMatch = key.match(/^(\d{2})/);
        if (hourMatch) {
          const hour = parseInt(hourMatch[1], 10);
          return hour >= 7 && hour < 19; // 07, 11, 15 are day
        }
        const lower = key.toLowerCase();
        return (
          lower.includes("day") ||
          lower.includes("morning") ||
          lower.includes("afternoon") ||
          lower.includes("evening")
        );
      };
      const isNightCategory = (key: string) => {
        const hourMatch = key.match(/^(\d{2})/);
        if (hourMatch) {
          const hour = parseInt(hourMatch[1], 10);
          return hour >= 19 || hour < 7; // 19, 23 are night
        }
        return key.toLowerCase().includes("night");
      };

      const dayValues = collectPositiveValues(isDayCategory);
      const nightValues = collectPositiveValues(isNightCategory);

      const minDayStaff = dayValues.length > 0 ? Math.min(...dayValues) : 5;
      const minNightStaff =
        nightValues.length > 0 ? Math.min(...nightValues) : 4;

      const additionalRules = rules.trim();

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
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("timed out")) {
        console.warn(
          "Preview constraints timed out; using local fallback constraints.",
        );
      } else {
        console.warn(
          "Preview constraints failed; using local fallback constraints:",
          err,
        );
      }

      const fallbackNurses = buildSchedulerNurses({
        ocrGrid,
        manualNurses,
        autoComments,
        nurseMetadataByName,
        getDefaultMaxWeeklyHours: resolveDefaultMaxWeeklyHours,
        fullTimeBiWeeklyTarget,
        partTimeBiWeeklyTarget,
      });
      const fallbackConstraints = buildFallbackConstraints(
        fallbackNurses,
        5,
        4,
      );
      setParsedConstraints(fallbackConstraints);
      setShowConstraintsModal(true);
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
    fullTimeBiWeeklyTarget,
    partTimeBiWeeklyTarget,
    requiredStaff,
    startDate,
    endDate,
    buildFallbackConstraints,
    loadingConstraints,
    optimizing,
  ]);

  // Optimize with confirmed constraints
  const optimizeWithConfirmedConstraints = useCallback(
    async (constraints: any) => {
      console.log("🚀 optimizeWithConfirmedConstraints() CALLED");
      console.log("  ocrGrid length:", ocrGrid.length);
      console.log("  manualNurses length:", manualNurses.length);

      if (ocrGrid.length === 0 && manualNurses.length === 0) {
        alert(
          "Cannot optimize: No nurses found in the schedule. Please add nurses to your grid or manual list first.",
        );
        // Still close modal and show result step with empty grid
        setShowConstraintsModal(false);
        onOptimized?.({
          grid: [],
          scheduleId: savedScheduleId || undefined,
          assignments: {},
          rawResponse: { error: "No nurses available for optimization" },
        });
        return;
      }

      setOptimizing(true);
      setShowConstraintsModal(false);

      try {
        const nurses = buildSchedulerNurses({
          ocrGrid,
          manualNurses,
          autoComments,
          nurseMetadataByName,
          getDefaultMaxWeeklyHours: resolveDefaultMaxWeeklyHours,
          fullTimeBiWeeklyTarget,
          partTimeBiWeeklyTarget,
        });
        const assignments = buildSchedulerAssignments(ocrGrid);

        // Debug logging for optimization payload
        console.log("[OPTIMIZATION DEBUG] ocrGrid rows:", ocrGrid.length);
        console.log("[OPTIMIZATION DEBUG] nurses array:", nurses.length);
        console.log(
          "[OPTIMIZATION DEBUG] assignments keys:",
          Object.keys(assignments).length,
        );
        if (nurses.length !== Object.keys(assignments).length) {
          console.warn(
            "[OPTIMIZATION DEBUG] MISMATCH! Nurses and assignments have different counts",
          );
          console.log(
            "[OPTIMIZATION DEBUG] Nurse names:",
            nurses.map((n) => n.name),
          );
          console.log(
            "[OPTIMIZATION DEBUG] Assignment keys:",
            Object.keys(assignments),
          );
        }

        // Guard against long-hanging backend calls in dev/local environments.
        // Use a sentinel object for timeouts instead of rejecting so the
        // timeout doesn't produce an uncaught rejection stack trace in the
        // console. We handle the sentinel below and fall back gracefully.
        // Ensure the backend-required `maxHoursPerWeek` constraint is present.
        // Prefer a value derived from nurse max hours, otherwise fall back
        // to a conservative default so the server-side validator is satisfied.
        const constraintsWithHours = {
          ...(constraints || {}),
        };
        if (!constraintsWithHours.constraints)
          constraintsWithHours.constraints = {};
        // Do NOT derive `maxHoursPerWeek` from the ambiguous `maxWeeklyHours`.
        // Instead prefer nurse `targetWeeklyHours` which here represents
        // bi-weekly targets. If no bi-weekly targets exist, omit the global
        // constraint entirely so we don't send misleading values to the API.
        const derivedFromTargets = Math.max(
          0,
          ...(nurses.map((n: any) => Number(n.targetWeeklyHours || 0)) || []),
        );
        if (derivedFromTargets > 0) {
          constraintsWithHours.constraints.maxHoursPerWeek = derivedFromTargets;
        } else {
          // Ensure we don't accidentally send a stale/incorrect global cap.
          delete constraintsWithHours.constraints.maxHoursPerWeek;
        }

        const guardedData = await Promise.race([
          optimizeWithConstraintsAPI(
            {
              constraints: constraintsWithHours,
              assignments,
              nurses,
              schedule_id: savedScheduleId || undefined,
            },
            getAuthHeaders ? await getAuthHeaders() : undefined,
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve({ __timed_out: true }), 45000),
          ),
        ]);

        // If the request timed out, perform a local fallback and return.
        if (guardedData && (guardedData as any).__timed_out) {
          console.warn(
            "Optimization request exceeded 45 seconds; using fallback grid.",
          );
          const fallbackGrid: GridRow[] = ocrGrid.map((row) => ({
            id: row.id,
            nurse: row.nurse,
            shifts: row.shifts,
          }));
          onOptimized?.({
            grid: fallbackGrid,
            scheduleId: savedScheduleId || undefined,
            assignments: buildSchedulerAssignments(ocrGrid),
            rawResponse: { timeout: true },
          });
          setOptimizing(false);
          return;
        }

        const optimizedSchedule =
          guardedData?.optimized_schedule ??
          guardedData?.result ??
          guardedData?.schedule;

        if (optimizedSchedule) {
          const newGrid: GridRow[] = Object.entries(optimizedSchedule).map(
            ([nurse, shifts], idx) => ({
              id: String(idx),
              nurse,
              shifts: shifts as ShiftEntry[],
            }),
          );

          onOptimized?.({
            grid: newGrid,
            scheduleId: guardedData.id,
            assignments,
            rawResponse: guardedData,
          });
        } else {
          console.error(
            "Optimization response missing schedule payload:",
            guardedData,
          );
          throw new Error(
            "Optimization completed but no optimized schedule was returned by the server.",
          );
        }
      } catch (err) {
        console.error("Optimization failed, using local fallback:", err);
        const fallbackGrid: GridRow[] = ocrGrid.map((row) => ({
          id: row.id,
          nurse: row.nurse,
          shifts: row.shifts,
        }));
        onOptimized?.({
          grid: fallbackGrid,
          scheduleId: savedScheduleId || undefined,
          assignments: buildSchedulerAssignments(ocrGrid),
          rawResponse: { fallback: true, error: err },
        });
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
      fullTimeBiWeeklyTarget,
      partTimeBiWeeklyTarget,
      getAuthHeaders,
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
