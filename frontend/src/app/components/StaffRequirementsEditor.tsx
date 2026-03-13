import React from "react";
import SectionCard from "./SectionCard";

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
      setRequiredStaff({});
    }
  }

  return (
    <SectionCard title="Staff Requirements & Shift Hours">
      <div className="mb-4 flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Set minimum staff required for each shift type per day. Leave blank to
          use defaults (5 day / 3 night staff).
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
              <th className="p-2 border">Shift</th>
              {ocrDates.map((date) => (
                <th key={date} className="p-2 border">
                  {date}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shiftTypes.map((shift) => (
              <tr key={shift}>
                <td className="border px-2 py-1 font-semibold">{shift}</td>
                {ocrDates.map((date) => (
                  <td key={date} className="border px-2 py-1">
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
