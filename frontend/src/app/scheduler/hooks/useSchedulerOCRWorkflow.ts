"use client";

import { useCallback } from "react";
import { Nurse, parseImageWithFastAPI, updateNurseAPI } from "../../lib/api";
import { GridRow, ManualNurse, OCRWarning, ShiftEntry, Step } from "../types";
import {
  cleanNurseName,
  deduplicateGridGhosts,
  deduplicateNurseCandidates,
  deduplicateOCRGrid,
  detectOCRIssues,
  extractNurseMetadata,
  getPotentialMatches,
  matchNursesWithDatabase,
  normalizeNurseName,
  parseShiftCode,
  sanitizeOCRShiftCell,
} from "./utils";

type SetState<T> = (value: T | ((prev: T) => T)) => void;

interface UseSchedulerOCRWorkflowOptions {
  screenshots: File[];
  startDate: string;
  endDate: string;
  userId: string;
  /** Function to get auth token for API calls */
  getToken: () => Promise<string | null>;
  /** Already-loaded nurses from the parent — avoids a redundant un-authenticated API call */
  organizationNurses: Nurse[];
  /** All nurses including those on leave - used for name matching only */
  allOrganizationNurses: Nurse[];
  getDefaultMaxWeeklyHours: (employmentType?: "FT" | "PT") => number;
  /** Bi-weekly target hours for new nurses (e.g., 75h FT, 63.75h PT) */
  fullTimeBiWeeklyTarget: number;
  partTimeBiWeeklyTarget: number;
  setOcrLoading: (value: boolean) => void;
  setOcrError: (value: string | null) => void;
  setAutoComments: SetState<string>;
  setOcrWarnings: (value: OCRWarning[]) => void;
  setOcrDates: (value: string[]) => void;
  setOcrGrid: (value: GridRow[]) => void;
  setCurrentStep: (value: Step) => void;
  setManualNurses: SetState<ManualNurse[]>;
  setNewNurseCandidates: SetState<any[]>;
  setShowCreateNursesModal: (value: boolean) => void;
}

export function useSchedulerOCRWorkflow({
  screenshots,
  startDate,
  endDate,
  userId,
  getToken,
  organizationNurses,
  allOrganizationNurses,
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
}: UseSchedulerOCRWorkflowOptions) {
  const runOCR = useCallback(async () => {
    if (screenshots.length === 0) return;

    setOcrLoading(true);
    setOcrError(null);

    try {
      // Get auth token for API calls
      const token = await getToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const allDates = new Set<string>();
      const combinedGrid: Record<
        string,
        {
          displayName: string;
          employeeId?: string;
          seniority?: string;
          shifts: Record<string, ShiftEntry>;
        }
      > = {};
      // Map keyed by "normalizedName|date" → comment text (deduplicates across screenshots)
      const extractedCommentsMap = new Map<
        string,
        { normalizedName: string; date: string; comment: string }
      >();

      for (const file of screenshots) {
        const result = await parseImageWithFastAPI(
          file,
          startDate,
          endDate,
          headers,
        );

        if (result.dates) {
          result.dates.forEach((d: string) => allDates.add(d));
        }

        // Use the dates from THIS specific screenshot for index mapping
        // This is critical for multi-period screenshots (e.g., 6 screenshots covering 6 weeks)
        const screenshotDates: string[] = result.dates || [];
        console.log(
          `[OCR] Processing screenshot: ${file.name}, dates: [${screenshotDates.slice(0, 3).join(", ")}...${screenshotDates.slice(-1)}] (${screenshotDates.length} dates)`,
        );

        if (result.grid && Array.isArray(result.grid)) {
          for (const row of result.grid) {
            const nurseName = row.nurse?.trim();
            if (!nurseName) continue;

            const { employeeId, seniority } = extractNurseMetadata(nurseName);
            const cleanedName = cleanNurseName(nurseName);
            if (!cleanedName) continue;

            const normalizedName = normalizeNurseName(cleanedName);

            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: cleanedName,
                employeeId,
                seniority,
                shifts: {},
              };
            } else {
              if (employeeId && !combinedGrid[normalizedName].employeeId) {
                combinedGrid[normalizedName].employeeId = employeeId;
              }
              if (seniority && !combinedGrid[normalizedName].seniority) {
                combinedGrid[normalizedName].seniority = seniority;
              }
            }

            // Use screenshot-specific dates for index mapping, not accumulated allDates
            if (row.shifts && Array.isArray(row.shifts)) {
              row.shifts.forEach((shift: string, idx: number) => {
                if (idx < screenshotDates.length) {
                  const date = screenshotDates[idx];
                  const sanitizedShift = sanitizeOCRShiftCell(shift);
                  const existingShift =
                    combinedGrid[normalizedName].shifts[date];
                  const isExistingEmpty =
                    !existingShift || !existingShift.shift;

                  if (shift && shift.includes("*")) {
                    const cleanShift = shift.replace(/\*/g, "").trim();
                    const sanitizedCleanShift =
                      sanitizeOCRShiftCell(cleanShift);
                    const commentKey = `${normalizedName}|${date}`;
                    if (!extractedCommentsMap.has(commentKey)) {
                      extractedCommentsMap.set(commentKey, {
                        normalizedName,
                        date,
                        comment: sanitizedCleanShift || "(preference marker)",
                      });
                    }
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

        if (result.rows && Array.isArray(result.rows)) {
          for (const row of result.rows) {
            const nurseName = row.nurse?.trim();
            if (!nurseName) continue;

            const { employeeId, seniority } = extractNurseMetadata(nurseName);
            const cleanedName = cleanNurseName(nurseName);
            if (!cleanedName) continue;

            const normalizedName = normalizeNurseName(cleanedName);

            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: cleanedName,
                employeeId,
                seniority,
                shifts: {},
              };
            } else {
              if (employeeId && !combinedGrid[normalizedName].employeeId) {
                combinedGrid[normalizedName].employeeId = employeeId;
              }
              if (seniority && !combinedGrid[normalizedName].seniority) {
                combinedGrid[normalizedName].seniority = seniority;
              }
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
                  const commentKey = `${normalizedName}|${shift.date}`;
                  if (!extractedCommentsMap.has(commentKey)) {
                    extractedCommentsMap.set(commentKey, {
                      normalizedName,
                      date: shift.date,
                      comment: sanitizedCleanShift || "(preference marker)",
                    });
                  }
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

      // --- Deduplicate near-identical nurse names across screenshots ---
      const {
        deduplicatedGrid: cleanGrid,
        duplicateWarnings,
        nameResolutionMap,
      } = deduplicateOCRGrid(combinedGrid, 0.85);

      // Finalize comments: remap names to canonical grid names, deduplicated
      if (extractedCommentsMap.size > 0) {
        const commentLines: string[] = [];
        for (const entry of extractedCommentsMap.values()) {
          const displayName =
            nameResolutionMap.get(entry.normalizedName) || entry.normalizedName;
          commentLines.push(`${displayName}|${entry.date}|${entry.comment}`);
        }
        console.log(
          `[OCR] Comments: ${extractedCommentsMap.size} unique entries (deduped from markers)`,
        );
        setAutoComments(commentLines.join("\n"));
      }

      const sortedDates = Array.from(allDates).sort();
      const gridRows: GridRow[] = Object.entries(cleanGrid).map(
        ([, data], idx) => ({
          id: String(idx),
          nurse: data.displayName,
          employeeId: data.employeeId,
          seniority: data.seniority,
          shifts: sortedDates.map(
            (date) =>
              data.shifts[date] || {
                date,
                shift: "",
                shiftType: "day" as const,
                hours: 0,
                startTime: "",
                endTime: "",
              },
          ),
        }),
      );

      gridRows.sort((a, b) => a.nurse.localeCompare(b.nurse));

      const warnings: OCRWarning[] = [...duplicateWarnings];
      for (const row of gridRows) {
        const issue = detectOCRIssues(row.nurse);
        if (issue) {
          warnings.push(issue);
        }
      }
      setOcrWarnings(warnings);

      setOcrDates(sortedDates);
      // De-Duplication Command: remove ghost Z23 tails before displaying the OCR grid.
      // Without this, overnight shifts show phantom entries in two calendar columns.

      // Use ALL nurses (including those on leave) for matching to prevent
      // nurses on leave from showing as "new nurses" in import
      const existingNurses = allOrganizationNurses;

      console.log(
        "[OCR Workflow] Existing nurses count (including on leave):",
        existingNurses.length,
      );
      if (existingNurses.length > 0) {
        console.log(
          "[OCR Workflow] Sample nurses:",
          existingNurses.slice(0, 3).map((n) => n.name),
        );
      }

      if (existingNurses.length === 0) {
        // No nurses loaded (user not logged in, or no nurses in org) – show raw grid
        console.warn("[OCR Workflow] No nurses loaded - skipping matching");
        setOcrGrid(deduplicateGridGhosts(gridRows));
        setCurrentStep("review");
      } else {
        try {
          const ocrNurseNames = gridRows.map((r) => r.nurse);
          console.log("[OCR Workflow] OCR names to match:", ocrNurseNames);
          console.log(
            "[OCR Workflow] DB nurses available:",
            existingNurses.map((n) => n.name),
          );

          const { matched, unmatched } = matchNursesWithDatabase(
            ocrNurseNames,
            existingNurses,
            0.65, // Lowered from 0.7 to catch more OCR variations
          );

          console.log(
            "[OCR Workflow] Matched:",
            matched.length,
            "Unmatched:",
            unmatched.length,
          );
          if (unmatched.length > 0) {
            console.log("[OCR Workflow] Unmatched names:", unmatched);
          }

          const ocrToDbNameMap = new Map<string, string>();
          for (const match of matched) {
            const gridRow = gridRows.find((r) => r.nurse === match.ocrName);
            if (gridRow) {
              ocrToDbNameMap.set(match.ocrName, match.dbNurse.name);
              gridRow.nurse = match.dbNurse.name;
              gridRow.employeeId =
                match.dbNurse.employee_id || gridRow.employeeId;

              if (
                gridRow.seniority &&
                match.dbNurse.seniority &&
                gridRow.seniority !== match.dbNurse.seniority
              ) {
                updateNurseAPI(
                  match.dbNurse.id,
                  userId,
                  {
                    seniority: gridRow.seniority,
                  },
                  headers,
                ).catch((err) => {
                  console.error(
                    `Failed to update seniority for ${match.dbNurse.name}:`,
                    err,
                  );
                });
              }
            }
          }

          setOcrGrid(deduplicateGridGhosts([...gridRows]));
          setCurrentStep("review");

          if (matched.length > 0) {
            setManualNurses((prev) => {
              const next = [...prev];

              for (const match of matched) {
                const dbNurse = match.dbNurse;
                const dbKey = normalizeNurseName(dbNurse.name);
                const ocrKey = normalizeNurseName(match.ocrName);
                const existingIndex = next.findIndex((nurse) => {
                  const key = normalizeNurseName(nurse.name);
                  return key === dbKey || key === ocrKey;
                });

                const matchedNurse: ManualNurse = {
                  name: dbNurse.name,
                  employeeId: dbNurse.employee_id,
                  seniority: dbNurse.seniority,
                  chemoCertified: dbNurse.is_chemo_certified,
                  transplantCertified: dbNurse.is_transplant_certified || false,
                  renalCertified: dbNurse.is_renal_certified || false,
                  chargeCertified: dbNurse.is_charge_certified || false,
                  maxHours: dbNurse.max_weekly_hours,
                  employmentType:
                    dbNurse.employment_type === "part-time" ? "PT" : "FT",
                };

                if (existingIndex >= 0) {
                  const existing = next[existingIndex];
                  next[existingIndex] = {
                    name: dbNurse.name,
                    employeeId: matchedNurse.employeeId ?? existing.employeeId,
                    seniority: matchedNurse.seniority ?? existing.seniority,
                    chemoCertified: matchedNurse.chemoCertified,
                    transplantCertified: matchedNurse.transplantCertified,
                    renalCertified: matchedNurse.renalCertified,
                    chargeCertified: matchedNurse.chargeCertified,
                    isHeadNurse: existing.isHeadNurse,
                    maxHours: matchedNurse.maxHours ?? existing.maxHours,
                    employmentType:
                      matchedNurse.employmentType ?? existing.employmentType,
                    offRequests: existing.offRequests,
                  };
                } else {
                  next.push(matchedNurse);
                }
              }

              return next;
            });
          }

          if (ocrToDbNameMap.size > 0) {
            setAutoComments((prev) => {
              let updated = prev;
              ocrToDbNameMap.forEach((dbName, ocrName) => {
                const escapedName = ocrName.replace(
                  /[.*+?^${}()|[\]\\]/g,
                  "\\$&",
                );
                const regex = new RegExp(`^${escapedName}(?=\\|)`, "gim");
                updated = updated.replace(regex, dbName);
              });
              return updated;
            });
          }

          if (unmatched.length > 0) {
            const newNurseRows = gridRows.filter((r) =>
              unmatched.some((name) => {
                const cleaned = cleanNurseName(name);
                return (
                  normalizeNurseName(r.nurse) === normalizeNurseName(cleaned) ||
                  normalizeNurseName(name) === normalizeNurseName(r.nurse)
                );
              }),
            );

            if (newNurseRows.length > 0) {
              const candidatesWithMatches = newNurseRows.map((row) => {
                const potentialMatches = getPotentialMatches(
                  row.nurse,
                  existingNurses,
                  0.4,
                ).map((m) => ({
                  dbNurse: {
                    id: m.nurse.id,
                    name: m.nurse.name,
                    employee_id: m.nurse.employee_id,
                    seniority: m.nurse.seniority,
                    employment_type: m.nurse.employment_type,
                    max_weekly_hours: m.nurse.max_weekly_hours,
                    is_chemo_certified: m.nurse.is_chemo_certified,
                    is_transplant_certified: m.nurse.is_transplant_certified,
                    is_renal_certified: m.nurse.is_renal_certified,
                    is_charge_certified: m.nurse.is_charge_certified,
                  },
                  score: m.score,
                }));

                console.log(
                  `[OCR Workflow] ${row.nurse} -> ${potentialMatches.length} potential matches`,
                );
                if (potentialMatches.length > 0) {
                  console.log(
                    `  Best match: ${potentialMatches[0].dbNurse.name} (score: ${potentialMatches[0].score})`,
                  );
                }

                return {
                  originalName: row.nurse,
                  name: row.nurse,
                  employeeId: row.employeeId,
                  seniority: row.seniority,
                  selected: true,
                  employmentType: "FT" as const,
                  isChemoCertified: false,
                  isTransplantCertified: false,
                  isRenalCertified: false,
                  isChargeCertified: false,
                  // Use bi-weekly target (e.g., 75h) instead of max cap (120h) for new nurses
                  maxHours: fullTimeBiWeeklyTarget,
                  potentialMatches,
                  selectedMatchId: undefined,
                  matchAction:
                    potentialMatches.length > 0
                      ? ("link" as const)
                      : ("create" as const),
                };
              });

              // Deduplicate candidates with similar names (e.g., "Alyssa Reniva" vs "Alyssa Renival")
              const deduplicatedCandidates = deduplicateNurseCandidates(
                candidatesWithMatches,
              );

              console.log(
                "[OCR Workflow] Setting candidates:",
                deduplicatedCandidates.length,
                "(before dedup:",
                candidatesWithMatches.length,
                ")",
              );
              setNewNurseCandidates(deduplicatedCandidates);
              setShowCreateNursesModal(true);
            }
          }
        } catch (error) {
          console.error("Error during nurse matching:", error);
          // On failure, still show the grid with original OCR names
          setOcrGrid(deduplicateGridGhosts([...gridRows]));
          setCurrentStep("review");
        }
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setOcrLoading(false);
    }
  }, [
    screenshots,
    startDate,
    endDate,
    userId,
    getToken,
    organizationNurses,
    allOrganizationNurses,
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
  ]);

  return { runOCR };
}
