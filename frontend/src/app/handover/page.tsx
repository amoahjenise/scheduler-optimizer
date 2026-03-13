"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import {
  Patient,
  Handover,
  ShiftType,
  fetchPatientsAPI,
  fetchTodaysHandoversAPI,
  createHandoverAPI,
  deletePatientAPI,
  fetchLatestHandoverForPatientAPI,
} from "../lib/api";
import HandoverForm from "./components/HandoverForm";
import AddPatientModal from "./components/AddPatientModal";
import UploadHandoverDoc from "./components/UploadHandoverDoc";
import PatientFieldSettings from "./components/PatientFieldSettings";
import {
  loadPatientConfig,
  savePatientConfig,
  PatientFieldConfig,
} from "../lib/patientConfig";
import { printHandover } from "./utils/printTemplate";
import { useOrganization } from "../context/OrganizationContext";

type ViewMode = "list" | "patient";

// Helper function to check if a date is from a past day
function isPastDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const handoverDate = new Date(dateStr);
  const today = new Date();
  // Compare dates (ignoring time)
  handoverDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return handoverDate < today;
}

// Format date for display
function formatShiftDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function mergePatientWithHandoverPatient(
  patient: Patient,
  handover: Handover | null | undefined,
): Patient {
  const handoverPatient = handover?.patient;
  if (!handoverPatient) {
    return patient;
  }

  return {
    ...patient,
    first_name: handoverPatient.first_name || patient.first_name,
    last_name: handoverPatient.last_name || patient.last_name,
    room_number: handoverPatient.room_number || patient.room_number,
    bed: handoverPatient.bed ?? patient.bed,
    mrn: handoverPatient.mrn ?? patient.mrn,
    diagnosis: handoverPatient.diagnosis ?? patient.diagnosis,
  };
}

export default function HandoverPage() {
  const { user } = useUser();
  const { getAuthHeaders } = useOrganization();
  const router = useRouter();
  const [urlParams, setUrlParams] = useState<URLSearchParams | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftType, setShiftType] = useState<ShiftType>("day");
  const hasHandledUrlParams = useRef(false);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedHandover, setSelectedHandover] = useState<Handover | null>(
    null,
  );

  // Modal state
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [patientConfig, setPatientConfig] = useState<PatientFieldConfig>(() =>
    loadPatientConfig(),
  );
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncParams = () =>
      setUrlParams(new URLSearchParams(window.location.search));
    syncParams();
    window.addEventListener("popstate", syncParams);

    return () => window.removeEventListener("popstate", syncParams);
  }, []);

  // Auto-detect shift based on time (only if not set by URL)
  useEffect(() => {
    const urlShift = urlParams?.get("shift");
    if (urlShift === "day" || urlShift === "night") {
      setShiftType(urlShift);
    } else {
      const hour = new Date().getHours();
      setShiftType(hour >= 7 && hour < 19 ? "day" : "night");
    }
  }, [urlParams]);

  // Fetch data - load handovers for BOTH shifts so we can switch
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [patientsRes, dayHandovers, nightHandovers] = await Promise.all([
        fetchPatientsAPI({ active_only: true }),
        fetchTodaysHandoversAPI("day"),
        fetchTodaysHandoversAPI("night"),
      ]);
      setPatients(patientsRes.patients);
      // Combine both shift handovers
      setHandovers([...dayHandovers.handovers, ...nightHandovers.handovers]);
      return {
        patients: patientsRes.patients,
        handovers: [...dayHandovers.handovers, ...nightHandovers.handovers],
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Get existing handover for a patient.
  // Important: opening a patient must never create a new handover.
  async function getOrCreateHandover(
    patient: Patient,
  ): Promise<Handover | null> {
    // Prefer handover for current shift type
    const existing = handovers.find(
      (h) => h.patient_id === patient.id && h.shift_type === shiftType,
    );
    if (existing) return existing;

    // Fallback: if any handover already exists for today for this patient,
    // open that instead of creating a new one (prevents count inflation on view).
    const existingForPatient = handovers
      .filter((h) => h.patient_id === patient.id)
      .sort((a, b) => {
        const aTime = new Date(
          a.updated_at || a.created_at || a.shift_date,
        ).getTime();
        const bTime = new Date(
          b.updated_at || b.created_at || b.shift_date,
        ).getTime();
        return bTime - aTime;
      });

    if (existingForPatient.length > 0) {
      const mostRecent = existingForPatient[0];
      if (mostRecent.shift_type !== shiftType) {
        setShiftType(mostRecent.shift_type);
      }
      return mostRecent;
    }

    // Final fallback: open most recent historical handover in read-only mode.
    // This lets users review yesterday's report without forcing a duplicate.
    try {
      const latestHistorical = await fetchLatestHandoverForPatientAPI(
        patient.id,
      );
      if (latestHistorical) {
        if (latestHistorical.shift_type !== shiftType) {
          setShiftType(latestHistorical.shift_type);
        }
        return latestHistorical;
      }
    } catch (err) {
      console.error("Failed to fetch latest historical handover:", err);
    }

    setError(
      "No hand-off report exists to open. Use Duplicate to today's date (or add a new patient) to create one.",
    );
    return null;
  }

  // Open patient handover form
  async function openPatientHandover(patient: Patient) {
    const handover = await getOrCreateHandover(patient);
    if (handover) {
      setSelectedPatient(mergePatientWithHandoverPatient(patient, handover));
      setSelectedHandover(handover);
      setViewMode("patient");
      // Scroll to top to show the form fully (avoid navbar overlap)
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 50);
    }
  }

  // Handle URL parameters to open a specific patient's handover directly
  useEffect(() => {
    if (hasHandledUrlParams.current || loading || !urlParams) return;

    const patientId = urlParams.get("patient");
    const edit = urlParams.get("edit");

    if (patientId && edit === "true") {
      const patient = patients.find((p) => p.id === patientId);
      if (patient) {
        hasHandledUrlParams.current = true;
        // Open the patient's handover
        openPatientHandover(patient);
      }
    }
  }, [loading, patients, urlParams]);

  // Delete patient
  async function handleDeletePatient(patientId: string) {
    try {
      const authHeaders = await getAuthHeaders();
      await deletePatientAPI(patientId, authHeaders);
      setPatients((prev) => prev.filter((p) => p.id !== patientId));
      setHandovers((prev) => prev.filter((h) => h.patient_id !== patientId));
      setDeleteConfirm(null);
    } catch {
      setError("Failed to delete patient");
    }
  }

  // Handle handover save
  function handleHandoverSave(updated: Handover) {
    setHandovers((prev) =>
      prev.map((h) => (h.id === updated.id ? updated : h)),
    );
    setSelectedHandover(updated);
  }

  // Copy current handover to BOTH day and night shifts for a new day
  async function copyToNewDay() {
    if (!selectedPatient || !selectedHandover) return;

    const currentData = selectedHandover;

    // Helper function to create handover with carryover data
    const createHandoverForShift = async (targetShift: ShiftType) => {
      // Check if already exists
      const existing = handovers.find(
        (h) =>
          h.patient_id === selectedPatient.id && h.shift_type === targetShift,
      );
      if (existing) return existing;

      return await createHandoverAPI({
        patient_id: selectedPatient.id,
        shift_date: new Date().toISOString(),
        shift_type: targetShift,
        outgoing_nurse: currentData.outgoing_nurse || "",
        // Carry over status fields
        status: currentData.status,
        acuity: currentData.acuity,
        isolation: currentData.isolation,
        code_status: currentData.code_status,
        // Pre-fill only static carryover data (NOT labs, VS, GU, fluid readings)
        pertinent_issues: currentData.pertinent_issues,
        admit_date: currentData.admit_date,
        anticipated_discharge: currentData.anticipated_discharge,
        allergies: currentData.allergies,
        medications_summary: currentData.medications_summary,
        prn_medications: currentData.prn_medications,
        chemotherapies: currentData.chemotherapies,
        iv_access: currentData.iv_access,
        cvad_type: currentData.cvad_type,
        cvad_dressing: currentData.cvad_dressing,
        tpn: currentData.tpn,
        tube_type: currentData.tube_type,
        diet: currentData.diet,
        activity: currentData.activity,
        oxygen_needs: currentData.oxygen_needs,
        braden_q_score: currentData.braden_q_score,
        skin_care_plan: currentData.skin_care_plan,
        mobility_restrictions: currentData.mobility_restrictions,
        assistive_devices: currentData.assistive_devices,
        positioning: currentData.positioning,
        expected_discharge_date: currentData.expected_discharge_date,
        discharge_teaching: currentData.discharge_teaching,
        discharge_prescriptions: currentData.discharge_prescriptions,
        home_enteral_feeding: currentData.home_enteral_feeding,
        followup_appointments: currentData.followup_appointments,
        // NOTE: labs, VS/pain, fluid intake, GU readings are NOT copied
      });
    };

    try {
      // Create BOTH day and night handoffs
      const [dayHandover, nightHandover] = await Promise.all([
        createHandoverForShift("day"),
        createHandoverForShift("night"),
      ]);

      // Add new handovers to state (filter out duplicates)
      setHandovers((prev) => {
        const existingIds = new Set(prev.map((h) => h.id));
        const newHandovers = [...prev];
        if (!existingIds.has(dayHandover.id)) newHandovers.push(dayHandover);
        if (!existingIds.has(nightHandover.id))
          newHandovers.push(nightHandover);
        return newHandovers;
      });

      // Switch to day shift by default after copy
      setShiftType("day");
      setSelectedHandover(dayHandover);
    } catch {
      setError("Failed to create new handovers");
    }
  }

  // Filter patients by search query
  const filteredPatients = searchQuery.trim()
    ? patients.filter((p) => {
        const q = searchQuery.toLowerCase();
        return (
          p.first_name.toLowerCase().includes(q) ||
          p.last_name.toLowerCase().includes(q) ||
          p.room_number.toLowerCase().includes(q) ||
          (p.mrn && p.mrn.toLowerCase().includes(q)) ||
          (p.diagnosis && p.diagnosis.toLowerCase().includes(q))
        );
      })
    : patients;

  // Group patients by room
  const patientsByRoom = filteredPatients.reduce(
    (acc, patient) => {
      const room = patient.room_number || "Unassigned";
      if (!acc[room]) acc[room] = [];
      acc[room].push(patient);
      return acc;
    },
    {} as Record<string, Patient[]>,
  );

  const sortedRooms = Object.keys(patientsByRoom).sort((a, b) => {
    const numA = parseInt(a) || 999;
    const numB = parseInt(b) || 999;
    return numA - numB;
  });

  // Count completed patients (at least one completed hand-off for today)
  const completedPatientIds = new Set(
    handovers.filter((h) => h.is_completed).map((h) => h.patient_id),
  );
  const completedCount = patients.filter((p) =>
    completedPatientIds.has(p.id),
  ).length;
  const totalCount = patients.length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-600">Loading patients...</p>
        </div>
      </div>
    );
  }

  // Patient Detail View
  if (viewMode === "patient" && selectedPatient && selectedHandover) {
    // Function to switch to a different shift's document
    const switchShiftDocument = async (newShift: ShiftType) => {
      if (newShift === shiftType) return;

      // Find an existing handover for the new shift (do not create here)
      const existingHandover = handovers.find(
        (h) => h.patient_id === selectedPatient.id && h.shift_type === newShift,
      );

      if (existingHandover) {
        setShiftType(newShift);
        setSelectedHandover(existingHandover);
      } else {
        setError(
          "No hand-off report exists for that shift. Use Duplicate to today's date to create it.",
        );
      }
    };

    // Check if this handover is from a past date
    const isFromPastDate = isPastDate(selectedHandover.shift_date);

    return (
      <div className="min-h-screen bg-gray-50">
        {/* Past Date Warning Banner */}
        {isFromPastDate && (
          <div className="bg-amber-50 border-b border-amber-200 sticky top-16 z-50">
            <div className="page-container py-3">
              <div className="flex items-center gap-3">
                <svg
                  className="w-5 h-5 text-amber-600 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">
                    This hand-off report is from a previous date (
                    {formatShiftDate(selectedHandover.shift_date)})
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Past reports are read-only. To create a new report for
                    today, go back to the patient list and select the patient
                    again.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setViewMode("list");
                    // Trigger loading fresh data
                    loadData();
                  }}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  Start Today&apos;s Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div
          className={`bg-white border-b border-gray-200 sticky ${isFromPastDate ? "top-[calc(4rem+4rem)]" : "top-16"} z-40`}
        >
          <div className="page-container py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setViewMode("list")}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
                >
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
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Back
                </button>
                <div className="h-6 w-px bg-gray-300" />
                <div>
                  <h1 className="text-lg font-semibold text-gray-900">
                    Room {selectedPatient.room_number}
                    {selectedPatient.bed ? `-${selectedPatient.bed}` : ""}:{" "}
                    {selectedPatient.last_name}, {selectedPatient.first_name}
                  </h1>
                  <p className="text-sm text-gray-500">
                    {selectedPatient.diagnosis || "No diagnosis"}
                    {isFromPastDate && (
                      <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                        Read Only
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Daily report - no shift toggle needed */}
            </div>
          </div>
        </div>

        {/* Handover Form */}
        <div className="py-6 px-4">
          <HandoverForm
            key={selectedHandover.id} // Force remount on handover change
            handover={selectedHandover}
            patient={selectedPatient}
            onSave={handleHandoverSave}
            readOnly={isFromPastDate}
            onPatientUpdate={(updated) => {
              setPatients((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p)),
              );
              setSelectedPatient(updated);
            }}
            onShiftChange={(newShift) => {
              switchShiftDocument(newShift);
            }}
            onPreview={(currentHandover, currentPatient) => {
              printHandover(currentHandover, currentPatient);
            }}
          />
        </div>
      </div>
    );
  }

  // List View - Main view showing all patients and handovers
  return (
    <div className="page-frame">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
        <div className="page-container py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Left side */}
            <div className="flex items-center gap-6">
              <div>
                <Link
                  href="/dashboard"
                  className="text-sm text-blue-600 hover:underline mb-1 inline-block"
                >
                  ← Back to Dashboard
                </Link>
                <h1 className="text-xl font-semibold text-gray-900">
                  Hand-off Report
                </h1>
                <p className="text-sm text-gray-500">
                  {new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            {/* Search bar */}
            <div className="flex-1 max-w-xs">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  placeholder="Search patient or room…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {completedCount}/{totalCount} completed
              </span>

              <button
                onClick={() => setShowFieldSettings(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Patient form settings"
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
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setShowAddPatient(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
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
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                Add Patient
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="page-container pt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 text-xl"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Patient List */}
      <div className="page-container py-6">
        {patients.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <svg
              className="w-16 h-16 text-gray-300 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No patients yet
            </h3>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setShowAddPatient(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Add Patient
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedRooms.map((room) => (
              <div
                key={room}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-700">Room {room}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {patientsByRoom[room].map((patient) => {
                    // Find handovers for this patient
                    const dayHandover = handovers.find(
                      (h) =>
                        h.patient_id === patient.id && h.shift_type === "day",
                    );
                    const nightHandover = handovers.find(
                      (h) =>
                        h.patient_id === patient.id && h.shift_type === "night",
                    );
                    const currentHandover =
                      shiftType === "day" ? dayHandover : nightHandover;
                    const displayPatient = mergePatientWithHandoverPatient(
                      patient,
                      currentHandover,
                    );

                    const statusColors: Record<string, string> = {
                      stable: "bg-green-100 text-green-700",
                      improved: "bg-blue-100 text-blue-700",
                      unchanged: "bg-gray-100 text-gray-700",
                      worsening: "bg-orange-100 text-orange-700",
                      critical: "bg-red-100 text-red-700",
                    };

                    return (
                      <div
                        key={patient.id}
                        className="px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          {/* Patient Info - Clickable */}
                          <button
                            onClick={() => openPatientHandover(displayPatient)}
                            className="flex-1 text-left flex items-center gap-4"
                          >
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-semibold text-sm">
                                {displayPatient.bed || room.slice(-1)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3">
                                <span className="font-medium text-gray-900">
                                  {displayPatient.last_name},{" "}
                                  {displayPatient.first_name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  Room {displayPatient.room_number || "N/A"}
                                </span>
                                {displayPatient.mrn && (
                                  <span className="text-xs text-gray-500">
                                    MRN: {displayPatient.mrn}
                                  </span>
                                )}
                                {currentHandover && (
                                  <span
                                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[currentHandover.status] || statusColors.stable}`}
                                  >
                                    {currentHandover.status}
                                  </span>
                                )}
                                {currentHandover?.is_completed && (
                                  <span className="text-green-600">
                                    <svg
                                      className="w-4 h-4"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <p className="text-sm text-gray-500 truncate">
                                  {displayPatient.diagnosis ||
                                    "No diagnosis specified"}
                                </p>
                                {currentHandover?.updated_at && (
                                  <span className="text-xs text-gray-400 shrink-0">
                                    Last updated{" "}
                                    {new Date(
                                      currentHandover.updated_at,
                                    ).toLocaleString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
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
                          </button>

                          {/* Actions */}
                          <div className="flex items-center gap-1 ml-4">
                            {/* Print button */}
                            {currentHandover && (
                              <button
                                onClick={() => {
                                  printHandover(
                                    currentHandover,
                                    displayPatient,
                                  );
                                }}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Print report"
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
                              </button>
                            )}
                            <button
                              onClick={() =>
                                openPatientHandover(displayPatient)
                              }
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Open handover form"
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
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            {/* Create from last report */}
                            <button
                              onClick={async () => {
                                // This creates a new handover for today from yesterday's data
                                const targetShift =
                                  shiftType === "day" ? "night" : "day";

                                // Check if a handover already exists for today for the TARGET shift
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const todayTargetShiftExists = handovers.some(
                                  (h) => {
                                    const hDate = new Date(h.shift_date);
                                    hDate.setHours(0, 0, 0, 0);
                                    return (
                                      h.patient_id === patient.id &&
                                      h.shift_type === targetShift &&
                                      hDate.getTime() === today.getTime()
                                    );
                                  },
                                );

                                if (todayTargetShiftExists) {
                                  alert(
                                    "A handover report already exists for today for that shift.",
                                  );
                                  return;
                                }

                                // Create new using the most recent existing handover as source,
                                // including prior days (for example yesterday's hand-off).
                                let latestForPatient: Handover | null = null;

                                try {
                                  latestForPatient =
                                    await fetchLatestHandoverForPatientAPI(
                                      patient.id,
                                    );
                                } catch (lookupError) {
                                  console.error(
                                    "Failed to fetch latest handover for duplication:",
                                    lookupError,
                                  );
                                }

                                if (!latestForPatient) {
                                  latestForPatient =
                                    handovers
                                      .filter(
                                        (h) => h.patient_id === patient.id,
                                      )
                                      .sort((a, b) => {
                                        const aTime = new Date(
                                          a.updated_at ||
                                            a.created_at ||
                                            a.shift_date,
                                        ).getTime();
                                        const bTime = new Date(
                                          b.updated_at ||
                                            b.created_at ||
                                            b.shift_date,
                                        ).getTime();
                                        return bTime - aTime;
                                      })[0] || null;
                                }

                                if (latestForPatient) {
                                  try {
                                    const newHandover = await createHandoverAPI(
                                      {
                                        patient_id: patient.id,
                                        shift_date: new Date().toISOString(),
                                        shift_type: targetShift,
                                        outgoing_nurse:
                                          latestForPatient.outgoing_nurse || "",
                                        status: latestForPatient.status,
                                        acuity: latestForPatient.acuity,
                                        isolation: latestForPatient.isolation,
                                        code_status:
                                          latestForPatient.code_status,
                                        pertinent_issues:
                                          latestForPatient.pertinent_issues,
                                        admit_date: latestForPatient.admit_date,
                                        anticipated_discharge:
                                          latestForPatient.anticipated_discharge,
                                        allergies: latestForPatient.allergies,
                                        medications_summary:
                                          latestForPatient.medications_summary,
                                        prn_medications:
                                          latestForPatient.prn_medications,
                                        chemotherapies:
                                          latestForPatient.chemotherapies,
                                        iv_access: latestForPatient.iv_access,
                                        cvad_type: latestForPatient.cvad_type,
                                        cvad_dressing:
                                          latestForPatient.cvad_dressing,
                                        tpn: latestForPatient.tpn,
                                        tube_type: latestForPatient.tube_type,
                                        diet: latestForPatient.diet,
                                        activity: latestForPatient.activity,
                                        oxygen_needs:
                                          latestForPatient.oxygen_needs,
                                        braden_q_score:
                                          latestForPatient.braden_q_score,
                                        skin_care_plan:
                                          latestForPatient.skin_care_plan,
                                        mobility_restrictions:
                                          latestForPatient.mobility_restrictions,
                                        assistive_devices:
                                          latestForPatient.assistive_devices,
                                        positioning:
                                          latestForPatient.positioning,
                                        expected_discharge_date:
                                          latestForPatient.expected_discharge_date,
                                        discharge_teaching:
                                          latestForPatient.discharge_teaching,
                                        discharge_prescriptions:
                                          latestForPatient.discharge_prescriptions,
                                        home_enteral_feeding:
                                          latestForPatient.home_enteral_feeding,
                                        followup_appointments:
                                          latestForPatient.followup_appointments,
                                        events_this_shift: "", // Clear daily notes for new day
                                      },
                                    );
                                    setHandovers((prev) => [
                                      ...prev,
                                      newHandover,
                                    ]);
                                    setShiftType(targetShift);
                                    setSelectedPatient(patient);
                                    setSelectedHandover(newHandover);
                                    setViewMode("patient");
                                  } catch {
                                    setError("Failed to create new handover");
                                  }
                                } else {
                                  setError(
                                    "No existing hand-off found to duplicate for this patient.",
                                  );
                                }
                              }}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Duplicate to today (copies medical info, clears daily notes)"
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
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                            </button>

                            {deleteConfirm === patient.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() =>
                                    handleDeletePatient(patient.id)
                                  }
                                  className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(patient.id)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete patient"
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
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddPatient && (
        <AddPatientModal
          onClose={() => setShowAddPatient(false)}
          onPatientAdded={async (patient: Patient) => {
            setPatients((prev) => [...prev, patient]);
            setShowAddPatient(false);

            // Adding a patient is an explicit create action.
            try {
              const newHandover = await createHandoverAPI({
                patient_id: patient.id,
                shift_date: new Date().toISOString(),
                shift_type: shiftType,
                outgoing_nurse: user?.fullName || user?.firstName || "Nurse",
              });
              setHandovers((prev) => [...prev, newHandover]);
            } catch {
              setError(
                "Patient added, but failed to create initial hand-off report.",
              );
            }
          }}
          config={patientConfig}
        />
      )}

      {showFieldSettings && (
        <PatientFieldSettings
          config={patientConfig}
          onSave={(newConfig) => {
            savePatientConfig(newConfig);
            setPatientConfig(newConfig);
            setShowFieldSettings(false);
          }}
          onClose={() => setShowFieldSettings(false)}
        />
      )}

      {showUpload && (
        <UploadHandoverDoc
          onPatientsImported={(newPatients) => {
            setPatients((prev) => [...prev, ...newPatients]);
            setShowUpload(false);
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
