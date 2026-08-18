import type { Handover } from "../lib/api";

export interface PrintShift {
  nurse: string;
  shiftType: string;
  shiftTime: string;
  hours: number;
}

export interface PrintAssignmentsInput {
  organizationName: string;
  date: Date;
  locale: string;
  dayStaff: PrintShift[];
  nightStaff: PrintShift[];
  dayHandovers: Handover[];
  nightHandovers: Handover[];
}

function normalize(name: string): string {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Schedule rows and handover reports don't always spell a nurse the same way
 * (e.g. "Tiffany G." vs "Tiffany Glodoviza"). Treat them as the same person
 * when one name is a prefix of the other, or when the first name matches and
 * the surname initial agrees.
 */
function sameNurse(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const strip = (s: string) => s.replace(/\./g, "").trim();
  const sx = strip(x);
  const sy = strip(y);
  if (sx.startsWith(sy) || sy.startsWith(sx)) return true;

  const [firstX, ...restX] = sx.split(" ");
  const [firstY, ...restY] = sy.split(" ");
  if (firstX && firstX === firstY) {
    const lastX = restX.join(" ");
    const lastY = restY.join(" ");
    if (!lastX || !lastY) return true;
    if (lastX[0] === lastY[0]) return true;
  }
  return false;
}

function patientLabel(h: Handover): string {
  const name = [h.p_first_name, h.p_last_name].filter(Boolean).join(" ").trim();
  const room = [h.p_room_number, h.p_bed].filter(Boolean).join("-");
  const parts: string[] = [];
  if (room) parts.push(`Rm ${room}`);
  parts.push(name || "Unnamed patient");
  if (h.p_diagnosis) parts.push(h.p_diagnosis);
  return parts.join(" · ");
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSection(
  title: string,
  staff: PrintShift[],
  handovers: Handover[],
): string {
  if (staff.length === 0 && handovers.length === 0) {
    return `<section><h2>${escapeHtml(title)}</h2><p class="empty">No staff scheduled.</p></section>`;
  }

  const used = new Set<Handover>();
  const rows = staff.map((shift) => {
    const assigned = handovers.filter((h) => {
      if (used.has(h)) return false;
      if (!sameNurse(shift.nurse, h.outgoing_nurse)) return false;
      used.add(h);
      return true;
    });

    const patients = assigned.length
      ? `<ul>${assigned.map((h) => `<li>${escapeHtml(patientLabel(h))}</li>`).join("")}</ul>`
      : `<span class="none">No patient assigned</span>`;

    return `
      <tr>
        <td class="nurse">${escapeHtml(shift.nurse)}</td>
        <td class="time">${escapeHtml(shift.shiftTime || `${shift.hours}h`)}</td>
        <td>${patients}</td>
      </tr>`;
  });

  // Handovers whose nurse isn't on the schedule still need to be visible.
  const unmatched = handovers.filter((h) => !used.has(h));
  if (unmatched.length) {
    rows.push(`
      <tr>
        <td class="nurse">${escapeHtml("Not on schedule")}</td>
        <td class="time">—</td>
        <td><ul>${unmatched
          .map(
            (h) =>
              `<li>${escapeHtml(patientLabel(h))} <em>(${escapeHtml(h.outgoing_nurse || "unassigned")})</em></li>`,
          )
          .join("")}</ul></td>
      </tr>`);
  }

  return `
    <section>
      <h2>${escapeHtml(title)} <span class="count">${staff.length} staff</span></h2>
      <table>
        <thead>
          <tr><th style="width:26%">Nurse</th><th style="width:16%">Shift</th><th>Patient assignments</th></tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </section>`;
}

export function buildAssignmentSheetHtml(input: PrintAssignmentsInput): string {
  const dateLabel = input.date.toLocaleDateString(input.locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Shift Assignments — ${escapeHtml(dateLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111; margin: 24px; }
  header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; }
  section { margin-bottom: 22px; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 8px; background: #f1f3f5; padding: 6px 8px; border-radius: 4px; }
  .count { font-weight: normal; color: #666; font-size: 12px; float: right; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td.nurse { font-weight: 600; }
  td.time { white-space: nowrap; color: #444; }
  ul { margin: 0; padding-left: 16px; }
  li { margin-bottom: 2px; }
  .none, .empty { color: #888; font-style: italic; }
  footer { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 10px; color: #666; }
  @media print {
    body { margin: 12mm; }
    @page { size: portrait; }
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(input.organizationName)} — Shift Assignments</h1>
    <div class="meta">${escapeHtml(dateLabel)}</div>
  </header>
  ${buildSection("Day Shift", input.dayStaff, input.dayHandovers)}
  ${buildSection("Night Shift", input.nightStaff, input.nightHandovers)}
  <footer>
    Patient assignments are derived from today's hand-off reports.
    Confidential — contains PHI. Handle per HIPAA policy.
  </footer>
</body>
</html>`;
}

export function printAssignmentSheet(input: PrintAssignmentsInput): void {
  const html = buildAssignmentSheetHtml(input);
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert("Please allow pop-ups to print the assignment sheet.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Give the new document a tick to lay out before invoking the print dialog.
  setTimeout(() => printWindow.print(), 250);
}
