"use client";

import { useRef } from "react";
import { Patient, Handover } from "../../lib/api";

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
              grid-template-columns: repeat(3, 1fr);
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

          {/* Patient identification */}
          <div className="patient-info grid grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg mb-4 border border-gray-200">
            <div>
              <strong className="text-xs text-gray-500 uppercase">
                Patient Name
              </strong>
              <span className="block text-sm font-semibold">
                {patient.last_name}, {patient.first_name}
              </span>
            </div>
            <div>
              <strong className="text-xs text-gray-500 uppercase">MRN</strong>
              <span className="block text-sm">{patient.mrn}</span>
            </div>
            <div>
              <strong className="text-xs text-gray-500 uppercase">
                Room / Bed
              </strong>
              <span className="block text-sm">
                {patient.room_number}
                {patient.bed ? ` / ${patient.bed}` : ""}
              </span>
            </div>
            <div>
              <strong className="text-xs text-gray-500 uppercase">
                Admission Date
              </strong>
              <span className="block text-sm">
                {patient.admission_date
                  ? formatDate(patient.admission_date)
                  : "—"}
              </span>
            </div>
            <div className="col-span-2">
              <strong className="text-xs text-gray-500 uppercase">
                Diagnosis
              </strong>
              <span className="block text-sm">{patient.diagnosis || "—"}</span>
            </div>
            <div className="col-span-2">
              <strong className="text-xs text-gray-500 uppercase">
                Attending Physician
              </strong>
              <span className="block text-sm">
                {patient.attending_physician || "—"}
              </span>
            </div>
          </div>

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
            <Section title="IV Access" content={handover.iv_access} />
          </div>

          <Section
            title="Medications Summary"
            content={handover.medications_summary}
          />

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
            <Section title="Pain Management" content={handover.pain_notes} />
          </div>

          <Section
            title="Family / Social Notes"
            content={handover.family_notes}
          />
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
            <div className="signature-row grid grid-cols-2 gap-16">
              <div>
                <div className="signature-line border-t border-gray-900 pt-2">
                  <span className="text-xs text-gray-600">
                    Outgoing Nurse Signature / Time
                  </span>
                </div>
              </div>
              <div>
                <div className="signature-line border-t border-gray-900 pt-2">
                  <span className="text-xs text-gray-600">
                    Incoming Nurse Signature / Time
                  </span>
                </div>
              </div>
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
