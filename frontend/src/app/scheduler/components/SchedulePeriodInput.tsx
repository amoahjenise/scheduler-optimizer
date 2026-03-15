"use client";

import React from "react";

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

  // ── Validation messages ──
  const errors: string[] = [];
  const warnings: string[] = [];

  if (startDate && endDate) {
    if (new Date(startDate) > new Date(endDate)) {
      errors.push("Start date must be before end date.");
    } else if (dayCount < 7) {
      errors.push(
        `Period is only ${dayCount} day${dayCount !== 1 ? "s" : ""}. Minimum recommended is 7 days.`,
      );
    } else if (dayCount > 42) {
      errors.push(
        `Period is ${dayCount} days (${Math.round(dayCount / 7)} weeks). Maximum recommended is 42 days (6 weeks).`,
      );
    }

    if (dayCount > 0 && dayCount % 7 !== 0) {
      warnings.push(
        `Period is ${dayCount} days — not a full number of weeks. The optimizer works best with 7, 14, 21, or 28-day periods.`,
      );
    }
  } else {
    if (!startDate) errors.push("Start date is required.");
    if (!endDate) errors.push("End date is required.");
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className="text-xl">📅</span> 1. Schedule Period
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Start Date
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
            End Date
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
          Schedule period: <strong>{dayCount} days</strong>
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
