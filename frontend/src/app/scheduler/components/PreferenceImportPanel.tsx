/**
 * PreferenceImportPanel — Multi-source nurse preference intake
 *
 * Tabs:
 *   📤  Upload   — Drag-drop CSV / Excel (eEspresso export, generic flat-file)
 *   📋  Paste    — Copy-paste from spreadsheet / plain text
 *   ✏️  Manual   — Per-nurse shift preference grid
 *
 * All tabs converge on NurseScheduleSubmission[] via usePreferenceImport.
 */

"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  Upload,
  ClipboardPaste,
  PenLine,
  CheckCircle,
  AlertTriangle,
  X,
  FileSpreadsheet,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  usePreferenceImport,
  type ImportSource,
  type ParsedPreferenceRow,
} from "../hooks/usePreferenceImport";
import { NurseScheduleSubmission, SHIFT_CODES, OFF_DAY_CODES } from "../types";

// ============================================================================
// PROPS
// ============================================================================

interface PreferenceImportPanelProps {
  startDate: string;
  endDate: string;
  /** Called when the user confirms the parsed submissions */
  onSubmissionsReady: (submissions: NurseScheduleSubmission[]) => void;
  /** Available nurses from org for auto-complete in manual entry */
  availableNurses?: { id: string; name: string }[];
}

// ============================================================================
// TAB CONFIG
// ============================================================================

const TABS: {
  key: ImportSource;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    key: "upload",
    label: "Upload File",
    icon: <Upload className="w-4 h-4" />,
    desc: "CSV, Excel (.xlsx), or TSV from eEspresso or other systems",
  },
  {
    key: "paste",
    label: "Copy & Paste",
    icon: <ClipboardPaste className="w-4 h-4" />,
    desc: "Paste data from a spreadsheet or text editor",
  },
  {
    key: "manual",
    label: "Manual Entry",
    icon: <PenLine className="w-4 h-4" />,
    desc: "Enter nurse preferences directly",
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function PreferenceImportPanel({
  startDate,
  endDate,
  onSubmissionsReady,
  availableNurses = [],
}: PreferenceImportPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportSource>("upload");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPreview, setShowPreview] = useState(true);

  // Manual entry state
  const [manualRows, setManualRows] = useState<ParsedPreferenceRow[]>([]);
  const [manualNurseName, setManualNurseName] = useState("");
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualDate, setManualDate] = useState(startDate);
  const [manualShiftCode, setManualShiftCode] = useState("07");

  const {
    status,
    result,
    parseFile,
    parsePastedText,
    fromManualEntries,
    reset,
  } = usePreferenceImport();

  // ── File drop / select handlers ──
  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const file = files[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ── Manual entry add row ──
  const addManualRow = useCallback(() => {
    if (!manualNurseName.trim() || !manualDate) return;

    const isOff = OFF_DAY_CODES.some(
      (c) => c.code.toUpperCase() === manualShiftCode.toUpperCase(),
    );

    setManualRows((prev) => [
      ...prev,
      {
        employeeId: manualEmployeeId,
        nurseName: manualNurseName,
        date: manualDate,
        shiftCode: manualShiftCode,
        priority: "primary" as const,
        isOff,
      },
    ]);

    // Advance date to next day
    const d = new Date(manualDate);
    d.setDate(d.getDate() + 1);
    setManualDate(d.toISOString().split("T")[0]);
  }, [manualNurseName, manualEmployeeId, manualDate, manualShiftCode]);

  const removeManualRow = useCallback((idx: number) => {
    setManualRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Generate dates for the period ──
  const periodDates = (() => {
    if (!startDate || !endDate) return [];
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  })();

  // ── Confirm & send submissions ──
  const handleConfirm = useCallback(() => {
    if (result?.submissions && result.submissions.length > 0) {
      onSubmissionsReady(result.submissions);
    }
  }, [result, onSubmissionsReady]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-xl">📥</span> Import Nurse Preferences
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Import preferred schedules from CSV/Excel exports, paste from a
          spreadsheet, or enter manually.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              if (status !== "idle") reset();
            }}
            className={`
              flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all
              ${
                activeTab === tab.key
                  ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {/* ────────── UPLOAD TAB ────────── */}
        {activeTab === "upload" && (
          <div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${
                  dragOver
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                }
              `}
            >
              <FileSpreadsheet className="w-10 h-10 mx-auto text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-700">
                Drag & drop a file here, or click to browse
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Supports: .csv, .tsv, .xlsx, .xls
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Compatible with Logibec GCH eEspresso self-scheduling exports,
                grid schedules, or flat preference lists
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                }}
              />
            </div>

            {/* Logibec format hint */}
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 font-medium">
                How to export from Logibec eEspresso
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-gray-600 space-y-1.5">
                <p>
                  1. Open <strong>Logibec GCH Espresso</strong> →{" "}
                  <em>Workforce Management</em> → <em>Reports</em>
                </p>
                <p>
                  2. Select <strong>Self-Scheduling Export</strong> (Rapport de
                  l&apos;auto-inscription)
                </p>
                <p>3. Choose your unit and period</p>
                <p>
                  4. Export as <strong>CSV (Comma Delimited)</strong>
                </p>
                <p className="text-gray-400 mt-1">
                  The parser automatically skips metadata headers and detects
                  Matricule, Nom_Prénom, Statut_FTE columns and DD-MM-YYYY date
                  format. Concatenated codes like{" "}
                  <code className="bg-gray-200 px-1 rounded">CF-3 07</code> and{" "}
                  <code className="bg-gray-200 px-1 rounded">Z23 B</code> are
                  recognised.
                </p>
              </div>
            </details>
          </div>
        )}

        {/* ────────── PASTE TAB ────────── */}
        {activeTab === "paste" && (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Paste data from Excel, Google Sheets, or any CSV/TSV text. The
              first row should contain headers.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`"Matricule","Nom_Prénom","Statut_FTE","24-08-2025","25-08-2025","26-08-2025"
"1234567","Zatylny, Alexandra","0.85","OFF","Z07","Z07"
"2345678","Sita, Demitra","1.00","VAC","VAC","CF-3 07"

Or flat format:
Employee ID\tName\tDate\tShift Code
12345\tSmith, Jane\t2025-07-01\t07`}
              className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => parsePastedText(pasteText)}
                disabled={!pasteText.trim() || status === "parsing"}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {status === "parsing" ? "Parsing…" : "Parse Data"}
              </button>
              {pasteText && (
                <button
                  onClick={() => {
                    setPasteText("");
                    reset();
                  }}
                  className="px-4 py-2 text-gray-600 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* ────────── MANUAL TAB ────────── */}
        {activeTab === "manual" && (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Add shift preferences one at a time, or bulk-add for a nurse.
            </p>

            {/* Quick-add form */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nurse Name
                  </label>
                  {availableNurses.length > 0 ? (
                    <select
                      value={manualNurseName}
                      onChange={(e) => {
                        setManualNurseName(e.target.value);
                        const nurse = availableNurses.find(
                          (n) => n.name === e.target.value,
                        );
                        if (nurse) setManualEmployeeId(nurse.id);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select nurse…</option>
                      {availableNurses.map((n) => (
                        <option key={n.id} value={n.name}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={manualNurseName}
                      onChange={(e) => setManualNurseName(e.target.value)}
                      placeholder="e.g., Smith, Jane"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Employee ID (optional)
                  </label>
                  <input
                    type="text"
                    value={manualEmployeeId}
                    onChange={(e) => setManualEmployeeId(e.target.value)}
                    placeholder="e.g., 12345"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Date
                  </label>
                  <select
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {periodDates.map((d) => {
                      const day = new Date(d + "T12:00:00").toLocaleDateString(
                        "en-CA",
                        { weekday: "short", month: "short", day: "numeric" },
                      );
                      return (
                        <option key={d} value={d}>
                          {d} ({day})
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Shift Code
                  </label>
                  <select
                    value={manualShiftCode}
                    onChange={(e) => setManualShiftCode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <optgroup label="Working Shifts">
                      {SHIFT_CODES.map((sc) => (
                        <option key={sc.code} value={sc.code}>
                          {sc.code} — {sc.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Off / Holidays">
                      {OFF_DAY_CODES.slice(0, 3).map((sc) => (
                        <option key={sc.code} value={sc.code}>
                          {sc.code} — {sc.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
              <button
                onClick={addManualRow}
                disabled={!manualNurseName.trim() || !manualDate}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                + Add Preference
              </button>
            </div>

            {/* Manual entry list */}
            {manualRows.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {manualRows.length} preference
                    {manualRows.length !== 1 ? "s" : ""} added
                  </span>
                  <button
                    onClick={() => setManualRows([])}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">
                          Nurse
                        </th>
                        <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">
                          Date
                        </th>
                        <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">
                          Shift
                        </th>
                        <th className="px-3 py-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {manualRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 text-gray-800">
                            {row.nurseName}
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {row.date}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                row.isOff
                                  ? "bg-gray-100 text-gray-600"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {row.shiftCode}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <button
                              onClick={() => removeManualRow(idx)}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => fromManualEntries(manualRows)}
                  disabled={manualRows.length === 0}
                  className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Preview Submissions
                </button>
              </div>
            )}
          </div>
        )}

        {/* ────────── PARSING INDICATOR ────────── */}
        {status === "parsing" && (
          <div className="mt-4 flex items-center gap-2 text-blue-600">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            <span className="text-sm">Parsing preferences…</span>
          </div>
        )}

        {/* ────────── ERROR STATE ────────── */}
        {status === "error" && result && (
          <div className="mt-4 space-y-2">
            {result.errors.map((err, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {err}
              </div>
            ))}
            <button
              onClick={reset}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* ────────── PREVIEW STATE ────────── */}
        {status === "preview" && result && (
          <div className="mt-4">
            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div className="mb-3 space-y-1">
                {result.warnings.slice(0, 5).map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
                {result.warnings.length > 5 && (
                  <p className="text-xs text-amber-600">
                    …and {result.warnings.length - 5} more warnings
                  </p>
                )}
              </div>
            )}

            {/* Summary */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-800">
                  Preferences parsed successfully
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-green-700 font-semibold text-lg">
                    {result.submissions.length}
                  </span>
                  <span className="text-green-600 ml-1">
                    nurse{result.submissions.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div>
                  <span className="text-green-700 font-semibold text-lg">
                    {result.parsedRows.filter((r) => !r.isOff).length}
                  </span>
                  <span className="text-green-600 ml-1">shift preferences</span>
                </div>
                <div>
                  <span className="text-green-700 font-semibold text-lg">
                    {result.parsedRows.filter((r) => r.isOff).length}
                  </span>
                  <span className="text-green-600 ml-1">off requests</span>
                </div>
              </div>
            </div>

            {/* Collapsible preview table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowPreview((p) => !p)}
                className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                <span>Preview by Nurse</span>
                {showPreview ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {showPreview &&
                (() => {
                  // Derive FTE map from parsedRows
                  const fteMap = new Map<string, number>();
                  for (const row of result.parsedRows) {
                    if (row.fte != null && !fteMap.has(row.nurseName)) {
                      fteMap.set(row.nurseName, row.fte);
                    }
                  }
                  return (
                    <div className="max-h-64 overflow-y-auto">
                      {result.submissions.map((sub) => {
                        const fte = fteMap.get(sub.nurseName);
                        const holidayShifts = sub.primaryRequests.filter(
                          (p) => p.reason && p.reason.startsWith("Holiday:"),
                        );
                        return (
                          <div
                            key={sub.nurseId}
                            className="px-4 py-3 border-t border-gray-100"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-800">
                                {sub.nurseName}
                                {sub.nurseId !== sub.nurseName && (
                                  <span className="text-gray-400 ml-1 text-xs">
                                    ({sub.nurseId})
                                  </span>
                                )}
                                {fte != null && (
                                  <span
                                    className={`ml-1.5 px-1.5 py-0.5 rounded text-xs font-normal ${
                                      fte >= 1.0
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-amber-50 text-amber-700"
                                    }`}
                                  >
                                    {fte >= 1.0 ? "FT" : `PT ${fte}`}
                                  </span>
                                )}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>
                                  {sub.primaryRequests.length} shift
                                  {sub.primaryRequests.length !== 1 ? "s" : ""}
                                </span>
                                {sub.offRequests.length > 0 && (
                                  <span>• {sub.offRequests.length} off</span>
                                )}
                                {holidayShifts.length > 0 && (
                                  <span className="text-purple-600">
                                    • {holidayShifts.length} holiday
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-gray-100">
                                  {sub.preferredShiftLength}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-gray-100">
                                  {sub.shiftTypePreference}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {sub.primaryRequests
                                .slice(0, 14)
                                .map((pref, i) => (
                                  <span
                                    key={i}
                                    className={`px-1.5 py-0.5 rounded text-xs ${
                                      pref.reason?.startsWith("Holiday:")
                                        ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200"
                                        : "bg-blue-50 text-blue-700"
                                    }`}
                                    title={pref.reason || undefined}
                                  >
                                    {pref.date.slice(5)} {pref.shiftCode}
                                    {pref.reason?.startsWith("Holiday:") &&
                                      " 🏖"}
                                  </span>
                                ))}
                              {sub.offRequests.slice(0, 5).map((d, i) => (
                                <span
                                  key={`off-${i}`}
                                  className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600"
                                >
                                  {d.slice(5)} OFF
                                </span>
                              ))}
                              {sub.primaryRequests.length +
                                sub.offRequests.length >
                                19 && (
                                <span className="text-xs text-gray-400">
                                  +
                                  {sub.primaryRequests.length +
                                    sub.offRequests.length -
                                    19}{" "}
                                  more
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleConfirm}
                className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Confirm & Use Preferences
              </button>
              <button
                onClick={reset}
                className="px-4 py-2 text-gray-600 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
