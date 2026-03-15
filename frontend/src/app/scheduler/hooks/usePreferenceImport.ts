/**
 * usePreferenceImport — Parses nurse preference data from multiple sources
 *
 * Supported intake methods:
 *   1. CSV / Excel upload  (Logibec eEspresso matrix-grid export, generic flat-file)
 *   2. Copy-paste from spreadsheet
 *   3. Manual entry grid
 *
 * Logibec GCH Espresso export format (matrix-grid):
 *   - 3-5 metadata header rows ("Rapport de l'auto-inscription", unit, period, etc.)
 *   - Header row: "Matricule","Nom_Prénom","Statut_FTE","DD-MM-YYYY",...
 *   - Data rows:  "1234567","Zatylny, Alexandra","0.85","OFF","Z07",...
 *   - Concatenated codes: "CF-3 07" (holiday + shift), "Z23 B" (night balance)
 *   - VAC = vacation, OFF = day off, CF-N = statutory holiday
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
  shiftCode: string; // normalised code (e.g., "Z07", "C", "CF-3")
  priority: "primary" | "secondary" | "flexible";
  isOff: boolean; // true if code represents an OFF / vacation / holiday
  fte?: number; // FTE from Statut_FTE column (0.85 = PT, 1.00 = FT)
  holidayModifier?: string; // e.g., "CF-3" when raw is "CF-3 07"
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

/** Logibec-specific codes not in the standard OFF_DAY_CODES list */
const LOGIBEC_OFF_CODES = ["VAC", "VACANCES", "MALADIE", "MAL", "ABS", "FER"];
const LOGIBEC_WORKING_ALIASES = ["VAC"]; // codes that map to OFF

/** All valid shift codes (working + off) for matching */
const ALL_CODES = new Set([
  ...SHIFT_CODES.map((sc) => sc.code.toUpperCase()),
  ...OFF_DAY_CODES.map((sc) => sc.code.toUpperCase()),
  ...LOGIBEC_OFF_CODES,
]);

/** Off-day codes */
const OFF_CODES = new Set([
  ...OFF_DAY_CODES.map((sc) => sc.code.toUpperCase()),
  ...LOGIBEC_OFF_CODES,
]);

/**
 * Logibec metadata row keywords — if a row's first cell contains any of
 * these, it is a report header/metadata row and should be skipped.
 */
const LOGIBEC_META_KEYWORDS = [
  "rapport",
  "généré",
  "genere",
  "unité",
  "unite",
  "période",
  "periode",
  "version",
  "auto-inscription",
  "gch",
];

/** Known Logibec header columns (always French) */
const LOGIBEC_HEADER_MARKERS = [
  "matricule",
  "nom_prénom",
  "nom_prenom",
  "statut_fte",
];

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
    "nom_prénom",
    "nom_prenom",
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

/**
 * Strip RTF (Rich Text Format) markup from text.
 *
 * macOS copy-paste often wraps content in RTF ({\rtf1 …}) instead of
 * plain text. This function extracts the visible text, converting:
 *   - \'XX hex escapes → actual characters (Windows-1252 / Latin-1)
 *   - \<newline>       → line break
 *   - \par, \line      → line break
 *   - \tab             → tab character
 * and stripping font tables, color tables, and all other control words.
 *
 * If the input is NOT RTF, it is returned unchanged.
 */
function stripRtf(text: string): string {
  const trimStart = text.trimStart();
  if (!trimStart.startsWith("{\\rtf")) return text;

  let output = "";
  let depth = 0;
  let skipGroup = false;
  let skipDepth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // ── Opening brace: increase depth, check for groups to skip ──
    if (ch === "{") {
      depth++;
      // Skip known non-content groups (font table, color table, stylesheet, etc.)
      const ahead = text.substring(i, i + 40);
      if (
        /^\{\\(?:fonttbl|colortbl|stylesheet|info|header|footer|\*\\)/.test(
          ahead,
        )
      ) {
        skipGroup = true;
        skipDepth = depth;
      }
      i++;
      continue;
    }

    // ── Closing brace: decrease depth, end skip if matched ──
    if (ch === "}") {
      if (skipGroup && depth === skipDepth) {
        skipGroup = false;
      }
      depth--;
      i++;
      continue;
    }

    // ── While inside a skipped group, consume everything ──
    if (skipGroup) {
      i++;
      continue;
    }

    // ── Backslash: control word or escape ──
    if (ch === "\\") {
      const next = text[i + 1];

      // Hex escape: \'XX  (Windows-1252 byte → char)
      if (next === "'") {
        const hex = text.substring(i + 2, i + 4);
        const code = parseInt(hex, 16);
        if (!isNaN(code)) {
          output += String.fromCharCode(code);
          i += 4;
          continue;
        }
      }

      // Literal escapes: \\  \{  \}
      if (next === "\\" || next === "{" || next === "}") {
        output += next;
        i += 2;
        continue;
      }

      // Line break: \ at end of line
      if (next === "\n" || next === "\r") {
        output += "\n";
        i += 2;
        if (i < text.length && text[i] === "\n") i++; // \r\n
        continue;
      }

      // Control word: \word or \wordN (with optional trailing space delimiter)
      const ctrlMatch = text.substring(i).match(/^\\([a-zA-Z]+)(-?\d+)?\s?/);
      if (ctrlMatch) {
        const word = ctrlMatch[1];
        if (word === "par" || word === "line") output += "\n";
        else if (word === "tab") output += "\t";
        // else: discard (formatting control words)
        i += ctrlMatch[0].length;
        continue;
      }

      // Unknown backslash escape — skip the backslash
      i++;
      continue;
    }

    // ── Regular character: keep it ──
    output += ch;
    i++;
  }

  return output.trim();
}

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

/**
 * Result of normalising a single cell value from the schedule grid.
 * For concatenated codes like "CF-3 07", the shift code is extracted
 * and the holiday modifier is returned separately.
 */
interface NormalisedCode {
  code: string; // The working shift code (e.g., "07") or off code (e.g., "C")
  isOff: boolean; // true if the nurse is OFF / on vacation / holiday-only
  holidayModifier?: string; // e.g., "CF-3" when raw is "CF-3 07"
}

/** Normalise a shift code: trim, uppercase, match against known codes.
 *  Handles Logibec concatenated codes like "CF-3 07", "CF-11 07", "VAC". */
function normaliseShiftCode(raw: string): NormalisedCode {
  const trimmed = raw.trim().toUpperCase();

  // ── 1. Direct match against known codes ──
  if (ALL_CODES.has(trimmed)) {
    return { code: trimmed, isOff: OFF_CODES.has(trimmed) };
  }

  // ── 2. "Z23 B" (Night Balance) — keep the space, it's a real code ──
  if (trimmed === "Z23 B") {
    return { code: "Z23 B", isOff: false };
  }

  // ── 3. Concatenated Logibec holiday + shift: "CF-3 07", "CF-11 Z07" ──
  //    Pattern: CF-<num> <shiftCode>
  const cfShift = trimmed.match(/^(CF(?:-\d{1,2})?)\s+(.+)$/);
  if (cfShift) {
    const [, holidayPart, shiftPart] = cfShift;
    const innerResult = normaliseShiftCode(shiftPart);
    // The nurse IS working (shift code is the real assignment),
    // but on a statutory holiday
    return {
      code: innerResult.code,
      isOff: false, // working on a holiday
      holidayModifier: holidayPart,
    };
  }

  // ── 4. Fuzzy: strip internal spaces (e.g., "Z 07" → "Z07") ──
  const noSpaces = trimmed.replace(/\s+/g, "");
  if (ALL_CODES.has(noSpaces)) {
    return { code: noSpaces, isOff: OFF_CODES.has(noSpaces) };
  }

  // ── 5. Common aliases (EN + FR) ──
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
    VAC: "C",
    V: "C",
    MALADIE: "C",
    MAL: "C",
    ABS: "C",
    FER: "C", // Férié (holiday without shift)
  };
  if (aliases[trimmed]) {
    const code = aliases[trimmed];
    return { code, isOff: true };
  }

  // ── 6. CF-prefix holidays without a shift (pure day off) ──
  if (/^CF(?:-\d{1,2})?$/.test(trimmed)) {
    return { code: trimmed, isOff: true };
  }

  // ── 7. Return raw (will be flagged as warning) ──
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
      (mapping as unknown as Record<string, string | null>)[field] =
        headers[idx];
    }
  }

  return mapping;
}

// ============================================================================
// GRID-FORMAT PARSER (Logibec eEspresso matrix-grid export)
// ============================================================================

/**
 * Detect if the data is in Logibec "matrix-grid" format:
 *
 *   Rows 0-N:  Metadata ("Rapport de l'auto-inscription", unit, period, blank lines)
 *   Row H:     Header — "Matricule","Nom_Prénom","Statut_FTE","DD-MM-YYYY",...
 *   Rows H+1:  Data   — "1234567","Zatylny, Alexandra","0.85","OFF","Z07",...
 *
 * Also supports simpler grids where row 0 is the header with dates.
 */
function tryParseGridFormat(
  rows: string[][],
  warnings: string[],
): ParsedPreferenceRow[] | null {
  if (rows.length < 2) return null;

  // ── Step 1: Find the header row by scanning for date columns ──
  //    Skip Logibec metadata rows ("Rapport…", "Généré…", blank lines)
  let headerRowIdx = -1;
  let dateColumns: { idx: number; date: string }[] = [];
  let matriculeIdx = -1;
  let nameIdx = -1;
  let fteIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;

    // Skip rows that look like Logibec metadata
    const firstCellLower = (row[0] || "").toLowerCase();
    if (
      LOGIBEC_META_KEYWORDS.some((kw) => firstCellLower.includes(kw)) ||
      (firstCellLower === "" && row.every((c) => !c || c.trim() === ""))
    ) {
      continue;
    }

    // Check if this row looks like a header:
    //   a) Contains Logibec column names (Matricule, Nom_Prénom)
    //   b) Has ≥3 columns that parse as dates
    const rowLower = row.map((c) => (c || "").toLowerCase().trim());
    const hasLogibecMarker = LOGIBEC_HEADER_MARKERS.some((m) =>
      rowLower.some((c) => c === m || c.includes(m)),
    );

    // Scan for date columns in this row
    const candidateDates: { idx: number; date: string }[] = [];
    for (let i = 0; i < row.length; i++) {
      const d = normaliseDate(row[i]);
      if (d) candidateDates.push({ idx: i, date: d });
    }

    if (hasLogibecMarker || candidateDates.length >= 3) {
      headerRowIdx = r;
      dateColumns = candidateDates;

      // Identify non-date columns by Logibec header names
      for (let i = 0; i < row.length; i++) {
        const cell = rowLower[i];
        if (
          cell === "matricule" ||
          cell === "no_employé" ||
          cell === "no_employe" ||
          cell === "employee_id"
        ) {
          matriculeIdx = i;
        } else if (
          cell === "nom_prénom" ||
          cell === "nom_prenom" ||
          cell === "nom" ||
          cell === "name"
        ) {
          nameIdx = i;
        } else if (
          cell === "statut_fte" ||
          cell === "fte" ||
          cell === "statut"
        ) {
          fteIdx = i;
        }
      }
      break;
    }
  }

  // Fallback: if no header found, try row 0 as simple grid
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    const header = rows[0];
    for (let i = 1; i < header.length; i++) {
      const d = normaliseDate(header[i]);
      if (d) dateColumns.push({ idx: i, date: d });
    }
  }

  // Need at least 3 date columns to confirm grid format
  if (dateColumns.length < 3) return null;

  // If Logibec columns not detected, assume col 0 = name/id (simple grid)
  const isLogibecFormat = matriculeIdx !== -1 || nameIdx !== -1;

  // ── Step 2: Parse data rows ──
  const parsed: ParsedPreferenceRow[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c || c.trim() === "")) continue; // skip empty

    let employeeId = "";
    let nurseName = "";
    let fte: number | undefined;

    if (isLogibecFormat) {
      // ── Logibec format: explicit columns ──
      employeeId = matriculeIdx !== -1 ? (row[matriculeIdx] || "").trim() : "";
      nurseName = nameIdx !== -1 ? (row[nameIdx] || "").trim() : employeeId;

      if (fteIdx !== -1) {
        const rawFte = (row[fteIdx] || "").trim();
        const parsedFte = parseFloat(rawFte);
        if (!isNaN(parsedFte) && parsedFte > 0 && parsedFte <= 1.5) {
          fte = parsedFte;
        }
      }
    } else {
      // ── Simple grid: col 0 = name or "ID - Name" ──
      const nameOrId = (row[0] || "").trim();
      if (!nameOrId) continue;
      nurseName = nameOrId;

      const dashSplit = nameOrId.match(/^(\d+)\s*[-–]\s*(.+)$/);
      if (dashSplit) {
        employeeId = dashSplit[1];
        nurseName = dashSplit[2].trim();
      }
    }

    if (!nurseName && !employeeId) continue;

    for (const col of dateColumns) {
      const cellValue = (row[col.idx] || "").trim();
      if (!cellValue) continue;

      const { code, isOff, holidayModifier } = normaliseShiftCode(cellValue);

      // Warn on truly unknown codes (not recognised at all)
      if (!ALL_CODES.has(code.toUpperCase()) && !isOff && !holidayModifier) {
        warnings.push(
          `Row ${r + 1}, col ${col.idx + 1}: unknown code "${cellValue}" for ${nurseName || employeeId}`,
        );
      }

      parsed.push({
        employeeId,
        nurseName: nurseName || employeeId,
        date: col.date,
        shiftCode: code,
        priority: "primary",
        isOff,
        fte,
        holidayModifier,
        raw: cellValue,
      });
    }
  }

  if (parsed.length > 0) {
    // Report detection summary
    const nurseCount = new Set(parsed.map((p) => p.employeeId || p.nurseName))
      .size;
    const format = isLogibecFormat ? "Logibec eEspresso" : "generic grid";
    warnings.unshift(
      `Detected ${format} format: ${nurseCount} nurses × ${dateColumns.length} dates (rows ${headerRowIdx + 1}–${rows.length})`,
    );
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
    errors.push("Could not find a Shift Code column. Please check your data.");
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
  // Group by nurse (keyed by Matricule when available)
  const byNurse = new Map<
    string,
    { id: string; name: string; fte?: number; rows: ParsedPreferenceRow[] }
  >();

  for (const row of rows) {
    const key = row.employeeId || row.nurseName;
    if (!byNurse.has(key)) {
      byNurse.set(key, {
        id: row.employeeId,
        name: row.nurseName,
        fte: row.fte,
        rows: [],
      });
    }
    byNurse.get(key)!.rows.push(row);
  }

  const submissions: NurseScheduleSubmission[] = [];

  for (const [, { id, name, fte, rows: nurseRows }] of byNurse) {
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
          // Attach holiday modifier as reason so the engine knows
          reason: row.holidayModifier
            ? `Holiday: ${row.holidayModifier}`
            : undefined,
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

    // Determine if permanent-night based on pattern
    const nightCount = shiftCodes.filter((c) =>
      ["23", "Z19", "Z23", "Z23 B"].includes(c),
    ).length;
    const totalShifts = shiftCodes.length;
    const isPermanentNight = totalShifts > 0 && nightCount / totalShifts >= 0.8;

    submissions.push({
      nurseId: id || name,
      nurseName: name,
      primaryRequests,
      offRequests,
      rotationPreference: "flexible",
      preferredShiftLength:
        has12hr && !has8hr ? "12hr" : has8hr && !has12hr ? "8hr" : "either",
      shiftTypePreference:
        hasNight && !hasDay ? "night" : hasDay && !hasNight ? "day" : "either",
      permanentNightWaiver: isPermanentNight,
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
          const rawText = await file.text();
          // macOS TextEdit can save .csv files as RTF — strip if detected
          const text = stripRtf(rawText);
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

        const flatResult = parseFlatFormat(
          rows,
          mergedMapping,
          warnings,
          errors,
        );
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
        // macOS clipboard often wraps rich-text in RTF — strip if detected
        const cleanText = stripRtf(text);
        const rows = parseCSVString(cleanText);
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

        const flatResult = parseFlatFormat(
          rows,
          mergedMapping,
          warnings,
          errors,
        );
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
  const fromManualEntries = useCallback((entries: ParsedPreferenceRow[]) => {
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
  }, []);

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
