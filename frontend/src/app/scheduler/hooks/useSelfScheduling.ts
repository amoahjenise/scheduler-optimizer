/**
 * useSelfScheduling - Hook for the Preferred-First Self-Scheduling System
 *
 * This hook provides functionality for:
 * 1. Collecting nurse preference submissions
 * 2. Running the 3-stage optimization algorithm
 * 3. Displaying preference fulfillment results with reason codes
 */

import { useState, useCallback } from "react";
import {
  NurseScheduleSubmission,
  NurseOptimizationResult,
  OptimizationConfig,
  PreferenceResult,
  ShiftEntry,
  GridRow,
} from "../types";

// ============================================================================
// TYPES
// ============================================================================

interface SelfScheduleRequest {
  submissions: Array<{
    nurse_id: string;
    nurse_name: string;
    seniority: number;
    employment_type: string;
    fte_target_hours: number;
    preferences: Array<{
      date: string;
      shift_code: string;
      rank: number;
      is_off_request: boolean;
      off_code: string;
      comment: string;
    }>;
    rotation_preference: string;
    shift_type_choice: string;
    is_permanent_night: boolean;
    max_weekly_hours: number;
    certifications: string[];
  }>;
  dates: string[];
  staffing_requirements: Record<string, { day: number; night: number }>;
  config?: {
    pay_period_days: number;
    ft_biweekly_target: number;
    pt_biweekly_target: number;
    min_rest_hours: number;
    max_consecutive_12h: number;
    max_consecutive_any: number;
    day_shift_min_percentage: number;
    weekend_max_ratio: number;
    balance_window_days: number;
    use_seniority_for_conflicts: boolean;
    allow_overtime: boolean;
    overtime_cap_hours: number;
  };
}

interface SelfScheduleResponse {
  schedule_id: string;
  results: Record<
    string,
    {
      nurse_id: string;
      nurse_name: string;
      assigned_shifts: ShiftEntry[];
      preference_results: Array<{
        date: string;
        shift_code: string;
        status: string;
        assigned: boolean;
        reason_detail: string;
        conflicting_nurse: string;
      }>;
      total_hours: number;
      target_hours: number;
      target_delta: number;
      day_shift_percentage: number;
      weekend_shifts: number;
      stats: {
        preferences_submitted: number;
        preferences_honored: number;
        conflicts_lost: number;
        day_shifts: number;
        night_shifts: number;
      };
    }
  >;
  summary: {
    total_nurses: number;
    total_preferences_submitted: number;
    total_preferences_honored: number;
    preference_fulfillment_rate: number;
    total_conflicts_resolved: number;
    date_range: { start: string; end: string };
  };
  grid: Array<{ nurse: string; shifts: ShiftEntry[] }>;
}

export interface SelfSchedulingState {
  isOptimizing: boolean;
  error: string | null;
  results: Record<string, NurseOptimizationResult> | null;
  summary: SelfScheduleResponse["summary"] | null;
  grid: GridRow[] | null;
  scheduleId: string | null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert legacy nurse data + OCR preferences to submission format
 */
function convertLegacyToSubmission(
  nurse: {
    name: string;
    employmentType?: string;
    seniority?: string | number;
    maxWeeklyHours?: number;
    offRequests?: string[];
    isChemoCertified?: boolean;
    isTransplantCertified?: boolean;
    isRenalCertified?: boolean;
    isChargeCertified?: boolean;
  },
  ocrShifts: string[],
  dates: string[],
): SelfScheduleRequest["submissions"][0] {
  // Parse seniority from various formats
  const parseSeniority = (val: string | number | undefined): number => {
    if (typeof val === "number") return val;
    if (!val) return 0;
    const matches = String(val).match(/\d+(?:\.\d+)?/g);
    return matches ? parseFloat(matches[matches.length - 1]) : 0;
  };

  // Build preferences from OCR shifts
  const preferences: SelfScheduleRequest["submissions"][0]["preferences"] = [];

  ocrShifts.forEach((shiftCode, idx) => {
    if (!shiftCode || !shiftCode.trim() || idx >= dates.length) return;

    const code = shiftCode.trim().toUpperCase();
    const isOff =
      code === "C" ||
      code === "OFF" ||
      code === "*" ||
      code.startsWith("CF") ||
      code === "VAC" ||
      code === "STAT";

    preferences.push({
      date: dates[idx],
      shift_code: shiftCode,
      rank: 1, // OCR shifts are all equally preferred
      is_off_request: isOff,
      off_code: isOff ? shiftCode : "",
      comment: "",
    });
  });

  // Add explicit off requests
  (nurse.offRequests || []).forEach((date) => {
    if (!preferences.some((p) => p.date === date)) {
      preferences.push({
        date,
        shift_code: "OFF",
        rank: 1,
        is_off_request: true,
        off_code: "OFF",
        comment: "Off request",
      });
    }
  });

  // Build certifications
  const certs: string[] = [];
  if (nurse.isChemoCertified) certs.push("chemo");
  if (nurse.isTransplantCertified) certs.push("transplant");
  if (nurse.isRenalCertified) certs.push("renal");
  if (nurse.isChargeCertified) certs.push("charge");

  // Determine FTE target
  const empType = nurse.employmentType || "FT";
  const fteTarget = empType === "PT" ? 63.75 : 75.0;

  return {
    nurse_id: nurse.name, // Use name as ID if no explicit ID
    nurse_name: nurse.name,
    seniority: parseSeniority(nurse.seniority),
    employment_type: empType,
    fte_target_hours: fteTarget,
    preferences,
    rotation_preference: "none",
    shift_type_choice: "mixed",
    is_permanent_night: false,
    max_weekly_hours: nurse.maxWeeklyHours || 40,
    certifications: certs,
  };
}

// ============================================================================
// HOOK
// ============================================================================

export function useSelfScheduling() {
  const [state, setState] = useState<SelfSchedulingState>({
    isOptimizing: false,
    error: null,
    results: null,
    summary: null,
    grid: null,
    scheduleId: null,
  });

  /**
   * Run self-scheduling optimization with explicit submissions
   */
  const optimizeWithSubmissions = useCallback(
    async (
      submissions: NurseScheduleSubmission[],
      dates: string[],
      staffingRequirements: Record<string, { day: number; night: number }>,
      config?: Partial<OptimizationConfig>,
    ) => {
      setState((prev) => ({ ...prev, isOptimizing: true, error: null }));

      try {
        // Convert to API format
        const apiSubmissions: SelfScheduleRequest["submissions"] =
          submissions.map((sub) => ({
            nurse_id: sub.nurseId,
            nurse_name: sub.nurseName,
            seniority: 0, // Will need to get from nurse data
            employment_type: "FT",
            fte_target_hours: 75.0,
            preferences: sub.primaryRequests
              .map((pref, idx) => ({
                date: pref.date,
                shift_code: pref.shiftCode || "Z07",
                rank:
                  pref.priority === "primary"
                    ? 1
                    : pref.priority === "secondary"
                      ? 2
                      : 3,
                is_off_request: false,
                off_code: "",
                comment: pref.reason || "",
              }))
              .concat(
                sub.offRequests.map((date) => ({
                  date,
                  shift_code: "OFF",
                  rank: 1,
                  is_off_request: true,
                  off_code: "OFF",
                  comment: "",
                })),
              ),
            rotation_preference: sub.rotationPreference,
            shift_type_choice:
              sub.preferredShiftLength === "12hr"
                ? "12h"
                : sub.preferredShiftLength === "8hr"
                  ? "8h"
                  : "mixed",
            is_permanent_night: sub.permanentNightWaiver,
            max_weekly_hours: 40,
            certifications: [],
          }));

        const request: SelfScheduleRequest = {
          submissions: apiSubmissions,
          dates,
          staffing_requirements: staffingRequirements,
          config: config
            ? {
                pay_period_days: config.payPeriodDays || 14,
                ft_biweekly_target: config.ftBiWeeklyTarget || 75.0,
                pt_biweekly_target: config.ptBiWeeklyTarget || 63.75,
                min_rest_hours: config.minRestHours || 11,
                max_consecutive_12h: config.maxConsecutive12hr || 3,
                max_consecutive_any: config.maxConsecutive8hr || 6,
                day_shift_min_percentage: config.minDayShiftPercentage || 50,
                weekend_max_ratio: 0.5,
                balance_window_days: config.balanceWindowDays || 28,
                use_seniority_for_conflicts:
                  config.useSeniorityForConflicts !== false,
                allow_overtime: false,
                overtime_cap_hours: 0,
              }
            : undefined,
        };

        const response = await fetch("/api/optimized_schedules/self-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "Self-scheduling failed");
        }

        const data: SelfScheduleResponse = await response.json();

        // Convert results to frontend format
        const results: Record<string, NurseOptimizationResult> = {};
        for (const [name, result] of Object.entries(data.results)) {
          results[name] = {
            nurseId: result.nurse_id,
            nurseName: result.nurse_name,
            assignments: result.assigned_shifts,
            preferenceResults: result.preference_results.map((pr) => ({
              date: pr.date,
              requestedShift: pr.shift_code,
              assignedShift: pr.assigned ? pr.shift_code : undefined,
              status: pr.assigned ? "granted" : "denied",
              reasonCode: pr.status as PreferenceResult["reasonCode"],
              reasonMessage: pr.reason_detail,
            })),
            stats: {
              totalHours: result.total_hours,
              targetHours: result.target_hours,
              delta: result.target_delta,
              preferencesGranted: result.stats.preferences_honored,
              preferencesModified: 0,
              preferencesDenied:
                result.stats.preferences_submitted -
                result.stats.preferences_honored,
              dayShiftPercentage: result.day_shift_percentage,
              weekendShifts: result.weekend_shifts,
            },
          };
        }

        // Convert grid to frontend format
        const grid: GridRow[] = data.grid.map((row, idx) => ({
          id: `nurse-${idx}`,
          nurse: row.nurse,
          shifts: row.shifts,
        }));

        setState({
          isOptimizing: false,
          error: null,
          results,
          summary: data.summary,
          grid,
          scheduleId: data.schedule_id,
        });

        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          isOptimizing: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    },
    [],
  );

  /**
   * Run self-scheduling using legacy OCR-based preferences
   * This converts existing OCR workflow to use the new algorithm
   */
  const optimizeWithLegacyPreferences = useCallback(
    async (
      nurses: Array<{
        name: string;
        employmentType?: string;
        seniority?: string | number;
        maxWeeklyHours?: number;
        offRequests?: string[];
        isChemoCertified?: boolean;
        isTransplantCertified?: boolean;
        isRenalCertified?: boolean;
        isChargeCertified?: boolean;
      }>,
      ocrAssignments: Record<string, string[]>,
      dates: string[],
      staffingRequirements: { minDayStaff: number; minNightStaff: number },
      config?: Partial<OptimizationConfig>,
    ) => {
      setState((prev) => ({ ...prev, isOptimizing: true, error: null }));

      try {
        // Convert legacy data to submissions
        const submissions: SelfScheduleRequest["submissions"] = nurses.map(
          (nurse) => {
            const ocrShifts = ocrAssignments[nurse.name] || [];
            return convertLegacyToSubmission(nurse, ocrShifts, dates);
          },
        );

        // Build staffing requirements per date
        const staffingReqs: Record<string, { day: number; night: number }> = {};
        dates.forEach((date) => {
          staffingReqs[date] = {
            day: staffingRequirements.minDayStaff || 5,
            night: staffingRequirements.minNightStaff || 5,
          };
        });

        const request: SelfScheduleRequest = {
          submissions,
          dates,
          staffing_requirements: staffingReqs,
          config: config
            ? {
                pay_period_days: config.payPeriodDays || 14,
                ft_biweekly_target: config.ftBiWeeklyTarget || 75.0,
                pt_biweekly_target: config.ptBiWeeklyTarget || 63.75,
                min_rest_hours: config.minRestHours || 11,
                max_consecutive_12h: config.maxConsecutive12hr || 3,
                max_consecutive_any: config.maxConsecutive8hr || 6,
                day_shift_min_percentage: config.minDayShiftPercentage || 50,
                weekend_max_ratio: 0.5,
                balance_window_days: config.balanceWindowDays || 28,
                use_seniority_for_conflicts:
                  config.useSeniorityForConflicts !== false,
                allow_overtime: false,
                overtime_cap_hours: 0,
              }
            : undefined,
        };

        const response = await fetch("/api/optimized_schedules/self-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "Self-scheduling failed");
        }

        const data: SelfScheduleResponse = await response.json();

        // Convert results (same as above)
        const results: Record<string, NurseOptimizationResult> = {};
        for (const [name, result] of Object.entries(data.results)) {
          results[name] = {
            nurseId: result.nurse_id,
            nurseName: result.nurse_name,
            assignments: result.assigned_shifts,
            preferenceResults: result.preference_results.map((pr) => ({
              date: pr.date,
              requestedShift: pr.shift_code,
              assignedShift: pr.assigned ? pr.shift_code : undefined,
              status: pr.assigned ? "granted" : "denied",
              reasonCode: pr.status as PreferenceResult["reasonCode"],
              reasonMessage: pr.reason_detail,
            })),
            stats: {
              totalHours: result.total_hours,
              targetHours: result.target_hours,
              delta: result.target_delta,
              preferencesGranted: result.stats.preferences_honored,
              preferencesModified: 0,
              preferencesDenied:
                result.stats.preferences_submitted -
                result.stats.preferences_honored,
              dayShiftPercentage: result.day_shift_percentage,
              weekendShifts: result.weekend_shifts,
            },
          };
        }

        const grid: GridRow[] = data.grid.map((row, idx) => ({
          id: `nurse-${idx}`,
          nurse: row.nurse,
          shifts: row.shifts,
        }));

        setState({
          isOptimizing: false,
          error: null,
          results,
          summary: data.summary,
          grid,
          scheduleId: data.schedule_id,
        });

        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          isOptimizing: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    },
    [],
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState({
      isOptimizing: false,
      error: null,
      results: null,
      summary: null,
      grid: null,
      scheduleId: null,
    });
  }, []);

  return {
    ...state,
    optimizeWithSubmissions,
    optimizeWithLegacyPreferences,
    reset,
  };
}

export default useSelfScheduling;
