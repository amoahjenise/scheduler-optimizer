"use client";

import { useState, useEffect } from "react";
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

type ViewMode = "list" | "patient";

export default function HandoverPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftType, setShiftType] = useState<ShiftType>("day");

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

  // Auto-detect shift based on time
  useEffect(() => {
    const hour = new Date().getHours();
    setShiftType(hour >= 7 && hour < 19 ? "day" : "night");
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  // Get or create handover for a patient (for current shift)
  // Pre-fills static data from the most recent handover
  async function getOrCreateHandover(
    patient: Patient,
  ): Promise<Handover | null> {
    // Find handover for current shift type
    const existing = handovers.find(
      (h) => h.patient_id === patient.id && h.shift_type === shiftType,
    );
    if (existing) return existing;

    try {
      // Fetch the latest handover for this patient to pre-fill data
      const latestHandover = await fetchLatestHandoverForPatientAPI(patient.id);

      // Define fields that should carry over (static/semi-static patient info)
      const prefillData = latestHandover
        ? {
            // Static patient info
            allergies: latestHandover.allergies,
            code_status: latestHandover.code_status,
            isolation: latestHandover.isolation,
            acuity: latestHandover.acuity,
            pertinent_issues: latestHandover.pertinent_issues,
            admit_date: latestHandover.admit_date,
            anticipated_discharge: latestHandover.anticipated_discharge,

            // Medications (usually carry over)
            medications_summary: latestHandover.medications_summary,
            prn_medications: latestHandover.prn_medications,
            chemotherapies: latestHandover.chemotherapies,

            // IV Access (usually stays the same)
            iv_access: latestHandover.iv_access,
            cvad_type: latestHandover.cvad_type,
            cvad_dressing: latestHandover.cvad_dressing,
            tpn: latestHandover.tpn,

            // Tubes/Access
            foley: latestHandover.foley,
            tube_type: latestHandover.tube_type,

            // Diet/Activity (often stays same)
            diet: latestHandover.diet,
            activity: latestHandover.activity,

            // Discharge planning
            expected_discharge_date: latestHandover.expected_discharge_date,
            discharge_teaching: latestHandover.discharge_teaching,
            discharge_prescriptions: latestHandover.discharge_prescriptions,
            home_enteral_feeding: latestHandover.home_enteral_feeding,
            followup_appointments: latestHandover.followup_appointments,

            // Skin care plans
            braden_q_score: latestHandover.braden_q_score,
            skin_care_plan: latestHandover.skin_care_plan,

            // Mobility
            mobility_restrictions: latestHandover.mobility_restrictions,
            assistive_devices: latestHandover.assistive_devices,
            positioning: latestHandover.positioning,

            // Oxygen
            oxygen_needs: latestHandover.oxygen_needs,
          }
        : {};

      const newHandover = await createHandoverAPI({
        patient_id: patient.id,
        shift_date: new Date().toISOString(),
        shift_type: shiftType,
        outgoing_nurse: "Nurse",
        ...prefillData,
      });
      setHandovers((prev) => [...prev, newHandover]);
      return newHandover;
    } catch {
      setError("Failed to create handover");
      return null;
    }
  }

  // Open patient handover form
  async function openPatientHandover(patient: Patient) {
    const handover = await getOrCreateHandover(patient);
    if (handover) {
      setSelectedPatient(patient);
      setSelectedHandover(handover);
      setViewMode("patient");
    }
  }

  // Delete patient
  async function handleDeletePatient(patientId: string) {
    try {
      await deletePatientAPI(patientId);
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
        // Pre-fill all the carryover data (static info)
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
        foley: currentData.foley,
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
        // Copy static handover fields
        status: currentData.status,
        acuity: currentData.acuity,
        isolation: currentData.isolation,
        code_status: currentData.code_status,
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

  // Group patients by room
  const patientsByRoom = patients.reduce(
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

  // Count completed handovers
  const completedCount = handovers.filter((h) => h.is_completed).length;
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

      // Find or create the handover for the new shift
      const existingHandover = handovers.find(
        (h) => h.patient_id === selectedPatient.id && h.shift_type === newShift,
      );

      if (existingHandover) {
        setShiftType(newShift);
        setSelectedHandover(existingHandover);
      } else {
        // Create new handover for this shift
        try {
          const newHandover = await createHandoverAPI({
            patient_id: selectedPatient.id,
            shift_date: new Date().toISOString(),
            shift_type: newShift,
            outgoing_nurse: "Nurse",
          });
          setHandovers((prev) => [...prev, newHandover]);
          setShiftType(newShift);
          setSelectedHandover(newHandover);
        } catch {
          setError("Failed to create handover for this shift");
        }
      }
    };

    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
          <div className="max-w-6xl mx-auto px-4 py-3">
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
                  </p>
                </div>
              </div>

              {/* Shift Document Switcher */}
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => switchShiftDocument("day")}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    shiftType === "day"
                      ? "bg-yellow-400 text-yellow-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  ☀️ Day
                </button>
                <button
                  onClick={() => switchShiftDocument("night")}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    shiftType === "night"
                      ? "bg-indigo-500 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  🌙 Night
                </button>
              </div>
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
            onPatientUpdate={(updated) => {
              setPatients((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p)),
              );
              setSelectedPatient(updated);
            }}
            onShiftChange={(newShift) => {
              switchShiftDocument(newShift);
            }}
            onPreview={() => {
              // Generate comprehensive print preview
              const printWindow = window.open("", "_blank");
              if (printWindow) {
                const h = selectedHandover;
                const p = selectedPatient;
                const shiftLabel =
                  shiftType === "day"
                    ? "Day Shift (7a-7p)"
                    : "Night Shift (7p-7a)";
                const today = new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });

                printWindow.document.write(`
                  <!DOCTYPE html>
                  <html>
                    <head>
                      <title>Handover: ${p.last_name}, ${p.first_name}</title>
                      <style>
                        @page { size: letter; margin: 0.4in; }
                        body { font-family: Arial, sans-serif; font-size: 10px; line-height: 1.3; margin: 0; padding: 0; }
                        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
                        .header h1 { font-size: 14px; margin: 0; }
                        .header p { font-size: 9px; color: #666; margin: 2px 0 0; }
                        .patient-row { display: grid; grid-template-columns: 1fr 2fr 1fr 1fr; gap: 6px; background: #f5f5f5; padding: 6px; margin-bottom: 8px; border: 1px solid #ddd; }
                        .patient-row div { font-size: 10px; }
                        .patient-row strong { display: block; font-size: 8px; color: #666; }
                        .section { margin-bottom: 6px; page-break-inside: avoid; border: 1px solid #ddd; }
                        .section-title { background: #2563eb; color: white; font-size: 9px; font-weight: bold; padding: 3px 6px; }
                        .section-content { padding: 4px 6px; font-size: 9px; white-space: pre-wrap; }
                        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
                        .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
                        .four-col { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; }
                        .label { font-size: 8px; color: #666; font-weight: bold; }
                        .value { font-size: 9px; }
                        .status-badge { display: inline-block; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: bold; }
                        .stable { background: #dcfce7; color: #166534; }
                        .critical { background: #fee2e2; color: #991b1b; }
                        .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd; }
                        .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 20px; }
                        .sig-line { border-top: 1px solid #000; padding-top: 3px; font-size: 9px; }
                        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
                      </style>
                    </head>
                    <body>
                      <div class="header">
                        <h1>HEMA-ONCOLOGY HAND-OFF REPORT</h1>
                        <p>Montreal Children's Hospital • ${shiftLabel} • ${today}</p>
                      </div>
                      
                      <div class="patient-row">
                        <div><strong>Room #</strong>${p.room_number || "—"}${p.bed ? "-" + p.bed : ""}</div>
                        <div><strong>Patient</strong>${p.last_name}, ${p.first_name}</div>
                        <div><strong>MRN</strong>${p.mrn}</div>
                        <div><strong>Code Status</strong>${h.code_status || "Full Code"}</div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">DIAGNOSIS</div>
                          <div class="section-content">${p.diagnosis || "—"}</div>
                        </div>
                        <div class="section">
                          <div class="section-title">PERTINENT ISSUES</div>
                          <div class="section-content">${h.pertinent_issues || "—"}</div>
                        </div>
                      </div>
                      
                      <div class="section">
                        <div class="section-title">STATIC INFO</div>
                        <div class="section-content">
                          <div class="four-col">
                            <div><span class="label">Admit:</span> ${h.admit_date || "—"}</div>
                            <div><span class="label">D/C:</span> ${h.anticipated_discharge || "—"}</div>
                            <div><span class="label">Status:</span> <span class="status-badge ${h.status}">${h.status}</span></div>
                            <div><span class="label">Isolation:</span> ${h.isolation || "None"}</div>
                          </div>
                          <div style="margin-top:4px"><span class="label">Allergies:</span> ${h.allergies || "NKDA"}</div>
                          <div style="margin-top:4px"><span class="label">Medications:</span> ${h.medications_summary || "—"}</div>
                          <div style="margin-top:4px"><span class="label">PRN:</span> ${h.prn_medications || "—"}</div>
                          <div style="margin-top:4px"><span class="label">Chemo:</span> ${h.chemotherapies || "—"}</div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">LABS</div>
                          <div class="section-content">
                            WBC: ${h.wbc || "—"} | Hgb: ${h.hgb || "—"} | Plt: ${h.plt || "—"} | ANC: ${h.anc || "—"}
                            ${h.abnormal_labs ? "\\nAbnormal: " + h.abnormal_labs : ""}
                          </div>
                        </div>
                        <div class="section">
                          <div class="section-title">VS / PAIN</div>
                          <div class="section-content">
                            ${h.abnormal_vitals || "WNL"} | BPEWS: ${h.bpews_score || "—"} | Pain: ${h.pain_scale || "—"}
                            ${h.pain_notes ? "\\n" + h.pain_notes : ""}
                          </div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">IV ACCESS</div>
                          <div class="section-content">${h.iv_access || "—"} | ${h.cvad_type || "—"} | TPN: ${h.tpn ? "Yes" : "No"}</div>
                        </div>
                        <div class="section">
                          <div class="section-title">G.U. / I&O</div>
                          <div class="section-content">
                            Output: ${h.urine_output || "—"} | Foley: ${h.foley ? "Yes" : "No"}
                            ${h.io_00 || h.io_06 || h.io_12 || h.io_18 ? "\\nI&O: " + [h.io_00, h.io_06, h.io_12, h.io_18].filter(Boolean).join(" | ") : ""}
                          </div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">NEURO</div>
                          <div class="section-content">${h.neuro_normal ? "Normal" : ""} ${h.altered_loc ? "Altered LOC" : ""} ${h.confusion ? "Confusion" : ""} ${h.neuro_notes || ""}</div>
                        </div>
                        <div class="section">
                          <div class="section-title">RESP/CARDIO</div>
                          <div class="section-content">${h.lung_assessment || "—"} | O2: ${h.oxygen_needs || "RA"}</div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">G.I. / NUTRITION</div>
                          <div class="section-content">
                            Diet: ${h.diet || "—"} | PO: ${h.po_intake || "—"} | BM: ${h.bowel_movements || "—"}
                            ${h.nausea || h.vomiting ? "\\nN/V: " + (h.nausea ? "Nausea " : "") + (h.vomiting ? "Vomiting" : "") : ""}
                          </div>
                        </div>
                        <div class="section">
                          <div class="section-title">MOBILITY / SKIN</div>
                          <div class="section-content">
                            Activity: ${h.activity || "—"} | Braden Q: ${h.braden_q_score || "—"}
                            ${h.skin_care_plan ? "\\nSkin: " + h.skin_care_plan : ""}
                          </div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">PSYCHOSOCIAL</div>
                          <div class="section-content">${h.psychosocial_notes || "—"}${h.family_notes ? "\\nFamily: " + h.family_notes : ""}</div>
                        </div>
                        <div class="section">
                          <div class="section-title">DISCHARGE PLANNING</div>
                          <div class="section-content">D/C Date: ${h.expected_discharge_date || "—"}${h.discharge_teaching ? "\\nTeaching: " + h.discharge_teaching : ""}</div>
                        </div>
                      </div>
                      
                      <div class="two-col">
                        <div class="section">
                          <div class="section-title">TO DO</div>
                          <div class="section-content">${h.todo_items || "—"}</div>
                        </div>
                        <div class="section">
                          <div class="section-title">FOLLOW UP</div>
                          <div class="section-content">${h.followup_items || "—"}</div>
                        </div>
                      </div>
                      
                      <div class="footer">
                        <div class="sig-row">
                          <div class="sig-line">Outgoing Nurse: ${h.outgoing_nurse || "________________"}</div>
                          <div class="sig-line">Incoming Nurse: ________________</div>
                        </div>
                      </div>
                    </body>
                  </html>
                `);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => {
                  printWindow.print();
                }, 250);
              }
            }}
            onCopyToNewDay={copyToNewDay}
          />
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Left side */}
            <div className="flex items-center gap-6">
              <div>
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

              {/* Shift Toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setShiftType("day")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    shiftType === "day"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  ☀️ Day
                </button>
                <button
                  onClick={() => setShiftType("night")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    shiftType === "night"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  🌙 Night
                </button>
              </div>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {completedCount}/{totalCount} completed
              </span>

              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
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
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Import Word Doc
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
        <div className="max-w-6xl mx-auto px-4 pt-4">
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
      <div className="max-w-6xl mx-auto px-4 py-6">
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
            <p className="text-gray-500 mb-6">
              Add patients manually or import from a Word document.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setShowUpload(true)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Import Word Doc
              </button>
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
                            onClick={() => openPatientHandover(patient)}
                            className="flex-1 text-left flex items-center gap-4"
                          >
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-semibold text-sm">
                                {patient.bed || room.slice(-1)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3">
                                <span className="font-medium text-gray-900">
                                  {patient.last_name}, {patient.first_name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  MRN: {patient.mrn}
                                </span>
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
                              <div className="flex items-center gap-2 mt-1">
                                <p className="text-sm text-gray-500 truncate">
                                  {patient.diagnosis ||
                                    "No diagnosis specified"}
                                </p>
                                {/* Show today's handover badges */}
                                <div className="flex items-center gap-1 ml-2">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      dayHandover
                                        ? "bg-yellow-100 text-yellow-700"
                                        : "bg-gray-100 text-gray-400"
                                    }`}
                                  >
                                    ☀️ {dayHandover ? "Done" : "—"}
                                  </span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      nightHandover
                                        ? "bg-indigo-100 text-indigo-700"
                                        : "bg-gray-100 text-gray-400"
                                    }`}
                                  >
                                    🌙 {nightHandover ? "Done" : "—"}
                                  </span>
                                </div>
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
                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => openPatientHandover(patient)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title={`Open ${shiftType} shift handover`}
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
          onPatientAdded={(patient: Patient) => {
            setPatients((prev) => [...prev, patient]);
            setShowAddPatient(false);
          }}
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
