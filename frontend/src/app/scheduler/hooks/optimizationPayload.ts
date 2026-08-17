import { GridRow, ManualNurse } from "../types";
import {
  extractOffDatesFromComments,
  findFuzzyMatchInMap,
  normalizeNurseName,
} from "./utils";

export type SchedulerOptimizationNurse = {
  id: string;
  name: string;
  employeeId?: string;
  isChemoCertified: boolean;
  isTransplantCertified: boolean;
  isRenalCertified: boolean;
  isChargeCertified: boolean;
  isHeadNurse?: boolean;
  employmentType: "full-time" | "part-time";
  maxWeeklyHours: number;
  targetWeeklyHours: number;
  targetBiWeeklyHours?: number;
  preferredShiftLengthHours?: number;
  offRequests: string[];
  // MCH Contract Constraints (hard constraints for the optimizer)
  minShiftsPerPeriod: number; // FT: 7 (must hit 75h), PT: 0
  maxShiftsPerPeriod: number; // FT: 8 (overtime threshold), PT: 10
  minZShiftsPerPeriod: number; // FT: 5 (min 12h shifts), PT: 0
  // Leave status
  isOnMaternityLeave?: boolean;
  isOnSickLeave?: boolean;
  isOnSabbatical?: boolean;
};

export type NurseMetadataLookup = Map<string, ManualNurse>;

interface BuildSchedulerNursesArgs {
  ocrGrid: GridRow[];
  manualNurses: ManualNurse[];
  autoComments: string;
  nurseMetadataByName?: NurseMetadataLookup;
  getDefaultMaxWeeklyHours: (employmentType?: "FT" | "PT") => number;
  fullTimeBiWeeklyTarget: number;
  partTimeBiWeeklyTarget: number;
}

function getMatchedCommentOffDates(
  nurseName: string,
  nurseOffDates: Record<string, string[]>,
): string[] {
  const offRequests = new Set<string>();

  for (const [commentNurse, dates] of Object.entries(nurseOffDates)) {
    const commentLower = commentNurse.toLowerCase();
    const nurseLower = nurseName.toLowerCase();
    if (
      commentLower.includes(nurseLower) ||
      nurseLower.includes(commentLower) ||
      commentNurse.split(" ")[0].toLowerCase() ===
        nurseName.split(" ")[0].toLowerCase()
    ) {
      dates.forEach((date) => offRequests.add(date));
    }
  }

  return Array.from(offRequests);
}

function getOffRequestsFromShiftCodes(row: GridRow): string[] {
  const offRequests = new Set<string>();

  for (const shift of row.shifts) {
    if (!shift?.shift) continue;

    // Strip trailing asterisks — a lone "*" is just a comment marker
    // (the actual off determination lives in autoComments / Employee
    // Notes & Time-Off Requests), NOT a time-off request by itself.
    const shiftCode = shift.shift.replace(/\*/g, "").trim().toUpperCase();
    if (!shiftCode) continue; // bare "*" → skip

    if (
      (shiftCode === "C" ||
        shiftCode === "CF" ||
        shiftCode === "OFF" ||
        shiftCode.startsWith("CF")) &&
      shift.date
    ) {
      offRequests.add(shift.date);
    }
  }

  return Array.from(offRequests);
}

export function buildSchedulerAssignments(
  ocrGrid: GridRow[],
): Record<string, string[]> {
  const result = Object.fromEntries(
    ocrGrid.map((row) => [
      row.nurse,
      row.shifts.map((shift) => shift.shift.replace(/\*/g, "").trim()),
    ]),
  );

  // Debug logging
  const totalShifts = Object.values(result).reduce(
    (sum, shifts) => sum + shifts.length,
    0,
  );
  const nonEmptyShifts = Object.values(result).reduce(
    (sum, shifts) =>
      sum +
      shifts.filter((s) => s && s.trim() !== "" && s.toUpperCase() !== "OFF")
        .length,
    0,
  );
  console.log("[buildSchedulerAssignments] Summary:", {
    nurses: Object.keys(result).length,
    totalShiftSlots: totalShifts,
    nonEmptyWorkingShifts: nonEmptyShifts,
    sampleNurse: Object.keys(result)[0],
    sampleShifts: result[Object.keys(result)[0]]?.slice(0, 5),
  });

  return result;
}

export function buildSchedulerComments(
  autoComments: string,
): Record<string, Record<string, string>> {
  const comments: Record<string, Record<string, string>> = {};
  if (!autoComments.trim()) return comments;

  const lines = autoComments.trim().split("\n");
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 3) continue;

    const nurseName = parts[0].trim();
    const date = parts[1].trim();
    const comment = parts.slice(2).join("|").trim();

    if (!comments[nurseName]) {
      comments[nurseName] = {};
    }
    comments[nurseName][date] = comment;
  }

  return comments;
}

export function buildSchedulerNurses({
  ocrGrid,
  manualNurses,
  autoComments,
  nurseMetadataByName,
  getDefaultMaxWeeklyHours,
  fullTimeBiWeeklyTarget,
  partTimeBiWeeklyTarget,
}: BuildSchedulerNursesArgs): SchedulerOptimizationNurse[] {
  const metadataLookup = nurseMetadataByName ?? new Map<string, ManualNurse>();
  const nurseOffDates = extractOffDatesFromComments(autoComments);

  const ocrNurseObjects: SchedulerOptimizationNurse[] = ocrGrid.map(
    (row, idx) => {
      const nurseMetadata = metadataLookup.get(normalizeNurseName(row.nurse));
      const isPartTime = nurseMetadata?.employmentType === "PT";
      const offRequests = new Set<string>([
        ...getMatchedCommentOffDates(row.nurse, nurseOffDates),
        ...getOffRequestsFromShiftCodes(row),
        ...(nurseMetadata?.offRequests || []),
      ]);

      // maxHours from DB/metadata contains the bi-weekly target hours.
      // We use it as the target for optimization (75h/2wks for FT, varies for PT).
      const rawMax = nurseMetadata?.maxHours;
      const maxWeeklyHours =
        typeof rawMax === "number" && rawMax > 0
          ? rawMax
          : getDefaultMaxWeeklyHours(isPartTime ? "PT" : "FT");

      // For target hours: use maxHours (bi-weekly target) if available, otherwise use org defaults
      const targetBiWeeklyHours =
        typeof rawMax === "number" && rawMax > 0
          ? rawMax
          : isPartTime
            ? partTimeBiWeeklyTarget
            : fullTimeBiWeeklyTarget;

      const targetWeeklyHours = targetBiWeeklyHours / 2.0;

      return {
        id: `ocr-${idx}`,
        name: row.nurse,
        employeeId: row.employeeId || nurseMetadata?.employeeId,
        isChemoCertified: nurseMetadata?.chemoCertified || false,
        isTransplantCertified: nurseMetadata?.transplantCertified || false,
        isRenalCertified: nurseMetadata?.renalCertified || false,
        isChargeCertified: nurseMetadata?.chargeCertified || false,
        isHeadNurse: nurseMetadata?.isHeadNurse || false,
        employmentType: isPartTime ? "part-time" : "full-time",
        maxWeeklyHours,
        targetWeeklyHours,
        targetBiWeeklyHours,
        preferredShiftLengthHours: nurseMetadata?.preferredShiftLengthHours,
        offRequests: Array.from(offRequests),
        // MCH Contract Constraints
        minShiftsPerPeriod: isPartTime ? 0 : 7,
        maxShiftsPerPeriod: isPartTime ? 10 : 8,
        minZShiftsPerPeriod: isPartTime ? 0 : 5,
        // Leave status
        isOnMaternityLeave: nurseMetadata?.isOnMaternityLeave,
        isOnSickLeave: nurseMetadata?.isOnSickLeave,
        isOnSabbatical: nurseMetadata?.isOnSabbatical,
      };
    },
  );

  const manualNurseObjects: SchedulerOptimizationNurse[] = manualNurses.map(
    (nurse, idx) => {
      const isPartTime = nurse.employmentType === "PT";

      // Manual nurse maxHours is bi-weekly from the DB.
      // We keep it as bi-weekly to match frontend display (75h/2wks for FT, etc.)
      const rawManualMax = nurse.maxHours;
      const maxWeeklyHours =
        typeof rawManualMax === "number" && rawManualMax > 0
          ? rawManualMax
          : getDefaultMaxWeeklyHours(nurse.employmentType);

      // Target hours: use maxHours if available, otherwise org defaults
      const targetBiWeeklyHours =
        typeof rawManualMax === "number" && rawManualMax > 0
          ? rawManualMax
          : isPartTime
            ? partTimeBiWeeklyTarget
            : fullTimeBiWeeklyTarget;

      const targetWeeklyHours = targetBiWeeklyHours / 2.0;

      return {
        id: `manual-${idx}`,
        name: nurse.name,
        employeeId: nurse.employeeId,
        isChemoCertified: nurse.chemoCertified || false,
        isTransplantCertified: nurse.transplantCertified || false,
        isRenalCertified: nurse.renalCertified || false,
        isChargeCertified: nurse.chargeCertified || false,
        isHeadNurse: nurse.isHeadNurse || false,
        employmentType: isPartTime ? "part-time" : "full-time",
        maxWeeklyHours,
        targetWeeklyHours,
        targetBiWeeklyHours,
        preferredShiftLengthHours: nurse.preferredShiftLengthHours,
        offRequests: nurse.offRequests || [],
        // MCH Contract Constraints
        minShiftsPerPeriod: isPartTime ? 0 : 7,
        maxShiftsPerPeriod: isPartTime ? 10 : 8,
        minZShiftsPerPeriod: isPartTime ? 0 : 5,
        // Leave status
        isOnMaternityLeave: nurse.isOnMaternityLeave,
        isOnSickLeave: nurse.isOnSickLeave,
        isOnSabbatical: nurse.isOnSabbatical,
      };
    },
  );

  const nurseMap = new Map<string, SchedulerOptimizationNurse>();
  for (const nurse of manualNurseObjects) {
    nurseMap.set(normalizeNurseName(nurse.name), nurse);
  }

  for (const nurse of ocrNurseObjects) {
    const key = normalizeNurseName(nurse.name);

    // First try exact match, then fuzzy match
    let existingKey = nurseMap.has(key) ? key : undefined;
    if (!existingKey) {
      // Fuzzy match: find a nurse with similar name (e.g., "Tiffany Glodoviza" vs "Tiffany Glodovizay")
      existingKey = findFuzzyMatchInMap(key, nurseMap);
    }

    if (existingKey) {
      const existing = nurseMap.get(existingKey)!;
      // Merge OCR-derived nurse with the existing manual nurse entry.
      // Prefer authoritative/manual fields (employeeId, certifications,
      // employmentType, max/target hours) while combining offRequests.
      const mergedOff = [
        ...new Set([
          ...(existing.offRequests || []),
          ...(nurse.offRequests || []),
        ]),
      ];

      const merged = {
        // Start with OCR values, then overlay manual (existing) to prefer manual
        // metadata for fields that matter for optimization.
        ...nurse,
        ...existing,
        offRequests: mergedOff,
      } as SchedulerOptimizationNurse;

      // Keep the existing key (the manual nurse's name) as the canonical name
      nurseMap.set(existingKey, merged);
      continue;
    }

    // No match found - add as new nurse
    nurseMap.set(key, nurse);
  }

  return Array.from(nurseMap.values());
}
