"use client";

import React from "react";
import SectionCard from "./SectionCard";
import { useTranslations } from "next-intl";

type ShiftEntry = {
  date: string;
  shift: string;
  shiftType: "day" | "night" | "combined";
  hours: number;
  startTime: string;
  endTime: string;
};

type GridRow = {
  id: string; // unique id for stable keys
  nurse: string;
  shifts: ShiftEntry[];
};

function generateEmptyRow(ocrDatesLength: number, ocrDates: string[]): GridRow {
  return {
    id: crypto.randomUUID(),
    nurse: "",
    shifts: ocrDates.map((date) => ({
      date,
      shift: "",
      shiftType: "day",
      hours: 0,
      startTime: "",
      endTime: "",
    })),
  };
}

export default function EditableOCRGrid({
  ocrDates,
  ocrGrid,
  setOcrGrid,
  marker,
  onAsteriskDetected,
  onAsteriskToggled,
}: {
  ocrDates: string[];
  ocrGrid: GridRow[];
  setOcrGrid: React.Dispatch<React.SetStateAction<GridRow[]>>;
  marker: string;
  onAsteriskDetected?: (nurse: string, date: string) => void;
  onAsteriskToggled?: (
    nurse: string,
    date: string,
    hasAsterisk: boolean,
  ) => void;
}) {
  const t = useTranslations("scheduler");
  const [colWidths, setColWidths] = React.useState<number[]>(() => {
    const baseWidth = 120;
    const shiftColWidth = 80;
    return [baseWidth, ...ocrDates.map(() => shiftColWidth), 60];
  });

  React.useEffect(() => {
    setColWidths((prev) => {
      const baseWidth = 120;
      const shiftColWidth = 80;
      const newWidths = [baseWidth, ...ocrDates.map(() => shiftColWidth), 60];
      return newWidths.map((w, i) => prev[i] || w);
    });
  }, [ocrDates]);

  const resizingColIndex = React.useRef<number | null>(null);
  const startX = React.useRef(0);
  const startWidth = React.useRef(0);

  function handleMouseDown(e: React.MouseEvent, colIndex: number) {
    resizingColIndex.current = colIndex;
    startX.current = e.clientX;
    startWidth.current = colWidths[colIndex];
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    e.preventDefault();
  }

  function handleMouseMove(e: MouseEvent) {
    if (resizingColIndex.current === null) return;
    const deltaX = e.clientX - startX.current;
    const newWidth = Math.max(40, startWidth.current + deltaX);
    setColWidths((prev) => {
      const updated = [...prev];
      updated[resizingColIndex.current!] = newWidth;
      return updated;
    });
  }

  function handleMouseUp() {
    resizingColIndex.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }

  function handleShiftChange(
    rowIndex: number,
    colIndex: number,
    value: string,
  ) {
    const hasAsterisk = value.trim().endsWith("*");
    const normalized = value.trim();
    const row = ocrGrid[rowIndex];
    const shift = row?.shifts?.[colIndex];
    const previousShiftValue = String(shift?.shift || "");
    const hadAsterisk = previousShiftValue.trim().endsWith("*");

    if (
      onAsteriskToggled &&
      row?.nurse &&
      shift?.date &&
      hadAsterisk !== hasAsterisk
    ) {
      onAsteriskToggled(row.nurse, shift.date, hasAsterisk);
    }

    if (
      onAsteriskDetected &&
      row?.nurse &&
      shift?.date &&
      (normalized === "*" || normalized.endsWith("*"))
    ) {
      onAsteriskDetected(row.nurse, shift.date);
    }

    setOcrGrid((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };
      const shifts = [...row.shifts];
      shifts[colIndex] = { ...shifts[colIndex], shift: value };
      row.shifts = shifts;
      updated[rowIndex] = row;
      return updated;
    });
  }

  function handleNurseChange(rowIndex: number, value: string) {
    setOcrGrid((prev) => {
      const updated = [...prev];
      updated[rowIndex] = {
        ...updated[rowIndex],
        nurse: value,
      };
      return updated;
    });
  }

  function handleAddRow() {
    setOcrGrid((prev) => [
      ...prev,
      generateEmptyRow(ocrDates.length, ocrDates),
    ]);
  }

  function handleRemoveRow(rowIndex: number) {
    setOcrGrid((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  return (
    <SectionCard
      title={t("editableScheduleGridOcrReview")}
      icon={<span>📝</span>}
    >
      <div className="overflow-auto" style={{ maxHeight: "520px" }}>
        <table
          className="table-auto border-collapse w-full text-sm text-left text-gray-700"
          style={{ tableLayout: "fixed" }}
        >
          <thead>
            <tr>
              <th
                className="border border-blue-200 p-2 text-center"
                style={{
                  width: colWidths[colWidths.length - 1],
                  minWidth: 80,
                  maxWidth: 100,
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 4,
                  backgroundColor: "#dbeafe",
                }}
              >
                {t("remove")}
              </th>
              <th
                className="border border-blue-200 p-2 relative whitespace-normal break-words"
                style={{
                  width: colWidths[0],
                  minWidth: 120,
                  maxWidth: 300,
                  position: "sticky",
                  top: 0,
                  left: colWidths[colWidths.length - 1],
                  zIndex: 4,
                  backgroundColor: "#dbeafe",
                }}
              >
                {t("nurse")}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 0)}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                  style={{ userSelect: "none" }}
                />
              </th>
              {ocrDates.map((date, i) => (
                <th
                  key={date}
                  className="border border-blue-200 p-2 text-center relative"
                  style={{
                    width: colWidths[i + 1],
                    minWidth: 40,
                    maxWidth: 300,
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    backgroundColor: "#dbeafe",
                  }}
                >
                  {date}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, i + 1)}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                    style={{ userSelect: "none" }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ocrGrid.map((row, rowIndex) => (
              <tr key={row.id}>
                <td
                  className="border border-blue-200 bg-white p-2 text-center"
                  style={{
                    width: colWidths[colWidths.length - 1],
                    minWidth: 80,
                    maxWidth: 100,
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    backgroundColor: "#ffffff",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(rowIndex)}
                    aria-label={t("removeNurseRowAria", {
                      name: row.nurse || String(rowIndex + 1),
                    })}
                    className="text-red-600 hover:text-red-800 font-bold px-2 py-1 rounded hover:bg-red-50"
                  >
                    ✕
                  </button>
                </td>
                <td
                  className="border border-blue-200 bg-white p-2 font-medium"
                  style={{
                    width: colWidths[0],
                    minWidth: 40,
                    maxWidth: 300,
                    position: "sticky",
                    left: colWidths[colWidths.length - 1],
                    zIndex: 2,
                    backgroundColor: "#ffffff",
                  }}
                >
                  <input
                    value={row.nurse}
                    onChange={(e) =>
                      handleNurseChange(rowIndex, e.target.value)
                    }
                    placeholder={t("nurseName")}
                    className="w-full bg-transparent focus:outline-none resize-y overflow-auto break-words"
                  />
                </td>
                {row.shifts.map((shift, colIndex) => (
                  <td
                    key={colIndex}
                    className={`border border-blue-200 p-1 text-center ${
                      shift.shift.endsWith("*") ? "bg-yellow-100" : "bg-white"
                    }`}
                    style={{
                      width: colWidths[colIndex + 1],
                      minWidth: 40,
                      maxWidth: 300,
                    }}
                  >
                    <input
                      value={shift.shift}
                      onChange={(e) =>
                        handleShiftChange(rowIndex, colIndex, e.target.value)
                      }
                      placeholder="—"
                      className="w-full text-center bg-transparent focus:outline-none resize-y overflow-auto placeholder:text-gray-300"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={handleAddRow}
          className="px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-700 transition"
        >
          + {t("addNurse")}
        </button>
      </div>
    </SectionCard>
  );
}
