/**
 * PreferenceResultsPanel - Displays preference fulfillment results with reason codes
 *
 * Shows nurses which preferences were granted, modified, or denied,
 * with clear explanations using reason codes.
 */

"use client";

import React, { useState } from "react";
import { NurseOptimizationResult, PreferenceReasonCode } from "../types";

// ============================================================================
// REASON CODE DESCRIPTIONS
// ============================================================================

const REASON_DESCRIPTIONS: Record<
  PreferenceReasonCode,
  { label: string; icon: string; color: string }
> = {
  GRANTED: {
    label: "Preference granted",
    icon: "✓",
    color: "text-green-600 bg-green-50",
  },
  CONFLICT_SENIORITY: {
    label: "Given to more senior staff",
    icon: "👤",
    color: "text-yellow-700 bg-yellow-50",
  },
  MIN_STAFFING_GAP: {
    label: "Assigned to meet unit safety levels",
    icon: "⚠️",
    color: "text-orange-600 bg-orange-50",
  },
  REST_VIOLATION: {
    label: "Would violate 11-hour rest rule",
    icon: "💤",
    color: "text-red-600 bg-red-50",
  },
  CONSECUTIVE_LIMIT: {
    label: "Would exceed consecutive shift limit",
    icon: "📅",
    color: "text-red-600 bg-red-50",
  },
  FTE_EXCEEDED: {
    label: "Would exceed FTE target hours",
    icon: "⏰",
    color: "text-amber-600 bg-amber-50",
  },
  DAY_SHIFT_RULE: {
    label: "Required for 50% day shift balance",
    icon: "☀️",
    color: "text-blue-600 bg-blue-50",
  },
  WEEKEND_FAIRNESS: {
    label: "Weekend rotation equity",
    icon: "📆",
    color: "text-purple-600 bg-purple-50",
  },
  SKILL_REQUIRED: {
    label: "Specific certification needed",
    icon: "🎓",
    color: "text-indigo-600 bg-indigo-50",
  },
  ALREADY_ASSIGNED: {
    label: "Already assigned another shift",
    icon: "📍",
    color: "text-gray-600 bg-gray-50",
  },
  NO_PREFERENCE: {
    label: "No preference submitted",
    icon: "—",
    color: "text-gray-400 bg-gray-50",
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

interface PreferenceResultsPanelProps {
  results: Record<string, NurseOptimizationResult>;
  summary: {
    total_nurses: number;
    total_preferences_submitted: number;
    total_preferences_honored: number;
    preference_fulfillment_rate: number;
    total_conflicts_resolved: number;
  };
  onClose?: () => void;
}

export function PreferenceResultsPanel({
  results,
  summary,
  onClose,
}: PreferenceResultsPanelProps) {
  const [selectedNurse, setSelectedNurse] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<
    "all" | "granted" | "denied"
  >("all");

  const nurseList = Object.values(results).sort((a, b) => {
    // Sort by fulfillment rate (lowest first to highlight issues)
    const rateA =
      a.stats.preferencesGranted /
      Math.max(1, a.stats.preferencesGranted + a.stats.preferencesDenied);
    const rateB =
      b.stats.preferencesGranted /
      Math.max(1, b.stats.preferencesGranted + b.stats.preferencesDenied);
    return rateA - rateB;
  });

  const selectedResult = selectedNurse ? results[selectedNurse] : null;

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Preference Fulfillment Results
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Self-scheduling optimization complete
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 mt-4">
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              {summary.total_nurses}
            </div>
            <div className="text-xs text-gray-500">Nurses</div>
          </div>
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="text-2xl font-bold text-green-600">
              {summary.preference_fulfillment_rate.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">Fulfillment Rate</div>
          </div>
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="text-2xl font-bold text-gray-700">
              {summary.total_preferences_honored}/
              {summary.total_preferences_submitted}
            </div>
            <div className="text-xs text-gray-500">Preferences Met</div>
          </div>
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="text-2xl font-bold text-yellow-600">
              {summary.total_conflicts_resolved}
            </div>
            <div className="text-xs text-gray-500">Conflicts Resolved</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Nurse List */}
        <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
          <div className="p-2 bg-gray-50 border-b border-gray-200 sticky top-0">
            <input
              type="text"
              placeholder="Search nurses..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="divide-y divide-gray-100">
            {nurseList.map((result) => {
              const total =
                result.stats.preferencesGranted +
                result.stats.preferencesDenied;
              const rate =
                total > 0
                  ? (result.stats.preferencesGranted / total) * 100
                  : 100;
              const isSelected = selectedNurse === result.nurseName;

              return (
                <button
                  key={result.nurseId}
                  onClick={() => setSelectedNurse(result.nurseName)}
                  className={`w-full p-3 text-left hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-blue-50 border-l-2 border-blue-500" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 truncate">
                      {result.nurseName}
                    </span>
                    <span
                      className={`text-sm font-semibold ${
                        rate >= 80
                          ? "text-green-600"
                          : rate >= 50
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {rate.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center mt-1 text-xs text-gray-500">
                    <span>{result.stats.totalHours.toFixed(1)}h</span>
                    <span className="mx-1">•</span>
                    <span
                      className={
                        result.stats.delta > 0
                          ? "text-red-500"
                          : result.stats.delta < -5
                            ? "text-amber-500"
                            : "text-green-500"
                      }
                    >
                      {result.stats.delta >= 0 ? "+" : ""}
                      {result.stats.delta.toFixed(1)}h
                    </span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="h-1 bg-gray-200 rounded-full mt-2">
                    <div
                      className={`h-full rounded-full ${
                        rate >= 80
                          ? "bg-green-500"
                          : rate >= 50
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedResult ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedResult.nurseName}
                </h3>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setFilterStatus("all")}
                    className={`px-2 py-1 text-xs rounded ${
                      filterStatus === "all"
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterStatus("granted")}
                    className={`px-2 py-1 text-xs rounded ${
                      filterStatus === "granted"
                        ? "bg-green-600 text-white"
                        : "bg-green-50 text-green-600"
                    }`}
                  >
                    Granted
                  </button>
                  <button
                    onClick={() => setFilterStatus("denied")}
                    className={`px-2 py-1 text-xs rounded ${
                      filterStatus === "denied"
                        ? "bg-red-600 text-white"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    Denied
                  </button>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-gray-900">
                    {selectedResult.stats.totalHours.toFixed(1)}h
                  </div>
                  <div className="text-xs text-gray-500">Total Hours</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-gray-900">
                    {selectedResult.stats.dayShiftPercentage.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">Day Shifts</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-gray-900">
                    {selectedResult.stats.weekendShifts}
                  </div>
                  <div className="text-xs text-gray-500">Weekend Shifts</div>
                </div>
              </div>

              {/* Preference Results */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Preference Results
                </h4>
                {selectedResult.preferenceResults
                  .filter((pr) => {
                    if (filterStatus === "granted")
                      return pr.status === "granted";
                    if (filterStatus === "denied")
                      return pr.status === "denied";
                    return true;
                  })
                  .map((pr, idx) => {
                    const reason =
                      REASON_DESCRIPTIONS[pr.reasonCode] ||
                      REASON_DESCRIPTIONS.NO_PREFERENCE;
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border ${
                          pr.status === "granted"
                            ? "border-green-200 bg-green-50"
                            : "border-red-200 bg-red-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-sm text-gray-600">
                              {pr.date}
                            </span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium">
                              {pr.requestedShift || "—"}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${reason.color}`}
                          >
                            {reason.icon} {reason.label}
                          </span>
                        </div>
                        {pr.reasonMessage && (
                          <p className="text-xs text-gray-500 mt-1">
                            {pr.reasonMessage}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              Select a nurse to view preference results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PreferenceResultsPanel;
