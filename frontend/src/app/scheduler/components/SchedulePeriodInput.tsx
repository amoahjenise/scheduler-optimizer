"use client";

import React from "react";
import { useTranslations } from "next-intl";

// ── Period presets (common scheduling cycles) ──
const PERIOD_PRESETS = [
  { key: "preset2Weeks", days: 14, descriptionKey: "presetStandardPayPeriod" },
  { key: "preset4Weeks", days: 28, descriptionKey: "presetMonthlyCycle" },
  { key: "preset6Weeks", days: 42, descriptionKey: "presetExtendedRotation" },
] as const;

interface SchedulePeriodInputProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

export default function SchedulePeriodInput({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: SchedulePeriodInputProps) {
  const t = useTranslations("scheduler");
  // Calculate number of days in the period
  const getDayCount = () => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
    return diffDays > 0 ? diffDays : 0;
  };

  const dayCount = getDayCount();

  /** Apply a preset: set endDate = startDate + (days - 1) */
  const applyPreset = (days: number) => {
    const base = startDate ? new Date(startDate) : new Date();
    if (!startDate) {
      // Default start to next Monday
      const day = base.getDay();
      const diff = day === 0 ? 1 : 8 - day; // days until next Monday
      base.setDate(base.getDate() + diff);
      onStartDateChange(base.toISOString().split("T")[0]);
    }
    const end = new Date(base);
    end.setDate(end.getDate() + days - 1);
    onEndDateChange(end.toISOString().split("T")[0]);
  };

  // Determine which preset matches current selection
  const activePreset = PERIOD_PRESETS.find((p) => p.days === dayCount);

  // ── Validation messages ──
  const errors: string[] = [];
  const warnings: string[] = [];

  if (startDate && endDate) {
    if (new Date(startDate) > new Date(endDate)) {
      errors.push(t("startDateBeforeEndDateError"));
    } else if (dayCount < 7) {
      errors.push(t("periodTooShortError", { count: dayCount }));
    } else if (dayCount > 42) {
      errors.push(
        t("periodTooLongError", {
          count: dayCount,
          weeks: Math.round(dayCount / 7),
        }),
      );
    }

    if (dayCount > 0 && dayCount % 7 !== 0) {
      warnings.push(t("periodNotFullWeeksWarning", { count: dayCount }));
    }
  } else {
    if (!startDate) errors.push(t("startDateRequired"));
    if (!endDate) errors.push(t("endDateRequired"));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className="text-xl">📅</span> 1. {t("schedulePeriod")}
      </h2>

      {/* ── Quick-select preset buttons ── */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          {t("quickSelect")}
        </label>
        <div className="flex gap-2">
          {PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => applyPreset(preset.days)}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${
                  activePreset?.days === preset.days
                    ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-300"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
                }
              `}
              title={t(preset.descriptionKey)}
            >
              {t(preset.key)}
              <span className="ml-1.5 text-xs opacity-70">
                ({preset.days}d)
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Date pickers ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("startDate")}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("endDate")}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>
      {dayCount > 0 && (
        <p className="text-sm text-gray-500 mt-2">
          {t("schedulePeriodLabel")}:{" "}
          <strong>{t("daysCount", { count: dayCount })}</strong>
          {activePreset && (
            <span className="ml-2 text-blue-600">
              ({t(activePreset.descriptionKey)})
            </span>
          )}
        </p>
      )}

      {errors.length > 0 && (
        <div className="mt-3 space-y-1">
          {errors.map((msg, i) => (
            <p
              key={i}
              className="text-sm text-red-600 flex items-center gap-1.5"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              {msg}
            </p>
          ))}
        </div>
      )}

      {warnings.length > 0 && errors.length === 0 && (
        <div className="mt-3 space-y-1">
          {warnings.map((msg, i) => (
            <p
              key={i}
              className="text-sm text-amber-600 flex items-center gap-1.5"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              {msg}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
