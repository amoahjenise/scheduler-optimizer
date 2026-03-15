"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  deleteHandoverAPI,
  fetchLatestHandoverForPatientAPI,
  fetchHandoverHistoryForPatientAPI,
} from "../lib/api";
import HandoverForm from "./components/HandoverForm";
import NewHandoffReportModal from "./components/NewHandoffReportModal";
import CriticalAlerts from "./components/CriticalAlerts";
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
  if (!handover) return patient;

  // Prefer embedded p_* fields directly from handover, fallback to nested patient, then to patient prop
  const hp = handover.patient;
  return {
    ...patient,
    first_name: handover.p_first_name || hp?.first_name || patient.first_name,
    last_name: handover.p_last_name || hp?.last_name || patient.last_name,
    room_number:
      handover.p_room_number || hp?.room_number || patient.room_number,
    bed: handover.p_bed ?? hp?.bed ?? patient.bed,
    mrn: handover.p_mrn ?? hp?.mrn ?? patient.mrn,
    diagnosis: handover.p_diagnosis ?? hp?.diagnosis ?? patient.diagnosis,
    date_of_birth: handover.p_date_of_birth || patient.date_of_birth,
    age: handover.p_age || patient.age,
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
  const [showNewReport, setShowNewReport] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [patientConfig, setPatientConfig] = useState<PatientFieldConfig>(() =>
    loadPatientConfig(),
  );
  const [searchQuery, setSearchQuery] = useState("");

  // History modal state
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null);
  const [historyHandovers, setHistoryHandovers] = useState<Handover[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
      const authHeaders = await getAuthHeaders();
      const [patientsRes, dayHandovers, nightHandovers] = await Promise.all([
        fetchPatientsAPI({ active_only: true }, authHeaders),
        fetchTodaysHandoversAPI("day", authHeaders),
        fetchTodaysHandoversAPI("night", authHeaders),
      ]);
      setPatients(patientsRes.patients);
      // Combine both shift handovers
      const allHandovers = [
        ...dayHandovers.handovers,
        ...nightHandovers.handovers,
      ];
      // Auto-mark past-date handovers as completed (locally) so they appear
      // as finished in the UI without requiring manual action.
      const marked = allHandovers.map((h) =>
        !h.is_completed && isPastDate(h.shift_date)
          ? { ...h, is_completed: true }
          : h,
      );
      setHandovers(marked);
      return {
        patients: patientsRes.patients,
        handovers: marked,
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
    const existing = findHandoverForPatient(patient, shiftType);
    if (existing) return existing;

    // Fallback: if any handover already exists for today for this patient,
    // open that instead of creating a new one (prevents count inflation on view).
    const existingForPatient = findAllHandoversForPatient(patient).sort(
      (a, b) => {
        const aTime = new Date(
          a.updated_at || a.created_at || a.shift_date,
        ).getTime();
        const bTime = new Date(
          b.updated_at || b.created_at || b.shift_date,
        ).getTime();
        return bTime - aTime;
      },
    );

    if (existingForPatient.length > 0) {
      const mostRecent = existingForPatient[0];
      if (mostRecent.shift_type !== shiftType) {
        setShiftType(mostRecent.shift_type);
      }
      return mostRecent;
    }

    // Final fallback: open most recent historical handover in read-only mode.
    // This lets users review yesterday's report without forcing a duplicate.
    // Only call the API for real patient IDs (not virtual/embedded)
    if (!patient.id.startsWith("embedded-")) {
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

  // Open history modal for a patient
  async function openHandoverHistory(patient: Patient) {
    // Only fetch history for real patients (not virtual/embedded)
    const patientId = patient.id.startsWith("embedded-") ? null : patient.id;

    if (!patientId) {
      // For embedded patients, show only local handovers we have
      const localHistory = findAllHandoversForPatient(patient).sort((a, b) => {
        const aTime = new Date(
          a.updated_at || a.created_at || a.shift_date,
        ).getTime();
        const bTime = new Date(
          b.updated_at || b.created_at || b.shift_date,
        ).getTime();
        return bTime - aTime;
      });
      setHistoryPatient(patient);
      setHistoryHandovers(localHistory);
      return;
    }

    setHistoryPatient(patient);
    setHistoryLoading(true);
    try {
      const result = await fetchHandoverHistoryForPatientAPI(patientId);
      setHistoryHandovers(result.handovers);
    } catch (err) {
      console.error("Failed to fetch handover history:", err);
      // Fallback to local handovers
      const localHistory = findAllHandoversForPatient(patient).sort((a, b) => {
        const aTime = new Date(
          a.updated_at || a.created_at || a.shift_date,
        ).getTime();
        const bTime = new Date(
          b.updated_at || b.created_at || b.shift_date,
        ).getTime();
        return bTime - aTime;
      });
      setHistoryHandovers(localHistory);
    } finally {
      setHistoryLoading(false);
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

    // Open "New Hand-Off Report" modal when ?new=true is in URL
    const newParam = urlParams.get("new");
    if (newParam === "true") {
      hasHandledUrlParams.current = true;
      setShowNewReport(true);
      // Clean URL without reloading
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loading, patients, urlParams]);

  // Delete patient and ALL associated handovers
  async function handleDeletePatient(patientId: string) {
    try {
      const authHeaders = await getAuthHeaders();

      // Find all handovers belonging to this patient (linked or embedded)
      const patient = allDisplayPatients.find((p) => p.id === patientId);
      const relatedHandovers = patient
        ? handovers.filter((h) => matchesPatient(h, patient))
        : patientId.startsWith("embedded-")
          ? handovers.filter(
              (h) =>
                `embedded-${h.id}` === patientId || h.patient_id === patientId,
            )
          : handovers.filter((h) => h.patient_id === patientId);

      // Delete each handover from the DB — track failures
      let deleteFailed = false;
      for (const h of relatedHandovers) {
        try {
          await deleteHandoverAPI(h.id, authHeaders);
        } catch (e) {
          console.error(`Failed to delete handover ${h.id}:`, e);
          deleteFailed = true;
        }
      }

      // Delete the patient record itself (only for real patients)
      if (!patientId.startsWith("embedded-")) {
        try {
          await deletePatientAPI(patientId, authHeaders);
        } catch (e) {
          // Patient not found is OK (may have been deleted already or be orphaned)
          const errMsg = e instanceof Error ? e.message : String(e);
          if (!errMsg.includes("not found")) {
            console.error(`Failed to delete patient ${patientId}:`, e);
            deleteFailed = true;
          }
        }
      }

      // Always refetch from server to get the authoritative state
      await loadData();
      setDeleteConfirm(null);

      if (deleteFailed) {
        setError("Some records could not be deleted. Please try again.");
      }
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Helper to check if a handover is from today
    const isFromToday = (h: Handover): boolean => {
      if (!h.shift_date) return false;
      const hDate = new Date(h.shift_date);
      hDate.setHours(0, 0, 0, 0);
      return hDate.getTime() === todayStart.getTime();
    };

    // Helper function to create handover with carryover data
    const createHandoverForShift = async (targetShift: ShiftType) => {
      // Check if TODAY's handover already exists for this shift
      const existing = handovers.find(
        (h) =>
          matchesPatient(h, selectedPatient) &&
          h.shift_type === targetShift &&
          isFromToday(h),
      );
      if (existing) return existing;

      return await createHandoverAPI({
        // Only pass a real patient_id (not virtual/embedded IDs)
        patient_id: selectedPatient.id.startsWith("embedded-")
          ? undefined
          : selectedPatient.id,
        // Embed patient info directly on the handover
        p_first_name:
          currentData.p_first_name || selectedPatient.first_name || "",
        p_last_name: currentData.p_last_name || selectedPatient.last_name || "",
        p_room_number:
          currentData.p_room_number || selectedPatient.room_number || "",
        p_bed: currentData.p_bed || selectedPatient.bed || "",
        p_mrn: currentData.p_mrn || selectedPatient.mrn || "",
        p_diagnosis: currentData.p_diagnosis || selectedPatient.diagnosis || "",
        p_date_of_birth:
          currentData.p_date_of_birth ||
          selectedPatient.date_of_birth ||
          undefined,
        p_age: currentData.p_age || selectedPatient.age || "",
        p_attending_physician: currentData.p_attending_physician || "",
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
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create new handovers",
      );
    }
  }

  // --- Helpers to match handovers for both linked (patient_id) and embedded patients ---
  const matchesPatient = useCallback(
    (h: Handover, patient: Patient): boolean => {
      // Direct patient_id link
      if (h.patient_id && h.patient_id === patient.id) return true;
      // Embedded match: name + room (normalized)
      const norm = (s: string | null | undefined) =>
        (s || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (
        !h.patient_id &&
        (h.p_room_number || "").trim() === (patient.room_number || "").trim() &&
        norm(h.p_first_name) === norm(patient.first_name) &&
        norm(h.p_last_name) === norm(patient.last_name)
      )
        return true;
      // Virtual-patient id match (embedded-{handoverId})
      if (
        patient.id.startsWith("embedded-") &&
        patient.id === `embedded-${h.id}`
      )
        return true;
      // For virtual patients, also match embedded handovers with same name + room
      // (catches day/night pair for the same virtual patient)
      if (
        patient.id.startsWith("embedded-") &&
        !h.patient_id &&
        (h.p_room_number || "").trim() &&
        (h.p_room_number || "").trim() === (patient.room_number || "").trim() &&
        norm(h.p_first_name) === norm(patient.first_name) &&
        norm(h.p_last_name) === norm(patient.last_name)
      )
        return true;
      return false;
    },
    [],
  );

  const findHandoverForPatient = useCallback(
    (patient: Patient, shift: ShiftType): Handover | undefined =>
      handovers.find(
        (h) => matchesPatient(h, patient) && h.shift_type === shift,
      ),
    [handovers, matchesPatient],
  );

  const findAllHandoversForPatient = useCallback(
    (patient: Patient): Handover[] =>
      handovers.filter((h) => matchesPatient(h, patient)),
    [handovers, matchesPatient],
  );

  // Merge real patients with "virtual" patients synthesized from orphan handovers
  // (embedded handovers whose patient_id is null or doesn't match any loaded patient)
  const allDisplayPatients = useMemo(() => {
    const patientIdSet = new Set(patients.map((p) => p.id));

    // Normalize helper: lowercase, trim, collapse whitespace
    const norm = (s: string | null | undefined) =>
      (s || "").trim().toLowerCase().replace(/\s+/g, " ");

    const patientKeys = new Set(
      patients.map(
        (p) =>
          `${norm(p.first_name)}|${norm(p.last_name)}|${(p.room_number || "").trim()}`,
      ),
    );

    // Also build a set of just room numbers for fuzzy matching—same room =
    // same physical patient even if OCR captured a slightly different name.
    const patientRoomSet = new Set(
      patients
        .map((p) => (p.room_number || "").trim())
        .filter((r) => r && r !== "Unassigned"),
    );

    const orphanHandovers = handovers.filter((h) => {
      // Already linked to a real patient → not an orphan
      if (h.patient_id && patientIdSet.has(h.patient_id)) return false;
      // Exact name+room match → not an orphan
      const key = `${norm(h.p_first_name)}|${norm(h.p_last_name)}|${(h.p_room_number || "").trim()}`;
      if (patientKeys.has(key)) return false;
      // Room-only match: if the room already belongs to a known patient,
      // treat this handover as belonging to that patient (OCR name variance)
      const room = (h.p_room_number || "").trim();
      if (room && room !== "Unassigned" && patientRoomSet.has(room))
        return false;
      return true;
    });

    // Deduplicate by embedded identity (same patient may have day+night handovers)
    // Keep the most recently updated handover per patient identity
    const virtualMap = new Map<string, Handover>();
    // Sort newest first so the first entry per key is the most recent
    const sortedOrphans = [...orphanHandovers].sort((a, b) => {
      const aTime = new Date(
        a.updated_at || a.created_at || a.shift_date,
      ).getTime();
      const bTime = new Date(
        b.updated_at || b.created_at || b.shift_date,
      ).getTime();
      return bTime - aTime;
    });
    for (const h of sortedOrphans) {
      // Use room as primary key - same room means same patient
      const room = (h.p_room_number || "").trim();
      const key = room
        ? `${norm(h.p_first_name)}|${norm(h.p_last_name)}|${room}`
        : `${norm(h.p_first_name)}|${norm(h.p_last_name)}|${h.id}`;
      if (!virtualMap.has(key)) virtualMap.set(key, h);
    }

    const virtualPatients: Patient[] = Array.from(virtualMap.values()).map(
      (h) => ({
        id: `embedded-${h.id}`,
        first_name: h.p_first_name || "",
        last_name: h.p_last_name || "",
        room_number: h.p_room_number || "Unassigned",
        bed: h.p_bed || "",
        mrn: h.p_mrn || "",
        diagnosis: h.p_diagnosis || "",
        is_active: true,
        created_at: h.created_at,
        updated_at: h.updated_at,
      }),
    );

    // Final dedup: collapse entries with the same normalized name + room.
    // Keep the entry with the most recent handover.  This prevents seeing
    // multiple cards for the same physical patient when there are several
    // DB records (real patient + virtual, or slight OCR name variations).
    const combined = [...patients, ...virtualPatients];
    const dedupMap = new Map<string, Patient>();
    for (const p of combined) {
      const key = `${norm(p.first_name)}|${norm(p.last_name)}|${(p.room_number || "").trim()}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, p);
      } else {
        // Prefer real patient over virtual
        const existingIsVirtual = existing.id.startsWith("embedded-");
        const currentIsVirtual = p.id.startsWith("embedded-");
        if (existingIsVirtual && !currentIsVirtual) {
          dedupMap.set(key, p);
        } else if (!existingIsVirtual && currentIsVirtual) {
          // keep existing real patient
        } else {
          // Both same type — keep the one with the more recent handover
          const existingTime = new Date(
            existing.updated_at || existing.created_at || "1970-01-01",
          ).getTime();
          const currentTime = new Date(
            p.updated_at || p.created_at || "1970-01-01",
          ).getTime();
          if (currentTime > existingTime) {
            dedupMap.set(key, p);
          }
        }
      }
    }

    return Array.from(dedupMap.values());
  }, [patients, handovers]);

  // Filter patients by search query
  const filteredPatients = searchQuery.trim()
    ? allDisplayPatients.filter((p) => {
        const q = searchQuery.toLowerCase();
        return (
          p.first_name.toLowerCase().includes(q) ||
          p.last_name.toLowerCase().includes(q) ||
          p.room_number.toLowerCase().includes(q) ||
          (p.mrn && p.mrn.toLowerCase().includes(q)) ||
          (p.diagnosis && p.diagnosis.toLowerCase().includes(q))
        );
      })
    : allDisplayPatients;

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

  // Count completed hand-offs
  // In daily mode, count all handovers; in shift mode, count only current shift
  const countableHandovers =
    patientConfig.reportMode === "daily"
      ? handovers
      : handovers.filter((h) => h.shift_type === shiftType);
  const completedCount = countableHandovers.filter(
    (h) => h.is_completed,
  ).length;
  const totalCount = countableHandovers.length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-600">Loading hand-off reports...</p>
        </div>
      </div>
    );
  }

  // Patient Detail View
  if (viewMode === "patient" && selectedPatient && selectedHandover) {
    // Find previous shift handover for lab trend comparison
    const oppositeShift =
      selectedHandover.shift_type === "day" ? "night" : "day";
    const previousHandover =
      handovers.find(
        (h) =>
          h.patient_id === selectedHandover.patient_id &&
          h.shift_type === oppositeShift &&
          h.id !== selectedHandover.id,
      ) ?? null;

    // Function to switch to a different shift's document
    const switchShiftDocument = async (newShift: ShiftType) => {
      if (newShift === shiftType) return;

      // Find an existing handover for the new shift (do not create here)
      const existingHandover = findHandoverForPatient(
        selectedPatient,
        newShift,
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
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
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

              {/* Start Today's Report — only when viewing a past-date handover */}
              {isFromPastDate && (
                <button
                  onClick={copyToNewDay}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
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
                  Start Today&apos;s Report
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Handover Form */}
        <div className="py-6 px-4" data-phi="true">
          <HandoverForm
            key={selectedHandover.id} // Force remount on handover change
            handover={selectedHandover}
            patient={selectedPatient}
            onSave={handleHandoverSave}
            readOnly={isFromPastDate}
            previousHandover={previousHandover}
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
              <span
                className="text-sm text-gray-500"
                title={
                  patientConfig.reportMode === "daily"
                    ? "All reports"
                    : `${shiftType.charAt(0).toUpperCase() + shiftType.slice(1)} shift reports only`
                }
              >
                {completedCount}/{totalCount}{" "}
                {patientConfig.reportMode === "daily"
                  ? "reports"
                  : `${shiftType} reports`}
              </span>

              <button
                onClick={() => setShowFieldSettings(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Hand-off report field settings"
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
                onClick={() => setShowNewReport(true)}
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
                New Hand-Off Report
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
        {allDisplayPatients.length === 0 ? (
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No hand-off reports yet
            </h3>
            <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
              Create your first hand-off report to get started. Patient details
              are captured directly in the report.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setShowNewReport(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                New Hand-Off Report
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
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700">Room {room}</h3>
                  <span className="text-xs text-gray-400">
                    {patientsByRoom[room].length} patient
                    {patientsByRoom[room].length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {patientsByRoom[room].map((patient) => {
                    // Find handovers for this patient (works for both linked and embedded)
                    const dayHandover = findHandoverForPatient(patient, "day");
                    const nightHandover = findHandoverForPatient(
                      patient,
                      "night",
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
                                {/* Critical clinical alerts */}
                                <CriticalAlerts handover={currentHandover} />
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
                            {/* View History button */}
                            <button
                              onClick={() =>
                                openHandoverHistory(displayPatient)
                              }
                              className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="View handover history"
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
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
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
                                const todayTargetShiftExists =
                                  findAllHandoversForPatient(patient).some(
                                    (h) => {
                                      const hDate = new Date(h.shift_date);
                                      hDate.setHours(0, 0, 0, 0);
                                      return (
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

                                if (!patient.id.startsWith("embedded-")) {
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
                                }

                                if (!latestForPatient) {
                                  latestForPatient =
                                    findAllHandoversForPatient(patient).sort(
                                      (a, b) => {
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
                                      },
                                    )[0] || null;
                                }

                                if (latestForPatient) {
                                  try {
                                    const newHandover = await createHandoverAPI(
                                      {
                                        patient_id: patient.id.startsWith(
                                          "embedded-",
                                        )
                                          ? undefined
                                          : patient.id,
                                        // Embed patient info directly
                                        p_first_name:
                                          latestForPatient.p_first_name ||
                                          patient.first_name ||
                                          "",
                                        p_last_name:
                                          latestForPatient.p_last_name ||
                                          patient.last_name ||
                                          "",
                                        p_room_number:
                                          latestForPatient.p_room_number ||
                                          patient.room_number ||
                                          "",
                                        p_bed:
                                          latestForPatient.p_bed ||
                                          patient.bed ||
                                          "",
                                        p_mrn:
                                          latestForPatient.p_mrn ||
                                          patient.mrn ||
                                          "",
                                        p_diagnosis:
                                          latestForPatient.p_diagnosis ||
                                          patient.diagnosis ||
                                          "",
                                        p_date_of_birth:
                                          latestForPatient.p_date_of_birth ||
                                          patient.date_of_birth ||
                                          undefined,
                                        p_age:
                                          latestForPatient.p_age ||
                                          patient.age ||
                                          "",
                                        p_attending_physician:
                                          latestForPatient.p_attending_physician ||
                                          "",
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
                                  } catch (err) {
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : "Failed to create new handover",
                                    );
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
      {showNewReport && (
        <NewHandoffReportModal
          onClose={() => setShowNewReport(false)}
          onHandoverCreated={(handover: Handover) => {
            setHandovers((prev) => [...prev, handover]);
            // Construct a Patient-like object from the handover's embedded fields
            // so the rest of the page can work with it
            const embeddedPatient: Patient = {
              id: handover.patient?.id || handover.id,
              first_name:
                handover.p_first_name || handover.patient?.first_name || "",
              last_name:
                handover.p_last_name || handover.patient?.last_name || "",
              room_number:
                handover.p_room_number || handover.patient?.room_number || "",
              bed: handover.p_bed || handover.patient?.bed || "",
              mrn: handover.p_mrn || handover.patient?.mrn || "",
              diagnosis:
                handover.p_diagnosis || handover.patient?.diagnosis || "",
              is_active: true,
              created_at: handover.created_at,
              updated_at: handover.updated_at,
            };
            setPatients((prev) => [...prev, embeddedPatient]);
            setShowNewReport(false);
            // Open the newly created handover
            setSelectedPatient(embeddedPatient);
            setSelectedHandover(handover);
            setViewMode("patient");
          }}
          config={patientConfig}
          shiftType={shiftType}
          outgoingNurse={user?.fullName || user?.firstName || "Nurse"}
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

      {/* Handover History Modal */}
      {historyPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Handover History
                </h2>
                <p className="text-sm text-gray-500">
                  {historyPatient.last_name}, {historyPatient.first_name} — Room{" "}
                  {historyPatient.room_number || "N/A"}
                </p>
              </div>
              <button
                onClick={() => {
                  setHistoryPatient(null);
                  setHistoryHandovers([]);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                  <span className="ml-3 text-gray-500">Loading history…</span>
                </div>
              ) : historyHandovers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  No handover history found for this patient.
                </div>
              ) : (
                <div className="space-y-2">
                  {historyHandovers.map((h, idx) => {
                    const dateStr = h.shift_date
                      ? new Date(h.shift_date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Unknown date";
                    const timeStr = h.updated_at
                      ? new Date(h.updated_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "";
                    const isLatest = idx === 0;

                    return (
                      <button
                        key={h.id}
                        onClick={() => {
                          // Open this handover
                          const merged = mergePatientWithHandoverPatient(
                            historyPatient,
                            h,
                          );
                          setSelectedPatient(merged);
                          setSelectedHandover(h);
                          setShiftType(h.shift_type || shiftType);
                          setViewMode("patient");
                          setHistoryPatient(null);
                          setHistoryHandovers([]);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                          isLatest
                            ? "border-blue-200 bg-blue-50 hover:bg-blue-100"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {patientConfig.reportMode === "shift" && (
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                                  h.shift_type === "day"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-indigo-100 text-indigo-700"
                                }`}
                              >
                                {h.shift_type === "day" ? "D" : "N"}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 text-sm">
                                  {dateStr}
                                </span>
                                {patientConfig.reportMode === "shift" && (
                                  <span className="text-xs text-gray-500 capitalize">
                                    {h.shift_type} shift
                                  </span>
                                )}
                                {isLatest && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700">
                                    LATEST
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {h.outgoing_nurse && (
                                  <span className="text-xs text-gray-500">
                                    By {h.outgoing_nurse}
                                  </span>
                                )}
                                {timeStr && (
                                  <span className="text-xs text-gray-400">
                                    at {timeStr}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {h.is_completed && (
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
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                h.status === "stable"
                                  ? "bg-green-100 text-green-700"
                                  : h.status === "improved"
                                    ? "bg-blue-100 text-blue-700"
                                    : h.status === "worsening"
                                      ? "bg-orange-100 text-orange-700"
                                      : h.status === "critical"
                                        ? "bg-red-100 text-red-700"
                                        : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {h.status}
                            </span>
                            <svg
                              className="w-4 h-4 text-gray-400"
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
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <p className="text-xs text-gray-400 text-center">
                Click any entry to view or edit that handover report
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
