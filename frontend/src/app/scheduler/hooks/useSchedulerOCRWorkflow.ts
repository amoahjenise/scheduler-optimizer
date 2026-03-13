"use client";

import { useCallback } from "react";
import {
  listNursesAPI,
  parseImageWithFastAPI,
  updateNurseAPI,
} from "../../lib/api";
import { GridRow, ManualNurse, OCRWarning, ShiftEntry, Step } from "../types";
import {
  cleanNurseName,
  detectOCRIssues,
  extractNurseMetadata,
  getPotentialMatches,
  matchNursesWithDatabase,
  normalizeNurseName,
  parseShiftCode,
} from "./utils";

type SetState<T> = (value: T | ((prev: T) => T)) => void;

interface UseSchedulerOCRWorkflowOptions {
  screenshots: File[];
  startDate: string;
  endDate: string;
  userId: string;
  getDefaultMaxWeeklyHours: (employmentType?: "FT" | "PT") => number;
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
  getDefaultMaxWeeklyHours,
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
      const extractedComments: string[] = [];

      for (const file of screenshots) {
        const result = await parseImageWithFastAPI(file, startDate, endDate);

        if (result.dates) {
          result.dates.forEach((d: string) => allDates.add(d));
        }

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

            const dates = Array.from(allDates).sort();
            if (row.shifts && Array.isArray(row.shifts)) {
              row.shifts.forEach((shift: string, idx: number) => {
                if (idx < dates.length) {
                  const date = dates[idx];
                  const existingShift =
                    combinedGrid[normalizedName].shifts[date];
                  const isExistingEmpty =
                    !existingShift || !existingShift.shift;

                  if (shift && shift.includes("*")) {
                    const cleanShift = shift.replace(/\*/g, "").trim();
                    extractedComments.push(
                      `${cleanedName}|${date}|${cleanShift} (marker note)`,
                    );
                    if (isExistingEmpty || cleanShift) {
                      const parsed = parseShiftCode(cleanShift, date);
                      combinedGrid[normalizedName].shifts[date] = {
                        ...parsed,
                        shift: cleanShift ? cleanShift + " *" : "*",
                      };
                    }
                  } else if (isExistingEmpty || shift) {
                    combinedGrid[normalizedName].shifts[date] = parseShiftCode(
                      shift,
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
                const existingShift =
                  combinedGrid[normalizedName].shifts[shift.date];
                const isExistingEmpty = !existingShift || !existingShift.shift;

                if (shift.shift && shift.shift.includes("*")) {
                  const cleanShift = shift.shift.replace(/\*/g, "").trim();
                  extractedComments.push(
                    `${cleanedName}|${shift.date}|${cleanShift} (marker note)`,
                  );
                  if (isExistingEmpty || cleanShift) {
                    combinedGrid[normalizedName].shifts[shift.date] = {
                      ...shift,
                      shift: cleanShift ? cleanShift + " *" : "*",
                    };
                  }
                } else if (isExistingEmpty || shift.shift) {
                  combinedGrid[normalizedName].shifts[shift.date] = shift;
                }
              }
            }
          }
        }
      }

      if (extractedComments.length > 0) {
        setAutoComments(extractedComments.join("\n"));
      }

      const sortedDates = Array.from(allDates).sort();
      const gridRows: GridRow[] = Object.entries(combinedGrid).map(
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

      const warnings: OCRWarning[] = [];
      for (const row of gridRows) {
        const issue = detectOCRIssues(row.nurse);
        if (issue) {
          warnings.push(issue);
        }
      }
      setOcrWarnings(warnings);

      setOcrDates(sortedDates);
      setOcrGrid(gridRows);
      setCurrentStep("review");

      if (userId) {
        try {
          const { nurses: existingNurses } = await listNursesAPI(
            userId,
            1,
            1000,
          );
          const ocrNurseNames = gridRows.map((r) => r.nurse);

          const { matched, unmatched } = matchNursesWithDatabase(
            ocrNurseNames,
            existingNurses,
            0.7,
          );

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
                updateNurseAPI(match.dbNurse.id, userId, {
                  seniority: gridRow.seniority,
                }).catch((err) => {
                  console.error(
                    `Failed to update seniority for ${match.dbNurse.name}:`,
                    err,
                  );
                });
              }
            }
          }

          setOcrGrid([...gridRows]);

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
                  maxHours: getDefaultMaxWeeklyHours("FT"),
                  potentialMatches,
                  selectedMatchId: undefined,
                  matchAction:
                    potentialMatches.length > 0
                      ? ("link" as const)
                      : ("create" as const),
                };
              });

              setNewNurseCandidates(candidatesWithMatches);
              setShowCreateNursesModal(true);
            }
          }
        } catch (error) {
          console.error("Error checking nurses:", error);
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
    getDefaultMaxWeeklyHours,
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
