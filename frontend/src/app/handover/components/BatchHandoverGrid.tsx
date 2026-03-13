"use client";

import { useState, useCallback } from "react";
import {
  Patient,
  Handover,
  HandoverUpdate,
  PatientStatus,
  updateHandoverAPI,
} from "../../lib/api";

interface BatchHandoverGridProps {
  patients: Patient[];
  handovers: Handover[];
  onHandoverUpdate: (handover: Handover) => void;
  onPrintAll: () => void;
}

// Inline editable cell component
function EditableCell({
  value,
  onChange,
  type = "text",
  options,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (val: string) => void;
  type?: "text" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const handleBlur = () => {
    setEditing(false);
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  if (type === "select" && options) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border-0 text-sm focus:ring-1 focus:ring-blue-500 rounded px-1 py-0.5 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLocalValue(value);
              setEditing(false);
            }
          }}
          className="w-full border border-blue-400 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[60px] resize-none"
          placeholder={placeholder}
        />
      );
    }
    return (
      <input
        autoFocus
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleBlur();
          if (e.key === "Escape") {
            setLocalValue(value);
            setEditing(false);
          }
        }}
        className="w-full border border-blue-400 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      onClick={() => {
        setLocalValue(value);
        setEditing(true);
      }}
      className={`w-full min-h-[24px] px-1 py-0.5 text-sm rounded cursor-text hover:bg-gray-100 ${
        !value ? "text-gray-400 italic" : ""
      }`}
    >
      {value || placeholder || "Click to edit"}
    </div>
  );
}

// Status badge with quick toggle
function StatusBadge({
  status,
  onChange,
}: {
  status: PatientStatus;
  onChange: (status: PatientStatus) => void;
}) {
  const statusConfig: Record<
    PatientStatus,
    { bg: string; text: string; label: string }
  > = {
    stable: { bg: "bg-green-100", text: "text-green-700", label: "Stable" },
    improved: { bg: "bg-blue-100", text: "text-blue-700", label: "Improved" },
    unchanged: { bg: "bg-gray-100", text: "text-gray-700", label: "Unchanged" },
    worsening: {
      bg: "bg-orange-100",
      text: "text-orange-700",
      label: "Worsening",
    },
    critical: { bg: "bg-red-100", text: "text-red-700", label: "Critical" },
  };

  const statuses: PatientStatus[] = [
    "stable",
    "improved",
    "unchanged",
    "worsening",
    "critical",
  ];

  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as PatientStatus)}
      className={`${statusConfig[status].bg} ${statusConfig[status].text} text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-1 focus:ring-blue-500`}
    >
      {statuses.map((s) => (
        <option key={s} value={s}>
          {statusConfig[s].label}
        </option>
      ))}
    </select>
  );
}

export default function BatchHandoverGrid({
  patients,
  handovers,
  onHandoverUpdate,
  onPrintAll,
}: BatchHandoverGridProps) {
  const [savingId, setSavingId] = useState<string | null>(null);

  const getHandoverForPatient = useCallback(
    (patientId: string) => {
      return handovers.find((h) => h.patient_id === patientId);
    },
    [handovers],
  );

  const updateField = useCallback(
    async (handoverId: string, field: keyof HandoverUpdate, value: string) => {
      setSavingId(handoverId);
      try {
        const updated = await updateHandoverAPI(handoverId, { [field]: value });
        onHandoverUpdate(updated);
      } catch (err) {
        console.error("Failed to update:", err);
      } finally {
        setSavingId(null);
      }
    },
    [onHandoverUpdate],
  );

  const isolationOptions = [
    { value: "none", label: "None" },
    { value: "contact", label: "Contact" },
    { value: "droplet", label: "Droplet" },
    { value: "airborne", label: "Airborne" },
    { value: "neutropenic", label: "Neutropenic" },
    { value: "protective", label: "Protective" },
  ];

  const acuityOptions = [
    { value: "low", label: "Low" },
    { value: "moderate", label: "Mod" },
    { value: "high", label: "High" },
    { value: "critical", label: "Crit" },
  ];

  // Group patients by room
  const patientsByRoom = patients.reduce(
    (acc, patient) => {
      const room = patient.room_number || "Unknown";
      if (!acc[room]) acc[room] = [];
      acc[room].push(patient);
      return acc;
    },
    {} as Record<string, Patient[]>,
  );

  const sortedRooms = Object.keys(patientsByRoom).sort((a, b) => {
    const numA = parseInt(a) || 0;
    const numB = parseInt(b) || 0;
    return numA - numB;
  });

  if (patients.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500">
          No patients to display. Add patients or upload a handover document.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="font-medium text-gray-900">
            {patients.length} patients
          </span>
          <span>•</span>
          <span>
            {handovers.filter((h) => h.is_completed).length} completed
          </span>
        </div>
        <button
          onClick={onPrintAll}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
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
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            />
          </svg>
          Print All
        </button>
      </div>

      {/* Grid Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-24">
                  Room
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-32">
                  Patient
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-24">
                  Status
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-20">
                  Acuity
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-24">
                  Isolation
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 w-32">
                  Diagnosis
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 min-w-[150px]">
                  IV/Lines
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 min-w-[200px]">
                  Events This Shift
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700 min-w-[150px]">
                  Pending
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRooms.map((room) =>
                patientsByRoom[room].map((patient, idx) => {
                  const handover = getHandoverForPatient(patient.id);
                  const isFirst = idx === 0;
                  const isSaving = savingId === handover?.id;

                  return (
                    <tr
                      key={patient.id}
                      className={`border-b border-gray-100 hover:bg-blue-50/30 ${
                        isSaving ? "opacity-70" : ""
                      } ${isFirst && idx > 0 ? "border-t-2 border-t-gray-200" : ""}`}
                    >
                      {/* Room */}
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {patient.room_number}
                        {patient.bed && (
                          <span className="text-gray-500">-{patient.bed}</span>
                        )}
                      </td>

                      {/* Patient Name */}
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {patient.last_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {patient.first_name}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <StatusBadge
                            status={handover.status as PatientStatus}
                            onChange={(val) =>
                              updateField(handover.id, "status", val)
                            }
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Acuity */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <EditableCell
                            type="select"
                            value={handover.acuity}
                            onChange={(val) =>
                              updateField(handover.id, "acuity", val)
                            }
                            options={acuityOptions}
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Isolation */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <EditableCell
                            type="select"
                            value={handover.isolation}
                            onChange={(val) =>
                              updateField(handover.id, "isolation", val)
                            }
                            options={isolationOptions}
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Diagnosis */}
                      <td className="px-3 py-2 text-gray-600">
                        {patient.diagnosis || (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* IV/Lines */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <EditableCell
                            value={handover.iv_access || ""}
                            onChange={(val) =>
                              updateField(handover.id, "iv_access", val)
                            }
                            placeholder="PIV, Central, Port..."
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Events This Shift */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <EditableCell
                            value={handover.events_this_shift || ""}
                            onChange={(val) =>
                              updateField(handover.id, "events_this_shift", val)
                            }
                            placeholder="Key events..."
                            multiline
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Pending */}
                      <td className="px-3 py-2">
                        {handover ? (
                          <EditableCell
                            value={handover.pending_tasks || ""}
                            onChange={(val) =>
                              updateField(handover.id, "pending_tasks", val)
                            }
                            placeholder="Pending tasks..."
                          />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Details Section - Click a row to expand */}
      <div className="text-xs text-gray-500 text-center">
        Click any cell to edit inline • Changes save automatically
      </div>
    </div>
  );
}
