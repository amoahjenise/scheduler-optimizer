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
  targetBiWeeklyHours?: number;
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
  fullTimeBiWeeklyTarget: number;
  partTimeBiWeeklyTarget: number;
}

function resolveTargetWeeklyHours(
  isPartTime: boolean,
  maxWeeklyHours: number,
  explicitTargetWeeklyHours: number | undefined,
  fullTimeBiWeeklyTarget: number,
  partTimeBiWeeklyTarget: number,
): number {
  if (
    typeof explicitTargetWeeklyHours === "number" &&
    Number.isFinite(explicitTargetWeeklyHours) &&
    explicitTargetWeeklyHours > 0
  ) {
    return explicitTargetWeeklyHours;
  }

  const defaultTarget = isPartTime
    ? partTimeBiWeeklyTarget
    : fullTimeBiWeeklyTarget;

  // Support custom PT lines (e.g., 0.6 FTE) when entered as nurse max hours.
  // Bi-weekly: values up to 60h are plausible PT targets.
  if (
    isPartTime &&
    Number.isFinite(maxWeeklyHours) &&
    maxWeeklyHours > 0 &&
    maxWeeklyHours <= 60
  ) {
    return maxWeeklyHours;
  }

  // For FT, allow explicit realistic target override near standard FT range (60-80h bi-weekly).
  if (
    !isPartTime &&
    Number.isFinite(maxWeeklyHours) &&
    maxWeeklyHours >= 60 &&
    maxWeeklyHours <= 80
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

/**
 * Night-start codes whose next-day "tail" in the OCR grid is a visual
 * artefact, NOT a separate worked shift.
 */
const NIGHT_START_CODES = new Set(["Z19", "Z23", "Z23 B", "23"]);
/** Only plain Z23 (without "B") is ever a ghost tail. */
const GHOST_TAIL_CODES = new Set(["Z23"]);

/**
 * Pre-clean an array of shift codes: remove ghost tails left→right.
 * Returns a NEW array (does not mutate the original).
 */
function removeGhostTails(shifts: string[]): string[] {
  const cleaned = [...shifts];
  for (let i = 0; i < cleaned.length - 1; i++) {
    const code = cleaned[i].replace(/\*/g, "").trim().toUpperCase();
    if (!code || !NIGHT_START_CODES.has(code)) continue;
    const next = cleaned[i + 1].replace(/\*/g, "").trim().toUpperCase();
    if (GHOST_TAIL_CODES.has(next)) {
      cleaned[i + 1] = ""; // null out ghost tail
    }
  }
  return cleaned;
}

export function buildSchedulerAssignments(
  ocrGrid: GridRow[],
): Record<string, string[]> {
  return Object.fromEntries(
    ocrGrid.map((row) => [
      row.nurse,
      // De-Duplication Command: clean ghost tails BEFORE data leaves the frontend.
      removeGhostTails(
        row.shifts.map((shift) => {
          const code = shift.shift.replace(/\*/g, "").trim();
          // Wrap-around night tails (marked with ↩ by dedup) are not real shifts.
          // Send empty so the optimizer treats the day as a rest/recovery day.
          if (code.includes("↩")) return "";
          return code;
        }),
      ),
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
      // `maxHours` stored in manual metadata is a bi-weekly value in the
      // UI/DB; convert to a weekly cap for the optimizer's `maxWeeklyHours`.
      const rawMax = nurseMetadata?.maxHours;
      const maxWeeklyHours =
        typeof rawMax === "number" && rawMax > 0
          ? Math.max(0, Number(rawMax) / 2.0)
          : getDefaultMaxWeeklyHours(isPartTime ? "PT" : "FT");

      // Resolve bi-weekly and weekly target hours consistently.  The
      // frontend stores organization-level defaults as bi-weekly values
      // (`fullTimeBiWeeklyTarget`), so expose both fields to the backend
      // to avoid ambiguity: `targetBiWeeklyHours` (bi-weekly) and
      // `targetWeeklyHours` (weekly = bi-weekly / 2).
      const explicitWeeklyTarget = nurseMetadata?.targetWeeklyHours;
      const explicitBiweeklyTarget = (nurseMetadata as any)
        ?.targetBiWeeklyHours;

      let targetBiWeeklyHours: number;
      if (
        typeof explicitWeeklyTarget === "number" &&
        explicitWeeklyTarget > 0
      ) {
        targetBiWeeklyHours = explicitWeeklyTarget * 2.0;
      } else if (
        typeof explicitBiweeklyTarget === "number" &&
        explicitBiweeklyTarget > 0
      ) {
        targetBiWeeklyHours = explicitBiweeklyTarget;
      } else {
        targetBiWeeklyHours = isPartTime
          ? partTimeBiWeeklyTarget
          : fullTimeBiWeeklyTarget;
      }
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
      };
    },
  );

  const manualNurseObjects: SchedulerOptimizationNurse[] = manualNurses.map(
    (nurse, idx) => {
      const isPartTime = nurse.employmentType === "PT";
      // Manual nurse entries come from the nurses UI where `maxHours` and
      // organization defaults are expressed as bi-weekly values. Convert
      // `maxHours` to a weekly cap and expose both weekly+biweekly targets.
      const rawManualMax = nurse.maxHours;
      const manualMaxWeekly =
        typeof rawManualMax === "number" && rawManualMax > 0
          ? Math.max(0, Number(rawManualMax) / 2.0)
          : getDefaultMaxWeeklyHours(nurse.employmentType);

      const explicitWeeklyTargetManual = nurse.targetWeeklyHours;
      const explicitBiweeklyTargetManual = (nurse as any).targetBiWeeklyHours;

      let manualTargetBiweekly: number;
      if (
        typeof explicitWeeklyTargetManual === "number" &&
        explicitWeeklyTargetManual > 0
      ) {
        manualTargetBiweekly = explicitWeeklyTargetManual * 2.0;
      } else if (
        typeof explicitBiweeklyTargetManual === "number" &&
        explicitBiweeklyTargetManual > 0
      ) {
        manualTargetBiweekly = explicitBiweeklyTargetManual;
      } else {
        manualTargetBiweekly = isPartTime
          ? partTimeBiWeeklyTarget
          : fullTimeBiWeeklyTarget;
      }
      const manualTargetWeekly = manualTargetBiweekly / 2.0;

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
        maxWeeklyHours: manualMaxWeekly,
        targetWeeklyHours: manualTargetWeekly,
        targetBiWeeklyHours: manualTargetBiweekly,
        preferredShiftLengthHours: nurse.preferredShiftLengthHours,
        offRequests: nurse.offRequests || [],
      };
    },
  );

  const nurseMap = new Map<string, SchedulerOptimizationNurse>();
  for (const nurse of manualNurseObjects) {
    nurseMap.set(normalizeNurseName(nurse.name), nurse);
  }

  for (const nurse of ocrNurseObjects) {
    const key = normalizeNurseName(nurse.name);
    const existing = nurseMap.get(key);
    if (existing) {
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

      nurseMap.set(key, merged);
      continue;
    }
    nurseMap.set(key, nurse);
  }

  return Array.from(nurseMap.values());
}
