"use client";

import React, { Dispatch, SetStateAction, useState } from "react";
import { motion } from "framer-motion";
import { SchedulePeriodInput } from "../components";
import { PreferenceImportPanel } from "../components/PreferenceImportPanel";
import { TemplatePicker } from "../components/ScheduleTemplateManager";
import UploadInput from "../../components/UploadInput";
import {
  AlertTriangle,
  Camera,
  FileSpreadsheet,
  LayoutTemplate,
} from "lucide-react";
import { NurseScheduleSubmission } from "../types";
import type { ScheduleTemplate } from "../hooks/useScheduleTemplates";

// ── Preference source modes ──
export type PreferenceSource = "ocr" | "import" | "template";

interface SetupStepProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  // Upload props (OCR mode)
  screenshots: File[];
  setScreenshots: Dispatch<SetStateAction<File[]>>;
  ocrLoading: boolean;
  ocrError: string | null;
  onExtract: () => void;
  /** Number of nurses loaded from the database (for name matching) */
  nursesLoadedCount?: number;
  /** True while nurse list is being fetched from backend */
  nursesLoading?: boolean;
  // Import preferences mode
  preferenceSource?: PreferenceSource;
  onPreferenceSourceChange?: (source: PreferenceSource) => void;
  onPreferenceSubmissions?: (submissions: NurseScheduleSubmission[]) => void;
  /** Available nurses for manual entry auto-complete */
  availableNurses?: { id: string; name: string }[];
  // Template mode
  templates?: ScheduleTemplate[];
  onTemplateSelect?: (templateId: string) => void;
  onTemplateDelete?: (templateId: string) => void;
}

export default function SetupStep({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  screenshots,
  setScreenshots,
  ocrLoading,
  ocrError,
  onExtract,
  nursesLoadedCount = 0,
  nursesLoading = false,
  preferenceSource = "ocr",
  onPreferenceSourceChange,
  onPreferenceSubmissions,
  availableNurses = [],
  templates = [],
  onTemplateSelect,
  onTemplateDelete,
}: SetupStepProps) {
  const [localSource, setLocalSource] =
    useState<PreferenceSource>(preferenceSource);
  const activeSource = onPreferenceSourceChange
    ? preferenceSource
    : localSource;

  const handleSourceChange = (source: PreferenceSource) => {
    if (onPreferenceSourceChange) {
      onPreferenceSourceChange(source);
    } else {
      setLocalSource(source);
    }
  };

  const isValid =
    startDate && endDate && new Date(startDate) <= new Date(endDate);
  const nursesNotLoaded = !nursesLoading && nursesLoadedCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Schedule Period Input */}
      <SchedulePeriodInput
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />

      {/* ── Preference Source Selector ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <span className="text-xl">📊</span> 2. Schedule Input Method
        </h2>
        <p className="text-gray-500 text-sm mb-4">
          Choose how to provide nurse schedule data for optimization.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {/* OCR option */}
          <button
            type="button"
            onClick={() => handleSourceChange("ocr")}
            className={`
              relative flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 transition-all text-left
              ${
                activeSource === "ocr"
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }
            `}
          >
            <Camera
              className={`w-7 h-7 ${activeSource === "ocr" ? "text-blue-600" : "text-gray-400"}`}
            />
            <span
              className={`text-sm font-medium ${activeSource === "ocr" ? "text-blue-700" : "text-gray-700"}`}
            >
              Upload Schedule Images
            </span>
            <span className="text-xs text-gray-500 text-center">
              Scan existing paper/PDF schedules with OCR
            </span>
            {activeSource === "ocr" && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>

          {/* Import option */}
          <button
            type="button"
            onClick={() => handleSourceChange("import")}
            className={`
              relative flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 transition-all text-left
              ${
                activeSource === "import"
                  ? "border-green-500 bg-green-50 ring-1 ring-green-200"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }
            `}
          >
            <FileSpreadsheet
              className={`w-7 h-7 ${activeSource === "import" ? "text-green-600" : "text-gray-400"}`}
            />
            <span
              className={`text-sm font-medium ${activeSource === "import" ? "text-green-700" : "text-gray-700"}`}
            >
              Import Preferences
            </span>
            <span className="text-xs text-gray-500 text-center">
              CSV/Excel from eEspresso, paste, or manual entry
            </span>
            {activeSource === "import" && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500" />
            )}
          </button>

          {/* Template option */}
          <button
            type="button"
            onClick={() => handleSourceChange("template")}
            className={`
              relative flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 transition-all text-left
              ${
                activeSource === "template"
                  ? "border-purple-500 bg-purple-50 ring-1 ring-purple-200"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }
            `}
          >
            <LayoutTemplate
              className={`w-7 h-7 ${activeSource === "template" ? "text-purple-600" : "text-gray-400"}`}
            />
            <span
              className={`text-sm font-medium ${activeSource === "template" ? "text-purple-700" : "text-gray-700"}`}
            >
              From Template
            </span>
            <span className="text-xs text-gray-500 text-center">
              Start from a previously saved schedule
            </span>
            {templates.length > 0 && (
              <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-purple-100 text-purple-600">
                {templates.length}
              </span>
            )}
            {activeSource === "template" && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-purple-500" />
            )}
          </button>
        </div>
      </div>

      {/* ── OCR Upload Mode ── */}
      {activeSource === "ocr" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span className="text-xl">📷</span> Upload Schedule Images
          </h2>
          <p className="text-gray-500 text-sm mb-4">
            Upload screenshots or photos of your current schedule. We&apos;ll
            extract the data using OCR.
          </p>

          <UploadInput
            screenshots={screenshots}
            setScreenshots={setScreenshots}
          />

          {screenshots.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {screenshots.length} file{screenshots.length !== 1 ? "s" : ""}{" "}
                selected
              </span>
            </div>
          )}

          {nursesLoading && screenshots.length > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                Loading nurse database… Wait a moment before extracting for best
                name matching results.
              </span>
            </div>
          )}

          {nursesNotLoaded && screenshots.length > 0 && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                Nurse database loaded with 0 records. You can still extract, but
                OCR name matching suggestions may be limited.
              </span>
            </div>
          )}

          {ocrError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {ocrError}
            </div>
          )}

          {/* Action */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={onExtract}
              disabled={
                !isValid ||
                screenshots.length === 0 ||
                ocrLoading ||
                nursesLoading
              }
              className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {ocrLoading ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Processing…
                </>
              ) : (
                "Extract & Continue →"
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Preference Import Mode ── */}
      {activeSource === "import" && (
        <PreferenceImportPanel
          startDate={startDate}
          endDate={endDate}
          onSubmissionsReady={(submissions) => {
            onPreferenceSubmissions?.(submissions);
          }}
          availableNurses={availableNurses}
        />
      )}

      {/* ── Template Mode ── */}
      {activeSource === "template" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span className="text-xl">📂</span> Load from Template
          </h2>
          <p className="text-gray-500 text-sm mb-4">
            Select a previously saved schedule template. The nurse roster and
            shift pattern will be projected onto your selected date range.
          </p>
          <TemplatePicker
            templates={templates}
            onSelect={(id) => onTemplateSelect?.(id)}
            onDelete={(id) => onTemplateDelete?.(id)}
          />
        </div>
      )}
    </motion.div>
  );
}
