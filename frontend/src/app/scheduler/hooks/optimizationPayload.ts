import { GridRow, ManualNurse } from "../types";
import { extractOffDatesFromComments, normalizeNurseName } from "./utils";

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
  preferredShiftLengthHours?: number;
  offRequests: string[];
};

export type NurseMetadataLookup = Map<string, ManualNurse>;

interface BuildSchedulerNursesArgs {
  ocrGrid: GridRow[];
  manualNurses: ManualNurse[];
  autoComments: string;
  nurseMetadataByName?: NurseMetadataLookup;
  getDefaultMaxWeeklyHours: (employmentType?: "FT" | "PT") => number;
  fullTimeWeeklyTarget: number;
  partTimeWeeklyTarget: number;
}

function resolveTargetWeeklyHours(
  isPartTime: boolean,
  maxWeeklyHours: number,
  explicitTargetWeeklyHours: number | undefined,
  fullTimeWeeklyTarget: number,
  partTimeWeeklyTarget: number,
): number {
  if (
    typeof explicitTargetWeeklyHours === "number" &&
    Number.isFinite(explicitTargetWeeklyHours) &&
    explicitTargetWeeklyHours > 0
  ) {
    return explicitTargetWeeklyHours;
  }

  const defaultTarget = isPartTime
    ? partTimeWeeklyTarget
    : fullTimeWeeklyTarget;

  // Support custom PT lines (e.g., 0.6 FTE = 22.5h/week) when entered as nurse max hours.
  if (
    isPartTime &&
    Number.isFinite(maxWeeklyHours) &&
    maxWeeklyHours > 0 &&
    maxWeeklyHours <= 30
  ) {
    return maxWeeklyHours;
  }

  // For FT, allow explicit realistic target override when provided near standard FT range.
  if (
    !isPartTime &&
    Number.isFinite(maxWeeklyHours) &&
    maxWeeklyHours >= 30 &&
    maxWeeklyHours <= 40
  ) {
    return maxWeeklyHours;
  }

  return defaultTarget;
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

    const shiftCode = shift.shift.replace(/\*/g, "").trim().toUpperCase();
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
  return Object.fromEntries(
    ocrGrid.map((row) => [
      row.nurse,
      row.shifts.map((shift) => shift.shift.replace(/\*/g, "").trim()),
    ]),
  );
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
  fullTimeWeeklyTarget,
  partTimeWeeklyTarget,
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
      const maxWeeklyHours =
        nurseMetadata?.maxHours ||
        getDefaultMaxWeeklyHours(isPartTime ? "PT" : "FT");
      const targetWeeklyHours = resolveTargetWeeklyHours(
        isPartTime,
        maxWeeklyHours,
        nurseMetadata?.targetWeeklyHours,
        fullTimeWeeklyTarget,
        partTimeWeeklyTarget,
      );

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
        preferredShiftLengthHours: nurseMetadata?.preferredShiftLengthHours,
        offRequests: Array.from(offRequests),
      };
    },
  );

  const manualNurseObjects: SchedulerOptimizationNurse[] = manualNurses.map(
    (nurse, idx) => {
      const isPartTime = nurse.employmentType === "PT";
      const maxWeeklyHours =
        nurse.maxHours || getDefaultMaxWeeklyHours(nurse.employmentType);
      const targetWeeklyHours = resolveTargetWeeklyHours(
        isPartTime,
        maxWeeklyHours,
        nurse.targetWeeklyHours,
        fullTimeWeeklyTarget,
        partTimeWeeklyTarget,
      );

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
        preferredShiftLengthHours: nurse.preferredShiftLengthHours,
        offRequests: nurse.offRequests || [],
      };
    },
  );

  const nurseMap = new Map<string, SchedulerOptimizationNurse>();
  for (const nurse of manualNurseObjects) {
    nurseMap.set(nurse.name, nurse);
  }

  for (const nurse of ocrNurseObjects) {
    const existing = nurseMap.get(nurse.name);
    if (existing) {
      nurse.offRequests = [
        ...new Set([
          ...(existing.offRequests || []),
          ...(nurse.offRequests || []),
        ]),
      ];
    }
    nurseMap.set(nurse.name, nurse);
  }

  return Array.from(nurseMap.values());
}
