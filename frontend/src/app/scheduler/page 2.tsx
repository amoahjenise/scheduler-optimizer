"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { motion } from "framer-motion";
import UploadInput from "../components/UploadInput";
import EditableOCRGrid from "../components/EditableOCRGrid";
import SchedulePreview from "../components/SchedulePreview";
import StaffRequirementsEditor from "../components/StaffRequirementsEditor";
import SystemPrompt from "../components/SystemPrompt";
import AutoCommentsBox from "../components/AutoCommentsBox";
import {
  parseImageWithFastAPI,
  optimizeScheduleAPI,
  finalizeScheduleAPI,
} from "../lib/api";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

interface ShiftEntry {
  date: string;
  shift: string;
  shiftType: "day" | "night";
  hours: number;
  startTime: string;
  endTime: string;
}

type GridRow = { id: string; nurse: string; shifts: ShiftEntry[] };

type Step = "setup" | "upload" | "review" | "optimize" | "result";

// Shift codes for the hospital schedule
const SHIFT_CODES = [
  {
    code: "D8-",
    start: "07:00",
    end: "15:15",
    hours: 8,
    type: "day" as const,
    label: "Day 8hr",
  },
  {
    code: "E8-",
    start: "15:00",
    end: "23:15",
    hours: 8,
    type: "day" as const,
    label: "Evening 8hr",
  },
  {
    code: "N8-",
    start: "23:00",
    end: "07:15",
    hours: 8,
    type: "night" as const,
    label: "Night 8hr",
  },
  {
    code: "N8+ZE2-",
    start: "23:00",
    end: "07:15",
    hours: 12,
    type: "night" as const,
    label: "Night+Eve 12hr",
  },
  {
    code: "ZD12-",
    start: "07:00",
    end: "19:25",
    hours: 12,
    type: "day" as const,
    label: "Day 12hr",
  },
  {
    code: "ZE2-",
    start: "19:00",
    end: "23:00",
    hours: 4,
    type: "night" as const,
    label: "Evening 4hr",
  },
  {
    code: "ZN-",
    start: "23:00",
    end: "07:25",
    hours: 8,
    type: "night" as const,
    label: "Night 8hr+",
  },
  {
    code: "ZN+ZE2-",
    start: "23:00",
    end: "07:25",
    hours: 12,
    type: "night" as const,
    label: "Night+Eve 12hr+",
  },
  {
    code: "Z11",
    start: "11:00",
    end: "23:25",
    hours: 12,
    type: "day" as const,
    label: "Mid 12hr",
  },
  {
    code: "11",
    start: "11:00",
    end: "19:15",
    hours: 8,
    type: "day" as const,
    label: "Mid 8hr",
  },
];

export default function SchedulerPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // Step management
  const [currentStep, setCurrentStep] = useState<Step>("setup");

  // Step 1: Setup
  const today = new Date().toISOString().split("T")[0];
  const twoWeeksLater = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeksLater);
  const [rules, setRules] = useState("");
  const [marker, setMarker] = useState("");

  // Step 2: Upload & OCR
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Step 3: Review
  const [ocrDates, setOcrDates] = useState<string[]>([]);
  const [ocrGrid, setOcrGrid] = useState<GridRow[]>([]);
  const [autoComments, setAutoComments] = useState<string>("");
  const [commentValidationErrors, setCommentValidationErrors] = useState<
    string[]
  >([]);

  // Step 4: Optimize
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeMethod, setOptimizeMethod] = useState<"math" | "ai">("math");

  // Step 5: Result
  const [optimizedGrid, setOptimizedGrid] = useState<GridRow[]>([]);
  const [savedScheduleId, setSavedScheduleId] = useState<string | null>(null);
  const [isFinalized, setIsFinalized] = useState(false);

  // Staff requirements
  const [requiredStaff, setRequiredStaff] = useState<
    Record<string, Record<string, number>>
  >({});
  const [shiftHours, setShiftHours] = useState<Record<string, number>>({
    Morning: 8,
    Afternoon: 8,
    Evening: 8,
  });

  const shiftTypes = ["Morning", "Afternoon", "Evening"];

  // Auto-save key for localStorage
  const STORAGE_KEY = "scheduler_draft_state";

  // Load saved state from localStorage on mount
  useEffect(() => {
    try {
      const savedState = localStorage.getItem(STORAGE_KEY);
      if (savedState) {
        const parsed = JSON.parse(savedState);
        console.log("Restoring scheduler state from localStorage...");

        // Restore all saved fields
        if (parsed.currentStep) setCurrentStep(parsed.currentStep);
        if (parsed.startDate) setStartDate(parsed.startDate);
        if (parsed.endDate) setEndDate(parsed.endDate);
        if (parsed.rules) setRules(parsed.rules);
        if (parsed.marker) setMarker(parsed.marker);
        if (parsed.ocrDates) setOcrDates(parsed.ocrDates);
        if (parsed.ocrGrid) setOcrGrid(parsed.ocrGrid);
        if (parsed.autoComments) setAutoComments(parsed.autoComments);
        if (parsed.optimizeMethod) setOptimizeMethod(parsed.optimizeMethod);
        if (parsed.optimizedGrid) setOptimizedGrid(parsed.optimizedGrid);
        if (parsed.requiredStaff) setRequiredStaff(parsed.requiredStaff);
        if (parsed.shiftHours) setShiftHours(parsed.shiftHours);
        if (parsed.savedScheduleId) setSavedScheduleId(parsed.savedScheduleId);
        if (parsed.isFinalized) setIsFinalized(parsed.isFinalized);

        console.log("Scheduler state restored successfully");
      }
    } catch (error) {
      console.error("Error loading saved scheduler state:", error);
    }
  }, []);

  // Auto-save state to localStorage whenever key state changes
  const saveState = useCallback(() => {
    try {
      const stateToSave = {
        currentStep,
        startDate,
        endDate,
        rules,
        marker,
        ocrDates,
        ocrGrid,
        autoComments,
        optimizeMethod,
        optimizedGrid,
        requiredStaff,
        shiftHours,
        savedScheduleId,
        isFinalized,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error("Error saving scheduler state:", error);
    }
  }, [
    currentStep,
    startDate,
    endDate,
    rules,
    marker,
    ocrDates,
    ocrGrid,
    autoComments,
    optimizeMethod,
    optimizedGrid,
    requiredStaff,
    shiftHours,
    savedScheduleId,
    isFinalized,
  ]);

  // Save on every state change with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveState();
    }, 500); // Debounce saves by 500ms

    return () => clearTimeout(timeoutId);
  }, [saveState]);

  // Clear saved state when user explicitly starts new
  function clearSavedState() {
    localStorage.removeItem(STORAGE_KEY);
    console.log("Scheduler saved state cleared");
  }

  // Helper function to parse shift code to ShiftEntry
  function parseShiftCode(shiftCode: string, date: string): ShiftEntry {
    const code = shiftCode.trim().toUpperCase();

    // Find matching shift code from our reference
    const matchedShift = SHIFT_CODES.find(
      (s) =>
        s.code.toUpperCase() === code || code.includes(s.code.toUpperCase()),
    );

    if (matchedShift) {
      return {
        date,
        shift: shiftCode.trim(),
        shiftType: matchedShift.type,
        hours: matchedShift.hours,
        startTime: matchedShift.start,
        endTime: matchedShift.end,
      };
    }

    // Handle common codes
    if (
      !shiftCode ||
      shiftCode.trim() === "" ||
      shiftCode.toLowerCase() === "off" ||
      shiftCode === "c"
    ) {
      return {
        date,
        shift: shiftCode.trim() || "",
        shiftType: "day",
        hours: 0,
        startTime: "",
        endTime: "",
      };
    }

    // Default for unknown codes
    return {
      date,
      shift: shiftCode.trim(),
      shiftType: "day",
      hours: 8,
      startTime: "07:00",
      endTime: "15:00",
    };
  }

  // Helper function to normalize nurse names for deduplication
  function normalizeNurseName(name: string): string {
    // Normalize: lowercase, collapse whitespace, remove extra info after numbers
    let normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
    // Remove trailing employee IDs or codes (e.g., "John Doe 42564 7Y-339.27D" -> "john doe")
    // Keep only the first two words (first name + last name)
    const parts = normalized.split(" ");
    if (parts.length >= 2) {
      // Check if third part is numeric (employee ID)
      if (parts.length > 2 && /^\d+$/.test(parts[2])) {
        normalized = parts.slice(0, 2).join(" ");
      }
    }
    return normalized;
  }

  // Run OCR on uploaded images
  async function runOCR() {
    if (screenshots.length === 0) return;

    setOcrLoading(true);
    setOcrError(null);

    try {
      const allDates = new Set<string>();
      // Use normalized name as key, but store original name for display
      const combinedGrid: Record<
        string,
        { displayName: string; shifts: Record<string, ShiftEntry> }
      > = {};
      const extractedComments: string[] = []; // Collect marker comments (cells with *)

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

            // Normalize nurse name for deduplication
            const normalizedName = normalizeNurseName(nurseName);

            // Merge with existing entry or create new one
            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: nurseName,
                shifts: {},
              };
            }

            // Map shifts array to dates
            const dates = Array.from(allDates).sort();
            if (row.shifts && Array.isArray(row.shifts)) {
              row.shifts.forEach((shift: string, idx: number) => {
                if (idx < dates.length) {
                  const date = dates[idx];
                  // Only update if current entry is empty or this is a real shift
                  const existingShift =
                    combinedGrid[normalizedName].shifts[date];
                  const isExistingEmpty =
                    !existingShift || !existingShift.shift;

                  // Extract comments from cells containing * marker
                  if (shift && shift.includes("*")) {
                    const cleanShift = shift.replace(/\*/g, "").trim();
                    extractedComments.push(
                      `${nurseName}|${date}|${cleanShift} (marker note)`,
                    );
                    if (isExistingEmpty || cleanShift) {
                      combinedGrid[normalizedName].shifts[date] =
                        parseShiftCode(cleanShift, date);
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

        // Handle rows format (alternative format)
        if (result.rows && Array.isArray(result.rows)) {
          for (const row of result.rows) {
            const nurseName = row.nurse?.trim();
            if (!nurseName) continue;

            // Normalize nurse name for deduplication
            const normalizedName = normalizeNurseName(nurseName);

            // Merge with existing entry or create new one
            if (!combinedGrid[normalizedName]) {
              combinedGrid[normalizedName] = {
                displayName: nurseName,
                shifts: {},
              };
            }

            for (const shift of row.shifts) {
              if (shift && shift.date) {
                const existingShift =
                  combinedGrid[normalizedName].shifts[shift.date];
                const isExistingEmpty = !existingShift || !existingShift.shift;

                // Extract comments from cells containing * marker
                if (shift.shift && shift.shift.includes("*")) {
                  const cleanShift = shift.shift.replace(/\*/g, "").trim();
                  extractedComments.push(
                    `${nurseName}|${shift.date}|${cleanShift} (marker note)`,
                  );
                  if (isExistingEmpty || cleanShift) {
                    combinedGrid[normalizedName].shifts[shift.date] = {
                      ...shift,
                      shift: cleanShift,
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

      // Set auto-comments from extracted markers
      if (extractedComments.length > 0) {
        setAutoComments(extractedComments.join("\n"));
      }

      const sortedDates = Array.from(allDates).sort();
      const gridRows: GridRow[] = Object.entries(combinedGrid).map(
        ([, data], idx) => ({
          id: String(idx),
          nurse: data.displayName,
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

      // Sort by nurse name for consistent ordering
      gridRows.sort((a, b) => a.nurse.localeCompare(b.nurse));

      setOcrDates(sortedDates);
      setOcrGrid(gridRows);
      setCurrentStep("review");
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setOcrLoading(false);
    }
  }

  // Math-based optimization (constraint satisfaction)
  function optimizeWithMath(): GridRow[] {
    const result: GridRow[] = [];

    // Simple constraint-based assignment
    // Rules: 1) No more than 5 consecutive days, 2) Balance workload
    for (const row of ocrGrid) {
      const optimizedShifts: ShiftEntry[] = [];
      let consecutiveDays = 0;

      for (const shift of row.shifts) {
        if (shift.shift && shift.shift.trim() !== "" && shift.shift !== "OFF") {
          // Check consecutive days constraint
          if (consecutiveDays >= 5) {
            // Force a day off after 5 consecutive days
            optimizedShifts.push({
              ...shift,
              shift: "OFF",
              hours: 0,
            });
            consecutiveDays = 0;
          } else {
            optimizedShifts.push(shift);
            consecutiveDays++;
          }
        } else {
          optimizedShifts.push(shift);
          if (shift.shift === "OFF" || !shift.shift) {
            consecutiveDays = 0;
          }
        }
      }

      result.push({
        id: row.id,
        nurse: row.nurse,
        shifts: optimizedShifts,
      });
    }

    return result;
  }

  // Run optimization
  async function runOptimization() {
    setOptimizing(true);

    try {
      if (optimizeMethod === "math") {
        // Use math-based optimization first
        const mathResult = optimizeWithMath();
        setOptimizedGrid(mathResult);
      } else {
        // Use AI optimization
        const nurses = ocrGrid.map((r) => r.nurse);
        const assignments: Record<string, string[]> = {};
        const comments: Record<string, Record<string, string>> = {};

        for (const row of ocrGrid) {
          assignments[row.nurse] = row.shifts.map((s) => s.shift);
          comments[row.nurse] = {};
        }

        // Parse rules into Record<string, number>
        const parsedRules: Record<string, number> = {};
        const ruleLines = rules.split("\n");
        for (const line of ruleLines) {
          const [key, value] = line.split("=").map((s) => s.trim());
          if (key && value) {
            const num = parseInt(value);
            if (!isNaN(num)) parsedRules[key] = num;
          }
        }

        // Calculate min/max staff requirements from the staff requirements editor
        let minDayStaff = 3; // Default minimum
        let minNightStaff = 2; // Default minimum

        // Check if user set requirements
        if (Object.keys(requiredStaff).length > 0) {
          const dayTotals: number[] = [];
          const nightTotals: number[] = [];

          for (const date of Object.keys(requiredStaff)) {
            const dayReqs = requiredStaff[date];
            const morning = dayReqs["Morning"] || 0;
            const afternoon = dayReqs["Afternoon"] || 0;
            const evening = dayReqs["Evening"] || 0;

            // Morning + Afternoon = day coverage needs
            dayTotals.push(Math.max(morning, afternoon));
            // Evening = night coverage needs
            nightTotals.push(evening);
          }

          if (dayTotals.length > 0) {
            minDayStaff = Math.max(
              minDayStaff,
              Math.round(
                dayTotals.reduce((a, b) => a + b, 0) / dayTotals.length,
              ),
            );
          }
          if (nightTotals.length > 0) {
            minNightStaff = Math.max(
              minNightStaff,
              Math.round(
                nightTotals.reduce((a, b) => a + b, 0) / nightTotals.length,
              ),
            );
          }
        }

        const payload = {
          schedule_id: null,
          nurses,
          dates: ocrDates,
          assignments,
          comments,
          rules: parsedRules,
          notes: `STAFFING REQUIREMENTS: minDayStaff=${minDayStaff}, minNightStaff=${minNightStaff}. Total nurses: ${nurses.length}`,
          staffRequirements: {
            minDayStaff,
            minNightStaff,
          },
        };

        const response = await optimizeScheduleAPI(payload);

        // Convert response to GridRow format
        if (response.optimized_schedule) {
          const newGrid: GridRow[] = Object.entries(
            response.optimized_schedule,
          ).map(([nurse, shifts], idx) => ({
            id: String(idx),
            nurse,
            shifts: shifts as ShiftEntry[],
          }));
          setOptimizedGrid(newGrid);

          // Save the schedule ID for later finalization
          if (response.id) {
            setSavedScheduleId(response.id);
            setIsFinalized(false);
          }
        }
      }

      setCurrentStep("result");
    } catch (err) {
      alert(
        "Optimization failed: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setOptimizing(false);
    }
  }

  // Step indicators
  const steps: { key: Step; label: string }[] = [
    { key: "setup", label: "Setup" },
    { key: "upload", label: "Upload" },
    { key: "review", label: "Review" },
    { key: "optimize", label: "Optimize" },
    { key: "result", label: "Result" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <a
                href="/dashboard"
                className="text-sm text-blue-600 hover:underline mb-1 inline-block"
              >
                ← Back to Dashboard
              </a>
              <h1 className="text-2xl font-semibold text-gray-900">
                Schedule Optimizer
              </h1>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center gap-2">
              {steps.map((step, idx) => (
                <div key={step.key} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      idx < currentStepIndex
                        ? "bg-green-500 text-white"
                        : idx === currentStepIndex
                          ? "bg-blue-600 text-white"
                          : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {idx < currentStepIndex ? (
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={`w-8 h-0.5 ${idx < currentStepIndex ? "bg-green-500" : "bg-gray-200"}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Step 1: Setup */}
        {currentStep === "setup" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                1. Set Date Range
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Shift Codes Reference */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-xl">🕐</span> Shift Codes Reference
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {SHIFT_CODES.map((shift) => (
                  <div
                    key={shift.code}
                    className={`p-2 rounded-lg border text-center ${
                      shift.type === "day"
                        ? "bg-amber-50 border-amber-200"
                        : shift.type === "night"
                          ? "bg-indigo-50 border-indigo-200"
                          : "bg-purple-50 border-purple-200"
                    }`}
                  >
                    <div className="font-mono font-bold text-sm">
                      {shift.code}
                    </div>
                    <div className="text-[10px] text-gray-600">
                      {shift.start}–{shift.end}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {shift.hours}h
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-200 mr-1"></span>{" "}
                Day
                <span className="inline-block w-3 h-3 rounded bg-indigo-100 border border-indigo-200 ml-3 mr-1"></span>{" "}
                Night
                <span className="inline-block w-3 h-3 rounded bg-purple-100 border border-purple-200 ml-3 mr-1"></span>{" "}
                Combined
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                3. Scheduling Rules (Optional)
              </h2>
              <p className="text-sm text-gray-500 mb-3">
                Add unit-specific or period-specific rules not covered by the
                system defaults.
              </p>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Examples of custom rules you can add:&#10;&#10;• Nurse X is on vacation Mar 10-15&#10;• Nurse Y can only work day shifts this period&#10;• Need extra coverage on weekends (6 nurses minimum)&#10;• Nurse Z is precepting - pair with senior nurse&#10;• Float pool available: Nurse A, Nurse B&#10;• No overtime for part-time staff this period"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-40 resize-none"
              />
            </div>

            {/* Advanced Settings - Collapsible */}
            <details className="bg-white rounded-xl border border-gray-200">
              <summary className="px-6 py-4 cursor-pointer select-none flex items-center justify-between hover:bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">⚙️</span>
                  <span className="font-medium text-gray-700">
                    Advanced Settings
                  </span>
                </div>
                <span className="text-gray-400 text-sm">Click to expand</span>
              </summary>
              <div className="px-6 pb-6 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  System Prompt
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Review and customize the AI system prompt. This controls how
                  the optimizer interprets your schedule data.
                </p>
                <SystemPrompt />
              </div>
            </details>

            <div className="flex justify-end">
              <button
                onClick={() => setCurrentStep("upload")}
                disabled={
                  !startDate ||
                  !endDate ||
                  new Date(startDate) > new Date(endDate)
                }
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Upload
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Upload */}
        {currentStep === "upload" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Upload Schedule Images
              </h2>
              <p className="text-gray-500 text-sm mb-4">
                Upload screenshots or photos of your current schedule.
                We&apos;ll extract the data using OCR.
              </p>

              <UploadInput
                screenshots={screenshots}
                setScreenshots={setScreenshots}
              />

              {screenshots.length > 0 && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-sm text-gray-600">
                    {screenshots.length} file(s) selected
                  </span>
                </div>
              )}

              {ocrError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  {ocrError}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("setup")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={runOCR}
                disabled={screenshots.length === 0 || ocrLoading}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {ocrLoading ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Processing...
                  </>
                ) : (
                  "Extract Data"
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Review */}
        {currentStep === "review" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Review Extracted Data
              </h2>
              <p className="text-gray-500 text-sm mb-4">
                Review and edit the extracted schedule data. Click any cell to
                modify.
              </p>

              <div className="overflow-x-auto">
                <EditableOCRGrid
                  ocrDates={ocrDates}
                  ocrGrid={ocrGrid}
                  setOcrGrid={setOcrGrid}
                  marker={marker}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Staff Requirements (Optional)
              </h2>
              <StaffRequirementsEditor
                ocrDates={ocrDates}
                shiftTypes={shiftTypes}
                requiredStaff={requiredStaff}
                setRequiredStaff={setRequiredStaff}
                shiftHours={shiftHours}
                setShiftHours={setShiftHours}
              />
            </div>

            {/* Auto-detected marker comments from OCR */}
            {autoComments && (
              <AutoCommentsBox
                autoComments={autoComments}
                setAutoComments={setAutoComments}
                validationErrors={commentValidationErrors}
              />
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("upload")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={() => setCurrentStep("optimize")}
                disabled={ocrGrid.length === 0}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Continue to Optimize
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Optimize */}
        {currentStep === "optimize" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Choose Optimization Method
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setOptimizeMethod("math")}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    optimizeMethod === "math"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        Algorithm-Based
                      </h3>
                      <span className="text-xs text-green-600 font-medium">
                        Recommended
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">
                    Uses constraint satisfaction algorithms to find optimal
                    assignments. Fast and deterministic.
                  </p>
                </button>

                <button
                  onClick={() => setOptimizeMethod("ai")}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    optimizeMethod === "ai"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-purple-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        AI-Powered
                      </h3>
                      <span className="text-xs text-purple-600 font-medium">
                        Advanced
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">
                    Uses AI to understand complex rules and preferences. Better
                    for nuanced scheduling needs.
                  </p>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Period:</span>
                  <p className="font-medium">
                    {startDate} to {endDate}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Staff Members:</span>
                  <p className="font-medium">{ocrGrid.length}</p>
                </div>
                <div>
                  <span className="text-gray-500">Days:</span>
                  <p className="font-medium">{ocrDates.length}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("review")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={runOptimization}
                disabled={optimizing}
                className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {optimizing ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Optimizing...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Run Optimization
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 5: Result */}
        {currentStep === "result" && optimizedGrid.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <svg
                className="w-6 h-6 text-green-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1">
                <h3 className="font-semibold text-green-800">
                  Optimization Complete!
                </h3>
                <p className="text-sm text-green-700">
                  Your schedule has been optimized using the {optimizeMethod}{" "}
                  method and saved to the database.
                </p>
              </div>
              {savedScheduleId && (
                <div className="flex items-center gap-2">
                  {isFinalized ? (
                    <span className="px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-full">
                      ✓ Finalized
                    </span>
                  ) : (
                    <button
                      onClick={async () => {
                        try {
                          await finalizeScheduleAPI(savedScheduleId);
                          setIsFinalized(true);
                          alert("Schedule has been finalized and approved!");
                        } catch (err) {
                          alert(
                            "Failed to finalize schedule: " +
                              (err instanceof Error
                                ? err.message
                                : "Unknown error"),
                          );
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                    >
                      Finalize & Approve
                    </button>
                  )}
                </div>
              )}
            </div>

            {savedScheduleId && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-700">
                  <span className="font-medium">Schedule ID:</span>{" "}
                  {savedScheduleId}
                  <span className="ml-4 text-blue-600">
                    (Auto-saved to database - you can close this page and
                    retrieve it later)
                  </span>
                </p>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Optimized Schedule
              </h2>
              <SchedulePreview ocrGrid={optimizedGrid} ocrDates={ocrDates} />
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep("optimize")}
                className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
              >
                ← Back to Optimize
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    // Reset and start over - clear saved state too
                    clearSavedState();
                    setCurrentStep("setup");
                    setOptimizedGrid([]);
                    setOcrGrid([]);
                    setOcrDates([]);
                    setScreenshots([]);
                    setRules("");
                    setAutoComments("");
                    setRequiredStaff({});
                  }}
                  className="px-6 py-2 text-gray-600 font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Start New
                </button>
                <button
                  onClick={async () => {
                    // Export as Excel with calendar-like formatting using ExcelJS
                    const workbook = new ExcelJS.Workbook();
                    workbook.creator = "Schedule Optimizer";
                    workbook.created = new Date();

                    const worksheet = workbook.addWorksheet("Schedule", {
                      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
                    });

                    // Define colors for shift types
                    const dayColor = { argb: "FFFEF3C7" }; // Amber-100
                    const nightColor = { argb: "FFE0E7FF" }; // Indigo-100
                    const offColor = { argb: "FFF3F4F6" }; // Gray-100
                    const headerColor = { argb: "FF3B82F6" }; // Blue-500
                    const totalRowColor = { argb: "FFDBEAFE" }; // Blue-100

                    // Create header row
                    const headerRow = worksheet.addRow([
                      "Nurse",
                      ...ocrDates.map((d) => {
                        const date = new Date(d);
                        const dayName = date.toLocaleDateString("en-US", {
                          weekday: "short",
                        });
                        const dayNum = date.getDate();
                        const month = date.toLocaleDateString("en-US", {
                          month: "short",
                        });
                        return `${dayName}\n${month} ${dayNum}`;
                      }),
                    ]);

                    // Style header row
                    headerRow.height = 35;
                    headerRow.eachCell((cell, colNumber) => {
                      cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: headerColor,
                      };
                      cell.font = {
                        bold: true,
                        color: { argb: "FFFFFFFF" },
                        size: 11,
                      };
                      cell.alignment = {
                        vertical: "middle",
                        horizontal: "center",
                        wrapText: true,
                      };
                      cell.border = {
                        top: { style: "thin" },
                        left: { style: "thin" },
                        bottom: { style: "thin" },
                        right: { style: "thin" },
                      };
                    });

                    // Add data rows
                    optimizedGrid.forEach((row) => {
                      const shiftByDate: Record<
                        string,
                        { shift: string; type: string }
                      > = {};
                      row.shifts.forEach((s) => {
                        shiftByDate[s.date] = {
                          shift: s.shift || "OFF",
                          type: s.shiftType,
                        };
                      });

                      const dataRow = worksheet.addRow([
                        row.nurse,
                        ...ocrDates.map((d) => shiftByDate[d]?.shift || "OFF"),
                      ]);

                      // Style data cells
                      dataRow.eachCell((cell, colNumber) => {
                        cell.border = {
                          top: { style: "thin", color: { argb: "FFE5E7EB" } },
                          left: { style: "thin", color: { argb: "FFE5E7EB" } },
                          bottom: {
                            style: "thin",
                            color: { argb: "FFE5E7EB" },
                          },
                          right: { style: "thin", color: { argb: "FFE5E7EB" } },
                        };
                        cell.alignment = {
                          vertical: "middle",
                          horizontal: "center",
                        };

                        if (colNumber === 1) {
                          // Nurse name column
                          cell.font = { bold: true };
                          cell.alignment = {
                            vertical: "middle",
                            horizontal: "left",
                          };
                        } else {
                          // Shift cells - color based on type
                          const dateIdx = colNumber - 2;
                          const date = ocrDates[dateIdx];
                          const shiftInfo = shiftByDate[date];

                          if (
                            !shiftInfo ||
                            !shiftInfo.shift ||
                            shiftInfo.shift === "OFF" ||
                            shiftInfo.shift === ""
                          ) {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: offColor,
                            };
                            cell.font = {
                              color: { argb: "FF9CA3AF" },
                              italic: true,
                            };
                          } else if (shiftInfo.type === "night") {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: nightColor,
                            };
                            cell.font = {
                              color: { argb: "FF4338CA" },
                              bold: true,
                            };
                          } else {
                            cell.fill = {
                              type: "pattern",
                              pattern: "solid",
                              fgColor: dayColor,
                            };
                            cell.font = {
                              color: { argb: "FFD97706" },
                              bold: true,
                            };
                          }
                        }
                      });
                    });

                    // Add empty row
                    worksheet.addRow([]);

                    // Add totals row
                    const totalsData = [
                      "TOTAL STAFF",
                      ...ocrDates.map((d) => {
                        let dayCount = 0;
                        let nightCount = 0;
                        optimizedGrid.forEach((row) => {
                          const shift = row.shifts.find((s) => s.date === d);
                          if (
                            shift &&
                            shift.shift &&
                            shift.shift !== "OFF" &&
                            shift.hours > 0
                          ) {
                            if (shift.shiftType === "day") dayCount++;
                            else nightCount++;
                          }
                        });
                        return `D:${dayCount} N:${nightCount}`;
                      }),
                    ];
                    const totalsRow = worksheet.addRow(totalsData);
                    totalsRow.eachCell((cell) => {
                      cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: totalRowColor,
                      };
                      cell.font = { bold: true, size: 11 };
                      cell.alignment = {
                        vertical: "middle",
                        horizontal: "center",
                      };
                      cell.border = {
                        top: { style: "medium" },
                        left: { style: "thin" },
                        bottom: { style: "medium" },
                        right: { style: "thin" },
                      };
                    });

                    // Set column widths
                    worksheet.getColumn(1).width = 25; // Nurse name
                    for (let i = 2; i <= ocrDates.length + 1; i++) {
                      worksheet.getColumn(i).width = 12;
                    }

                    // Generate and download file
                    const buffer = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([buffer], {
                      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    });
                    const startDateStr = ocrDates[0] || "schedule";
                    const endDateStr = ocrDates[ocrDates.length - 1] || "";
                    saveAs(
                      blob,
                      `schedule_${startDateStr}_to_${endDateStr}.xlsx`,
                    );
                  }}
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export Excel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
