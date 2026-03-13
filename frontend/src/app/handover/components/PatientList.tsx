"use client";

import { Patient } from "../../lib/api";

interface PatientListProps {
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onAddPatient: () => void;
  getHandoverStatus: (
    patientId: string,
  ) => "not-started" | "in-progress" | "completed";
  nurseName: string;
}

export default function PatientList({
  patients,
  onSelectPatient,
  onAddPatient,
  getHandoverStatus,
  nurseName,
}: PatientListProps) {
  const statusColors = {
    "not-started": "bg-gray-100 text-gray-600",
    "in-progress": "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
  };

  const statusLabels = {
    "not-started": "Not started",
    "in-progress": "In progress",
    completed: "Completed",
  };

  // Group patients by room
  const patientsByRoom = patients.reduce(
    (acc, patient) => {
      const room = patient.room_number;
      if (!acc[room]) acc[room] = [];
      acc[room].push(patient);
      return acc;
    },
    {} as Record<string, Patient[]>,
  );

  const sortedRooms = Object.keys(patientsByRoom).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, "")) || 0;
    const numB = parseInt(b.replace(/\D/g, "")) || 0;
    return numA - numB;
  });

  const completedCount = patients.filter(
    (p) => getHandoverStatus(p.id) === "completed",
  ).length;
  const inProgressCount = patients.filter(
    (p) => getHandoverStatus(p.id) === "in-progress",
  ).length;

  return (
    <div>
      {/* Summary bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {patients.length}
              </p>
              <p className="text-sm text-gray-500">Active patients</p>
            </div>
            <div className="h-10 w-px bg-gray-200" />
            <div>
              <p className="text-2xl font-semibold text-green-600">
                {completedCount}
              </p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
            <div className="h-10 w-px bg-gray-200" />
            <div>
              <p className="text-2xl font-semibold text-amber-600">
                {inProgressCount}
              </p>
              <p className="text-sm text-gray-500">In progress</p>
            </div>
          </div>

          <button
            onClick={onAddPatient}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Patient
          </button>
        </div>
      </div>

      {/* Warning if no nurse name */}
      {!nurseName && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg mb-6 text-sm">
          <strong>Note:</strong> Enter your name above before starting
          handovers.
        </div>
      )}

      {/* Patient grid */}
      {patients.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No patients
          </h3>
          <p className="text-gray-500 mb-4">
            Add patients to begin the handover process.
          </p>
          <button
            onClick={onAddPatient}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add First Patient
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedRooms.map((room) => (
            <div
              key={room}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <h3 className="text-sm font-medium text-gray-700">
                  Room {room}
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {patientsByRoom[room].map((patient) => {
                  const status = getHandoverStatus(patient.id);
                  return (
                    <button
                      key={patient.id}
                      onClick={() => onSelectPatient(patient)}
                      disabled={!nurseName}
                      className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-600 font-medium text-sm">
                            {patient.first_name[0]}
                            {patient.last_name[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {patient.last_name}, {patient.first_name}
                            {patient.bed && (
                              <span className="text-gray-500 font-normal">
                                {" "}
                                - Bed {patient.bed}
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-3 text-sm text-gray-500">
                            <span>MRN: {patient.mrn}</span>
                            {patient.diagnosis && (
                              <>
                                <span>•</span>
                                <span className="truncate max-w-xs">
                                  {patient.diagnosis}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}
                        >
                          {statusLabels[status]}
                        </span>
                        <svg
                          className="w-5 h-5 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
