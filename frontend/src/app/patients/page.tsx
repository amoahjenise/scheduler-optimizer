"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchPatientsAPI,
  createPatientAPI,
  updatePatientAPI,
  deletePatientAPI,
  Patient,
  PatientCreate,
} from "../lib/api";
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  X,
  User,
  Check,
  AlertCircle,
  Bed,
  Calendar,
  FileText,
  Settings,
} from "lucide-react";
import PatientFieldSettings from "../handover/components/PatientFieldSettings";
import {
  loadPatientConfig,
  PatientFieldConfig,
  FieldConfig,
} from "../lib/patientConfig";
import { useOrganization } from "../context/OrganizationContext";
import { FEATURES } from "../lib/featureFlags";

export default function PatientsPage() {
  const router = useRouter();

  // Redirect when patient management is disabled
  if (!FEATURES.PATIENT_MANAGEMENT) {
    router.replace("/handover");
    return null;
  }

  const { getAuthHeaders } = useOrganization();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [patientConfig, setPatientConfig] = useState<PatientFieldConfig>(() =>
    loadPatientConfig(),
  );

  // Age input mode toggle (like AddPatientModal)
  const [ageInputMode, setAgeInputMode] = useState<"dob" | "age">("dob");
  const [ageValue, setAgeValue] = useState("");
  const [ageUnit, setAgeUnit] = useState<"months" | "years">("years");

  // Listen for config changes
  useEffect(() => {
    const handleConfigChange = () => {
      setPatientConfig(loadPatientConfig());
    };
    window.addEventListener("patientConfigChanged", handleConfigChange);
    return () =>
      window.removeEventListener("patientConfigChanged", handleConfigChange);
  }, []);

  // Form state
  const [formData, setFormData] = useState<Partial<PatientCreate>>({
    first_name: "",
    last_name: "",
    mrn: "",
    room_number: "",
    bed: "",
    diagnosis: "",
    date_of_birth: "",
    age: "",
    attending_physician: "",
    admission_date: "",
    is_active: true,
  });

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchPatientsAPI({
        active_only: !showInactive,
        search: searchQuery || undefined,
      });
      setPatients(result.patients || []);
      setError(null);
    } catch (err) {
      console.error("Failed to load patients:", err);
      setError("Failed to load patients");
    } finally {
      setLoading(false);
    }
  }, [showInactive, searchQuery]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const handleCreatePatient = async () => {
    if (!formData.first_name || !formData.last_name || !formData.room_number) {
      setError("First name, last name, and room number are required");
      return;
    }

    setSaving(true);
    try {
      await createPatientAPI(formData as PatientCreate);
      setIsCreating(false);
      resetForm();
      loadPatients();
    } catch (err) {
      console.error("Failed to create patient:", err);
      setError("Failed to create patient");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePatient = async () => {
    if (!editingPatient) return;

    setSaving(true);
    try {
      await updatePatientAPI(editingPatient.id, formData);
      setEditingPatient(null);
      setShowModal(false);
      resetForm();
      loadPatients();
    } catch (err) {
      console.error("Failed to update patient:", err);
      setError("Failed to update patient");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePatient = async (id: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      await deletePatientAPI(id, authHeaders);
      setDeleteConfirm(null);
      loadPatients();
    } catch (err) {
      console.error("Failed to delete patient:", err);
      setError("Failed to delete patient");
    }
  };

  const handleToggleActive = async (patient: Patient) => {
    try {
      await updatePatientAPI(patient.id, {
        is_active: !patient.is_active,
      } as any);
      loadPatients();
    } catch (err) {
      console.error("Failed to toggle patient status:", err);
      setError("Failed to update patient status");
    }
  };

  const startEditing = (patient: Patient) => {
    setEditingPatient(patient);
    // Format dates to YYYY-MM-DD for date inputs (strip time portion if present)
    const formatDateForInput = (dateStr: string | undefined) => {
      if (!dateStr) return "";
      return dateStr.split("T")[0];
    };
    setFormData({
      first_name: patient.first_name,
      last_name: patient.last_name,
      mrn: patient.mrn || "",
      room_number: patient.room_number,
      bed: patient.bed || "",
      diagnosis: patient.diagnosis || "",
      date_of_birth: formatDateForInput(patient.date_of_birth),
      age: patient.age || "",
      attending_physician: patient.attending_physician || "",
      admission_date: formatDateForInput(patient.admission_date),
      is_active: patient.is_active,
    });
    // Set age input mode based on existing data
    if (patient.age) {
      setAgeInputMode("age");
      // Parse age value and unit
      const ageStr = patient.age.toLowerCase();
      if (ageStr.includes("month")) {
        setAgeUnit("months");
        setAgeValue(ageStr.replace(/[^0-9]/g, ""));
      } else {
        setAgeUnit("years");
        setAgeValue(ageStr.replace(/[^0-9]/g, ""));
      }
    } else if (patient.date_of_birth) {
      setAgeInputMode("dob");
      setAgeValue("");
    } else {
      setAgeInputMode("dob");
      setAgeValue("");
    }
    setIsCreating(false);
    setShowModal(true);
  };

  const startCreating = () => {
    setIsCreating(true);
    setEditingPatient(null);
    resetForm();
    setAgeInputMode("dob");
    setAgeValue("");
    setAgeUnit("years");
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({
      first_name: "",
      last_name: "",
      mrn: "",
      room_number: "",
      bed: "",
      diagnosis: "",
      date_of_birth: "",
      age: "",
      attending_physician: "",
      admission_date: "",
      is_active: true,
    });
    setAgeInputMode("dob");
    setAgeValue("");
    setAgeUnit("years");
    setError(null);
  };

  const cancelEditing = () => {
    setEditingPatient(null);
    setIsCreating(false);
    setShowModal(false);
    resetForm();
  };

  // Helper to check if a field should be shown based on config
  const shouldShowField = (fieldKey: keyof PatientFieldConfig): boolean => {
    if (fieldKey === "reportMode") return false;
    const field = patientConfig[fieldKey] as FieldConfig | undefined;
    return field?.show !== false; // Default to true if not configured
  };

  // Helper to get field label
  const getFieldLabel = (
    fieldKey: keyof PatientFieldConfig,
    defaultLabel: string,
  ): string => {
    if (fieldKey === "reportMode") return defaultLabel;
    const field = patientConfig[fieldKey] as FieldConfig | undefined;
    return field?.label || defaultLabel;
  };

  // Helper to check if a field is required
  const isFieldRequired = (fieldKey: keyof PatientFieldConfig): boolean => {
    if (fieldKey === "reportMode") return false;
    const field = patientConfig[fieldKey] as FieldConfig | undefined;
    return field?.required === true;
  };

  const filteredPatients = patients.filter((p) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      p.first_name.toLowerCase().includes(query) ||
      p.last_name.toLowerCase().includes(query) ||
      p.room_number?.toLowerCase().includes(query) ||
      p.mrn?.toLowerCase().includes(query) ||
      p.diagnosis?.toLowerCase().includes(query)
    );
  });

  // Group patients by room number
  const patientsByRoom = filteredPatients.reduce(
    (acc, patient) => {
      const roomKey = patient.room_number || "Unassigned";
      if (!acc[roomKey]) {
        acc[roomKey] = [];
      }
      acc[roomKey].push(patient);
      return acc;
    },
    {} as Record<string, Patient[]>,
  );

  // Sort rooms numerically/alphabetically
  const sortedRoomKeys = Object.keys(patientsByRoom).sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  return (
    <div className="page-frame">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="page-container py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/dashboard"
                className="text-sm text-blue-600 hover:underline mb-1 inline-block"
              >
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-semibold text-gray-900">
                Patient Management
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Manage patient census, profile details, and status
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFieldSettings(true)}
                className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 text-sm font-medium rounded-lg transition-colors"
                title="Field Settings"
              >
                <Settings className="w-4 h-4" />
                Field Settings
              </button>
              <button
                onClick={startCreating}
                className="flex items-center gap-2 px-4 py-2 bg-[#1A5CFF] hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Patient
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-container py-6">
        {/* Search and Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, room, MRN, or diagnosis..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-gray-300 text-[#1A5CFF] focus:ring-blue-500"
              />
              Show inactive patients
            </label>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="text-sm text-red-700">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 hover:bg-red-100 rounded"
            >
              <X className="w-4 h-4 text-red-600" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Patient List - always full width, form is now a modal */}
          <div className="col-span-12">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">
                  {filteredPatients.length} patient
                  {filteredPatients.length !== 1 ? "s" : ""}
                </span>
              </div>

              {loading ? (
                <div className="p-12 text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm text-gray-500">Loading patients...</p>
                </div>
              ) : filteredPatients.length === 0 ? (
                <div className="p-12 text-center">
                  <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No patients found</p>
                  <p className="text-sm text-gray-400 mt-1">
                    {searchQuery
                      ? "Try a different search term"
                      : "Add your first patient to get started"}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {sortedRoomKeys.map((roomNumber) => {
                    const roomPatients = patientsByRoom[roomNumber];
                    return (
                      <div key={roomNumber} className="bg-white">
                        {/* Room Header */}
                        <div className="bg-gradient-to-r from-blue-50 to-gray-50 px-4 py-3 border-b border-blue-100">
                          <div className="flex items-center gap-2">
                            <Bed className="w-4 h-4 text-blue-600" />
                            <h3 className="text-sm font-bold text-gray-900">
                              {roomNumber === "Unassigned"
                                ? "Unassigned Room"
                                : `Room ${roomNumber}`}
                            </h3>
                            <span className="ml-2 text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">
                              {roomPatients.length} patient
                              {roomPatients.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>

                        {/* Patients in this room */}
                        <div className="divide-y divide-gray-100">
                          {roomPatients.map((patient) => (
                            <div
                              key={patient.id}
                              className={`p-4 hover:bg-gray-50 transition-colors ${
                                editingPatient?.id === patient.id
                                  ? "bg-blue-50"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-full bg-[#1A5CFF]/10 flex items-center justify-center flex-shrink-0">
                                  <User className="w-5 h-5 text-[#1A5CFF]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-semibold text-gray-900">
                                      {patient.last_name}, {patient.first_name}
                                    </h3>
                                    <span
                                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                        patient.is_active
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-gray-100 text-gray-600"
                                      }`}
                                    >
                                      {patient.is_active
                                        ? "Active"
                                        : "Inactive"}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                    {patient.room_number && (
                                      <span className="flex items-center gap-1">
                                        <Bed className="w-3.5 h-3.5" />
                                        Room {patient.room_number}
                                        {patient.bed && ` / ${patient.bed}`}
                                      </span>
                                    )}
                                    {patient.mrn && (
                                      <span className="flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" />
                                        MRN: {patient.mrn}
                                      </span>
                                    )}
                                    {(patient.age || patient.date_of_birth) && (
                                      <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {patient.age || patient.date_of_birth}
                                      </span>
                                    )}
                                  </div>
                                  {patient.diagnosis && (
                                    <p className="text-sm text-gray-600 mt-1 truncate">
                                      {patient.diagnosis}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button
                                    onClick={() => startEditing(patient)}
                                    className="p-2 text-gray-400 hover:text-[#1A5CFF] hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Edit patient"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleToggleActive(patient)}
                                    className={`p-2 rounded-lg transition-colors ${
                                      patient.is_active
                                        ? "text-gray-400 hover:text-orange-600 hover:bg-orange-50"
                                        : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
                                    }`}
                                    title={
                                      patient.is_active
                                        ? "Deactivate patient (remove from active list)"
                                        : "Activate patient"
                                    }
                                    aria-label={
                                      patient.is_active
                                        ? "Deactivate patient"
                                        : "Activate patient"
                                    }
                                  >
                                    {patient.is_active ? (
                                      <X className="w-4 h-4" />
                                    ) : (
                                      <Check className="w-4 h-4" />
                                    )}
                                  </button>
                                  {deleteConfirm === patient.id ? (
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs text-gray-700 max-w-xs">
                                        Permanently delete this patient and all
                                        associated handovers? This action cannot
                                        be undone.
                                      </div>
                                      <button
                                        onClick={() =>
                                          handleDeletePatient(patient.id)
                                        }
                                        className="px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                                        title="Permanently delete patient"
                                      >
                                        Delete permanently
                                      </button>
                                      <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        setDeleteConfirm(patient.id)
                                      }
                                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Delete patient (permanent)"
                                      aria-label="Delete patient permanently"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit/Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={cancelEditing}
          />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5" />
                <span className="font-semibold text-base">
                  {isCreating ? "Add New Patient" : "Edit Patient"}
                </span>
              </div>
              <button
                onClick={cancelEditing}
                className="p-1.5 hover:bg-blue-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Name - Always shown */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={formData.first_name || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        first_name: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={formData.last_name || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        last_name: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Doe"
                  />
                </div>
              </div>

              {/* Room - Always shown */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Room Number *
                  </label>
                  <input
                    type="text"
                    value={formData.room_number || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        room_number: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="101"
                  />
                </div>
                {/* Bed - Configurable */}
                {shouldShowField("bed") && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {getFieldLabel("bed", "Bed")}
                      {isFieldRequired("bed") && " *"}
                    </label>
                    <input
                      type="text"
                      value={formData.bed || ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          bed: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="A"
                    />
                  </div>
                )}
              </div>

              {/* MRN - Configurable */}
              {shouldShowField("mrn") && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {getFieldLabel("mrn", "MRN")}
                    {isFieldRequired("mrn") && " *"}
                  </label>
                  <input
                    type="text"
                    value={formData.mrn || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        mrn: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="MRN123456"
                  />
                </div>
              )}

              {/* Age / DOB - Configurable with Toggle */}
              {shouldShowField("date_of_birth") && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {ageInputMode === "dob" ? "Date of Birth" : "Age"}
                      {isFieldRequired("date_of_birth") && " *"}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const newMode = ageInputMode === "dob" ? "age" : "dob";
                        setAgeInputMode(newMode);
                        // Convert existing data when switching modes
                        if (newMode === "age" && formData.date_of_birth) {
                          // Calculate age from DOB
                          const dob = new Date(formData.date_of_birth);
                          const today = new Date();
                          const ageInYears = Math.floor(
                            (today.getTime() - dob.getTime()) /
                              (365.25 * 24 * 60 * 60 * 1000),
                          );
                          if (ageInYears < 2) {
                            const ageInMonths = Math.floor(
                              (today.getTime() - dob.getTime()) /
                                (30.44 * 24 * 60 * 60 * 1000),
                            );
                            setAgeValue(String(ageInMonths));
                            setAgeUnit("months");
                          } else {
                            setAgeValue(String(ageInYears));
                            setAgeUnit("years");
                          }
                        } else if (newMode === "dob" && ageValue) {
                          // Calculate DOB from age
                          const today = new Date();
                          let years =
                            ageUnit === "months"
                              ? parseInt(ageValue) / 12
                              : parseInt(ageValue);
                          const dob = new Date(
                            today.getFullYear() - years,
                            today.getMonth(),
                            today.getDate(),
                          );
                          setFormData((prev) => ({
                            ...prev,
                            date_of_birth: dob.toISOString().split("T")[0],
                          }));
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
                        setFormData((prev) => ({
                          ...prev,
                          date_of_birth: e.target.value,
                          age: "", // Clear age when DOB is set
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        value={ageValue}
                        onChange={(e) => {
                          setAgeValue(e.target.value);
                          if (e.target.value) {
                            const ageStr = `${e.target.value} ${ageUnit}`;
                            setFormData((prev) => ({
                              ...prev,
                              age: ageStr,
                              date_of_birth: "", // Clear DOB when age is set
                            }));
                          }
                        }}
                        placeholder="e.g., 2"
                        className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <select
                        value={ageUnit}
                        onChange={(e) => {
                          const newUnit = e.target.value as "months" | "years";
                          setAgeUnit(newUnit);
                          if (ageValue) {
                            const ageStr = `${ageValue} ${newUnit}`;
                            setFormData((prev) => ({
                              ...prev,
                              age: ageStr,
                            }));
                          }
                        }}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="months">months</option>
                        <option value="years">years</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Diagnosis - Configurable */}
              {shouldShowField("diagnosis") && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {getFieldLabel("diagnosis", "Diagnosis")}
                    {isFieldRequired("diagnosis") && " *"}
                  </label>
                  <textarea
                    value={formData.diagnosis || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        diagnosis: e.target.value,
                      }))
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Enter diagnosis..."
                  />
                </div>
              )}

              {/* Attending Physician - Configurable */}
              {shouldShowField("attending_physician") && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {getFieldLabel(
                      "attending_physician",
                      "Attending Physician",
                    )}
                    {isFieldRequired("attending_physician") && " *"}
                  </label>
                  <input
                    type="text"
                    value={formData.attending_physician || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        attending_physician: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Dr. Smith"
                  />
                </div>
              )}

              {/* Admission Date - Configurable */}
              {shouldShowField("admission_date") && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {getFieldLabel("admission_date", "Admission Date")}
                    {isFieldRequired("admission_date") && " *"}
                  </label>
                  <input
                    type="date"
                    value={formData.admission_date || ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        admission_date: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Patient Status - Only show when editing */}
              {!isCreating && (
                <div className="pt-2 border-t border-gray-200">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          is_active: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        Active Patient
                      </span>
                      <p className="text-xs text-gray-500">
                        Uncheck to mark this patient as inactive/discharged
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={cancelEditing}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={isCreating ? handleCreatePatient : handleUpdatePatient}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {isCreating ? "Create Patient" : "Save Changes"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field Settings Modal */}
      {showFieldSettings && (
        <PatientFieldSettings
          config={patientConfig}
          onSave={(newConfig) => setPatientConfig(newConfig)}
          onClose={() => setShowFieldSettings(false)}
        />
      )}
    </div>
  );
}
