"use client";

import React, { Dispatch, SetStateAction } from "react";
import { motion } from "framer-motion";
import UploadInput from "../../components/UploadInput";

interface UploadStepProps {
  screenshots: File[];
  setScreenshots: Dispatch<SetStateAction<File[]>>;
  ocrLoading: boolean;
  ocrError: string | null;
  onBack: () => void;
  onExtract: () => void;
}

export default function UploadStep({
  screenshots,
  setScreenshots,
  ocrLoading,
  ocrError,
  onBack,
  onExtract,
}: UploadStepProps) {
  return (
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
          Upload screenshots or photos of your current schedule. We&apos;ll
          extract the data using OCR.
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
          onClick={onBack}
          className="px-6 py-2 text-gray-600 font-medium hover:text-gray-900"
        >
          ← Back
        </button>
        <button
          onClick={onExtract}
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
  );
}
