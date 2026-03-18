"use client";

import { useState, useEffect } from "react";
import {
  Handover,
  HandoverCreate,
  ShiftType,
  createHandoverAPI,
} from "../../lib/api";
import { PatientFieldConfig } from "../../lib/patientConfig";
import { loadRooms } from "../../lib/roomsConfig";
import { loadTeams, DEFAULT_TEAMS } from "../../lib/teamsConfig";
import { loadDiagnoses, addDiagnosis } from "../../lib/diagnosesConfig";
import { useOrganization } from "../../context/OrganizationContext";

interface NewHandoffReportModalProps {
  onClose: () => void;
  onHandoverCreated: (handover: Handover) => void;
  config: PatientFieldConfig;
  shiftType: ShiftType;
  outgoingNurse: string;
}

const BED_OPTIONS = ["", "A", "B", "C", "D"];

const PHYSICIAN_SUGGESTIONS = [
  "Dr. Bhatt",
  "Dr. Mitchell",
  "Dr. Cellot",
  "Dr. Moghrabi",
  "Dr. Bernstein",
  "Dr. Jabado",
  "Dr. Bhojwani",
];

export default function NewHandoffReportModal({
  onClose,
  onHandoverCreated,
  config,
  shiftType,
  outgoingNurse,
}: NewHandoffReportModalProps) {
  const { getAuthHeaders } = useOrganization();
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    room_number: "",
    bed: "",
    mrn: "",
    diagnosis: "",
    attending_physician: "",
    date_of_birth: "",
    age: "",
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
  const [diagnosisSuggestions, setDiagnosisSuggestions] =
    useState<string[]>(loadDiagnoses());

  useEffect(() => {
    setTeamSuggestions(loadTeams());
    const handleTeamsChange = () => setTeamSuggestions(loadTeams());
    window.addEventListener("teamsConfigChanged", handleTeamsChange);
    return () =>
      window.removeEventListener("teamsConfigChanged", handleTeamsChange);
  }, []);

  useEffect(() => {
    setRoomSuggestions(loadRooms());
    const handleRoomsChange = () => setRoomSuggestions(loadRooms());
    window.addEventListener("roomsConfigChanged", handleRoomsChange);
    return () =>
      window.removeEventListener("roomsConfigChanged", handleRoomsChange);
  }, []);

  useEffect(() => {
    setDiagnosisSuggestions(loadDiagnoses());
    const handleDiagChange = () => setDiagnosisSuggestions(loadDiagnoses());
    window.addEventListener("diagnosesConfigChanged", handleDiagChange);
    return () =>
      window.removeEventListener("diagnosesConfigChanged", handleDiagChange);
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const missing: string[] = [];
    if (!formData.first_name.trim()) missing.push("First Name");
    if (!formData.last_name.trim()) missing.push("Last Name");
    if (!formData.room_number.trim()) missing.push("Room");
    if (config.mrn.show && config.mrn.required && !formData.mrn.trim())
      missing.push(config.mrn.label);
    if (
      config.diagnosis.show &&
      config.diagnosis.required &&
      !formData.diagnosis.trim()
    )
      missing.push(config.diagnosis.label);
    if (
      config.attending_physician.show &&
      config.attending_physician.required &&
      !formData.attending_physician.trim()
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

      // Build diagnosis with team suffix
      const teamSuffix = config.team.show && selectedTeam ? selectedTeam : "";
      const diagnosis = teamSuffix
        ? formData.diagnosis
          ? `${formData.diagnosis} - ${teamSuffix}`
          : teamSuffix
        : formData.diagnosis;

      // Determine age string
      let ageString: string | undefined;
      if (ageInputMode === "age" && ageValue) {
        ageString = `${ageValue} ${ageUnit}`;
      } else if (formData.date_of_birth) {
        ageString = getAge(formData.date_of_birth);
      }

      // Create handover directly with embedded patient info (no separate patient record)
      const handoverData: HandoverCreate = {
        shift_date: new Date().toISOString(),
        shift_type: shiftType,
        outgoing_nurse: outgoingNurse,
        // Embedded patient demographics
        p_first_name: formData.first_name.trim(),
        p_last_name: formData.last_name.trim(),
        p_room_number: formData.room_number.trim(),
        p_bed: formData.bed || undefined,
        p_mrn: formData.mrn.trim() || undefined,
        p_diagnosis: diagnosis || undefined,
        p_date_of_birth: formData.date_of_birth || undefined,
        p_age: ageString || undefined,
        p_attending_physician: formData.attending_physician.trim() || undefined,
      };

      const authHeaders = await getAuthHeaders();
      const handover = await createHandoverAPI(handoverData, authHeaders);
      onHandoverCreated(handover);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create hand-off report",
      );
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: keyof typeof formData, value: string) => {
    let newValue = value;
    if (field === "room_number") newValue = value.toUpperCase();
    setFormData((prev) => ({ ...prev, [field]: newValue }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-blue-600 text-white">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                shiftType === "day"
                  ? "bg-amber-500 text-white"
                  : "bg-indigo-800 text-white"
              }`}
            >
              {shiftType === "day" ? "D" : "N"}
            </div>
            <div>
              <h2 className="font-semibold">
                New {shiftType === "day" ? "Day" : "Night"} Shift Report
              </h2>
              <p className="text-xs text-blue-100">
                Patient info is stored only on this report
              </p>
            </div>
          </div>
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

        {/* Privacy notice */}
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
          <svg
            className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-xs text-amber-800">
            Patient information is embedded in this hand-off report and is not
            stored as a separate permanent record. Reports are subject to your
            organization&apos;s data retention policy.
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* Room + Bed */}
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
                  value={formData.bed}
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

          {/* Name */}
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
                        const newMode = ageInputMode === "dob" ? "age" : "dob";
                        setAgeInputMode(newMode);
                        if (newMode === "age" && formData.date_of_birth) {
                          const age = getAge(formData.date_of_birth);
                          if (age.includes("month")) {
                            setAgeUnit("months");
                            setAgeValue(age.replace(/[^0-9]/g, ""));
                          } else {
                            setAgeUnit("years");
                            setAgeValue(age.split(" ")[0]);
                          }
                        } else if (newMode === "dob" && ageValue) {
                          const today = new Date();
                          const years =
                            ageUnit === "months"
                              ? parseInt(ageValue) / 12
                              : parseInt(ageValue);
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
                      value={formData.date_of_birth}
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
                            const years =
                              ageUnit === "months"
                                ? parseInt(e.target.value) / 12
                                : parseInt(e.target.value);
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
                            const years =
                              newUnit === "months"
                                ? parseInt(ageValue) / 12
                                : parseInt(ageValue);
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

          {/* Diagnosis */}
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
                value={formData.diagnosis}
                onChange={(e) => updateField("diagnosis", e.target.value)}
                onFocus={() => setShowDiagnosisDropdown(true)}
                onBlur={() =>
                  setTimeout(() => setShowDiagnosisDropdown(false), 150)
                }
                placeholder="e.g., ALL, AML, Neuroblastoma"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500"
              />
              {showDiagnosisDropdown &&
                (() => {
                  const trimmed = formData.diagnosis.trim();
                  const filtered = diagnosisSuggestions
                    .filter((d) =>
                      d.toLowerCase().includes(trimmed.toLowerCase()),
                    )
                    .slice(0, 6);
                  const exactMatch =
                    trimmed.length > 0 &&
                    diagnosisSuggestions.some(
                      (d) => d.toLowerCase() === trimmed.toLowerCase(),
                    );
                  return (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto">
                      {filtered.map((diag) => (
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
                      {trimmed.length > 1 && !exactMatch && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = addDiagnosis(trimmed);
                            setDiagnosisSuggestions(updated);
                            setShowDiagnosisDropdown(false);
                          }}
                          className="w-full text-left px-2 py-1.5 text-sm text-green-700 bg-green-50 hover:bg-green-100 border-t border-gray-100 flex items-center gap-1.5"
                        >
                          <svg
                            className="w-3.5 h-3.5"
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
                          Add &quot;{trimmed}&quot; to suggestions
                        </button>
                      )}
                    </div>
                  );
                })()}
            </div>
          )}

          {/* Physician */}
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
                value={formData.attending_physician}
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
                      .includes(formData.attending_physician.toLowerCase()),
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

          {/* Team */}
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

        {/* Footer */}
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
            Create Report
          </button>
        </div>
      </div>
    </div>
  );
}
