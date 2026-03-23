"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";

export interface ShiftCodeInfo {
  code: string;
  start: string;
  end: string;
  hours: number;
  type: "day" | "night" | "combined" | "off";
  label: string;
}

export interface TimeSlotInfo {
  slot: string;
  category: "Day" | "Evening" | "Night";
  duration: string;
  mapsTo: string[];
  label: string;
}

interface ShiftCodesPopoverProps {
  shiftCodes: ShiftCodeInfo[];
  /** Optional time slots for toggle view */
  timeSlots?: TimeSlotInfo[];
  /** Optional label next to the icon */
  label?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Optional className for the trigger button */
  className?: string;
}

/**
 * Reusable info-icon popover that displays shift code reference.
 * Hover or click the ℹ icon to reveal a floating panel.
 * Supports toggle between shift codes and time slots view.
 */
export default function ShiftCodesPopover({
  shiftCodes,
  timeSlots = [],
  label,
  size = "sm",
  className = "",
}: ShiftCodesPopoverProps) {
  const t = useTranslations("scheduler");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"codes" | "slots">("codes");
  const ref = useRef<HTMLDivElement>(null);

  const showingSlots = mode === "slots" && timeSlots.length > 0;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const iconSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div ref={ref} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors focus:outline-none"
        aria-label={t("shiftCodesReference")}
      >
        <svg
          className={iconSize}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {label && (
          <span className="text-xs font-medium text-gray-500">{label}</span>
        )}
      </button>

      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute z-50 top-full mt-2 right-0 w-[420px] bg-white rounded-xl shadow-xl border border-gray-200 p-4 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <span>🕐</span>{" "}
              {showingSlots
                ? t("timeSlotCategories")
                : t("shiftCodesReference")}
            </h4>
            <div className="flex items-center gap-2">
              {/* Mode toggle - only show if timeSlots provided */}
              {timeSlots.length > 0 && (
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setMode("codes")}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                      mode === "codes"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t("codes")}
                  </button>
                  <button
                    onClick={() => setMode("slots")}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                      mode === "slots"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t("slots")}
                  </button>
                </div>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-gray-500 mb-3">
            {showingSlots ? (
              <>{t("timeSlotsDescription")}</>
            ) : (
              <>{t("shiftCodesDescription")}</>
            )}
          </p>

          {/* Codes or Slots grid */}
          <div className="grid grid-cols-4 gap-1.5">
            {showingSlots
              ? timeSlots.map((slot) => (
                  <div
                    key={slot.slot}
                    className={`p-1.5 rounded-lg border text-center ${
                      slot.category === "Day"
                        ? "bg-amber-50 border-amber-200"
                        : slot.category === "Evening"
                          ? "bg-orange-50 border-orange-200"
                          : "bg-indigo-50 border-indigo-200"
                    }`}
                  >
                    <div className="font-mono font-bold text-xs">
                      {slot.slot}
                    </div>
                    <div className="text-[9px] text-gray-600">
                      {t(`timeSlotLabel.${slot.slot}`)}
                    </div>
                    <div className="text-[8px] text-gray-500 mt-0.5">
                      → {slot.mapsTo.join(", ")}
                    </div>
                  </div>
                ))
              : shiftCodes.map((shift) => (
                  <div
                    key={shift.code}
                    className={`p-1.5 rounded-lg border text-center ${
                      shift.type === "day"
                        ? "bg-amber-50 border-amber-200"
                        : shift.type === "night"
                          ? "bg-indigo-50 border-indigo-200"
                          : shift.type === "off"
                            ? "bg-gray-50 border-gray-300"
                            : "bg-purple-50 border-purple-200"
                    }`}
                  >
                    <div className="font-mono font-bold text-xs">
                      {shift.code}
                    </div>
                    {shift.type === "off" ? (
                      <div className="text-[9px] text-gray-600">
                        {shift.label}
                      </div>
                    ) : (
                      <>
                        <div className="text-[9px] text-gray-600">
                          {shift.start}–{shift.end}
                        </div>
                        <div className="text-[9px] text-gray-500">
                          {shift.hours}h
                        </div>
                      </>
                    )}
                  </div>
                ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-2.5 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-amber-100 border border-amber-200" />
              {t("day")}
            </span>
            {showingSlots && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded bg-orange-100 border border-orange-200" />
                {t("evening")}
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-indigo-100 border border-indigo-200" />
              {t("night")}
            </span>
            {!showingSlots && (
              <>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded bg-purple-100 border border-purple-200" />
                  {t("combined")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded bg-gray-100 border border-gray-300" />
                  {t("off")}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
