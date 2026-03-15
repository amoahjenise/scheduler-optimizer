"use client";

import React, { useState, useMemo, useEffect } from "react";
import SectionCard from "./SectionCard";
import {
  CalendarHeart,
  Undo2,
  Trash2,
  RefreshCcw,
  Plus,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDraggable,
  DragOverEvent,
  DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

// Standard hospital shift codes - only actual shift codes used on schedules
// (not internal time slots like D, E, N which are categories, not actual codes)
const SHIFT_CODES = [
  {
    code: "07",
    label: "Day 8hr",
    type: "day" as const,
    hours: 7.5,
    start: "07:00",
    end: "15:15",
  },
  {
    code: "Z07",
    label: "Day 12hr",
    type: "day" as const,
    hours: 11.25,
    start: "07:00",
    end: "19:25",
  },
  {
    code: "11",
    label: "Mid 8hr",
    type: "day" as const,
    hours: 7.5,
    start: "11:00",
    end: "19:15",
  },
  {
    code: "Z11",
    label: "Mid 12hr",
    type: "day" as const,
    hours: 11.25,
    start: "11:00",
    end: "23:25",
  },
  {
    code: "E15",
    label: "Evening 8hr",
    type: "day" as const,
    hours: 7.5,
    start: "15:00",
    end: "23:15",
  },
  {
    code: "23",
    label: "Night 8hr",
    type: "night" as const,
    hours: 7.5,
    start: "23:00",
    end: "07:15",
  },
  {
    code: "Z19",
    label: "Night 12hr",
    type: "night" as const,
    hours: 11.25,
    start: "19:00",
    end: "07:25",
  },
  {
    code: "Z23",
    label: "Night 12hr",
    type: "night" as const,
    hours: 11.25,
    start: "23:00",
    end: "11:25",
  },
  {
    code: "Z23 B",
    label: "Night 12hr Balance",
    type: "night" as const,
    hours: 11.25,
    start: "23:00",
    end: "11:25",
  },
];

// Off-day and holiday codes (CF = Congé Férié)
const OFF_CODES = [
  {
    code: "C",
    label: "Congé (Off)",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "OFF",
    label: "Off Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF",
    label: "Congé Férié (Holiday)",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-1",
    label: "Canada Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-2",
    label: "Labour Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-3",
    label: "Thanksgiving",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-4",
    label: "Christmas Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-5",
    label: "Boxing Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-6",
    label: "New Year's Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-7",
    label: "Day after New Year's",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-8",
    label: "Good Friday",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-9",
    label: "Victoria Day",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-10",
    label: "Fête Nationale",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-11",
    label: "Easter Monday",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-12",
    label: "Mobile Holiday 1",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
  {
    code: "CF-13",
    label: "Mobile Holiday 2",
    type: "off" as const,
    hours: 0,
    start: "",
    end: "",
  },
];

// Combined list for dropdowns
const ALL_CODES = [...SHIFT_CODES, ...OFF_CODES];

interface SchedulePreviewProps {
  ocrGrid: { nurse: string; shifts: ShiftEntry[] }[];
  ocrDates: string[];
  nurseMetadata?: {
    name: string;
    employmentType?: string;
    isChemoCertified?: boolean;
    maxHours?: number;
  }[];
  onChange?: (updatedGrid: { nurse: string; shifts: ShiftEntry[] }[]) => void;
  onAsteriskDetected?: (nurse: string, date: string) => void;
}

interface ShiftEntry {
  // id: UUID
  date: string;
  shift: string;
  shiftType: "day" | "night" | "combined" | "off";
  hours: number;
  startTime: string;
  endTime: string;
}

function buildGridDataKey(grid: { nurse: string; shifts: ShiftEntry[] }[]) {
  return JSON.stringify(
    grid.map((row) => ({
      nurse: row.nurse,
      shifts: row.shifts
        .map((shift) => `${shift.date}:${shift.shift}`)
        .join(","),
    })),
  );
}

function cloneShiftMap(
  map: Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>,
) {
  return new Map(
    Array.from(map.entries()).map(([date, entries]) => [
      date,
      entries.map(({ nurse, shiftEntry }) => ({
        nurse,
        shiftEntry: { ...shiftEntry },
      })),
    ]),
  );
}

function createShiftMapFromGrid(
  grid: { nurse: string; shifts: ShiftEntry[] }[],
) {
  const map = new Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>();

  grid.forEach(({ nurse, shifts }) => {
    shifts.forEach((shiftEntry) => {
      if (!map.has(shiftEntry.date)) {
        map.set(shiftEntry.date, []);
      }

      // Correct stored hours using the authoritative SHIFT_CODES table.
      // Previously, parseShiftCode had a substring bug that stored wrong
      // hours (e.g. Z07 → 7.5h instead of 11.25h, Z23 B → 7.5h instead of
      // 11.25h).  Re-validate on load so the calendar displays correct hours.
      const corrected = { ...shiftEntry };
      if (corrected.shift) {
        const code = corrected.shift
          .replace(/\s*\*\s*$/, "")
          .trim()
          .toUpperCase();
        const def = SHIFT_CODES.find((s) => s.code.toUpperCase() === code);
        if (def) {
          corrected.hours = def.hours;
          corrected.startTime = def.start;
          corrected.endTime = def.end;
          corrected.shiftType = def.type;
        }
      }

      map.get(shiftEntry.date)!.push({ nurse, shiftEntry: corrected });
    });
  });

  return map;
}

const shiftColor = (shiftType: string, shift?: string) => {
  // Special styling for OFF days and holiday codes
  const upperShift = shift?.toUpperCase() || "";
  if (
    !shift ||
    shift === "" ||
    upperShift === "OFF" ||
    upperShift === "C" ||
    upperShift.startsWith("CF") ||
    shiftType === "off"
  ) {
    return "bg-gray-100 text-gray-500 border-dashed border-gray-300";
  }

  switch (shiftType) {
    case "day":
      return "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-amber-200 shadow-amber-100";
    case "night":
      return "bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border-indigo-200 shadow-indigo-100";
    case "combined":
      return "bg-gradient-to-r from-purple-100 to-fuchsia-100 text-purple-800 border-purple-200 shadow-purple-100";
    default:
      return "bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 border-blue-200 shadow-blue-100";
  }
};

function getShiftTimes(
  shift: string,
  shiftType: "day" | "night" | "combined" | "off",
): { startTime: string; endTime: string } {
  // Look up shift times from the authoritative SHIFT_CODES array.
  // This avoids the old bug where only 5 codes were mapped and everything
  // else (11, Z11, E15, D8-, N8-, etc.) defaulted to 07:00–19:00.
  const code = shift.replace(/\s*\*\s*$/, "").trim();
  const def = SHIFT_CODES.find(
    (s) => s.code.toUpperCase() === code.toUpperCase(),
  );
  if (def) {
    return { startTime: def.start, endTime: def.end };
  }

  // For CF- (congé/formation) combo codes like "CF-4 07", try the
  // trailing base code after the last space.
  const parts = code.split(/\s+/);
  if (parts.length > 1) {
    const baseCode = parts[parts.length - 1];
    const baseDef = SHIFT_CODES.find(
      (s) => s.code.toUpperCase() === baseCode.toUpperCase(),
    );
    if (baseDef) {
      return { startTime: baseDef.start, endTime: baseDef.end };
    }
  }

  // Fallback for completely unknown codes
  return {
    startTime: shiftType === "day" ? "07:00" : "19:00",
    endTime: shiftType === "day" ? "19:00" : "07:00",
  };
}

function makeId(nurse: string, shiftEntry: ShiftEntry, index: number) {
  return `${nurse}|${shiftEntry.date}|${shiftEntry.shift}|${index}`;
}

function parseId(id: string) {
  const parts = id.split("|");
  return { nurse: parts[0], date: parts[1], shift: parts[2] };
}

function DraggableShift({
  id,
  nurse,
  shiftEntry,
  onDelete,
  onUpdateShift,
  nurseMetadata,
}: {
  id: string;
  nurse: string;
  shiftEntry: ShiftEntry;
  onDelete: () => void;
  onUpdateShift: (nextShiftCode: string) => void;
  nurseMetadata?: {
    name: string;
    employmentType?: string;
    isChemoCertified?: boolean;
    maxHours?: number;
  };
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });
  const isOff =
    !shiftEntry.shift ||
    shiftEntry.shift === "OFF" ||
    shiftEntry.shiftType === "off" ||
    shiftEntry.hours === 0;

  // Build tooltip content (details shown on hover only)
  const tooltipLines = [nurse];
  if (nurseMetadata) {
    if (nurseMetadata.employmentType) {
      tooltipLines.push(
        `Type: ${nurseMetadata.employmentType === "FT" ? "Full-Time" : nurseMetadata.employmentType === "PT" ? "Part-Time" : nurseMetadata.employmentType}`,
      );
    }
    if (nurseMetadata.isChemoCertified) {
      tooltipLines.push("✓ Chemo Certified");
    }
    if (nurseMetadata.maxHours) {
      tooltipLines.push(`Max: ${nurseMetadata.maxHours}h/week`);
    }
  }
  if (!isOff) {
    tooltipLines.push(`Shift: ${shiftEntry.shift} (${shiftEntry.hours}h)`);
    tooltipLines.push(`Time: ${shiftEntry.startTime} – ${shiftEntry.endTime}`);
  } else {
    const offDef = OFF_CODES.find(
      (o) => o.code.toUpperCase() === (shiftEntry.shift || "").toUpperCase(),
    );
    if (offDef) tooltipLines.push(offDef.label);
  }

  const shiftOptions = ALL_CODES.some(
    (option) => option.code === shiftEntry.shift,
  )
    ? ALL_CODES
    : [
        {
          code: shiftEntry.shift,
          label: "Current shift",
          type:
            shiftEntry.shiftType === "combined" ? "day" : shiftEntry.shiftType,
          hours: shiftEntry.hours,
          start: shiftEntry.startTime,
          end: shiftEntry.endTime,
        },
        ...ALL_CODES,
      ];

  // Abbreviated first name for compact display
  const nameParts = nurse.split(" ");
  const shortName =
    nameParts.length > 1
      ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
      : nurse;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group text-xs px-1.5 py-0.5 rounded-md font-medium border cursor-move flex items-center gap-1 transition-all hover:shadow-md ${shiftColor(
        shiftEntry.shiftType,
        shiftEntry.shift,
      )} ${isDragging ? "opacity-50 scale-105" : ""}`}
      title={tooltipLines.join("\n")}
    >
      {/* Name — truncated, compact */}
      <span className="font-semibold truncate text-[11px] leading-tight flex-1 min-w-0">
        {shortName}
        {nurseMetadata?.isChemoCertified && (
          <span className="text-[7px] ml-0.5">💉</span>
        )}
      </span>

      {/* Shift dropdown — always visible, compact */}
      <select
        value={shiftEntry.shift || "OFF"}
        onChange={(e) => onUpdateShift(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className="text-[9px] font-semibold bg-white/60 border-0 rounded px-0.5 py-0 w-[32px] shrink-0 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none cursor-pointer"
        aria-label={`Change shift code for ${nurse}`}
      >
        <optgroup label="Day Shifts">
          {shiftOptions
            .filter((o) => o.type === "day")
            .map((option) => (
              <option key={option.code} value={option.code}>
                {option.code}
              </option>
            ))}
        </optgroup>
        <optgroup label="Night Shifts">
          {shiftOptions
            .filter((o) => o.type === "night")
            .map((option) => (
              <option key={option.code} value={option.code}>
                {option.code}
              </option>
            ))}
        </optgroup>
        <optgroup label="Off / Holiday">
          {shiftOptions
            .filter((o) => o.type === "off")
            .map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} – {option.label}
              </option>
            ))}
        </optgroup>
      </select>

      {/* Delete — visible on hover only */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        type="button"
        className="focus:outline-none opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
      >
        <Trash2 className="w-3 h-3 text-red-500" />
      </button>
    </div>
  );
}

function DroppableDay({
  date,
  shifts,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  displayDate,
  handleDelete,
  onUpdateShift,
  onAddShift,
  availableNurses,
  getNurseMetadata,
}: {
  date: string;
  shifts: { nurse: string; shiftEntry: ShiftEntry }[];
  displayDate: string;
  handleDelete: (date: string, id: string) => void;
  onUpdateShift: (date: string, id: string, nextShiftCode: string) => void;
  onAddShift: (
    date: string,
    nurse: string,
    shiftCode: (typeof ALL_CODES)[0],
  ) => void;
  availableNurses: string[];
  getNurseMetadata: (name: string) =>
    | {
        name: string;
        employmentType?: string;
        isChemoCertified?: boolean;
        maxHours?: number;
      }
    | undefined;
}) {
  const { setNodeRef } = useDroppable({ id: date });
  const parsedDate = parseISO(date);
  const isWeekend = parsedDate.getDay() === 0 || parsedDate.getDay() === 6;

  // Sort each category alphabetically by nurse name
  const sortAlpha = (
    a: { nurse: string; shiftEntry: ShiftEntry },
    b: { nurse: string; shiftEntry: ShiftEntry },
  ) => a.nurse.localeCompare(b.nurse);

  const dayShifts = shifts
    .filter((s) => s.shiftEntry.shiftType === "day" && s.shiftEntry.hours > 0)
    .sort(sortAlpha);
  const nightShifts = shifts
    .filter((s) => s.shiftEntry.shiftType === "night" && s.shiftEntry.hours > 0)
    .sort(sortAlpha);
  // Only show off entries with a recognized code (C, CF-*, OFF) from OCR or manual edit.
  // Suppress blank algorithm-generated offs so the calendar isn't cluttered.
  const offShifts = shifts
    .filter((s) => {
      if (
        s.shiftEntry.shiftType !== "off" &&
        s.shiftEntry.shiftType !== "combined" &&
        !(
          s.shiftEntry.hours === 0 &&
          s.shiftEntry.shiftType !== "day" &&
          s.shiftEntry.shiftType !== "night"
        )
      )
        return false;
      const code = (s.shiftEntry.shift || "").trim().toUpperCase();
      if (!code) return false; // blank = algorithm-generated, hide
      return OFF_CODES.some((oc) => oc.code.toUpperCase() === code);
    })
    .sort(sortAlpha);
  const totalStaff = dayShifts.length + nightShifts.length;

  // State for add nurse modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedNurse, setSelectedNurse] = useState("");
  const [selectedShift, setSelectedShift] = useState("");

  // Get nurses already assigned on this day
  const assignedNurses = shifts.map((s) => s.nurse);
  const unassignedNurses = availableNurses.filter(
    (n) => !assignedNurses.includes(n),
  );

  const handleAddSubmit = () => {
    if (!selectedNurse || !selectedShift) return;
    const shiftCode = ALL_CODES.find((s) => s.code === selectedShift);
    if (!shiftCode) return;
    onAddShift(date, selectedNurse, shiftCode);
    setShowAddModal(false);
    setSelectedNurse("");
    setSelectedShift("");
  };

  return (
    <div
      ref={setNodeRef}
      id={date}
      className={`bg-white border-2 rounded-xl p-2 shadow-sm flex flex-col transition-all hover:shadow-lg ${
        isWeekend ? "border-orange-200 bg-orange-50/30" : "border-gray-200"
      }`}
    >
      {/* Header with date and stats */}
      <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-gray-100">
        <div className="flex items-baseline gap-1">
          <div
            className={`text-xs font-bold ${isWeekend ? "text-orange-600" : "text-gray-800"}`}
          >
            {format(parsedDate, "EEE")}
          </div>
          <div className="text-sm font-bold text-gray-900">
            {format(parsedDate, "d")}
          </div>
          <div className="text-[10px] text-gray-400">
            {format(parsedDate, "MMM")}
          </div>
        </div>
        <div
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            totalStaff === 0
              ? "bg-red-100 text-red-600"
              : totalStaff < 5
                ? "bg-yellow-100 text-yellow-700"
                : "bg-green-100 text-green-700"
          }`}
        >
          {totalStaff}
        </div>
      </div>

      {/* Day shifts section */}
      {dayShifts.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-0.5 flex items-center gap-1">
            <span>☀️</span> Day ({dayShifts.length})
          </div>
          <div className="flex flex-col gap-0.5">
            <SortableContext
              items={dayShifts.map(({ nurse, shiftEntry }, idx) =>
                makeId(nurse, shiftEntry, idx),
              )}
              strategy={verticalListSortingStrategy}
            >
              {dayShifts.map(({ nurse, shiftEntry }, idx) => {
                const id = makeId(nurse, shiftEntry, idx);
                return (
                  <DraggableShift
                    key={id}
                    id={id}
                    nurse={nurse}
                    shiftEntry={shiftEntry}
                    onUpdateShift={(nextShiftCode) =>
                      onUpdateShift(date, id, nextShiftCode)
                    }
                    onDelete={() => handleDelete(date, id)}
                    nurseMetadata={getNurseMetadata(nurse)}
                  />
                );
              })}
            </SortableContext>
          </div>
        </div>
      )}

      {/* Night shifts section */}
      {nightShifts.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold mb-0.5 flex items-center gap-1">
            <span>🌙</span> Night ({nightShifts.length})
          </div>
          <div className="flex flex-col gap-0.5">
            <SortableContext
              items={nightShifts.map(({ nurse, shiftEntry }, idx) =>
                makeId(nurse, shiftEntry, idx),
              )}
              strategy={verticalListSortingStrategy}
            >
              {nightShifts.map(({ nurse, shiftEntry }, idx) => {
                const id = makeId(nurse, shiftEntry, idx);
                return (
                  <DraggableShift
                    key={id}
                    id={id}
                    nurse={nurse}
                    shiftEntry={shiftEntry}
                    onUpdateShift={(nextShiftCode) =>
                      onUpdateShift(date, id, nextShiftCode)
                    }
                    nurseMetadata={getNurseMetadata(nurse)}
                    onDelete={() => handleDelete(date, id)}
                  />
                );
              })}
            </SortableContext>
          </div>
        </div>
      )}

      {/* Off / CF shifts section */}
      {offShifts.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 flex items-center gap-1">
            <span>🏖️</span> Off ({offShifts.length})
          </div>
          <div className="flex flex-col gap-0.5">
            <SortableContext
              items={offShifts.map(({ nurse, shiftEntry }, idx) =>
                makeId(nurse, shiftEntry, idx),
              )}
              strategy={verticalListSortingStrategy}
            >
              {offShifts.map(({ nurse, shiftEntry }, idx) => {
                const id = makeId(nurse, shiftEntry, idx);
                return (
                  <DraggableShift
                    key={id}
                    id={id}
                    nurse={nurse}
                    shiftEntry={shiftEntry}
                    onUpdateShift={(nextShiftCode) =>
                      onUpdateShift(date, id, nextShiftCode)
                    }
                    nurseMetadata={getNurseMetadata(nurse)}
                    onDelete={() => handleDelete(date, id)}
                  />
                );
              })}
            </SortableContext>
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalStaff === 0 && offShifts.length === 0 && (
        <div className="flex-1 flex items-center justify-center py-2">
          <div className="text-center">
            <div className="text-lg mb-0.5">⚠️</div>
            <div className="text-[10px] text-red-500 font-medium">
              No Coverage
            </div>
          </div>
        </div>
      )}

      {/* Add Nurse Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="mt-1 w-full py-0.5 px-2 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md flex items-center justify-center gap-1 transition-colors"
        type="button"
      >
        <Plus className="w-2.5 h-2.5" />
        Add
      </button>

      {/* Add Nurse Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white rounded-xl p-4 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-900">
                Add Nurse to {format(parsedDate, "MMM d")}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Select Nurse
                </label>
                <select
                  value={selectedNurse}
                  onChange={(e) => setSelectedNurse(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Choose a nurse...</option>
                  {unassignedNurses.map((nurse) => (
                    <option key={nurse} value={nurse}>
                      {nurse}
                    </option>
                  ))}
                </select>
                {unassignedNurses.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    All nurses already assigned to this day
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Select Shift
                </label>
                <select
                  value={selectedShift}
                  onChange={(e) => setSelectedShift(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Choose a shift...</option>
                  <optgroup label="Day Shifts">
                    {SHIFT_CODES.filter((s) => s.type === "day").map(
                      (shift) => (
                        <option key={shift.code} value={shift.code}>
                          {shift.code} - {shift.label} ({shift.hours}hrs)
                        </option>
                      ),
                    )}
                  </optgroup>
                  <optgroup label="Night Shifts">
                    {SHIFT_CODES.filter((s) => s.type === "night").map(
                      (shift) => (
                        <option key={shift.code} value={shift.code}>
                          {shift.code} - {shift.label} ({shift.hours}hrs)
                        </option>
                      ),
                    )}
                  </optgroup>
                  <optgroup label="Off / Holiday (CF)">
                    {OFF_CODES.map((shift) => (
                      <option key={shift.code} value={shift.code}>
                        {shift.code} - {shift.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSubmit}
                  disabled={!selectedNurse || !selectedShift}
                  className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
                  type="button"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SchedulePreview({
  ocrGrid,
  ocrDates,
  nurseMetadata = [],
  onChange,
  onAsteriskDetected,
}: SchedulePreviewProps) {
  const gridDataKey = useMemo(() => {
    return buildGridDataKey(ocrGrid);
  }, [ocrGrid]);

  const originalShiftMap = useMemo(() => {
    return createShiftMapFromGrid(ocrGrid);
  }, [ocrGrid]);

  const [baselineShiftMap, setBaselineShiftMap] = useState(() =>
    cloneShiftMap(originalShiftMap),
  );
  const [shiftMap, setShiftMap] = useState(() =>
    cloneShiftMap(originalShiftMap),
  );
  const [history, setHistory] = useState<
    Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>[]
  >([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [activeId, setActiveId] = useState<string | null>(null);

  const lastSyncedKeyRef = React.useRef<string>("");
  const pendingInternalSyncKeyRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (lastSyncedKeyRef.current === gridDataKey) {
      return;
    }

    lastSyncedKeyRef.current = gridDataKey;

    if (pendingInternalSyncKeyRef.current === gridDataKey) {
      pendingInternalSyncKeyRef.current = null;
      return;
    }

    const nextBaseline = cloneShiftMap(originalShiftMap);
    setBaselineShiftMap(nextBaseline);
    setShiftMap(cloneShiftMap(nextBaseline));
    setHistory([]);
    isInitialMount.current = true;
  }, [originalShiftMap, gridDataKey]);

  // Convert shiftMap back to grid format and notify parent of changes
  const convertShiftMapToGrid = (
    map: Map<string, { nurse: string; shiftEntry: ShiftEntry }[]>,
  ) => {
    const nurseShiftsMap = new Map<string, ShiftEntry[]>();

    map.forEach((shifts) => {
      shifts.forEach(({ nurse, shiftEntry }) => {
        if (!nurseShiftsMap.has(nurse)) {
          nurseShiftsMap.set(nurse, []);
        }
        nurseShiftsMap.get(nurse)!.push(shiftEntry);
      });
    });

    return Array.from(nurseShiftsMap.entries()).map(([nurse, shifts]) => ({
      nurse,
      shifts: shifts.sort((a, b) => a.date.localeCompare(b.date)),
    }));
  };

  const isInitialMount = React.useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (onChange) {
      const updatedGrid = convertShiftMapToGrid(shiftMap);
      pendingInternalSyncKeyRef.current = buildGridDataKey(updatedGrid);
      onChange(updatedGrid);
    }
  }, [shiftMap, onChange]);

  // Get list of all available nurses from the grid
  const availableNurses = useMemo(() => {
    return Array.from(new Set(ocrGrid.map((r) => r.nurse))).sort();
  }, [ocrGrid]);

  // Helper to get nurse metadata by name
  const getNurseMetadata = (nurseName: string) => {
    return nurseMetadata.find((n) => n.name === nurseName);
  };

  const saveHistory = () => {
    setHistory((prev) => [cloneShiftMap(shiftMap), ...prev.slice(0, 19)]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previousMap = cloneShiftMap(history[0]);
    setShiftMap(previousMap);
    setHistory((prev) => prev.slice(1));
  };

  const handleReset = () => {
    const resetMap = cloneShiftMap(baselineShiftMap);
    setShiftMap(resetMap);
    setHistory([]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id.toString());
  };

  const handleDragOver = (_event: DragOverEvent) => {}; // eslint-disable-line @typescript-eslint/no-unused-vars

  const handleDragEndWithMove = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveId(null);
      return;
    }

    const activeId = active.id.toString();
    const overId = over.id.toString();

    if (!activeId.includes("|")) return;

    const { nurse, date: fromDate, shift } = parseId(activeId);
    const toDate = overId;

    const dragged = shiftMap
      .get(fromDate)
      ?.find(
        (e) =>
          e.nurse === nurse &&
          e.shiftEntry.shift === shift &&
          e.shiftEntry.date === fromDate,
      );
    if (!dragged || fromDate === toDate) return;

    saveHistory();

    setShiftMap((prev) => {
      const newMap = cloneShiftMap(prev);
      const fromList = [...(newMap.get(fromDate) || [])];
      const toList = [...(newMap.get(toDate) || [])];

      newMap.set(
        fromDate,
        fromList.filter(
          (e) =>
            !(
              e.nurse === nurse &&
              e.shiftEntry.shift === shift &&
              e.shiftEntry.date === fromDate
            ),
        ),
      );

      const updatedEntry = {
        nurse,
        shiftEntry: { ...dragged.shiftEntry, date: toDate },
      };
      newMap.set(toDate, [...toList, updatedEntry]);

      return newMap;
    });

    setActiveId(null);
  };

  const handleDelete = (date: string, id: string) => {
    const { nurse, shift } = parseId(id);
    saveHistory();
    setShiftMap((prev) => {
      const newMap = cloneShiftMap(prev);
      const shifts = [...(newMap.get(date) || [])];
      newMap.set(
        date,
        shifts.filter(
          (e) =>
            !(
              e.nurse === nurse &&
              e.shiftEntry.shift === shift &&
              e.shiftEntry.date === date
            ),
        ),
      );
      return newMap;
    });
  };

  const handleAddShift = (
    date: string,
    nurse: string,
    shiftCode: (typeof ALL_CODES)[0],
  ) => {
    saveHistory();
    const newShiftEntry: ShiftEntry = {
      date,
      shift: shiftCode.code,
      shiftType: shiftCode.type,
      hours: shiftCode.hours,
      startTime: shiftCode.start,
      endTime: shiftCode.end,
    };

    setShiftMap((prev) => {
      const newMap = cloneShiftMap(prev);
      const shifts = [...(newMap.get(date) || [])];
      shifts.push({ nurse, shiftEntry: newShiftEntry });
      newMap.set(date, shifts);
      return newMap;
    });
  };

  const handleUpdateShift = (
    date: string,
    id: string,
    nextShiftCode: string,
  ) => {
    const { nurse, shift } = parseId(id);

    // Detect asterisk (*) and trigger callback
    if (nextShiftCode.trim() === "*" && onAsteriskDetected) {
      onAsteriskDetected(nurse, date);
      // Don't update the shift, just return
      return;
    }

    const nextShiftDefinition = ALL_CODES.find(
      (shiftCode) => shiftCode.code === nextShiftCode,
    );

    saveHistory();
    setShiftMap((prev) => {
      const newMap = cloneShiftMap(prev);
      const shifts = [...(newMap.get(date) || [])];

      newMap.set(
        date,
        shifts.map((entry) => {
          if (
            entry.nurse !== nurse ||
            entry.shiftEntry.shift !== shift ||
            entry.shiftEntry.date !== date
          ) {
            return entry;
          }

          const currentShiftType =
            entry.shiftEntry.shiftType === "combined"
              ? "day"
              : entry.shiftEntry.shiftType;
          const nextShiftType = nextShiftDefinition?.type ?? currentShiftType;
          const { startTime, endTime } = getShiftTimes(
            nextShiftCode,
            nextShiftType,
          );

          return {
            ...entry,
            shiftEntry: {
              ...entry.shiftEntry,
              shift: nextShiftCode,
              shiftType: nextShiftType,
              hours: nextShiftDefinition?.hours ?? entry.shiftEntry.hours,
              startTime: nextShiftDefinition?.start ?? startTime,
              endTime: nextShiftDefinition?.end ?? endTime,
            },
          };
        }),
      );

      return newMap;
    });
  };

  const sortedShiftMap = useMemo(() => {
    const newMap = new Map<
      string,
      { nurse: string; shiftEntry: ShiftEntry }[]
    >();
    shiftMap.forEach((entries, date) => {
      const dayShifts = entries.filter((e) => e.shiftEntry.shiftType === "day");
      const nightShifts = entries.filter(
        (e) => e.shiftEntry.shiftType === "night",
      );
      const offShifts = entries.filter(
        (e) =>
          e.shiftEntry.shiftType !== "day" &&
          e.shiftEntry.shiftType !== "night",
      );
      newMap.set(date, [...dayShifts, ...nightShifts, ...offShifts]);
    });
    return newMap;
  }, [shiftMap]);

  const shiftMapWithTimes = useMemo(() => {
    const newMap = new Map<
      string,
      { nurse: string; shiftEntry: ShiftEntry }[]
    >();
    sortedShiftMap.forEach((entries, date) => {
      const updatedEntries = entries.map(({ nurse, shiftEntry }) => {
        const { startTime, endTime } = getShiftTimes(
          shiftEntry.shift,
          shiftEntry.shiftType,
        );
        return {
          nurse,
          shiftEntry: { ...shiftEntry, startTime, endTime },
        };
      });
      newMap.set(date, updatedEntries);
    });
    return newMap;
  }, [sortedShiftMap]);

  const rows: string[][] = [];
  for (let i = 0; i < ocrDates.length; i += 7) {
    rows.push(ocrDates.slice(i, i + 7));
  }

  const isAtBaseline =
    buildGridDataKey(convertShiftMapToGrid(shiftMap)) ===
    buildGridDataKey(convertShiftMapToGrid(baselineShiftMap));

  return (
    <SectionCard
      title="Schedule Calendar"
      icon={<CalendarHeart className="text-pink-600" />}
      actions={
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500 mr-2">
            {ocrDates.length} days • {ocrGrid.length} staff
          </span>
          <button
            onClick={handleUndo}
            title="Undo"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            type="button"
            disabled={history.length === 0}
          >
            <Undo2
              className={`w-4 h-4 ${history.length === 0 ? "text-gray-300" : "text-gray-600"}`}
            />
          </button>
          <button
            onClick={handleReset}
            title="Reset"
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            type="button"
            disabled={isAtBaseline}
          >
            <RefreshCcw
              className={`w-4 h-4 ${isAtBaseline ? "text-gray-300" : "text-gray-600"}`}
            />
          </button>
        </div>
      }
    >
      {/* Legend */}
      <div className="flex gap-4 mb-4 pb-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm">☀️</span>
          <span className="text-xs font-medium text-gray-600">Day Shift</span>
          <div className="w-4 h-4 rounded bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-200" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">🌙</span>
          <span className="text-xs font-medium text-gray-600">Night Shift</span>
          <div className="w-4 h-4 rounded bg-gradient-to-r from-indigo-100 to-purple-100 border border-indigo-200" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-orange-50 border-2 border-orange-200" />
          <span className="text-xs font-medium text-gray-600">Weekend</span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEndWithMove}
        onDragOver={handleDragOver}
      >
        <div className="space-y-6">
          {rows.map((week, weekIdx) => (
            <div key={weekIdx}>
              {/* Week header */}
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Week {weekIdx + 1}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {week.map((date) => {
                  const parsedDate = parseISO(date);
                  const displayDate = format(parsedDate, "EEE, MMM d");
                  const shifts = shiftMapWithTimes.get(date) || [];

                  return (
                    <DroppableDay
                      key={date}
                      date={date}
                      shifts={shifts}
                      displayDate={displayDate}
                      handleDelete={handleDelete}
                      onUpdateShift={handleUpdateShift}
                      onAddShift={handleAddShift}
                      availableNurses={availableNurses}
                      getNurseMetadata={getNurseMetadata}
                    />
                  );
                })}
                {week.length < 7 &&
                  Array.from({ length: 7 - week.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="invisible" />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </DndContext>
    </SectionCard>
  );
}
