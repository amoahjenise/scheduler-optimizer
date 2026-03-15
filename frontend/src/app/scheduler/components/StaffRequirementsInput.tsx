"use client";

import React from "react";

interface StaffRequirementsProps {
  dayStaffCount: number;
  nightStaffCount: number;
  onDayStaffChange: (count: number) => void;
  onNightStaffChange: (count: number) => void;
}

export default function StaffRequirementsInput({
  dayStaffCount,
  nightStaffCount,
  onDayStaffChange,
  onNightStaffChange,
}: StaffRequirementsProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className="text-xl">👥</span> 2. Staff Requirements
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Minimum nurses required per shift type. These are enforced as minimums.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Day Shift Staff
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={dayStaffCount}
            onChange={(e) => onDayStaffChange(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Default: 5</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Night Shift Staff
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={nightStaffCount}
            onChange={(e) => onNightStaffChange(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Default: 4</p>
        </div>
      </div>
    </div>
  );
}
