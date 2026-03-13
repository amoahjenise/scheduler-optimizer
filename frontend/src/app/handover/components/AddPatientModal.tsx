"use client";

import { useState, useEffect } from "react";
import { Patient, PatientCreate, createPatientAPI } from "../../lib/api";
import { PatientFieldConfig } from "../../lib/patientConfig";
import { loadRooms } from "../../lib/roomsConfig";
import { loadTeams, DEFAULT_TEAMS } from "../../lib/teamsConfig";

interface AddPatientModalProps {
  onClose: () => void;
  onPatientAdded: (patient: Patient) => void;
  config: PatientFieldConfig;
}

const BED_OPTIONS = ["", "A", "B", "C", "D"];

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
  "SCIDS",
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

export default function AddPatientModal({
  onClose,
  onPatientAdded,
  config,
}: AddPatientModalProps) {
  const [formData, setFormData] = useState<PatientCreate>({
    mrn: "",
    first_name: "",
    last_name: "",
    date_of_birth: undefined,
    room_number: "",
    bed: "",
    diagnosis: "",
    attending_physician: "",
    admission_date: new Date().toISOString().split("T")[0],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRoomDropdown, setShowRoomDropdown] = useState(false);
  const [showDiagnosisDropdown, setShowDiagnosisDropdown] = useState(false);
  const [showPhysicianDropdown, setShowPhysicianDropdown] = useState(false);
  const [ageInputMode, setAgeInputMode] = useState<"dob" | "age">("dob");
  const [ageValue, setAgeValue] = useState<string>("");
  const [ageUnit, setAgeUnit] = useState<"months" | "years">("years");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [teamSuggestions, setTeamSuggestions] = useState<string[]>(loadTeams());
  const [roomSuggestions, setRoomSuggestions] = useState<string[]>(loadRooms());

  // Load teams from shared settings and listen for changes
  useEffect(() => {
    setTeamSuggestions(loadTeams());

    const handleTeamsChange = () => {
      setTeamSuggestions(loadTeams());
    };

    window.addEventListener("teamsConfigChanged", handleTeamsChange);
    return () => {
      window.removeEventListener("teamsConfigChanged", handleTeamsChange);
    };
  }, []);

  // Load rooms from config and listen for changes
  useEffect(() => {
    setRoomSuggestions(loadRooms());

    const handleRoomsChange = () => {
      setRoomSuggestions(loadRooms());
    };

    window.addEventListener("roomsConfigChanged", handleRoomsChange);
    return () => {
      window.removeEventListener("roomsConfigChanged", handleRoomsChange);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const missing: string[] = [];
    if (!formData.first_name.trim()) missing.push("First Name");
    if (!formData.last_name.trim()) missing.push("Last Name");
    if (!formData.room_number.trim()) missing.push("Room");
    if (config.mrn.show && config.mrn.required && !formData.mrn?.trim())
      missing.push(config.mrn.label);
    if (
      config.diagnosis.show &&
      config.diagnosis.required &&
      !formData.diagnosis?.trim()
    )
      missing.push(config.diagnosis.label);
    if (
      config.attending_physician.show &&
      config.attending_physician.required &&
      !formData.attending_physician?.trim()
    )
      missing.push(config.attending_physician.label);
    if (config.team.show && config.team.required && !selectedTeam)
      missing.push(config.team.label);
    if (missing.length) {
      setError(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    try {
      setLoading(true);
      // Include team in diagnosis field if team is shown and selected
      const teamSuffix = config.team.show && selectedTeam ? selectedTeam : "";
      // Determine age string to save
      let ageString: string | undefined;
      if (ageInputMode === "age" && ageValue) {
        ageString = `${ageValue} ${ageUnit}`;
      } else if (formData.date_of_birth) {
        ageString = getAge(formData.date_of_birth);
      }
      const patientData = {
        ...formData,
        mrn: formData.mrn?.trim() || undefined,
        age: ageString,
        diagnosis: teamSuffix
          ? formData.diagnosis
            ? `${formData.diagnosis} - ${teamSuffix}`
            : teamSuffix
          : formData.diagnosis,
      };
      const patient = await createPatientAPI(patientData);
      onPatientAdded(patient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create patient");
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: keyof PatientCreate, value: string) => {
    let newValue = value;
    if (field === "room_number") {
      newValue = value.toUpperCase();
    }
    setFormData((prev) => ({ ...prev, [field]: newValue }));
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
                  {roomSuggestions
                    .filter((r) =>
                      r
                        .toLowerCase()
                        .includes(formData.room_number.toLowerCase()),
                    )
                    .map((room) => (
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
            {config.bed.show && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {config.bed.label}
                </label>
                <select
                  value={formData.bed || ""}
                  onChange={(e) => updateField("bed", e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                >
                  {BED_OPTIONS.map((bed) => (
                    <option key={bed || "none"} value={bed}>
                      {bed || "(None)"}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

          {/* MRN + Age/DOB */}
          {(config.mrn.show || config.date_of_birth.show) && (
            <div className="grid grid-cols-2 gap-2">
              {config.mrn.show && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {config.mrn.label}
                    {config.mrn.required && (
                      <span className="text-red-500 ml-0.5">*</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={formData.mrn}
                    onChange={(e) => updateField("mrn", e.target.value)}
                    placeholder={config.mrn.required ? "" : "(Optional)"}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
              {config.date_of_birth.show && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-600">
                      {ageInputMode === "dob"
                        ? config.date_of_birth.label
                        : "Age"}
                      {config.date_of_birth.required && (
                        <span className="text-red-500 ml-0.5">*</span>
                      )}
                      {ageInputMode === "dob" && formData.date_of_birth && (
                        <span className="text-gray-400 ml-1">
                          ({getAge(formData.date_of_birth)})
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAgeInputMode(ageInputMode === "dob" ? "age" : "dob");
                        if (ageInputMode === "dob" && formData.date_of_birth) {
                          // Calculate age from DOB
                          const age = getAge(formData.date_of_birth);
                          const match = age.match(/(\d+)(\s*mo|\.\d+)/);
                          if (
                            match &&
                            (age.includes("mo") || parseFloat(match[1]) < 2)
                          ) {
                            setAgeUnit("months");
                            const months = age.includes("mo")
                              ? match[1]
                              : Math.round(parseFloat(age) * 12).toString();
                            setAgeValue(months);
                          } else {
                            setAgeUnit("years");
                            setAgeValue(age.split("y")[0]);
                          }
                        } else if (ageInputMode === "age" && ageValue) {
                          // Calculate DOB from age
                          const today = new Date();
                          let years = 0;
                          if (ageUnit === "months") {
                            years = parseInt(ageValue) / 12;
                          } else {
                            years = parseInt(ageValue);
                          }
                          const dob = new Date(
                            today.getFullYear() - years,
                            today.getMonth(),
                            today.getDate(),
                          );
                          updateField(
                            "date_of_birth",
                            dob.toISOString().split("T")[0],
                          );
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 underline"
                    >
                      {ageInputMode === "dob" ? "Use Age" : "Use DOB"}
                    </button>
                  </div>
                  {ageInputMode === "dob" ? (
                    <input
                      type="date"
                      value={formData.date_of_birth || ""}
                      onChange={(e) =>
                        updateField("date_of_birth", e.target.value)
                      }
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min="0"
                        value={ageValue}
                        onChange={(e) => {
                          setAgeValue(e.target.value);
                          if (e.target.value) {
                            const today = new Date();
                            let years = 0;
                            if (ageUnit === "months") {
                              years = parseInt(e.target.value) / 12;
                            } else {
                              years = parseInt(e.target.value);
                            }
                            const dob = new Date(
                              today.getFullYear() - years,
                              today.getMonth(),
                              today.getDate(),
                            );
                            updateField(
                              "date_of_birth",
                              dob.toISOString().split("T")[0],
                            );
                          }
                        }}
                        placeholder="e.g., 2"
                        className="w-14 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                      <select
                        value={ageUnit}
                        onChange={(e) => {
                          const newUnit = e.target.value as "months" | "years";
                          setAgeUnit(newUnit);
                          if (ageValue) {
                            const today = new Date();
                            let years = 0;
                            if (newUnit === "months") {
                              years = parseInt(ageValue) / 12;
                            } else {
                              years = parseInt(ageValue);
                            }
                            const dob = new Date(
                              today.getFullYear() - years,
                              today.getMonth(),
                              today.getDate(),
                            );
                            updateField(
                              "date_of_birth",
                              dob.toISOString().split("T")[0],
                            );
                          }
                        }}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="years">yr</option>
                        <option value="months">mo</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Diagnosis with suggestions */}
          {config.diagnosis.show && (
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {config.diagnosis.label}
                {config.diagnosis.required && (
                  <span className="text-red-500 ml-0.5">*</span>
                )}
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
          )}

          {/* Physician with suggestions */}
          {config.attending_physician.show && (
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {config.attending_physician.label}
                {config.attending_physician.required && (
                  <span className="text-red-500 ml-0.5">*</span>
                )}
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
          )}

          {/* Team selection */}
          {config.team.show && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {config.team.label}
                {config.team.required && (
                  <span className="text-red-500 ml-0.5">*</span>
                )}
              </label>
              <div className="flex gap-1 flex-wrap">
                {(teamSuggestions.length ? teamSuggestions : DEFAULT_TEAMS).map(
                  (team) => (
                    <button
                      key={team}
                      type="button"
                      onClick={() =>
                        setSelectedTeam(team === selectedTeam ? "" : team)
                      }
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        selectedTeam === team
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                      }`}
                    >
                      {team}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
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
