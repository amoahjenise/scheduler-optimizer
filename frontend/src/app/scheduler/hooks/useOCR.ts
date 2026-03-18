"use client";

import { useState, useCallback } from "react";
import { GridRow, ShiftEntry, OCRWarning, NewNurseCandidate } from "../types";
import {
  parseShiftCode,
  sanitizeOCRShiftCell,
  cleanNurseName,
  normalizeNurseName,
  extractEmployeeId,
  detectOCRIssues,
  deduplicateNightShifts,
} from "./utils";
import { parseImageWithFastAPI, listNursesAPI } from "../../lib/api";

interface UseOCROptions {
  userId: string;
  startDate: string;
  endDate: string;
  getToken?: () => Promise<string | null>;
  onComplete?: (data: {
    dates: string[];
    grid: GridRow[];
    autoComments: string;
    warnings: OCRWarning[];
  }) => void;
  onNewNursesDetected?: (candidates: NewNurseCandidate[]) => void;
}

/**
 * Custom hook for OCR processing
 */
export function useOCR({
  userId,
  startDate,
  endDate,
  getToken,
  onComplete,
  onNewNursesDetected,
}: UseOCROptions) {
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runOCR = useCallback(async () => {
    if (screenshots.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const allDates = new Set<string>();
      // Use normalized name as key, but store original name for display
      const combinedGrid: Record<
        string,
        {
          displayName: string;
          employeeId?: string;
          shifts: Record<string, ShiftEntry>;
        }
      > = {};
      const extractedComments: string[] = [];

      for (const file of screenshots) {
        const result = await parseImageWithFastAPI(file, startDate, endDate);

        // Handle dates array
        if (result.dates) {
          result.dates.forEach((d: string) => allDates.add(d));
        }

        // Handle grid format (from backend textract_parser)
        if (result.grid && Array.isArray(result.grid)) {
          for (const row of result.grid) {
            const nurseName = row.nurse?.trim();
            if (!nurseName) continue;

            // Extract employee ID before cleaning
            const employeeId = extractEmployeeId(nurseName);

            // Clean the nurse name (remove employee IDs, codes, etc.)
            const cleanedName = cleanNurseName(nurseName);
            if (!cleanedName) continue;

            // Normalize for deduplication (lowercase, etc.)
            const normalizedName = normalizeNurseName(cleanedName);

            // Merge with existing entry or create new one
            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: cleanedName,
                shifts: {},
              };
            }

            // Map shifts array to dates
            const dates = Array.from(allDates).sort();
            if (row.shifts && Array.isArray(row.shifts)) {
              row.shifts.forEach((shift: string, idx: number) => {
                if (idx < dates.length) {
                  const date = dates[idx];
                  const sanitizedShift = sanitizeOCRShiftCell(shift);
                  const existingShift =
                    combinedGrid[normalizedName].shifts[date];
                  const isExistingEmpty =
                    !existingShift || !existingShift.shift;

                  // Extract comments from cells containing * marker
                  if (shift && shift.includes("*")) {
                    const cleanShift = shift.replace(/\*/g, "").trim();
                    const sanitizedCleanShift =
                      sanitizeOCRShiftCell(cleanShift);
                    extractedComments.push(
                      `${nurseName}|${date}|${sanitizedCleanShift} (marker note)`,
                    );
                    if (isExistingEmpty || sanitizedCleanShift) {
                      const parsed = parseShiftCode(sanitizedCleanShift, date);
                      combinedGrid[normalizedName].shifts[date] = {
                        ...parsed,
                        shift: sanitizedCleanShift
                          ? sanitizedCleanShift + " *"
                          : "*",
                      };
                    }
                  } else if (isExistingEmpty || sanitizedShift) {
                    combinedGrid[normalizedName].shifts[date] = parseShiftCode(
                      sanitizedShift,
                      date,
                    );
                  }
                }
              });
            }
          }
        }

        // Handle rows format (alternative format)
        if (result.rows && Array.isArray(result.rows)) {
          for (const row of result.rows) {
            const nurseName = row.nurse?.trim();
            if (!nurseName) continue;

            const cleanedName = cleanNurseName(nurseName);
            if (!cleanedName) continue;

            const normalizedName = normalizeNurseName(cleanedName);

            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: cleanedName,
                shifts: {},
              };
            }

            for (const shift of row.shifts) {
              if (shift && shift.date) {
                const sanitizedShift = sanitizeOCRShiftCell(shift.shift || "");
                const existingShift =
                  combinedGrid[normalizedName].shifts[shift.date];
                const isExistingEmpty = !existingShift || !existingShift.shift;

                if (shift.shift && shift.shift.includes("*")) {
                  const cleanShift = shift.shift.replace(/\*/g, "").trim();
                  const sanitizedCleanShift = sanitizeOCRShiftCell(cleanShift);
                  extractedComments.push(
                    `${nurseName}|${shift.date}|${sanitizedCleanShift} (marker note)`,
                  );
                  if (isExistingEmpty || sanitizedCleanShift) {
                    const parsed = parseShiftCode(
                      sanitizedCleanShift,
                      shift.date,
                    );
                    combinedGrid[normalizedName].shifts[shift.date] = {
                      ...parsed,
                      shift: sanitizedCleanShift
                        ? sanitizedCleanShift + " *"
                        : "*",
                    };
                  }
                } else if (isExistingEmpty || sanitizedShift) {
                  combinedGrid[normalizedName].shifts[shift.date] =
                    parseShiftCode(sanitizedShift, shift.date);
                }
              }
            }
          }
        }
      }

      const sortedDates = Array.from(allDates).sort();
      const gridRows: GridRow[] = Object.entries(combinedGrid).map(
        ([, data], idx) => {
          // Build the raw shifts array for this nurse
          const rawShifts = sortedDates.map(
            (date) =>
              data.shifts[date] || {
                date,
                shift: "",
                shiftType: "day" as const,
                hours: 0,
                startTime: "",
                endTime: "",
              },
          );

          // Deduplicate wrap-around night shifts — only plain Z23 after a
          // night code is a ghost tail.  Z23 B is always a real shift.
          // Example: Z19, Z23 B, Z23 B, Z23 → 3 shifts + 1 ghost (last Z23).
          const dedupedShifts = deduplicateNightShifts(rawShifts);

          return {
            id: String(idx),
            nurse: data.displayName,
            employeeId: data.employeeId,
            shifts: dedupedShifts,
          };
        },
      );

      // Sort by nurse name for consistent ordering
      gridRows.sort((a, b) => a.nurse.localeCompare(b.nurse));

      // Detect OCR issues with nurse names
      const warnings: OCRWarning[] = [];
      for (const row of gridRows) {
        const issue = detectOCRIssues(row.nurse);
        if (issue) {
          warnings.push(issue);
        }
      }

      const autoComments =
        extractedComments.length > 0 ? extractedComments.join("\n") : "";

      // Notify completion
      onComplete?.({
        dates: sortedDates,
        grid: gridRows,
        autoComments,
        warnings,
      });

      // Check for new nurses not yet in the database
      if (userId && onNewNursesDetected) {
        try {
          const token = getToken ? await getToken() : null;
          const authHeaders = token
            ? { Authorization: `Bearer ${token}` }
            : undefined;
          const { nurses: existingNurses } = await listNursesAPI(
            userId,
            1,
            1000,
            undefined,
            authHeaders,
          );
          const existingNames = new Set(
            existingNurses.map((n) => n.name.toLowerCase().trim()),
          );
          const newNurses = gridRows
            .map((r) => r.nurse)
            .filter((name) => !existingNames.has(name.toLowerCase().trim()));

          if (newNurses.length > 0) {
            console.log("New nurses detected:", newNurses);
            onNewNursesDetected(
              newNurses.map((name) => ({
                name,
                selected: true,
                employmentType: "FT" as const,
                isChemoCertified: false,
                isTransplantCertified: false,
                isRenalCertified: false,
                isChargeCertified: false,
                maxHours: 75, // Bi-weekly default target/cap for FT nurses
              })),
            );
          }
        } catch (err) {
          console.error("Error checking nurses:", err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setLoading(false);
    }
  }, [
    screenshots,
    startDate,
    endDate,
    userId,
    onComplete,
    onNewNursesDetected,
  ]);

  const clearScreenshots = useCallback(() => {
    setScreenshots([]);
    setError(null);
  }, []);

  return {
    screenshots,
    setScreenshots,
    loading,
    error,
    runOCR,
    clearScreenshots,
  };
}
