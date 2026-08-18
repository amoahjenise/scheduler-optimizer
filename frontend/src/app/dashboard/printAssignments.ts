import type { Handover } from "../lib/api";

export interface PrintShift {
  nurse: string;
  shiftType: string;
  shiftTime: string;
  hours: number;
}

/** Minimal roster info needed to print correct names and roles. */
export interface PrintRosterEntry {
  name: string;
  staffing_role?: "nurse" | "assistant_manager" | null;
}

export type PrintShiftSelection = "day" | "night";
export type PrintLayoutMode = "separate" | "stacked";

export interface PrintScheduleDay {
  date: string;
  dayStaff: PrintShift[];
  nightStaff: PrintShift[];
  dayHandovers: Handover[];
  nightHandovers: Handover[];
}

export interface PrintAssignmentsInput {
  organizationName: string;
  locale: string;
  scheduleDays: PrintScheduleDay[];
  /** Roster used to show real nurse names and flag assistant managers. */
  roster?: PrintRosterEntry[];
  /** Optional single-page reprint (date, and optionally shift). */
  specificPage?: { date: string; shift?: PrintShiftSelection };
  layoutMode?: PrintLayoutMode;
  labels: {
    dayShift: string;
    nightShift: string;
    role: string;
    nurse: string;
    shift: string;
    patientAssignments: string;
    nursesCount: string;
    noNursingStaffScheduled: string;
    noPatientAssigned: string;
    notOnSchedule: string;
    unassigned: string;
    unnamedPatient: string;
    assistantManager: string;
    assistantManagers: string;
    assistantManagerNote: string;
    derivedFromHandovers: string;
    confidentialFooter: string;
    printBlockedPopup: string;
    pageLabel: string;
    pageOfLabel: string;
    printFullPeriod: string;
    printSinglePage: string;
    roleNurse: string;
    roleAssistantManager: string;
  };
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

function findRosterEntry(
  name: string,
  roster: PrintRosterEntry[],
): PrintRosterEntry | undefined {
  return roster.find((entry) => sameNurse(entry.name, name));
}

/**
 * Hand-off reports can carry the author's account name. The printed sheet must
 * always show the roster nurse name instead.
 */
function resolveNurseName(name: string, roster: PrintRosterEntry[]): string {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return findRosterEntry(raw, roster)?.name || raw;
}

function isAssistantManager(name: string, roster: PrintRosterEntry[]): boolean {
  return findRosterEntry(name, roster)?.staffing_role === "assistant_manager";
}

/** Renders as: `Rm B7.04 · Samantha Jane (Nurse Name)` */
function patientLabel(
  h: Handover,
  roster: PrintRosterEntry[],
  labels: PrintAssignmentsInput["labels"],
): string {
  const patientName = [h.p_first_name, h.p_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const room = [h.p_room_number, h.p_bed].filter(Boolean).join("-");

  const parts: string[] = [];
  if (room) parts.push(`Rm ${room}`);
  parts.push(patientName || labels.unnamedPatient);

  const nurseName = resolveNurseName(h.outgoing_nurse || "", roster);
  return `${parts.join(" · ")} (${nurseName || labels.unassigned})`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleForName(
  name: string,
  roster: PrintRosterEntry[],
): "assistant_manager" | "nurse" {
  return isAssistantManager(name, roster) ? "assistant_manager" : "nurse";
}

function buildAssistantManagerBlock(
  staff: PrintShift[],
  labels: PrintAssignmentsInput["labels"],
): string {
  if (!staff.length) return "";

  const items = staff
    .map(
      (shift) =>
        `<li>${escapeHtml(shift.nurse)} <span class="time">${escapeHtml(
          shift.shiftTime || `${shift.hours}h`,
        )}</span></li>`,
    )
    .join("");

  return `
    <div class="assistant-managers">
      <h3>${escapeHtml(
        staff.length > 1
          ? labels.assistantManagers
          : labels.assistantManager,
      )}</h3>
      <ul class="inline">${items}</ul>
      <p class="note">${escapeHtml(labels.assistantManagerNote)}</p>
    </div>`;
}

function buildSection(
  title: string,
  staff: PrintShift[],
  handovers: Handover[],
  roster: PrintRosterEntry[],
  labels: PrintAssignmentsInput["labels"],
): string {
  // Assistant managers are shown, but separately from the nurse assignment grid.
  const assistantManagers = staff.filter((s) =>
    isAssistantManager(s.nurse, roster),
  );
  const nurseStaff = staff.filter((s) => !isAssistantManager(s.nurse, roster));

  if (nurseStaff.length === 0 && handovers.length === 0) {
    return `<section><h2>${escapeHtml(title)}</h2>${buildAssistantManagerBlock(
      assistantManagers,
      labels,
    )}<p class="empty">${escapeHtml(labels.noNursingStaffScheduled)}</p></section>`;
  }

  const used = new Set<Handover>();
  const rows = nurseStaff.map((shift) => {
    const assigned = handovers.filter((h) => {
      if (used.has(h)) return false;
      if (!sameNurse(shift.nurse, h.outgoing_nurse)) return false;
      used.add(h);
      return true;
    });

    const patients = assigned.length
      ? `<ul>${assigned
          .map((h) => `<li>${escapeHtml(patientLabel(h, roster, labels))}</li>`)
          .join("")}</ul>`
      : `<span class="none">${escapeHtml(labels.noPatientAssigned)}</span>`;

    return `
      <tr>
        <td class="nurse">${escapeHtml(resolveNurseName(shift.nurse, roster))}</td>
        <td class="role">${escapeHtml(
          roleForName(shift.nurse, roster) === "assistant_manager"
            ? labels.roleAssistantManager
            : labels.roleNurse,
        )}</td>
        <td class="time">${escapeHtml(shift.shiftTime || `${shift.hours}h`)}</td>
        <td>${patients}</td>
      </tr>`;
  });

  // Handovers whose nurse isn't on the schedule still need to be visible.
  const unmatched = handovers.filter((h) => !used.has(h));
  if (unmatched.length) {
    rows.push(`
      <tr>
        <td class="nurse">${escapeHtml(labels.notOnSchedule)}</td>
        <td class="role">—</td>
        <td class="time">—</td>
        <td><ul>${unmatched
          .map((h) => `<li>${escapeHtml(patientLabel(h, roster, labels))}</li>`)
          .join("")}</ul></td>
      </tr>`);
  }

  return `
    <section>
      <h2>${escapeHtml(title)} <span class="count">${nurseStaff.length} ${escapeHtml(labels.nursesCount)}</span></h2>
      ${buildAssistantManagerBlock(assistantManagers, labels)}
      <table>
        <thead>
          <tr><th style="width:24%">${escapeHtml(labels.nurse)}</th><th style="width:18%">${escapeHtml(labels.role)}</th><th style="width:16%">${escapeHtml(labels.shift)}</th><th>${escapeHtml(labels.patientAssignments)}</th></tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </section>`;
}

export function buildAssignmentSheetHtml(input: PrintAssignmentsInput): string {
  const roster = input.roster || [];
  const layoutMode = input.layoutMode || "separate";
  const sortedDays = [...input.scheduleDays].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const pages =
    layoutMode === "stacked"
      ? (input.specificPage
          ? sortedDays.filter((d) => d.date === input.specificPage?.date)
          : sortedDays
        ).map((d) => ({
          date: d.date,
          mode: "stacked" as const,
          title: `${input.labels.dayShift} + ${input.labels.nightShift}`,
          dayStaff: d.dayStaff,
          dayHandovers: d.dayHandovers,
          nightStaff: d.nightStaff,
          nightHandovers: d.nightHandovers,
        }))
      : input.specificPage
        ? sortedDays
            .filter((d) => d.date === input.specificPage?.date)
            .flatMap((d) => {
              const isDay = (input.specificPage?.shift || "day") === "day";
              return [
                {
                  date: d.date,
                  mode: "single" as const,
                  shift: input.specificPage?.shift || "day",
                  shiftLabel: isDay
                    ? input.labels.dayShift
                    : input.labels.nightShift,
                  staff: isDay ? d.dayStaff : d.nightStaff,
                  handovers: isDay ? d.dayHandovers : d.nightHandovers,
                },
              ];
            })
        : sortedDays.flatMap((d) => [
            {
              date: d.date,
              mode: "single" as const,
              shift: "day" as const,
              shiftLabel: input.labels.dayShift,
              staff: d.dayStaff,
              handovers: d.dayHandovers,
            },
            {
              date: d.date,
              mode: "single" as const,
              shift: "night" as const,
              shiftLabel: input.labels.nightShift,
              staff: d.nightStaff,
              handovers: d.nightHandovers,
            },
          ]);

  const renderedPages = pages
    .map((page, index) => {
      const dateLabel = new Date(`${page.date}T00:00:00`).toLocaleDateString(
        input.locale,
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        },
      );

      return `
      <article class="sheet ${index < pages.length - 1 ? "sheet-break" : ""}">
        <header>
          <h1>${escapeHtml(input.organizationName)} — ${escapeHtml(page.mode === "stacked" ? page.title : page.shiftLabel)}</h1>
          <div class="meta">${escapeHtml(dateLabel)}</div>
          <div class="meta">${escapeHtml(input.labels.pageLabel)} ${index + 1} ${escapeHtml(input.labels.pageOfLabel)} ${pages.length}</div>
        </header>
        ${
          page.mode === "stacked"
            ? `${buildSection(
                input.labels.dayShift,
                page.dayStaff,
                page.dayHandovers,
                roster,
                input.labels,
              )}${buildSection(
                input.labels.nightShift,
                page.nightStaff,
                page.nightHandovers,
                roster,
                input.labels,
              )}`
            : buildSection(
                page.shiftLabel,
                page.staff,
                page.handovers,
                roster,
                input.labels,
              )
        }
      </article>`;
    })
    .join("");

  const title = input.specificPage
    ? input.labels.printSinglePage
    : input.labels.printFullPeriod;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(input.organizationName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111; margin: 24px; }
  .sheet { page-break-inside: avoid; }
  .sheet-break { page-break-after: always; }
  header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; }
  section { margin-bottom: 22px; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 8px; background: #f1f3f5; padding: 6px 8px; border-radius: 4px; }
  h3 { font-size: 12px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: .03em; color: #444; }
  .count { font-weight: normal; color: #666; font-size: 12px; float: right; }
  .assistant-managers { border: 1px dashed #bbb; border-radius: 4px; padding: 8px; margin-bottom: 10px; background: #fcfcfc; }
  .assistant-managers .note { margin: 4px 0 0; font-size: 10px; color: #777; font-style: italic; }
  ul.inline { list-style: none; margin: 0; padding: 0; font-size: 12px; }
  ul.inline li { display: inline-block; margin-right: 14px; font-weight: 600; }
  ul.inline .time { font-weight: normal; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td.nurse { font-weight: 600; }
  td.role { font-weight: 500; color: #333; }
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
  ${renderedPages}
  <footer>
    ${escapeHtml(input.labels.derivedFromHandovers)}
    ${escapeHtml(input.labels.confidentialFooter)}
  </footer>
</body>
</html>`;
}

export function printAssignmentSheet(input: PrintAssignmentsInput): void {
  const html = buildAssignmentSheetHtml(input);
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert(input.labels.printBlockedPopup);
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Give the new document a tick to lay out before invoking the print dialog.
  setTimeout(() => printWindow.print(), 250);
}
