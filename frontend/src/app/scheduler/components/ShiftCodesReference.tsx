"use client";

import React from "react";
import { TimeSlot } from "../types";

export interface ShiftCode {
  code: string;
  start: string;
  end: string;
  hours: number;
  type: "day" | "night" | "combined";
  label: string;
}

interface ShiftCodesReferenceProps {
  shiftCodes: ShiftCode[];
  mode?: "codes" | "slots";
  onModeChange?: (mode: "codes" | "slots") => void;
  timeSlots?: TimeSlot[];
}

export default function ShiftCodesReference({
  shiftCodes,
  mode = "codes",
  onModeChange,
  timeSlots = [],
}: ShiftCodesReferenceProps) {
  const showingSlots = mode === "slots" && timeSlots.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-xl">🕐</span>
          {showingSlots ? "Time Slot Categories" : "Shift Codes Reference"}
        </h2>
        {onModeChange && timeSlots.length > 0 && (
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => onModeChange("codes")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                mode === "codes"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Shift Codes
            </button>
            <button
              onClick={() => onModeChange("slots")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                mode === "slots"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Time Slots
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        {showingSlots ? (
          <>
            Time slots are <strong>categories</strong> used in self-scheduling
            (e.g., D=Day, E=Evening, N=Night). Admins may use these
            interchangeably with actual shift codes when writing schedules. Each
            slot maps to one or more actual shift codes.
          </>
        ) : (
          <>
            Shift codes indicate actual shifts used on schedules. Z-prefixed
            codes (Z07, Z11, Z19, Z23) are 12-hour shifts (11.25h actual).
            Standard codes (07, 11, E15, 23) are 8-hour shifts (7.5h actual).
            &quot;B&quot; suffix (Z23 B) indicates nurse returns at 19:00 same
            day for next shift. Hours shown include breaks.
          </>
        )}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {showingSlots
          ? timeSlots.map((slot) => (
              <div
                key={slot.slot}
                className={`p-2 rounded-lg border text-center ${
                  slot.category === "Day"
                    ? "bg-amber-50 border-amber-200"
                    : slot.category === "Evening"
                      ? "bg-orange-50 border-orange-200"
                      : "bg-indigo-50 border-indigo-200"
                }`}
              >
                <div className="font-mono font-bold text-sm">{slot.slot}</div>
                <div className="text-[10px] text-gray-600">{slot.label}</div>
                <div className="text-[9px] text-gray-500 mt-1">
                  → {slot.mapsTo.join(", ")}
                </div>
              </div>
            ))
          : shiftCodes.map((shift) => (
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
                <div className="font-mono font-bold text-sm">{shift.code}</div>
                <div className="text-[10px] text-gray-600">
                  {shift.start}–{shift.end}
                </div>
                <div className="text-[10px] text-gray-500">{shift.hours}h</div>
              </div>
            ))}
      </div>
      <p className="text-xs text-gray-500 mt-3">
        <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-200 mr-1"></span>{" "}
        Day
        {showingSlots && (
          <>
            <span className="inline-block w-3 h-3 rounded bg-orange-100 border border-orange-200 ml-3 mr-1"></span>{" "}
            Evening
          </>
        )}
        <span className="inline-block w-3 h-3 rounded bg-indigo-100 border border-indigo-200 ml-3 mr-1"></span>{" "}
        Night
        {!showingSlots && (
          <>
            <span className="inline-block w-3 h-3 rounded bg-purple-100 border border-purple-200 ml-3 mr-1"></span>{" "}
            Combined
          </>
        )}
      </p>
    </div>
  );
}
