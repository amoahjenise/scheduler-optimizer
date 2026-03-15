/**
 * usePreferenceImport — Parses nurse preference data from multiple sources
 *
 * Supported intake methods:
 *   1. CSV / Excel upload  (eEspresso export, generic flat-file)
 *   2. Copy-paste from spreadsheet
 *   3. Manual entry grid
 *
 * All paths converge on NurseScheduleSubmission[].
 */

import { useState, useCallback } from "react";
import ExcelJS from "exceljs";
import {
  NurseScheduleSubmission,
  ShiftPreference,
  SHIFT_CODES,
  OFF_DAY_CODES,
} from "../types";

// ============================================================================
// TYPES
// ============================================================================

export type ImportSource = "upload" | "paste" | "manual";
export type ImportStatus = "idle" | "parsing" | "preview" | "error";

/** A single parsed row before conversion to NurseScheduleSubmission */
export interface ParsedPreferenceRow {
  employeeId: string;
  nurseName: string;
  date: string; // YYYY-MM-DD
  shiftCode: string; // raw code from source
  priority: "primary" | "secondary" | "flexible";
  isOff: boolean; // true if code represents an OFF / vacation
  raw?: string; // original cell value for debugging
}

/** Column mapping for flexible CSV/Excel parsing */
export interface ColumnMapping {
  employeeId: string | null; // column header for employee ID
  nurseName: string | null; // column header for nurse name
  date: string | null; // column header for date
  shiftCode: string | null; // column header for shift code
  priority: string | null; // column header for priority (optional)
}

/** Import result returned to consumers */
export interface ImportResult {
  submissions: NurseScheduleSubmission[];
  parsedRows: ParsedPreferenceRow[];
  warnings: string[];
  errors: string[];
  source: ImportSource;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** All valid shift codes (working + off) for matching */
const ALL_CODES = new Set([
  ...SHIFT_CODES.map((sc) => sc.code.toUpperCase()),
  ...OFF_DAY_CODES.map((sc) => sc.code.toUpperCase()),
]);

/** Off-day codes */
const OFF_CODES = new Set(
  OFF_DAY_CODES.map((sc) => sc.code.toUpperCase()),
);

/** Common column header synonyms for auto-detection */
const HEADER_SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  employeeId: [
    "employee id",
    "emp id",
    "emp_id",
    "employeeid",
    "employee_id",
    "id employé",
    "matricule",
    "badge",
    "employee number",
    "emp_no",
    "no_emp",
    "user_id",
  ],
  nurseName: [
    "name",
    "nurse",
    "nurse name",
    "employee name",
    "nom",
    "nom_employe",
    "employee",
    "full name",
    "nom complet",
    "infirmier",
    "infirmière",
  ],
  date: [
    "date",
    "shift date",
    "work date",
    "schedule date",
    "jour",
    "date_quart",
    "date_shift",
    "request date",
  ],
  shiftCode: [
    "shift",
    "shift code",
    "code",
    "shift_code",
    "quart",
    "code_quart",
    "assignment",
    "type",
    "shift type",
    "code quart",
  ],
  priority: [
    "priority",
    "priorité",
    "pref",
    "preference",
    "level",
    "importance",
  ],
};

// ============================================================================
// PARSER UTILITIES
// ============================================================================

/** Normalise a date string to YYYY-MM-DD, accepting multiple formats */
function normaliseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // MM/DD/YYYY (US format — try to infer)
  const mdy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    const mNum = parseInt(m, 10);
    if (mNum > 12) {
      // Must be DD/MM/YYYY
      return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
    }
  }

  // Try JS Date parse as fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

/** Normalise a shift code: trim, uppercase, match against known codes */
function normaliseShiftCode(raw: string): { code: string; isOff: boolean } {
  const trimmed = raw.trim().toUpperCase();

  // Direct match
  if (ALL_CODES.has(trimmed)) {
    return { code: trimmed, isOff: OFF_CODES.has(trimmed) };
  }

  // Fuzzy: strip spaces within (e.g., "Z 07" → "Z07")
  const noSpaces = trimmed.replace(/\s+/g, "");
  if (ALL_CODES.has(noSpaces)) {
    return { code: noSpaces, isOff: OFF_CODES.has(noSpaces) };
  }

  // Common aliases
  const aliases: Record<string, string> = {
    DAY: "07",
    "DAY 8": "07",
    "DAY 12": "Z07",
    NIGHT: "23",
    "NIGHT 8": "23",
    "NIGHT 12": "Z19",
    EVENING: "E15",
    "EVE 8": "E15",
    OFF: "C",
    CONGE: "C",
    CONGÉ: "C",
    VACATION: "C",
    VACANCES: "C",
    "V": "C",
  };
  if (aliases[trimmed]) {
    const code = aliases[trimmed];
    return { code, isOff: OFF_CODES.has(code) };
  }

  // CF-prefix holidays
  if (trimmed.startsWith("CF")) {
    return { code: trimmed, isOff: true };
  }

  // Return raw (will be flagged as warning)
  return { code: trimmed, isOff: false };
}

/** Auto-detect column mapping from header row */
function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    employeeId: null,
    nurseName: null,
    date: null,
    shiftCode: null,
    priority: null,
  };

  const normalised = headers.map((h) => h.toLowerCase().trim());

  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    const idx = normalised.findIndex((h) =>
      synonyms.some((syn) => h === syn || h.includes(syn)),
    );
    if (idx !== -1) {
      (mapping as unknown as Record<string, string | null>)[field] = headers[idx];
    }
  }

  return mapping;
}

// ============================================================================
// GRID-FORMAT PARSER (eEspresso / horizontal schedule)
// ============================================================================

/**
 * Detect if the data is in "grid" format where:
 *   Row 0 = header with dates as columns
 *   Rows 1..N = one nurse per row, shift codes in date columns
 *
 * Returns parsed rows if detected, null otherwise.
 */
function tryParseGridFormat(
  rows: string[][],
  warnings: string[],
): ParsedPreferenceRow[] | null {
  if (rows.length < 2 || rows[0].length < 3) return null;

  const header = rows[0];

  // Check if columns 1+ look like dates
  let dateColumns: { idx: number; date: string }[] = [];
  for (let i = 1; i < header.length; i++) {
    const d = normaliseDate(header[i]);
    if (d) dateColumns.push({ idx: i, date: d });
  }

  // Need at least 3 date columns to consider this a grid
  if (dateColumns.length < 3) return null;

  const parsed: ParsedPreferenceRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const nameOrId = (row[0] || "").trim();
    if (!nameOrId) continue;

    // Try to split "LastName, FirstName" or "ID - Name"
    let employeeId = "";
    let nurseName = nameOrId;
    const dashSplit = nameOrId.match(/^(\d+)\s*[-–]\s*(.+)$/);
    if (dashSplit) {
      employeeId = dashSplit[1];
      nurseName = dashSplit[2].trim();
    }

    for (const col of dateColumns) {
      const cellValue = (row[col.idx] || "").trim();
      if (!cellValue) continue;

      const { code, isOff } = normaliseShiftCode(cellValue);
      if (!ALL_CODES.has(code.toUpperCase()) && !isOff) {
        warnings.push(
          `Row ${r + 1}, col ${col.idx + 1}: unknown code "${cellValue}" for ${nurseName}`,
        );
      }

      parsed.push({
        employeeId,
        nurseName,
        date: col.date,
        shiftCode: code,
        priority: "primary",
        isOff,
        raw: cellValue,
      });
    }
  }

  return parsed.length > 0 ? parsed : null;
}

// ============================================================================
// FLAT-FORMAT PARSER (one row per shift request)
// ============================================================================

function parseFlatFormat(
  rows: string[][],
  mapping: ColumnMapping,
  warnings: string[],
  errors: string[],
): ParsedPreferenceRow[] {
  if (rows.length < 2) {
    errors.push("No data rows found.");
    return [];
  }

  const headers = rows[0].map((h) => h.trim());
  const getIdx = (col: string | null) =>
    col ? headers.findIndex((h) => h.toLowerCase() === col.toLowerCase()) : -1;

  const idIdx = getIdx(mapping.employeeId);
  const nameIdx = getIdx(mapping.nurseName);
  const dateIdx = getIdx(mapping.date);
  const codeIdx = getIdx(mapping.shiftCode);
  const prioIdx = getIdx(mapping.priority);

  if (dateIdx === -1) {
    errors.push("Could not find a Date column. Please check your data.");
    return [];
  }
  if (codeIdx === -1) {
    errors.push(
      "Could not find a Shift Code column. Please check your data.",
    );
    return [];
  }
  if (nameIdx === -1 && idIdx === -1) {
    errors.push(
      "Could not find a Nurse Name or Employee ID column. Please check your data.",
    );
    return [];
  }

  const parsed: ParsedPreferenceRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c?.trim())) continue; // skip empty rows

    const rawDate = row[dateIdx] || "";
    const date = normaliseDate(rawDate);
    if (!date) {
      warnings.push(`Row ${r + 1}: could not parse date "${rawDate}"`);
      continue;
    }

    const rawCode = row[codeIdx] || "";
    if (!rawCode.trim()) continue; // skip blank shift entries

    const { code, isOff } = normaliseShiftCode(rawCode);
    const empId = idIdx !== -1 ? (row[idIdx] || "").trim() : "";
    const name = nameIdx !== -1 ? (row[nameIdx] || "").trim() : empId;

    // Priority
    let priority: "primary" | "secondary" | "flexible" = "primary";
    if (prioIdx !== -1) {
      const rawPrio = (row[prioIdx] || "").trim().toLowerCase();
      if (rawPrio === "secondary" || rawPrio === "2") priority = "secondary";
      else if (rawPrio === "flexible" || rawPrio === "3") priority = "flexible";
    }

    parsed.push({
      employeeId: empId,
      nurseName: name,
      date,
      shiftCode: code,
      priority,
      isOff,
      raw: rawCode,
    });
  }

  return parsed;
}

// ============================================================================
// CONVERSION: ParsedPreferenceRow[] → NurseScheduleSubmission[]
// ============================================================================

function rowsToSubmissions(
  rows: ParsedPreferenceRow[],
): NurseScheduleSubmission[] {
  // Group by nurse
  const byNurse = new Map<
    string,
    { id: string; name: string; rows: ParsedPreferenceRow[] }
  >();

  for (const row of rows) {
    const key = row.employeeId || row.nurseName;
    if (!byNurse.has(key)) {
      byNurse.set(key, { id: row.employeeId, name: row.nurseName, rows: [] });
    }
    byNurse.get(key)!.rows.push(row);
  }

  const submissions: NurseScheduleSubmission[] = [];

  for (const [, { id, name, rows: nurseRows }] of byNurse) {
    const primaryRequests: ShiftPreference[] = [];
    const offRequests: string[] = [];

    for (const row of nurseRows) {
      if (row.isOff) {
        offRequests.push(row.date);
      } else {
        primaryRequests.push({
          date: row.date,
          shiftCode: row.shiftCode,
          priority: row.priority,
        });
      }
    }

    // Infer shift preferences from most common patterns
    const shiftCodes = primaryRequests.map((r) => r.shiftCode || "");
    const has12hr = shiftCodes.some((c) =>
      ["Z07", "Z11", "Z19", "Z23", "Z23 B"].includes(c),
    );
    const has8hr = shiftCodes.some((c) =>
      ["07", "11", "E15", "23"].includes(c),
    );
    const hasNight = shiftCodes.some((c) =>
      ["23", "Z19", "Z23", "Z23 B"].includes(c),
    );
    const hasDay = shiftCodes.some((c) =>
      ["07", "Z07", "11", "Z11"].includes(c),
    );

    submissions.push({
      nurseId: id || name,
      nurseName: name,
      primaryRequests,
      offRequests,
      rotationPreference: "flexible",
      preferredShiftLength: has12hr && !has8hr
        ? "12hr"
        : has8hr && !has12hr
          ? "8hr"
          : "either",
      shiftTypePreference: hasNight && !hasDay
        ? "night"
        : hasDay && !hasNight
          ? "day"
          : "either",
      permanentNightWaiver: false,
      weekendAvailability: "both",
      submittedAt: new Date().toISOString(),
    });
  }

  return submissions;
}

// ============================================================================
// HOOK
// ============================================================================

export function usePreferenceImport() {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    employeeId: null,
    nurseName: null,
    date: null,
    shiftCode: null,
    priority: null,
  });

  // ── Parse CSV string ──
  const parseCSVString = useCallback((text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((line) => {
      // Simple CSV parse (handles quoted values)
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if ((ch === "," || ch === "\t" || ch === ";") && !inQuotes) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
  }, []);

  // ── Parse Excel/CSV file ──
  const parseFile = useCallback(
    async (file: File): Promise<void> => {
      setStatus("parsing");
      const warnings: string[] = [];
      const errors: string[] = [];

      try {
        let rows: string[][] = [];
        const ext = file.name.split(".").pop()?.toLowerCase();

        if (ext === "csv" || ext === "tsv" || ext === "txt") {
          const text = await file.text();
          rows = parseCSVString(text);
        } else if (ext === "xlsx" || ext === "xls") {
          const buffer = await file.arrayBuffer();
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);

          const sheet = workbook.worksheets[0];
          if (!sheet) {
            setResult({
              submissions: [],
              parsedRows: [],
              warnings: [],
              errors: ["No worksheets found in the Excel file."],
              source: "upload",
            });
            setStatus("error");
            return;
          }

          sheet.eachRow((row) => {
            const cells = row.values as (string | number | Date | null)[];
            // ExcelJS row.values is 1-indexed, first element is undefined
            const stringCells = cells.slice(1).map((c) => {
              if (c === null || c === undefined) return "";
              if (c instanceof Date) return c.toISOString().split("T")[0];
              return String(c);
            });
            rows.push(stringCells);
          });
        } else {
          errors.push(
            `Unsupported file type: .${ext}. Please use .csv, .tsv, .xlsx, or .xls`,
          );
          setResult({
            submissions: [],
            parsedRows: [],
            warnings: [],
            errors,
            source: "upload",
          });
          setStatus("error");
          return;
        }

        if (rows.length === 0) {
          errors.push("File is empty.");
          setResult({
            submissions: [],
            parsedRows: [],
            warnings: [],
            errors,
            source: "upload",
          });
          setStatus("error");
          return;
        }

        // Try grid format first (eEspresso-style: nurse × dates)
        const gridResult = tryParseGridFormat(rows, warnings);
        if (gridResult) {
          const submissions = rowsToSubmissions(gridResult);
          setResult({
            submissions,
            parsedRows: gridResult,
            warnings,
            errors,
            source: "upload",
          });
          setStatus("preview");
          return;
        }

        // Fall back to flat format (one row per shift request)
        const detected = autoDetectColumns(rows[0]);
        const mergedMapping: ColumnMapping = {
          employeeId: columnMapping.employeeId || detected.employeeId,
          nurseName: columnMapping.nurseName || detected.nurseName,
          date: columnMapping.date || detected.date,
          shiftCode: columnMapping.shiftCode || detected.shiftCode,
          priority: columnMapping.priority || detected.priority,
        };

        // Update detected mapping for the UI
        setColumnMapping(mergedMapping);

        const flatResult = parseFlatFormat(rows, mergedMapping, warnings, errors);
        if (errors.length > 0) {
          setResult({
            submissions: [],
            parsedRows: flatResult,
            warnings,
            errors,
            source: "upload",
          });
          setStatus("error");
          return;
        }

        const submissions = rowsToSubmissions(flatResult);
        setResult({
          submissions,
          parsedRows: flatResult,
          warnings,
          errors,
          source: "upload",
        });
        setStatus("preview");
      } catch (err) {
        setResult({
          submissions: [],
          parsedRows: [],
          warnings: [],
          errors: [
            `Failed to parse file: ${err instanceof Error ? err.message : "Unknown error"}`,
          ],
          source: "upload",
        });
        setStatus("error");
      }
    },
    [parseCSVString, columnMapping],
  );

  // ── Parse pasted text (clipboard from spreadsheet / CSV) ──
  const parsePastedText = useCallback(
    (text: string) => {
      setStatus("parsing");
      const warnings: string[] = [];
      const errors: string[] = [];

      try {
        const rows = parseCSVString(text);
        if (rows.length === 0) {
          errors.push("No data found in pasted text.");
          setResult({
            submissions: [],
            parsedRows: [],
            warnings: [],
            errors,
            source: "paste",
          });
          setStatus("error");
          return;
        }

        // Try grid format first
        const gridResult = tryParseGridFormat(rows, warnings);
        if (gridResult) {
          const submissions = rowsToSubmissions(gridResult);
          setResult({
            submissions,
            parsedRows: gridResult,
            warnings,
            errors,
            source: "paste",
          });
          setStatus("preview");
          return;
        }

        // Flat format
        const detected = autoDetectColumns(rows[0]);
        const mergedMapping: ColumnMapping = {
          employeeId: columnMapping.employeeId || detected.employeeId,
          nurseName: columnMapping.nurseName || detected.nurseName,
          date: columnMapping.date || detected.date,
          shiftCode: columnMapping.shiftCode || detected.shiftCode,
          priority: columnMapping.priority || detected.priority,
        };

        setColumnMapping(mergedMapping);

        const flatResult = parseFlatFormat(rows, mergedMapping, warnings, errors);
        if (errors.length > 0) {
          setResult({
            submissions: [],
            parsedRows: flatResult,
            warnings,
            errors,
            source: "paste",
          });
          setStatus("error");
          return;
        }

        const submissions = rowsToSubmissions(flatResult);
        setResult({
          submissions,
          parsedRows: flatResult,
          warnings,
          errors,
          source: "paste",
        });
        setStatus("preview");
      } catch (err) {
        setResult({
          submissions: [],
          parsedRows: [],
          warnings: [],
          errors: [
            `Parse error: ${err instanceof Error ? err.message : "Unknown error"}`,
          ],
          source: "paste",
        });
        setStatus("error");
      }
    },
    [parseCSVString, columnMapping],
  );

  // ── Create submissions from manual entry data ──
  const fromManualEntries = useCallback(
    (entries: ParsedPreferenceRow[]) => {
      const warnings: string[] = [];
      const submissions = rowsToSubmissions(entries);
      setResult({
        submissions,
        parsedRows: entries,
        warnings,
        errors: [],
        source: "manual",
      });
      setStatus("preview");
    },
    [],
  );

  // ── Reset ──
  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setColumnMapping({
      employeeId: null,
      nurseName: null,
      date: null,
      shiftCode: null,
      priority: null,
    });
  }, []);

  return {
    status,
    result,
    columnMapping,
    setColumnMapping,
    parseFile,
    parsePastedText,
    fromManualEntries,
    reset,
  };
}
