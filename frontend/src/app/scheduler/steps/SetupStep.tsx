"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  ShiftCodesReference,
  RulesEditorCard,
  SchedulePeriodInput,
} from "../components";
import SystemPrompt from "../../components/SystemPrompt";
import { SHIFT_CODES, TIME_SLOTS } from "../types";

interface SetupStepProps {
  startDate: string;
  endDate: string;
  rules: string;
  shiftEntryMode?: "codes" | "slots";
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onRulesChange: (rules: string) => void;
  onShiftEntryModeChange?: (mode: "codes" | "slots") => void;
  onContinue: () => void;
}

export default function SetupStep({
  startDate,
  endDate,
  rules,
  shiftEntryMode = "codes",
  onStartDateChange,
  onEndDateChange,
  onRulesChange,
  onShiftEntryModeChange,
  onContinue,
}: SetupStepProps) {
  const isValid =
    startDate && endDate && new Date(startDate) <= new Date(endDate);

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

      {/* Shift Codes Reference */}
      <ShiftCodesReference
        shiftCodes={SHIFT_CODES}
        timeSlots={TIME_SLOTS}
        mode={shiftEntryMode}
        onModeChange={onShiftEntryModeChange}
      />

      {/* Custom Rules Editor */}
      <RulesEditorCard rules={rules} onChange={onRulesChange} />

      {/* Advanced Settings - Collapsible */}
      <details className="bg-white rounded-xl border border-gray-200">
        <summary className="px-6 py-4 cursor-pointer select-none flex items-center justify-between hover:bg-gray-50 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">⚙️</span>
            <span className="font-medium text-gray-700">Advanced Settings</span>
          </div>
          <span className="text-gray-400 text-sm">Click to expand</span>
        </summary>
        <div className="px-6 pb-6 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            System Prompt
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Review and customize the AI system prompt. This controls how the
            optimizer interprets your schedule data.
          </p>
          <SystemPrompt />
        </div>
      </details>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          disabled={!isValid}
          className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Upload
        </button>
      </div>
    </motion.div>
  );
}
