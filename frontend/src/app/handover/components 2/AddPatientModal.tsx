"use client";

import { useState } from "react";
import { Patient, PatientCreate, createPatientAPI } from "../../lib/api";

interface AddPatientModalProps {
  onClose: () => void;
  onPatientAdded: (patient: Patient) => void;
}

// Real room suggestions for HEMA-ONC unit (B7 wing)
const ROOM_SUGGESTIONS = [
  "B7.01",
  "B7.02",
  "B7.03",
  "B7.04",
  "B7.05",
  "B7.06",
  "B7.07",
  "B7.08",
  "B7.09",
  "B7.10",
  "B7.11",
  "B7.12",
  "B7.13",
  "B7.14",
  "B7.15",
  "B7.16",
];

const BED_OPTIONS = ["A", "B", "C", "D"];

const DIAGNOSIS_SUGGESTIONS = [
  "ALL (Acute Lymphoblastic Leukemia)",
  "AML (Acute Myeloid Leukemia)",
  "Neuroblastoma",
  "Hodgkin Lymphoma",
  "Non-Hodgkin Lymphoma",
  "Brain Tumor",
  "Osteosarcoma",
  "Ewing Sarcoma",
  "Wilms Tumor",
  "Rhabdomyosarcoma",
  "Retinoblastoma",
  "Sickle Cell Disease",
  "Aplastic Anemia",
  "Hemophilia",
  "Thalassemia",
  "BMT - Auto",
  "BMT - Allo",
];

const PHYSICIAN_SUGGESTIONS = [
  "Dr. Bhatt",
  "Dr. Mitchell",
  "Dr. Cellot",
  "Dr. Moghrabi",
  "Dr. Bernstein",
  "Dr. Jabado",
  "Dr. Bhojwani",
];

// Team suggestions
const TEAM_SUGGESTIONS = ["Oncology", "BMT", "Hematology", "Neuro-Onc"];

export default function AddPatientModal({
  onClose,
  onPatientAdded,
}: AddPatientModalProps) {
  const [formData, setFormData] = useState<PatientCreate>({
    mrn: "",
    first_name: "",
    last_name: "",
    date_of_birth: undefined,
    room_number: "",
    bed: "A",
    diagnosis: "",
    attending_physician: "",
    admission_date: new Date().toISOString().split("T")[0],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRoomDropdown, setShowRoomDropdown] = useState(false);
  const [showDiagnosisDropdown, setShowDiagnosisDropdown] = useState(false);
  const [showPhysicianDropdown, setShowPhysicianDropdown] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (
      !formData.mrn.trim() ||
      !formData.first_name.trim() ||
      !formData.last_name.trim() ||
      !formData.room_number.trim()
    ) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setLoading(true);
      const patient = await createPatientAPI(formData);
      onPatientAdded(patient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create patient");
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: keyof PatientCreate, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Calculate age from DOB
  const getAge = (dob: string) => {
    if (!dob) return "";
    const birth = new Date(dob);
    const now = new Date();
    const months =
      (now.getFullYear() - birth.getFullYear()) * 12 +
      (now.getMonth() - birth.getMonth());
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    return `${years} year${years !== 1 ? "s" : ""}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal - Compact size */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-blue-600 text-white">
          <h2 className="font-semibold">Quick Add Patient</h2>
          <button onClick={onClose} className="p-1 hover:bg-blue-700 rounded">
            <svg
              className="w-5 h-5"
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

        {/* Scrollable Form */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* Room + Bed - Most important, at top */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Room <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.room_number}
                onChange={(e) => updateField("room_number", e.target.value)}
                onFocus={() => setShowRoomDropdown(true)}
                onBlur={() => setTimeout(() => setShowRoomDropdown(false), 150)}
                placeholder="B7.01"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                required
              />
              {showRoomDropdown && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                  {ROOM_SUGGESTIONS.filter((r) =>
                    r.includes(formData.room_number),
                  ).map((room) => (
                    <button
                      key={room}
                      type="button"
                      onClick={() => {
                        updateField("room_number", room);
                        setShowRoomDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-blue-50"
                    >
                      {room}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Bed
              </label>
              <select
                value={formData.bed || "A"}
                onChange={(e) => updateField("bed", e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
              >
                {BED_OPTIONS.map((bed) => (
                  <option key={bed} value={bed}>
                    {bed}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Name - Compact row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                placeholder="John"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => updateField("last_name", e.target.value)}
                placeholder="Doe"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* MRN + DOB */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                MRN <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.mrn}
                onChange={(e) => updateField("mrn", e.target.value)}
                placeholder="1234567"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                DOB{" "}
                {formData.date_of_birth && (
                  <span className="text-gray-400">
                    ({getAge(formData.date_of_birth)})
                  </span>
                )}
              </label>
              <input
                type="date"
                value={formData.date_of_birth || ""}
                onChange={(e) => updateField("date_of_birth", e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Diagnosis with suggestions */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Diagnosis
            </label>
            <input
              type="text"
              value={formData.diagnosis || ""}
              onChange={(e) => updateField("diagnosis", e.target.value)}
              onFocus={() => setShowDiagnosisDropdown(true)}
              onBlur={() =>
                setTimeout(() => setShowDiagnosisDropdown(false), 150)
              }
              placeholder="e.g., ALL, AML, Neuroblastoma"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
            />
            {showDiagnosisDropdown && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {DIAGNOSIS_SUGGESTIONS.filter((d) =>
                  d
                    .toLowerCase()
                    .includes((formData.diagnosis || "").toLowerCase()),
                )
                  .slice(0, 6)
                  .map((diag) => (
                    <button
                      key={diag}
                      type="button"
                      onClick={() => {
                        updateField("diagnosis", diag);
                        setShowDiagnosisDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-blue-50"
                    >
                      {diag}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Physician with suggestions */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Attending Physician
            </label>
            <input
              type="text"
              value={formData.attending_physician || ""}
              onChange={(e) =>
                updateField("attending_physician", e.target.value)
              }
              onFocus={() => setShowPhysicianDropdown(true)}
              onBlur={() =>
                setTimeout(() => setShowPhysicianDropdown(false), 150)
              }
              placeholder="Dr. Smith"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
            />
            {showPhysicianDropdown && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-24 overflow-y-auto">
                {PHYSICIAN_SUGGESTIONS.filter((p) =>
                  p
                    .toLowerCase()
                    .includes(
                      (formData.attending_physician || "").toLowerCase(),
                    ),
                ).map((phys) => (
                  <button
                    key={phys}
                    type="button"
                    onClick={() => {
                      updateField("attending_physician", phys);
                      setShowPhysicianDropdown(false);
                    }}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-blue-50"
                  >
                    {phys}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick team buttons */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Team (Quick Select)
            </label>
            <div className="flex gap-1 flex-wrap">
              {TEAM_SUGGESTIONS.map((team) => (
                <button
                  key={team}
                  type="button"
                  onClick={() =>
                    updateField(
                      "diagnosis",
                      formData.diagnosis
                        ? `${formData.diagnosis} - ${team}`
                        : team,
                    )
                  }
                  className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200"
                >
                  {team}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Footer - Fixed at bottom */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded flex items-center gap-2"
          >
            {loading && (
              <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
            )}
            Add Patient
          </button>
        </div>
      </div>
    </div>
  );
}
