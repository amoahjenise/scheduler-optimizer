"use client";

import { useRef } from "react";
import { Patient, Handover } from "../../lib/api";
import { loadPatientConfig } from "../../lib/patientConfig";

interface HandoverPreviewProps {
  handover: Handover;
  patient: Patient;
  onBack: () => void;
  onComplete: () => void;
}

export default function HandoverPreview({
  handover,
  patient,
  onBack,
  onComplete,
}: HandoverPreviewProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const patientConfig = loadPatientConfig();
  const showOutgoingNurse = patientConfig.outgoing_nurse.show;
  const showIncomingNurse = patientConfig.incoming_nurse.show;
  const showHandOffDetails = showOutgoingNurse || showIncomingNurse;
  const showMrn = patientConfig.mrn.show;
  const showAge = patientConfig.date_of_birth.show;
  const showDiagnosis = patientConfig.diagnosis.show;
  const showAttendingPhysician = patientConfig.attending_physician.show;
  const showBed = patientConfig.bed.show;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Handover Report - ${patient.last_name}, ${patient.first_name}</title>
          <style>
            @page {
              size: letter;
              margin: 0.5in;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 11px;
              line-height: 1.4;
              color: #000;
              margin: 0;
              padding: 0;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 8px;
              margin-bottom: 12px;
            }
            .header h1 {
              font-size: 16px;
              margin: 0 0 4px 0;
            }
            .header p {
              font-size: 10px;
              color: #666;
              margin: 0;
            }
            .patient-info {
              display: grid;
              grid-template-columns: repeat(5, 1fr);
              gap: 8px;
              background: #f5f5f5;
              padding: 10px;
              margin-bottom: 12px;
              border: 1px solid #ddd;
            }
            .patient-info div {
              font-size: 11px;
            }
            .patient-info strong {
              display: block;
              font-size: 10px;
              color: #666;
              margin-bottom: 2px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 10px;
              margin: 4px 0;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 3px 6px;
              text-align: left;
            }
            th {
              background: #f5f5f5;
              font-weight: 600;
            }
            td {
              text-align: center;
            }
            td:first-child {
              text-align: left;
            }
            .status-row {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
              margin-bottom: 12px;
            }
            .status-box {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: center;
            }
            .status-box .label {
              font-size: 9px;
              color: #666;
              text-transform: uppercase;
              margin-bottom: 4px;
            }
            .status-box .value {
              font-size: 12px;
              font-weight: bold;
            }
            .section {
              margin-bottom: 10px;
              page-break-inside: avoid;
            }
            .section-header {
              font-size: 10px;
              font-weight: bold;
              text-transform: uppercase;
              color: #666;
              border-bottom: 1px solid #ddd;
              padding-bottom: 3px;
              margin-bottom: 5px;
            }
            .section-content {
              font-size: 11px;
              white-space: pre-wrap;
            }
            .two-column {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 12px;
            }
            .footer {
              margin-top: 20px;
              padding-top: 12px;
              border-top: 1px solid #ddd;
            }
            .signature-row {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 40px;
              margin-top: 30px;
            }
            .signature-line {
              border-top: 1px solid #000;
              padding-top: 4px;
              font-size: 10px;
            }
            .empty {
              color: #999;
              font-style: italic;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      stable: "Stable",
      improved: "Improved",
      unchanged: "Unchanged",
      worsening: "Worsening",
      critical: "Critical",
    };
    return labels[status] || status;
  };

  const getAcuityLabel = (acuity: string) => {
    const labels: Record<string, string> = {
      low: "Low",
      moderate: "Moderate",
      high: "High",
      critical: "Critical",
    };
    return labels[acuity] || acuity;
  };

  const getIsolationLabel = (isolation: string) => {
    const labels: Record<string, string> = {
      none: "None",
      contact: "Contact",
      droplet: "Droplet",
      airborne: "Airborne",
      neutropenic: "Neutropenic",
      protective: "Protective",
    };
    return labels[isolation] || isolation;
  };

  const getShiftLabel = (shift: string) => {
    const labels: Record<string, string> = {
      day: "Day Shift (7a-7p)",
      night: "Night Shift (7p-7a)",
      evening: "Evening Shift",
    };
    return labels[shift] || shift;
  };

  const calculateAge = (dob: string | undefined): string => {
    if (!dob) return "—";
    const birthDate = new Date(dob);
    const today = new Date();
    const months =
      (today.getFullYear() - birthDate.getFullYear()) * 12 +
      (today.getMonth() - birthDate.getMonth());

    // For infants, show months
    if (months < 24) {
      return `${months} month${months !== 1 ? "s" : ""}`;
    }

    // For older children/adults, show years
    const years = Math.floor(months / 12);
    return `${years} year${years !== 1 ? "s" : ""}`;
  };

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
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
          Back to Edit
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
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
            Print
          </button>
          <button
            onClick={onComplete}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
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
                d="M5 13l4 4L19 7"
              />
            </svg>
            Mark Complete
          </button>
        </div>
      </div>

      {/* Preview document */}
      <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
        <div ref={printRef}>
          {/* Header */}
          <div className="header text-center border-b-2 border-gray-900 pb-3 mb-4">
            <h1 className="text-xl font-bold text-gray-900">
              HEMA-ONCOLOGY HAND-OFF REPORT
            </h1>
            <p className="text-sm text-gray-600">
              Montreal Children&apos;s Hospital
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {getShiftLabel(handover.shift_type)} •{" "}
              {formatDate(handover.shift_date)}
            </p>
          </div>

          {/* Patient identification - matches form layout */}
          <div className="patient-info grid grid-cols-5 gap-4 bg-gray-50 p-4 rounded-lg mb-4 border border-gray-200">
            <div>
              <strong className="text-xs text-gray-500 uppercase">
                {showBed ? "Room / Bed" : "Room"}
              </strong>
              <span className="block text-sm font-semibold">
                {patient.room_number}
                {showBed && patient.bed ? ` / ${patient.bed}` : ""}
              </span>
            </div>
            <div className="col-span-2">
              <strong className="text-xs text-gray-500 uppercase">
                {showAge ? "Patient / Age" : "Patient"}
              </strong>
              <span className="block text-sm font-semibold">
                {patient.last_name}, {patient.first_name}
                {showAge
                  ? ` / ${patient.age || calculateAge(patient.date_of_birth)}`
                  : ""}
              </span>
            </div>
            {showMrn && (
              <div>
                <strong className="text-xs text-gray-500 uppercase">MRN</strong>
                <span className="block text-sm">{patient.mrn || "—"}</span>
              </div>
            )}
            <div>
              <strong className="text-xs text-gray-500 uppercase">
                Code Status
              </strong>
              <span className="block text-sm font-semibold">
                {handover.code_status || "—"}
              </span>
            </div>
            {showDiagnosis && (
              <div className="col-span-3">
                <strong className="text-xs text-gray-500 uppercase">
                  Diagnosis
                </strong>
                <span className="block text-sm">
                  {patient.diagnosis || "—"}
                </span>
              </div>
            )}
            {showAttendingPhysician && (
              <div className="col-span-2">
                <strong className="text-xs text-gray-500 uppercase">
                  Attending Physician
                </strong>
                <span className="block text-sm">
                  {patient.attending_physician || "—"}
                </span>
              </div>
            )}
            <div className="col-span-2">
              <strong className="text-xs text-gray-500 uppercase">
                Pertinent Issues
              </strong>
              <span className="block text-sm">
                {handover.pertinent_issues || "—"}
              </span>
            </div>
          </div>

          {showHandOffDetails && (
            <div className="grid grid-cols-3 gap-4 bg-white p-4 rounded-lg mb-4 border border-gray-200">
              <div>
                <strong className="text-xs text-gray-500 uppercase">
                  Shift
                </strong>
                <span className="block text-sm font-semibold">
                  {getShiftLabel(handover.shift_type)}
                </span>
              </div>
              {showOutgoingNurse && (
                <div>
                  <strong className="text-xs text-gray-500 uppercase">
                    Outgoing Nurse
                  </strong>
                  <span className="block text-sm">
                    {handover.outgoing_nurse || "—"}
                  </span>
                </div>
              )}
              {showIncomingNurse && (
                <div>
                  <strong className="text-xs text-gray-500 uppercase">
                    Incoming Nurse
                  </strong>
                  <span className="block text-sm">
                    {handover.incoming_nurse || "—"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Status indicators */}
          <div className="status-row grid grid-cols-4 gap-3 mb-4">
            <div className="status-box border border-gray-200 rounded-lg p-3 text-center">
              <div className="label text-xs text-gray-500 uppercase mb-1">
                Status
              </div>
              <div
                className={`value text-sm font-semibold ${
                  handover.status === "critical"
                    ? "text-red-600"
                    : handover.status === "worsening"
                      ? "text-orange-600"
                      : handover.status === "improved"
                        ? "text-blue-600"
                        : "text-green-600"
                }`}
              >
                {getStatusLabel(handover.status)}
              </div>
            </div>
            <div className="status-box border border-gray-200 rounded-lg p-3 text-center">
              <div className="label text-xs text-gray-500 uppercase mb-1">
                Acuity
              </div>
              <div
                className={`value text-sm font-semibold ${
                  handover.acuity === "critical"
                    ? "text-red-600"
                    : handover.acuity === "high"
                      ? "text-orange-600"
                      : handover.acuity === "moderate"
                        ? "text-yellow-600"
                        : "text-green-600"
                }`}
              >
                {getAcuityLabel(handover.acuity)}
              </div>
            </div>
            <div className="status-box border border-gray-200 rounded-lg p-3 text-center">
              <div className="label text-xs text-gray-500 uppercase mb-1">
                Isolation
              </div>
              <div
                className={`value text-sm font-semibold ${
                  handover.isolation !== "none"
                    ? "text-purple-600"
                    : "text-gray-600"
                }`}
              >
                {getIsolationLabel(handover.isolation)}
              </div>
            </div>
            <div className="status-box border border-gray-200 rounded-lg p-3 text-center">
              <div className="label text-xs text-gray-500 uppercase mb-1">
                Code Status
              </div>
              <div className="value text-sm font-semibold text-gray-900">
                {handover.code_status || "Not specified"}
              </div>
            </div>
          </div>

          {/* Clinical information */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Section title="Allergies" content={handover.allergies} />
            <IVSection handover={handover} />
          </div>

          <MedicationsSection handover={handover} />

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Section title="Diet" content={handover.diet} />
            <Section title="Activity" content={handover.activity} />
          </div>

          <Section
            title="Events This Shift"
            content={handover.events_this_shift}
          />

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Section
              title="Pending Tasks / Follow-ups"
              content={handover.pending_tasks}
            />
            <Section
              title="Pending Labs / Diagnostics"
              content={handover.pending_labs}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Section title="Consults" content={handover.consults} />
            <LabsSection handover={handover} />
          </div>

          <VSPainSection handover={handover} />

          <NutritionSection handover={handover} />

          <RespiratoryCardioSection handover={handover} />

          <GISection handover={handover} />

          <GUIOSection handover={handover} />

          <MusculoskeletalSection handover={handover} />

          <SkinSection handover={handover} />

          <Section
            title="Psycho-Social / Family Notes"
            content={handover.psychosocial_notes || handover.family_notes}
          />

          <DischargePlanningSection handover={handover} />

          <Section
            title="Additional Notes"
            content={handover.additional_notes}
          />

          {/* Footer with signatures */}
          <div className="footer mt-8 pt-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 mb-6">
              <p>Created: {formatDateTime(handover.created_at)}</p>
              {handover.updated_at !== handover.created_at && (
                <p>Last Updated: {formatDateTime(handover.updated_at)}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  content,
}: {
  title: string;
  content: string | null | undefined;
}) {
  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        {title}
      </div>
      <div className="section-content text-sm text-gray-800 whitespace-pre-wrap">
        {content && content.trim() !== "" ? (
          content
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function PreviewInputBox({
  value,
  placeholder,
  className = "",
}: {
  value: string | null | undefined;
  placeholder: string;
  className?: string;
}) {
  return (
    <div
      className={`min-h-[28px] rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 ${className}`}
    >
      {value && value.trim() ? (
        value
      ) : (
        <span className="text-gray-400">{placeholder}</span>
      )}
    </div>
  );
}

function MedicationsSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.medications_summary ||
    handover.prn_medications ||
    handover.chemotherapies;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Medications
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">
                Medications
              </div>
              <PreviewInputBox
                value={handover.medications_summary}
                placeholder="List current medications..."
                className="min-h-[56px] whitespace-pre-wrap"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">PRN</div>
              <PreviewInputBox
                value={handover.prn_medications}
                placeholder="List PRN medications..."
                className="min-h-[56px] whitespace-pre-wrap"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">
                Chemotherapies
              </div>
              <PreviewInputBox
                value={handover.chemotherapies}
                placeholder="Current chemotherapy regimen..."
                className="min-h-[56px] whitespace-pre-wrap"
              />
            </div>
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function LabsSection({ handover }: { handover: Handover }) {
  const fields = [
    { label: "WBC", value: handover.wbc },
    { label: "Hgb", value: handover.hgb },
    { label: "PLT", value: handover.plt },
    { label: "ANC", value: handover.anc },
    { label: "Abnormal Labs", value: handover.abnormal_labs },
  ];
  const hasContent = fields.some((field) => field.value && field.value.trim());

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Labs
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="grid grid-cols-5 gap-3">
            {fields.map((field) => (
              <div key={field.label} className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  {field.label}
                </div>
                <PreviewInputBox value={field.value} placeholder="" />
              </div>
            ))}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function IVSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.cvad_type ||
    handover.cvad_dressing ||
    handover.iv_infusions ||
    handover.tpn;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        I.V.
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  CVAD Type
                </div>
                <PreviewInputBox
                  value={handover.cvad_type}
                  placeholder=""
                  className="whitespace-pre-wrap"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  Dressing
                </div>
                <PreviewInputBox
                  value={handover.cvad_dressing}
                  placeholder=""
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">
                IV Infusions
              </div>
              <PreviewInputBox
                value={handover.iv_infusions}
                placeholder=""
                className="whitespace-pre-wrap"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">TPN</div>
              <PreviewInputBox
                value={handover.tpn}
                placeholder=""
                className="whitespace-pre-wrap"
              />
            </div>
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function VSPainSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.abnormal_vitals ||
    handover.bpews_score ||
    handover.pain_scale ||
    handover.pain_location ||
    handover.pain_relieved_post_med ||
    handover.pca_checkbox ||
    handover.nca_checkbox ||
    handover.pca_nca_bolus ||
    handover.monitoring_cardiac ||
    handover.monitoring_o2_sat;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        VS / Pain
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600">
                Vital signs (abnormal)
              </div>
              <PreviewInputBox
                value={handover.abnormal_vitals}
                placeholder=""
                className="whitespace-pre-wrap"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  BPEWS Score
                </div>
                <PreviewInputBox value={handover.bpews_score} placeholder="" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  Pain Scale
                </div>
                <PreviewInputBox value={handover.pain_scale} placeholder="" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  Pain Location
                </div>
                <PreviewInputBox
                  value={handover.pain_location}
                  placeholder="Location..."
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-600">
                  Relieved post med
                </div>
                <PreviewInputBox
                  value={handover.pain_relieved_post_med}
                  placeholder="Yes/No/Time..."
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.pca_checkbox ? "✓" : ""}
                </span>
                PCA
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.nca_checkbox ? "✓" : ""}
                </span>
                NCA
              </span>
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <span>Bolus (successful/failed):</span>
                <div className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800">
                  {handover.pca_nca_bolus || (
                    <span className="text-gray-400">e.g. 3/5</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-2">
              <span className="text-xs font-medium text-gray-700">
                Monitoring:
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.monitoring_cardiac ? "✓" : ""}
                </span>
                Cardiac
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.monitoring_o2_sat ? "✓" : ""}
                </span>
                O₂ Sat
              </span>
            </div>
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function NutritionSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.diet ||
    handover.weight ||
    handover.fluid_intake_po ||
    handover.fluid_intake_iv ||
    handover.fluid_intake_ng ||
    handover.total_fluid ||
    handover.formula_checkbox ||
    handover.formula ||
    handover.breast_milk ||
    handover.continuous_feeding ||
    handover.continuous_feeding_rate ||
    handover.bolus_feeding ||
    handover.bolus_amount ||
    handover.ng_tube ||
    handover.nj_tube ||
    handover.gt_tube ||
    handover.npo ||
    handover.feeding_goal ||
    handover.see_feeding_schedule;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Nutrition
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-1">
            {handover.diet && (
              <div>
                <span className="font-medium">Diet:</span> {handover.diet}
              </div>
            )}
            {handover.weight && (
              <div>
                <span className="font-medium">Weight:</span> {handover.weight}{" "}
                kg
              </div>
            )}
            {(handover.fluid_intake_po ||
              handover.fluid_intake_iv ||
              handover.fluid_intake_ng ||
              handover.total_fluid) && (
              <div>
                <span className="font-medium">Fluid Intake:</span>{" "}
                {[
                  handover.fluid_intake_po &&
                    `PO: ${handover.fluid_intake_po}ml`,
                  handover.fluid_intake_iv &&
                    `IV: ${handover.fluid_intake_iv}ml`,
                  handover.fluid_intake_ng &&
                    `NG: ${handover.fluid_intake_ng}ml`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                {handover.total_fluid && ` (Total: ${handover.total_fluid})`}
              </div>
            )}
            {(handover.formula_checkbox ||
              handover.formula ||
              handover.breast_milk) && (
              <div>
                <span className="font-medium">Feeding:</span>{" "}
                {[
                  handover.formula_checkbox &&
                    (handover.formula
                      ? `Formula: ${handover.formula}`
                      : "Formula"),
                  handover.breast_milk && "Breast milk",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            {(handover.continuous_feeding || handover.bolus_feeding) && (
              <div>
                <span className="font-medium">Feeding Type:</span>{" "}
                {[
                  handover.continuous_feeding &&
                    (handover.continuous_feeding_rate
                      ? `Continuous: ${handover.continuous_feeding_rate}ml/h`
                      : "Continuous"),
                  handover.bolus_feeding &&
                    (handover.bolus_amount
                      ? `Bolus: ${handover.bolus_amount}`
                      : "Bolus"),
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            {(handover.ng_tube ||
              handover.nj_tube ||
              handover.gt_tube ||
              handover.npo) && (
              <div>
                <span className="font-medium">Access/Status:</span>{" "}
                {[
                  handover.ng_tube && "NG",
                  handover.nj_tube && "NJ",
                  handover.gt_tube && "GT",
                  handover.npo && "NPO",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            {handover.feeding_goal && (
              <div>
                <span className="font-medium">Goal:</span>{" "}
                {handover.feeding_goal}
              </div>
            )}
            {handover.see_feeding_schedule && (
              <div className="text-xs text-blue-600">
                ℹ️ See feeding schedule
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function GUIOSection({ handover }: { handover: Handover }) {
  const is6Hour = !handover.io_interval || handover.io_interval === "6h";
  const ioValues = handover as Handover &
    Record<string, string | null | undefined>;
  const ioRows = is6Hour
    ? [
        {
          label: "00-06h",
          interval: handover.io_00,
          intervalKgHr: ioValues.io_00_kghr,
          running: handover.io_00_last6h,
          runningKgHr: ioValues.io_00_last6h_kghr,
        },
        {
          label: "06-12h",
          interval: handover.io_06,
          intervalKgHr: ioValues.io_06_kghr,
          running: handover.io_06_last6h,
          runningKgHr: ioValues.io_06_last6h_kghr,
        },
        {
          label: "12-18h",
          interval: handover.io_12,
          intervalKgHr: ioValues.io_12_kghr,
          running: handover.io_12_last6h,
          runningKgHr: ioValues.io_12_last6h_kghr,
        },
        {
          label: "18-24h",
          interval: handover.io_18,
          intervalKgHr: ioValues.io_18_kghr,
          running: handover.io_18_last6h,
          runningKgHr: ioValues.io_18_last6h_kghr,
        },
      ]
    : [
        {
          label: "00-04h",
          interval: handover.io_00_04,
          intervalKgHr: ioValues.io_00_04_kghr,
          running: handover.io_00_04_last6h,
          runningKgHr: ioValues.io_00_04_last6h_kghr,
        },
        {
          label: "04-08h",
          interval: handover.io_04_08,
          intervalKgHr: ioValues.io_04_08_kghr,
          running: handover.io_04_08_last6h,
          runningKgHr: ioValues.io_04_08_last6h_kghr,
        },
        {
          label: "08-12h",
          interval: handover.io_08_12,
          intervalKgHr: ioValues.io_08_12_kghr,
          running: handover.io_08_12_last6h,
          runningKgHr: ioValues.io_08_12_last6h_kghr,
        },
        {
          label: "12-16h",
          interval: handover.io_12_16,
          intervalKgHr: ioValues.io_12_16_kghr,
          running: handover.io_12_16_last6h,
          runningKgHr: ioValues.io_12_16_last6h_kghr,
        },
        {
          label: "16-20h",
          interval: handover.io_16_20,
          intervalKgHr: ioValues.io_16_20_kghr,
          running: handover.io_16_20_last6h,
          runningKgHr: ioValues.io_16_20_last6h_kghr,
        },
        {
          label: "20-24h",
          interval: handover.io_20_24,
          intervalKgHr: ioValues.io_20_24_kghr,
          running: handover.io_20_24_last6h,
          runningKgHr: ioValues.io_20_24_last6h_kghr,
        },
      ];
  const runningPlaceholder = is6Hour ? "last 6h ml" : "last 4h ml";

  // Check if there's any I/O data
  const hasIOData = is6Hour
    ? handover.io_00 ||
      handover.io_06 ||
      handover.io_12 ||
      handover.io_18 ||
      handover.io_00_last6h ||
      handover.io_06_last6h ||
      handover.io_12_last6h ||
      handover.io_18_last6h
    : handover.io_00_04 ||
      handover.io_04_08 ||
      handover.io_08_12 ||
      handover.io_12_16 ||
      handover.io_16_20 ||
      handover.io_20_24;

  const hasUrineDetails =
    handover.foley ||
    handover.urine_sg ||
    handover.urine_ph ||
    handover.urine_ob ||
    handover.urine_glucose ||
    handover.urine_ketones;

  const hasContent = hasIOData || hasUrineDetails || handover.urine_output;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        G.U. — Urine Output &amp; Fluid Balance
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 border-b border-gray-200 pb-2">
              <span className="text-xs font-medium text-gray-700">
                Monitoring Interval:
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-900">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-blue-600">
                  {!is6Hour && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                  )}
                </span>
                4 hours
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-900">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-blue-600">
                  {is6Hour && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                  )}
                </span>
                6 hours
              </span>
            </div>
            {/* I/O Table */}
            {hasIOData && (
              <div>
                <div className="mb-1 text-xs font-semibold text-gray-700">
                  Urine Output (I/O)
                </div>
                <div className="mb-2 text-[10px] text-gray-500 leading-snug bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                  <span className="font-semibold text-gray-600">
                    How to read:
                  </span>{" "}
                  Each time block shows <strong>Total ml</strong> (volume in
                  that interval) and <strong>ml/kg/hr</strong> (output ÷ patient
                  weight ÷ hours).
                  <br />
                  Goal ≥ 1 ml/kg/hr&ensp;|&ensp;⚑ &lt; 0.5 ml/kg/hr for 6 hrs =
                  medical alert&ensp;|&ensp; +value = net positive (intake &gt;
                  output)&ensp;|&ensp;−value = net negative
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {ioRows.map((row) => (
                    <div key={row.label} className="space-y-1">
                      <div className="text-xs font-semibold text-blue-700 text-center bg-blue-50 rounded px-1 py-0.5">
                        {row.label}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-0.5">
                            Total ml
                          </div>
                          <div className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                            {row.interval || (
                              <span className="text-gray-400">ml</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-0.5">
                            ml/kg/hr
                          </div>
                          <div className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                            {row.intervalKgHr || (
                              <span className="text-gray-400">ml/kg/hr</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-0.5">
                            Running
                          </div>
                          <div className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                            {row.running || (
                              <span className="text-gray-400">
                                {runningPlaceholder}
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-0.5">
                            ml/kg/hr
                          </div>
                          <div className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                            {row.runningKgHr || (
                              <span className="text-gray-400">ml/kg/hr</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Urine details */}
            {hasUrineDetails && (
              <div className="flex flex-wrap items-end gap-4 border-t border-gray-200 pt-2">
                <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                    {handover.foley ? "✓" : ""}
                  </span>
                  Foley
                </span>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    SG
                  </div>
                  <div className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                    {handover.urine_sg || ""}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Ph
                  </div>
                  <div className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                    {handover.urine_ph || ""}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    OB
                  </div>
                  <div className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                    {handover.urine_ob || ""}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Gluc
                  </div>
                  <div className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                    {handover.urine_glucose || ""}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Ket
                  </div>
                  <div className="w-16 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-800">
                    {handover.urine_ketones || ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function GISection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.gi_tenderness ||
    handover.gi_distention ||
    handover.gi_girth ||
    handover.vomiting ||
    handover.vomiting_quantity ||
    handover.nausea ||
    handover.last_bowel_movement ||
    handover.bowel_amount ||
    handover.bowel_description ||
    handover.constipation ||
    handover.diarrhea ||
    handover.diarrhea_quantity ||
    handover.colostomy;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        G.I.
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.gi_tenderness ? "✓" : ""}
                </span>
                Abnormal tenderness
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.gi_distention ? "✓" : ""}
                </span>
                Distention
              </span>
            </div>

            {handover.gi_girth && (
              <div>
                <span className="font-medium">Girth:</span> {handover.gi_girth}
              </div>
            )}

            <div className="flex flex-wrap gap-4 items-center">
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.vomiting ? "✓" : ""}
                </span>
                Vomiting
              </span>
              {handover.vomiting_quantity && (
                <>
                  <span className="text-xs text-gray-600">Quantity:</span>
                  <span className="inline-block px-2 py-0.5 border border-gray-300 rounded bg-white text-xs">
                    {handover.vomiting_quantity}
                  </span>
                </>
              )}
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.nausea ? "✓" : ""}
                </span>
                Nausea
              </span>
            </div>

            {(handover.last_bowel_movement ||
              handover.bowel_amount ||
              handover.bowel_description) && (
              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-700">
                  Last Bowel Movement
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {handover.last_bowel_movement && (
                    <div>
                      <span className="text-xs font-medium text-gray-600">
                        Date:
                      </span>{" "}
                      <span className="text-sm">
                        {handover.last_bowel_movement}
                      </span>
                    </div>
                  )}
                  {handover.bowel_amount && (
                    <div>
                      <span className="text-xs font-medium text-gray-600">
                        Amount:
                      </span>{" "}
                      <span className="text-sm">{handover.bowel_amount}</span>
                    </div>
                  )}
                </div>
                {handover.bowel_description && (
                  <div>
                    <span className="text-xs font-medium text-gray-600">
                      Description:
                    </span>{" "}
                    <span className="text-sm">
                      {handover.bowel_description}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.constipation ? "✓" : ""}
                </span>
                Constipation
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.diarrhea ? "✓" : ""}
                </span>
                Diarrhea
                {handover.diarrhea_quantity
                  ? ` (${handover.diarrhea_quantity})`
                  : ""}
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-gray-700">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-gray-400 text-[10px] leading-none text-gray-700">
                  {handover.colostomy ? "✓" : ""}
                </span>
                Colostomy
              </span>
            </div>
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function DischargePlanningSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.expected_discharge_date ||
    handover.discharge_teaching ||
    handover.discharge_prescriptions ||
    handover.home_enteral_feeding ||
    handover.followup_appointments;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Discharge Planning
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-1">
            {handover.expected_discharge_date && (
              <div>
                <span className="font-medium">Expected D/C Date:</span>{" "}
                {handover.expected_discharge_date}
              </div>
            )}
            {handover.home_enteral_feeding && (
              <div>
                <span className="font-medium">Home Enteral Feeding:</span>{" "}
                {handover.home_enteral_feeding}
              </div>
            )}
            {handover.discharge_teaching && (
              <div>
                <span className="font-medium">Teaching:</span>{" "}
                {handover.discharge_teaching}
              </div>
            )}
            {handover.discharge_prescriptions && (
              <div>
                <span className="font-medium">D/C Prescriptions:</span>{" "}
                {handover.discharge_prescriptions}
              </div>
            )}
            {handover.followup_appointments && (
              <div>
                <span className="font-medium">Follow-up:</span>{" "}
                {handover.followup_appointments}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function RespiratoryCardioSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.lung_assessment ||
    handover.oxygen ||
    handover.cardiovascular ||
    handover.chest_tube_left ||
    handover.chest_tube_right ||
    handover.chest_tube_type_lws ||
    handover.chest_tube_type_sd ||
    handover.heart_rate_notes;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Resp / Cardio
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-2">
            {handover.lung_assessment && (
              <div>
                <span className="font-medium">Lungs:</span>{" "}
                {handover.lung_assessment}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {handover.oxygen && (
                <div>
                  <span className="font-medium">Oxygen:</span> {handover.oxygen}
                </div>
              )}
              {handover.cardiovascular && (
                <div>
                  <span className="font-medium">
                    Cardiovascular Assessment:
                  </span>{" "}
                  {handover.cardiovascular}
                </div>
              )}
            </div>

            {/* Chest tube section */}
            {(handover.chest_tube_left ||
              handover.chest_tube_right ||
              handover.chest_tube_type_lws ||
              handover.chest_tube_type_sd) && (
              <div className="border-t border-gray-200 pt-2">
                <div className="flex flex-wrap gap-4 items-center text-xs">
                  <span className="font-medium text-gray-600">Chest tube:</span>
                  {handover.chest_tube_left && (
                    <span className="inline-flex items-center">
                      <span className="w-3 h-3 border border-gray-400 mr-1 text-center text-xs leading-3">
                        ✓
                      </span>
                      L
                    </span>
                  )}
                  {handover.chest_tube_right && (
                    <span className="inline-flex items-center">
                      <span className="w-3 h-3 border border-gray-400 mr-1 text-center text-xs leading-3">
                        ✓
                      </span>
                      R
                    </span>
                  )}
                  <span className="font-medium text-gray-600 ml-2">Type:</span>
                  {handover.chest_tube_type_lws && (
                    <span className="inline-flex items-center">
                      <span className="w-3 h-3 border border-gray-400 mr-1 text-center text-xs leading-3">
                        ✓
                      </span>
                      LWS
                    </span>
                  )}
                  {handover.chest_tube_type_sd && (
                    <span className="inline-flex items-center">
                      <span className="w-3 h-3 border border-gray-400 mr-1 text-center text-xs leading-3">
                        ✓
                      </span>
                      SD
                    </span>
                  )}
                </div>
              </div>
            )}

            {handover.heart_rate_notes && (
              <div>
                <span className="font-medium">Heart Rate Notes:</span>{" "}
                {handover.heart_rate_notes}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function MusculoskeletalSection({ handover }: { handover: Handover }) {
  const hasContent = handover.activity || handover.assistive_devices;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Musculoskeletal
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-1">
            {handover.activity && (
              <div>
                <span className="font-medium">Activity Level:</span>{" "}
                {handover.activity}
              </div>
            )}
            {handover.assistive_devices && (
              <div>
                <span className="font-medium">Assistive Devices:</span>{" "}
                {handover.assistive_devices}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}

function SkinSection({ handover }: { handover: Handover }) {
  const hasContent =
    handover.braden_q_score ||
    handover.skin_assessment ||
    handover.skin_care_plan ||
    handover.pressure_sore_stage ||
    handover.pressure_sore_location ||
    handover.pressure_sore_treatment;

  return (
    <div className="section mb-3">
      <div className="section-header text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-1 mb-2">
        Skin
      </div>
      <div className="section-content text-sm text-gray-800">
        {hasContent ? (
          <div className="space-y-1">
            {handover.braden_q_score && (
              <div>
                <span className="font-medium">Braden Q Score:</span>{" "}
                {handover.braden_q_score}
              </div>
            )}
            {handover.skin_assessment && (
              <div>
                <span className="font-medium">Skin Assessment:</span>{" "}
                {handover.skin_assessment}
              </div>
            )}
            {handover.skin_care_plan && (
              <div>
                <span className="font-medium">Skin Care Plan:</span>{" "}
                {handover.skin_care_plan}
              </div>
            )}
            {(handover.pressure_sore_stage ||
              handover.pressure_sore_location ||
              handover.pressure_sore_treatment) && (
              <div className="border-t border-gray-200 pt-1 mt-1">
                <span className="font-medium">Pressure Sore:</span>
                <div className="ml-4 text-xs">
                  {handover.pressure_sore_stage && (
                    <div>Stage: {handover.pressure_sore_stage}</div>
                  )}
                  {handover.pressure_sore_location && (
                    <div>Location: {handover.pressure_sore_location}</div>
                  )}
                  {handover.pressure_sore_treatment && (
                    <div>Treatment: {handover.pressure_sore_treatment}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">Not documented</span>
        )}
      </div>
    </div>
  );
}
