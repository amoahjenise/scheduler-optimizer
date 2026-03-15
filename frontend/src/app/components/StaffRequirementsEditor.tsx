import React, { useEffect, useRef } from "react";
import SectionCard from "./SectionCard";

/**
 * Staffing categories representing time windows that need coverage.
 * These are NOT actual shift codes - they represent staffing requirement windows.
 *
 * Format: "HH(G)" where HH is the start hour and (G) indicates Global/Total requirement.
 * The actual shift codes (07, Z07, 23, Z19, etc.) are mapped to these windows.
 *
 * Default MUHC windows:
 * - 07(G): 07:00 start (covers 07, Z07 shifts)
 * - 15(G): 15:00 start (covers E15, afternoon coverage)
 * - 19(G): 19:00 start (covers Z19, evening-to-night)
 * - 23(G): 23:00 start (covers 23, Z23 shifts)
 *
 * These can be customized per organization via localStorage or API.
 */
export const DEFAULT_STAFFING_CATEGORIES = ["07(G)", "15(G)", "19(G)", "23(G)"];

/** Default minimum-staff values per staffing category.
 *  Keys MUST match the shiftTypes array that the parent passes in.  */
export const DEFAULT_STAFF_REQUIREMENTS: Record<string, number> = {
  "07(G)": 5,
  "15(G)": 5,
  "19(G)": 4,
  "23(G)": 4,
};

// Legacy export for backward compatibility
export const DEFAULT_SHIFT_TYPES = DEFAULT_STAFFING_CATEGORIES;

/** Load user-customised staffing categories from localStorage (falls back to defaults). */
export function loadStaffingCategories(): string[] {
  if (typeof window === "undefined") return DEFAULT_STAFFING_CATEGORIES;
  try {
    const raw = localStorage.getItem("staffing_categories");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_STAFFING_CATEGORIES;
}

/** Persist staffing categories to localStorage. */
export function saveStaffingCategories(categories: string[]) {
  localStorage.setItem("staffing_categories", JSON.stringify(categories));
  window.dispatchEvent(new CustomEvent("staffingCategoriesChanged"));
}

/** Load user-customised staffing defaults from localStorage (falls back to
 *  built-in defaults). */
export function loadStaffingDefaults(): Record<string, number> {
  if (typeof window === "undefined") return DEFAULT_STAFF_REQUIREMENTS;
  try {
    const raw = localStorage.getItem("staffing_defaults");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return DEFAULT_STAFF_REQUIREMENTS;
}

/** Persist staffing defaults to localStorage. */
export function saveStaffingDefaults(defaults: Record<string, number>) {
  localStorage.setItem("staffing_defaults", JSON.stringify(defaults));
  window.dispatchEvent(new CustomEvent("staffingDefaultsChanged"));
}

export default function StaffRequirementsEditor({
  ocrDates,
  shiftTypes,
  requiredStaff,
  setRequiredStaff,
}: {
  ocrDates: string[];
  shiftTypes: string[];
  requiredStaff: Record<string, Record<string, number>>;
  setRequiredStaff: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, number>>>
  >;
}) {
  const didPrefill = useRef(false);

  // Pre-fill empty cells with defaults on first render when dates are available
  useEffect(() => {
    if (didPrefill.current || ocrDates.length === 0) return;
    didPrefill.current = true;

    const defaults = loadStaffingDefaults();

    setRequiredStaff((prev) => {
      // Only prefill if the table is currently empty
      const hasAnyValue = Object.values(prev).some((byDate) =>
        Object.values(byDate).some((v) => v != null && v !== 0),
      );
      if (hasAnyValue) return prev;

      const next: Record<string, Record<string, number>> = {};
      for (const shift of shiftTypes) {
        next[shift] = {};
        const defaultVal = defaults[shift] ?? 0;
        for (const date of ocrDates) {
          next[shift][date] = defaultVal;
        }
      }
      return next;
    });
  }, [ocrDates, shiftTypes, setRequiredStaff]);

  function handleStaffChange(shift: string, date: string, value: number) {
    setRequiredStaff((prev) => ({
      ...prev,
      [shift]: {
        ...prev[shift],
        [date]: value,
      },
    }));
  }

  function handleReset() {
    if (confirm("Reset all staff requirements to defaults?")) {
      const defaults = loadStaffingDefaults();
      const next: Record<string, Record<string, number>> = {};
      for (const shift of shiftTypes) {
        next[shift] = {};
        const defaultVal = defaults[shift] ?? 0;
        for (const date of ocrDates) {
          next[shift][date] = defaultVal;
        }
      }
      setRequiredStaff(next);
    }
  }

  /* Format date header: show short day name + day number */
  function formatDateHeader(dateStr: string) {
    try {
      const d = new Date(dateStr + "T00:00:00");
      const day = d.toLocaleDateString("en-CA", { weekday: "short" });
      const num = d.getDate();
      return (
        <>
          <span className="block text-[10px] text-gray-400 leading-none">
            {day}
          </span>
          <span className="block text-xs font-semibold">{num}</span>
        </>
      );
    } catch {
      return <span className="text-xs">{dateStr}</span>;
    }
  }

  return (
    <SectionCard title="Staff Requirements & Shift Hours">
      <div className="mb-4 flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Set minimum staff required for each shift per day.
        </p>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          Reset to Defaults
        </button>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm border border-blue-300">
          <thead>
            <tr className="bg-blue-100">
              <th className="p-2 border text-left whitespace-nowrap">Shift</th>
              {ocrDates.map((date) => (
                <th key={date} className="p-1 border text-center min-w-[3rem]">
                  {formatDateHeader(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shiftTypes.map((shift) => (
              <tr key={shift} className="hover:bg-gray-50">
                <td className="border px-2 py-1 font-semibold whitespace-nowrap">
                  {shift}
                </td>
                {ocrDates.map((date) => (
                  <td key={date} className="border px-1 py-1">
                    <input
                      type="number"
                      value={requiredStaff[shift]?.[date] ?? ""}
                      onChange={(e) =>
                        handleStaffChange(shift, date, Number(e.target.value))
                      }
                      className="w-14 border rounded px-1 text-center"
                      min={0}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
