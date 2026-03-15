"use client";

import React, { Dispatch, SetStateAction } from "react";
import { motion } from "framer-motion";
import { SchedulePeriodInput } from "../components";
import UploadInput from "../../components/UploadInput";
import { AlertTriangle } from "lucide-react";

interface SetupStepProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  // Upload props
  screenshots: File[];
  setScreenshots: Dispatch<SetStateAction<File[]>>;
  ocrLoading: boolean;
  ocrError: string | null;
  onExtract: () => void;
  /** Number of nurses loaded from the database (for name matching) */
  nursesLoadedCount?: number;
  /** True while nurse list is being fetched from backend */
  nursesLoading?: boolean;
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
}: SetupStepProps) {
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

      {/* Upload Schedule Images */}
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
              Loading nurse database... Wait a moment before extracting for best
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
      </div>

      {/* Action */}
      <div className="flex justify-end">
        <button
          onClick={onExtract}
          disabled={
            !isValid || screenshots.length === 0 || ocrLoading || nursesLoading
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
    </motion.div>
  );
}
