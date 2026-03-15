import type { Handover } from "../../lib/api";
import { loadPatientConfig } from "../../lib/patientConfig";

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  mrn?: string | null;
  room_number: string;
  bed?: string | null;
  diagnosis?: string | null;
  age?: string | null;
  date_of_birth?: string | null;
  attending_physician?: string | null;
}

/** Compute a human-readable age string from an ISO date-of-birth. */
function ageFromDob(dob: string | null | undefined): string {
  if (!dob) return "";
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return "";
  const now = new Date();
  const months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  if (months < 1) return "< 1 month";
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""}`;
  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? "s" : ""}`;
}

// For input fields: show underline via CSS; leave value empty when missing
const f = (v: string | null | undefined) => (v && v.trim() ? v : "");

// For text areas: leave blank if empty
const fEmpty = (v: string | null | undefined) => (v && v.trim() ? v : "");

// Format multi-select values nicely (wrap long lists)
const multiSelect = (v: string | null | undefined) =>
  v && v.trim() ? v.split(", ").join(" • ") : "";

const inputLikeValue = (v: string | null | undefined, placeholder: string) =>
  v && v.trim()
    ? v
    : `<span style="color:#9ca3af; font-size:8px;">${placeholder}</span>`;

const renderGuIoGrid = (
  values: Record<string, string | null | undefined>,
  rows: Array<{
    label: string;
    intervalKey: string;
    intervalKgHrKey: string;
    runningKey: string;
    runningKgHrKey: string;
  }>,
  runningPlaceholder: string,
) => `
  <div style="margin-top:6px; margin-bottom:4px;">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px; margin-bottom:6px; font-size:7px; color:#6b7280; line-height:1.35;">
      <div><strong style="color:#374151;">Total ml</strong> — volume produced in this interval</div>
      <div><strong style="color:#374151;">ml/kg/hr</strong> — output ÷ (weight kg × hours) &nbsp;⚑ &lt; 0.5 is a red flag</div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(${rows.length}, 1fr); gap:6px;">
      ${rows
        .map(
          (row) => `
        <div style="display:flex; flex-direction:column; gap:3px;">
          <div style="font-size:8px; font-weight:700; color:#1e40af; text-align:center; background:#eff6ff; border-radius:3px; padding:2px 4px;">${row.label}</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:3px;">
            <div>
              <div style="font-size:6px; color:#6b7280; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:1px;">Total ml</div>
              <div class="gu-input-box">${inputLikeValue(values[row.intervalKey], "ml")}</div>
            </div>
            <div>
              <div style="font-size:6px; color:#6b7280; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:1px;">ml/kg/hr</div>
              <div class="gu-input-box">${inputLikeValue(values[row.intervalKgHrKey], "ml/kg/hr")}</div>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:3px;">
            <div>
              <div style="font-size:6px; color:#6b7280; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:1px;">Running</div>
              <div class="gu-input-box">${inputLikeValue(values[row.runningKey], runningPlaceholder)}</div>
            </div>
            <div>
              <div style="font-size:6px; color:#6b7280; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:1px;">ml/kg/hr</div>
              <div class="gu-input-box">${inputLikeValue(values[row.runningKgHrKey], "ml/kg/hr")}</div>
            </div>
          </div>
        </div>`,
        )
        .join("")}
    </div>
  </div>
`;

export function generatePrintHtml(h: Handover, p: Patient): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const patientConfig = loadPatientConfig();
  const showOutgoingNurse = patientConfig.outgoing_nurse.show;
  const showIncomingNurse = patientConfig.incoming_nurse.show;
  const showHandOffDetails = showOutgoingNurse || showIncomingNurse;
  const showMrn = patientConfig.mrn.show;
  const showAge = patientConfig.date_of_birth.show;
  const showDiagnosis = patientConfig.diagnosis.show;
  const showAttendingPhysician = patientConfig.attending_physician.show;
  const showBed = patientConfig.bed.show;
  const ioValues = h as Handover & Record<string, string | null | undefined>;
  const handoffDetailsColumns = [
    '<div class="field"><div class="field-label">Shift</div><div class="field-value">' +
      f(
        h.shift_type
          ? h.shift_type.charAt(0).toUpperCase() + h.shift_type.slice(1)
          : "",
      ) +
      "</div></div>",
    showOutgoingNurse
      ? '<div class="field"><div class="field-label">Outgoing Nurse</div><div class="field-value">' +
        f(h.outgoing_nurse) +
        "</div></div>"
      : "",
    showIncomingNurse
      ? '<div class="field"><div class="field-label">Incoming Nurse</div><div class="field-value">' +
        f(h.incoming_nurse) +
        "</div></div>"
      : "",
  ]
    .filter(Boolean)
    .join("");
  const patientBarFields = [
    `<div><strong>${showAge ? "Patient / Age" : "Patient"}</strong>${p.last_name}, ${p.first_name}${showAge ? ` / ${p.age || ageFromDob(p.date_of_birth) || "—"}` : ""}</div>`,
    `<div><strong>${showBed ? "Room / Bed" : "Room"}</strong>${p.room_number}${showBed && p.bed ? " – " + p.bed : ""}</div>`,
    showMrn && p.mrn ? `<div><strong>MRN</strong>${p.mrn}</div>` : "",
    `<div><strong>Code Status</strong>${f(h.code_status)}</div>`,
    showDiagnosis && p.diagnosis
      ? `<div style="grid-column:span 2"><strong>Diagnosis</strong>${p.diagnosis}</div>`
      : "",
    showAttendingPhysician && p.attending_physician
      ? `<div style="grid-column:span 2"><strong>Attending</strong>${p.attending_physician}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Hand-off report — ${p.last_name}, ${p.first_name}</title>
        <style>
          @page { size: letter; margin: 0.5in; }
          body { font-family: Arial, sans-serif; font-size: 10px; line-height: 1.4; margin: 0; padding: 0; color: #111; }
          .header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 5px; margin-bottom: 8px; }
          .header h1 { font-size: 15px; margin: 0; font-weight: bold; }
          .header .date { font-size: 11px; color: #444; }
          .patient-bar { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 6px; background: #f3f4f6; padding: 7px 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 4px; }
          .patient-bar div { font-size: 10px; }
          .patient-bar strong { display: block; font-size: 8px; color: #6b7280; text-transform: uppercase; margin-bottom: 1px; }
          .section { margin-bottom: 6px; border: 1px solid #d1d5db; border-radius: 3px; page-break-inside: avoid; }
          .section-title { background: #1d4ed8; color: white; font-size: 9px; font-weight: bold; padding: 3px 7px; text-transform: uppercase; letter-spacing: 0.03em; }
          .section-body { padding: 5px 7px; }
          .field { margin-bottom: 3px; }
          .field-label { font-size: 7px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 1px; }
          .field-value { font-size: 10px; white-space: pre-wrap; min-height: 12px; color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 1px; }
          .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
          .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
          .four-col { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; }
          .five-col { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap: 6px; }
          .inline-fields { display: flex; flex-wrap: wrap; gap: 10px 20px; }
          .cb { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; margin-right: 8px; }
          .cb-box { width: 11px; height: 11px; border: 1.5px solid #333; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; }
          .radio-dot { width: 10px; height: 10px; border: 1.5px solid #2563eb; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; }
          .radio-dot-inner { width: 5px; height: 5px; border-radius: 999px; background: #2563eb; }
          .input-box { border: 1px solid #999; padding: 2px 4px; min-height: 14px; background: #fafafa; font-size: 10px; }
          .input-line { border-bottom: 1px solid #999; min-height: 14px; font-size: 10px; padding: 1px 2px; }
          .gu-input-box { border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 6px; min-height: 18px; background: #fff; font-size: 8px; color: #111827; }
          .status-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: bold; }
          .status-stable { background: #dbeafe; color: #1e40af; }
          .status-improved { background: #dcfce7; color: #166534; }
          .status-critical { background: #fee2e2; color: #991b1b; }
          .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #d1d5db; }
          .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 18px; }
          .sig-line { border-top: 1px solid #111; padding-top: 3px; font-size: 9px; }
          .todo-section .section-body { min-height: 80px; }
          .todo-section .field-value { min-height: 70px; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { margin-bottom: 0.3in; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Hand-off report</h1>
          <span class="date">${today}</span>
        </div>
        
        <div class="patient-bar">
          ${patientBarFields}
        </div>

        ${
          showHandOffDetails
            ? `<div class="section" style="margin-bottom:8px;">
          <div class="section-title">Hand-off Details</div>
          <div class="section-body">
            <div class="three-col">
              ${handoffDetailsColumns}
            </div>
          </div>
        </div>`
            : ""
        }

        <div class="two-col">
          <div class="section">
            <div class="section-title">Pertinent Issues</div>
            <div class="section-body"><div class="field-value">${f(h.pertinent_issues)}</div></div>
          </div>
          <div class="section">
            <div class="section-title">Static Info</div>
            <div class="section-body">
              <div class="four-col">
                <div class="field"><div class="field-label">Admit</div><div class="field-value">${f(h.admit_date)}</div></div>
                <div class="field"><div class="field-label">D/C Date</div><div class="field-value">${f(h.anticipated_discharge)}</div></div>
                <div class="field"><div class="field-label">Status</div><div class="field-value"><span class="status-badge ${h.status === "improved" ? "status-improved" : h.status === "critical" ? "status-critical" : "status-stable"}">${h.status ? h.status.charAt(0).toUpperCase() + h.status.slice(1) : "Stable"}</span></div></div>
                <div class="field"><div class="field-label">Isolation</div><div class="field-value">${multiSelect(h.isolation)}</div></div>
              </div>
              <div class="field" style="margin-top:4px"><div class="field-label">Allergies</div><div class="field-value">${f(h.allergies)}</div></div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Medications</div>
          <div class="section-body">
            <div class="three-col">
              <div class="field"><div class="field-label">Scheduled</div><div class="field-value" style="min-height:56px; border-bottom:1px solid #d1d5db; padding-bottom:2px;">${f(h.medications_summary)}</div></div>
              <div class="field"><div class="field-label">PRN</div><div class="field-value" style="min-height:56px; border-bottom:1px solid #d1d5db; padding-bottom:2px;">${f(h.prn_medications)}</div></div>
              <div class="field"><div class="field-label">Chemotherapy</div><div class="field-value" style="min-height:56px; border-bottom:1px solid #d1d5db; padding-bottom:2px;">${f(h.chemotherapies)}</div></div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">Labs</div>
            <div class="section-body">
              <div class="five-col">
                <div class="field"><div class="field-label">WBC</div><div class="field-value">${f(h.wbc)}</div></div>
                <div class="field"><div class="field-label">Hgb</div><div class="field-value">${f(h.hgb)}</div></div>
                <div class="field"><div class="field-label">PLT</div><div class="field-value">${f(h.plt)}</div></div>
                <div class="field"><div class="field-label">ANC</div><div class="field-value">${f(h.anc)}</div></div>
                <div class="field"><div class="field-label">Abnormal</div><div class="field-value">${f(h.abnormal_labs)}</div></div>
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">VS / Pain</div>
            <div class="section-body">
              <div class="three-col">
                <div class="field"><div class="field-label">Abnormal Vitals</div><div class="field-value">${f(h.abnormal_vitals)}</div></div>
                <div class="field"><div class="field-label">BPEWS Score</div><div class="field-value">${f(h.bpews_score)}</div></div>
                <div class="field"><div class="field-label">Pain Scale</div><div class="field-value">${f(h.pain_scale)}${h.pain_location ? " – " + h.pain_location : ""}</div></div>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Relieved post med</div><div class="field-value">${f(h.pain_relieved_post_med)}</div></div>
              <div class="inline-fields" style="margin-top:3px">
                <span class="cb"><span class="cb-box">${h.pca_checkbox ? "✓" : ""}</span> PCA</span>
                <span class="cb"><span class="cb-box">${h.nca_checkbox ? "✓" : ""}</span> NCA</span>
                <span style="margin-left:10px;"><span class="field-label">Bolus:</span> ${fEmpty(h.pca_nca_bolus) || "________"}</span>
              </div>
              <div class="inline-fields" style="margin-top:3px; padding-top:3px; border-top:1px solid #e5e7eb;">
                <span style="font-size:8px; font-weight:bold; color:#6b7280;">MONITORING:</span>
                <span class="cb"><span class="cb-box">${h.monitoring_cardiac ? "✓" : ""}</span> Cardiac</span>
                <span class="cb"><span class="cb-box">${h.monitoring_o2_sat ? "✓" : ""}</span> O₂ Sat</span>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Notes</div><div class="field-value">${f(h.pain_notes)}</div></div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">I.V.</div>
            <div class="section-body">
              <div class="field"><div class="field-label">CVAD Type</div><div class="field-value">${multiSelect(h.cvad_type)}</div></div>
              <div class="two-col" style="margin-top:3px">
                <div class="field"><div class="field-label">Dressing</div><div class="field-value">${f(h.cvad_dressing)}</div></div>
                <div class="field"><div class="field-label">TPN</div><div class="field-value">${f(h.tpn)}</div></div>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">IV Infusions</div><div class="field-value">${f(h.iv_infusions)}</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">G.U. — Urine Output & Fluid Balance</div>
            <div class="section-body">
              <div style="display:flex; align-items:center; gap:14px; padding-bottom:6px; border-bottom:1px solid #e5e7eb; margin-bottom:4px;">
                <span style="font-size:8px; font-weight:600; color:#374151;">Monitoring Interval:</span>
                <span style="display:inline-flex; align-items:center; gap:4px; font-size:8px; color:#111827;">
                  <span class="radio-dot">${h.io_interval === "4h" ? '<span class="radio-dot-inner"></span>' : ""}</span>
                  4 hours
                </span>
                <span style="display:inline-flex; align-items:center; gap:4px; font-size:8px; color:#111827;">
                  <span class="radio-dot">${!h.io_interval || h.io_interval === "6h" ? '<span class="radio-dot-inner"></span>' : ""}</span>
                  6 hours
                </span>
              </div>
              
              <div style="margin-top:4px;">
                <div style="font-size:9px; font-weight:700; color:#374151; margin-bottom:2px;">Urine Output (I/O)</div>
                <div style="font-size:7px; color:#6b7280; line-height:1.35; margin-bottom:4px; padding:3px 5px; background:#f9fafb; border-radius:3px; border:1px solid #e5e7eb;">
                  <strong style="color:#374151;">How to read:</strong>
                  Each time block shows <strong>Total ml</strong> (volume in that interval) and <strong>ml/kg/hr</strong> (output ÷ patient weight ÷ hours).
                  <br/>Goal ≥ 1 ml/kg/hr &nbsp;|&nbsp; ⚑ &lt; 0.5 ml/kg/hr for 6 hrs = medical alert &nbsp;|&nbsp; +value = net positive (intake &gt; output) &nbsp;|&nbsp; −value = net negative
                </div>
                ${
                  h.io_interval === "4h"
                    ? renderGuIoGrid(
                        ioValues,
                        [
                          {
                            label: "00-04h",
                            intervalKey: "io_00_04",
                            intervalKgHrKey: "io_00_04_kghr",
                            runningKey: "io_00_04_last6h",
                            runningKgHrKey: "io_00_04_last6h_kghr",
                          },
                          {
                            label: "04-08h",
                            intervalKey: "io_04_08",
                            intervalKgHrKey: "io_04_08_kghr",
                            runningKey: "io_04_08_last6h",
                            runningKgHrKey: "io_04_08_last6h_kghr",
                          },
                          {
                            label: "08-12h",
                            intervalKey: "io_08_12",
                            intervalKgHrKey: "io_08_12_kghr",
                            runningKey: "io_08_12_last6h",
                            runningKgHrKey: "io_08_12_last6h_kghr",
                          },
                          {
                            label: "12-16h",
                            intervalKey: "io_12_16",
                            intervalKgHrKey: "io_12_16_kghr",
                            runningKey: "io_12_16_last6h",
                            runningKgHrKey: "io_12_16_last6h_kghr",
                          },
                          {
                            label: "16-20h",
                            intervalKey: "io_16_20",
                            intervalKgHrKey: "io_16_20_kghr",
                            runningKey: "io_16_20_last6h",
                            runningKgHrKey: "io_16_20_last6h_kghr",
                          },
                          {
                            label: "20-24h",
                            intervalKey: "io_20_24",
                            intervalKgHrKey: "io_20_24_kghr",
                            runningKey: "io_20_24_last6h",
                            runningKgHrKey: "io_20_24_last6h_kghr",
                          },
                        ],
                        "last 4h ml",
                      )
                    : renderGuIoGrid(
                        ioValues,
                        [
                          {
                            label: "00-06h",
                            intervalKey: "io_00",
                            intervalKgHrKey: "io_00_kghr",
                            runningKey: "io_00_last6h",
                            runningKgHrKey: "io_00_last6h_kghr",
                          },
                          {
                            label: "06-12h",
                            intervalKey: "io_06",
                            intervalKgHrKey: "io_06_kghr",
                            runningKey: "io_06_last6h",
                            runningKgHrKey: "io_06_last6h_kghr",
                          },
                          {
                            label: "12-18h",
                            intervalKey: "io_12",
                            intervalKgHrKey: "io_12_kghr",
                            runningKey: "io_12_last6h",
                            runningKgHrKey: "io_12_last6h_kghr",
                          },
                          {
                            label: "18-24h",
                            intervalKey: "io_18",
                            intervalKgHrKey: "io_18_kghr",
                            runningKey: "io_18_last6h",
                            runningKgHrKey: "io_18_last6h_kghr",
                          },
                        ],
                        "last 6h ml",
                      )
                }
              </div>

              <div style="display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin-top:8px; padding-top:6px; border-top:1px solid #e5e7eb;">
                <span class="cb"><span class="cb-box">${h.foley ? "✓" : ""}</span> Foley</span>
                <div class="field" style="margin-bottom:0;"><div class="field-label">SG</div><div class="gu-input-box" style="min-width:42px;">${inputLikeValue(h.urine_sg, "")}</div></div>
                <div class="field" style="margin-bottom:0;"><div class="field-label">Ph</div><div class="gu-input-box" style="min-width:42px;">${inputLikeValue(h.urine_ph, "")}</div></div>
                <div class="field" style="margin-bottom:0;"><div class="field-label">OB</div><div class="gu-input-box" style="min-width:42px;">${inputLikeValue(h.urine_ob, "")}</div></div>
                <div class="field" style="margin-bottom:0;"><div class="field-label">Gluc</div><div class="gu-input-box" style="min-width:42px;">${inputLikeValue(h.urine_glucose, "")}</div></div>
                <div class="field" style="margin-bottom:0;"><div class="field-label">Ket</div><div class="gu-input-box" style="min-width:42px;">${inputLikeValue(h.urine_ketones, "")}</div></div>
              </div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">Neurological</div>
            <div class="section-body">
              <div class="inline-fields">
                <span class="cb"><span class="cb-box">${h.neuro_normal ? "✓" : ""}</span> Normal</span>
                <span class="cb"><span class="cb-box">${h.altered_loc ? "✓" : ""}</span> Altered LOC</span>
                <span class="cb"><span class="cb-box">${h.confusion ? "✓" : ""}</span> Confusion</span>
                <span class="cb"><span class="cb-box">${h.speech_changes ? "✓" : ""}</span> Speech changes</span>
                <span class="cb"><span class="cb-box">${h.vp_shunt ? "✓" : ""}</span> VP Shunt</span>
              </div>
              <div class="two-col" style="margin-top:3px">
                <div class="field"><div class="field-label">Glasgow</div><div class="field-value">${f(h.glasgow_score)}</div></div>
                <div class="field"><div class="field-label">GCS</div><div class="field-value">${f(h.gcs_score)}</div></div>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Notes</div><div class="field-value">${f(h.neuro_notes)}</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Resp / Cardio</div>
            <div class="section-body">
              <div class="field"><div class="field-label">Lungs</div><div class="field-value">${f(h.lung_assessment)}</div></div>
              <div class="two-col" style="margin-top:3px">
                <div class="field"><div class="field-label">Oxygen</div><div class="field-value">${f(h.oxygen)}</div></div>
                <div class="field"><div class="field-label">Cardiovascular Assessment</div><div class="field-value">${f(h.cardiovascular)}</div></div>
              </div>
              <div class="inline-fields" style="margin-top:3px; padding-top:3px; border-top:1px solid #e5e7eb;">
                <span style="font-size:8px; font-weight:bold; color:#6b7280;">Chest tube:</span>
                <span class="cb"><span class="cb-box">${h.chest_tube_left ? "✓" : ""}</span> L</span>
                <span class="cb"><span class="cb-box">${h.chest_tube_right ? "✓" : ""}</span> R</span>
                <span style="font-size:8px; color:#6b7280; margin-left:6px;">Type:</span>
                <span class="cb"><span class="cb-box">${h.chest_tube_type_lws ? "✓" : ""}</span> LWS</span>
                <span class="cb"><span class="cb-box">${h.chest_tube_type_sd ? "✓" : ""}</span> SD</span>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Heart Rate Notes</div><div class="field-value">${f(h.heart_rate_notes)}</div></div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">G.I.</div>
            <div class="section-body">
              <div class="inline-fields">
                <span class="cb"><span class="cb-box">${h.gi_tenderness ? "✓" : ""}</span> Abnormal tenderness</span>
                <span class="cb"><span class="cb-box">${h.gi_distention ? "✓" : ""}</span> Distention</span>
              </div>
              ${h.gi_girth ? `<div style="margin-top:3px"><span style="font-weight:600;">Girth:</span> ${h.gi_girth}</div>` : ""}
              <div style="margin-top:3px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <span class="cb"><span class="cb-box">${h.vomiting ? "✓" : ""}</span> Vomiting</span>
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:8px; color:#4b5563;">Quantity:</span>
                  <div style="display:inline-block; padding:4px 10px; border:1px solid #d1d5db; border-radius:3px; background:#fff; font-size:9px; min-width:80px; min-height:20px;">${h.vomiting_quantity || ""}</div>
                </div>
                <span class="cb"><span class="cb-box">${h.nausea ? "✓" : ""}</span> Nausea</span>
              </div>
              <div style="margin-top:3px; padding:8px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px;">
                <div style="font-size:8px; font-weight:600; color:#374151; margin-bottom:6px;">Last Bowel Movement</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                  <div><span style="font-size:8px; font-weight:500; color:#4b5563;">Date:</span> <span style="font-size:9px;">${h.last_bowel_movement || ""}</span></div>
                  <div><span style="font-size:8px; font-weight:500; color:#4b5563;">Amount:</span> <span style="font-size:9px;">${h.bowel_amount || ""}</span></div>
                </div>
                <div><span style="font-size:8px; font-weight:500; color:#4b5563;">Description:</span> <span style="font-size:9px;">${h.bowel_description || ""}</span></div>
              </div>
              <div class="inline-fields" style="margin-top:3px">
                <span class="cb"><span class="cb-box">${h.constipation ? "✓" : ""}</span> Constipation</span>
                <span class="cb"><span class="cb-box">${h.diarrhea ? "✓" : ""}</span> Diarrhea${h.diarrhea_quantity ? " (" + h.diarrhea_quantity + ")" : ""}</span>
                <span class="cb"><span class="cb-box">${h.colostomy ? "✓" : ""}</span> Colostomy</span>
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Nutrition</div>
            <div class="section-body">
              <div class="two-col">
                <div class="field"><div class="field-label">Diet</div><div class="field-value">${f(h.diet)}</div></div>
                <div class="field"><div class="field-label">Weight</div><div class="field-value">${f(h.weight)}</div></div>
              </div>
              
              <div style="margin-top:4px; padding-top:4px; border-top:1px solid #e5e7eb;">
                <div class="field-label" style="margin-bottom:2px">Fluid Intake</div>
                <div class="four-col">
                  <div class="field"><div class="field-label">PO</div><div class="input-box">${f(h.fluid_intake_po)}</div></div>
                  <div class="field"><div class="field-label">IV</div><div class="input-box">${f(h.fluid_intake_iv)}</div></div>
                  <div class="field"><div class="field-label">NG</div><div class="input-box">${f(h.fluid_intake_ng)}</div></div>
                  <div class="field">
                    <div class="field-label">Total</div>
                    <div style="font-weight:600; color:#1d4ed8; background:#dbeafe; padding:2px 6px; border-radius:3px; font-size:10px;">
                      ${h.total_fluid || "0 ml"}
                    </div>
                  </div>
                </div>
              </div>

              <div style="margin-top:4px; padding-top:4px; border-top:1px solid #e5e7eb;">
                <div class="two-col">
                  <div class="field">
                    <span class="cb"><span class="cb-box">${h.formula_checkbox ? "✓" : ""}</span> Formula</span>
                    ${h.formula ? `<div class="input-box" style="margin-top:2px">${h.formula}</div>` : '<div class="input-box" style="margin-top:2px"></div>'}
                  </div>
                  <div class="field">
                    <span class="cb"><span class="cb-box">${h.breast_milk ? "✓" : ""}</span> Breast Milk</span>
                  </div>
                </div>
              </div>

              <div style="margin-top:4px; padding-top:4px; border-top:1px solid #e5e7eb;">
                <div class="two-col">
                  <div class="field">
                    <span class="cb"><span class="cb-box">${h.continuous_feeding ? "✓" : ""}</span> Continuous</span>
                    ${h.continuous_feeding_rate ? `<div class="input-box" style="margin-top:2px">${h.continuous_feeding_rate} ml/h</div>` : '<div class="input-box" style="margin-top:2px"></div>'}
                  </div>
                  <div class="field">
                    <span class="cb"><span class="cb-box">${h.bolus_feeding ? "✓" : ""}</span> Bolus</span>
                    ${h.bolus_amount ? `<div class="input-box" style="margin-top:2px">${h.bolus_amount}</div>` : '<div class="input-box" style="margin-top:2px"></div>'}
                  </div>
                </div>
              </div>

              <div style="margin-top:4px; padding-top:4px; border-top:1px solid #e5e7eb;">
                <div class="inline-fields">
                  <span class="cb"><span class="cb-box">${h.ng_tube ? "✓" : ""}</span> NG</span>
                  <span class="cb"><span class="cb-box">${h.nj_tube ? "✓" : ""}</span> NJ</span>
                  <span class="cb"><span class="cb-box">${h.gt_tube ? "✓" : ""}</span> GT</span>
                  <span class="cb"><span class="cb-box">${h.npo ? "✓" : ""}</span> NPO</span>
                </div>
                ${h.feeding_goal ? `<div class="field" style="margin-top:3px"><div class="field-label">Goal</div><div class="input-box">${h.feeding_goal}</div></div>` : '<div class="field" style="margin-top:3px"><div class="field-label">Goal</div><div class="input-box"></div></div>'}
                ${h.see_feeding_schedule ? '<div style="margin-top:3px; font-size:9px; color:#1d4ed8;">ℹ️ See feeding schedule</div>' : ""}
              </div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">Musculoskeletal</div>
            <div class="section-body">
              <div class="field"><div class="field-label">Activity Level</div><div class="field-value">${f(h.activity)}</div></div>
              <div class="field"><div class="field-label">Assistive Devices</div><div class="field-value">${f(h.assistive_devices)}</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Skin</div>
            <div class="section-body">
              <div class="two-col">
                <div class="field"><div class="field-label">Braden Q Score</div><div class="field-value">${f(h.braden_q_score)}</div></div>
                <div class="field"><div class="field-label">Skin Assessment</div><div class="field-value">${f(h.skin_assessment)}</div></div>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Skin Care Plan</div><div class="field-value">${f(h.skin_care_plan)}</div></div>
              <div class="three-col" style="margin-top:3px">
                <div class="field"><div class="field-label">Pressure Sore Stage</div><div class="field-value">${f(h.pressure_sore_stage)}</div></div>
                <div class="field"><div class="field-label">Location</div><div class="field-value">${f(h.pressure_sore_location)}</div></div>
                <div class="field"><div class="field-label">Treatment</div><div class="field-value">${f(h.pressure_sore_treatment)}</div></div>
              </div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section">
            <div class="section-title">Psycho-Social</div>
            <div class="section-body">
              <div class="field"><div class="field-label">Patient/Family Concerns</div><div class="field-value">${f(h.psychosocial_notes)}</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Discharge Planning</div>
            <div class="section-body">
              <div class="three-col">
                <div class="field"><div class="field-label">Expected D/C</div><div class="field-value">${f(h.expected_discharge_date)}</div></div>
                <div class="field" style="grid-column:span 2"><div class="field-label">Teaching</div><div class="field-value">${f(h.discharge_teaching)}</div></div>
              </div>
              <div class="field" style="margin-top:3px"><div class="field-label">Home Enteral Feeding</div><div class="field-value">${f(h.home_enteral_feeding)}</div></div>
              <div class="field"><div class="field-label">Prescriptions</div><div class="field-value">${f(h.discharge_prescriptions)}</div></div>
              <div class="field"><div class="field-label">Follow-up Appts</div><div class="field-value">${f(h.followup_appointments)}</div></div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="section todo-section">
            <div class="section-title">To Do</div>
            <div class="section-body">
              <div class="field-value">${f(h.todo_items)}</div>
            </div>
          </div>
          <div class="section todo-section">
            <div class="section-title">Follow Up</div>
            <div class="section-body">
              <div class="field-value">${f(h.followup_items)}</div>
            </div>
          </div>
        </div>

      </body>
    </html>
  `;
}

export function printHandover(h: Handover, p: Patient): void {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(generatePrintHtml(h, p));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
}
