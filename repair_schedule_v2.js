const fs = require("fs");

const root = "/Users/graandzenizer/Desktop/Dev/scheduler-optimizer";
const inputPath = root + "/good_output_balanced_minimal.csv";
const ocrPath = root + "/shared_input_from_chat.csv";
const outputPath = root + "/good_output_balanced_minimal_v2.csv";

const DAY_CODES = new Set(["Z07", "07", "11", "E15"]);
const NIGHT_CODES = new Set(["Z19", "Z23", "Z23 B", "23"]);
const WORK_CODES = new Set([...DAY_CODES, ...NIGHT_CODES]);

function parseCsv(content) {
  return content
    .trimEnd()
    .split(/\r?\n/)
    .map((l) => l.split(","));
}

function normSpaces(s) {
  return s.replace(/\s+/g, " ").trim();
}

function sanitizeCell(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (/^[.\-—_]+$/.test(s)) return "";

  s = normSpaces(s.toUpperCase());
  if (/^\*+$/.test(s)) return "OFF";

  const noStar = normSpaces(s.replace(/\*/g, ""));
  if (!noStar) return "OFF";

  if (noStar === "23 B") return "Z23 B";
  if (noStar === "Z23B") return "Z23 B";
  if (noStar === "OFF") return "OFF";
  if (noStar === "R") return "R";

  if (WORK_CODES.has(noStar)) return noStar;
  return "";
}

function shiftType(code) {
  if (DAY_CODES.has(code)) return "day";
  if (NIGHT_CODES.has(code)) return "night";
  return "off";
}

function isWorking(code) {
  return WORK_CODES.has(code);
}

function nurseHours(row) {
  return row.reduce((sum, code) => sum + (isWorking(code) ? 8 : 0), 0);
}

const scheduleRows = parseCsv(fs.readFileSync(inputPath, "utf8"));
const ocrRows = parseCsv(fs.readFileSync(ocrPath, "utf8"));

const header = scheduleRows[0];
const dates = header.slice(1);
const D = dates.length;

const ocrByName = new Map();
for (const r of ocrRows.slice(1)) {
  ocrByName.set(r[0], r);
}

const names = [];
const schedule = [];
const fixed = [];

for (const r of scheduleRows.slice(1)) {
  const name = r[0];
  names.push(name);

  const o = ocrByName.get(name) || [];
  const row = [];
  const fix = [];

  for (let d = 0; d < D; d++) {
    const current = sanitizeCell(r[d + 1] || "");
    const ocr = sanitizeCell(o[d + 1] || "");

    if (ocr !== "") {
      row.push(ocr);
      fix.push(true);
    } else {
      row.push(current);
      fix.push(false);
    }
  }

  schedule.push(row);
  fixed.push(fix);
}

const N = names.length;

function dayCounts(dayIdx) {
  let day = 0;
  let night = 0;

  for (let i = 0; i < N; i++) {
    const t = shiftType(schedule[i][dayIdx]);
    if (t === "day") day++;
    else if (t === "night") night++;
  }

  return { day, night };
}

function canAssign(nurseIdx, dayIdx, code) {
  if (schedule[nurseIdx][dayIdx] !== "") return false;
  if (fixed[nurseIdx][dayIdx]) return false;

  const type = shiftType(code);
  const prev = dayIdx > 0 ? schedule[nurseIdx][dayIdx - 1] : "";
  const next = dayIdx < D - 1 ? schedule[nurseIdx][dayIdx + 1] : "";

  if (type === "day" && shiftType(prev) === "night") return false;
  if (type === "night" && shiftType(next) === "day") return false;

  let run = 1;
  let k = dayIdx - 1;
  while (k >= 0 && isWorking(schedule[nurseIdx][k])) {
    run++;
    k--;
  }

  k = dayIdx + 1;
  while (k < D && isWorking(schedule[nurseIdx][k])) {
    run++;
    k++;
  }

  if (run > 3) return false;
  return true;
}

function countViolations() {
  let dayAfterNight = 0;
  let consecutiveGt3 = 0;

  for (let i = 0; i < N; i++) {
    for (let d = 1; d < D; d++) {
      if (
        shiftType(schedule[i][d - 1]) === "night" &&
        shiftType(schedule[i][d]) === "day"
      ) {
        dayAfterNight++;
      }
    }

    let d = 0;
    while (d < D) {
      if (!isWorking(schedule[i][d])) {
        d++;
        continue;
      }

      const start = d;
      while (d < D && isWorking(schedule[i][d])) d++;
      const len = d - start;

      if (len > 3) {
        consecutiveGt3 += len - 3;
      }
    }
  }

  return { dayAfterNight, consecutiveGt3 };
}

function removeViolationsPreferNonFixed() {
  let changed = false;

  for (let i = 0; i < N; i++) {
    for (let d = 1; d < D; d++) {
      if (
        shiftType(schedule[i][d - 1]) === "night" &&
        shiftType(schedule[i][d]) === "day"
      ) {
        if (!fixed[i][d] && isWorking(schedule[i][d])) {
          schedule[i][d] = "";
          changed = true;
        } else if (!fixed[i][d - 1] && isWorking(schedule[i][d - 1])) {
          schedule[i][d - 1] = "";
          changed = true;
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    let d = 0;

    while (d < D) {
      if (!isWorking(schedule[i][d])) {
        d++;
        continue;
      }

      const start = d;
      while (d < D && isWorking(schedule[i][d])) d++;
      const end = d - 1;
      let len = end - start + 1;

      if (len > 3) {
        for (let k = end; k >= start && len > 3; k--) {
          if (!fixed[i][k] && isWorking(schedule[i][k])) {
            schedule[i][k] = "";
            len--;
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

function removeViolationsAllowFixed() {
  let changed = false;

  for (let i = 0; i < N; i++) {
    for (let d = 1; d < D; d++) {
      if (
        shiftType(schedule[i][d - 1]) === "night" &&
        shiftType(schedule[i][d]) === "day"
      ) {
        if (isWorking(schedule[i][d])) {
          schedule[i][d] = "";
          changed = true;
        } else if (isWorking(schedule[i][d - 1])) {
          schedule[i][d - 1] = "";
          changed = true;
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    let d = 0;

    while (d < D) {
      if (!isWorking(schedule[i][d])) {
        d++;
        continue;
      }

      const start = d;
      while (d < D && isWorking(schedule[i][d])) d++;
      const end = d - 1;
      let len = end - start + 1;

      if (len > 3) {
        for (let k = end; k >= start && len > 3; k--) {
          if (isWorking(schedule[i][k])) {
            schedule[i][k] = "";
            len--;
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

function pickCandidate(dayIdx, code) {
  const candidates = [];

  for (let i = 0; i < N; i++) {
    if (!canAssign(i, dayIdx, code)) continue;
    candidates.push({ i, hrs: nurseHours(schedule[i]) });
  }

  candidates.sort((a, b) => a.hrs - b.hrs);
  return candidates.length ? candidates[0].i : -1;
}

function refillCoverageIfNeeded() {
  let changed = false;

  for (let d = 0; d < D; d++) {
    let c = dayCounts(d);

    while (c.day < 5) {
      const i = pickCandidate(d, "Z07");
      if (i < 0) break;
      schedule[i][d] = "Z07";
      c.day++;
      changed = true;
    }

    while (c.night < 4) {
      const i = pickCandidate(d, "Z23");
      if (i < 0) break;
      schedule[i][d] = "Z23";
      c.night++;
      changed = true;
    }
  }

  return changed;
}

for (let iter = 0; iter < 12; iter++) {
  const removed = removeViolationsPreferNonFixed();
  const filled = refillCoverageIfNeeded();
  const v = countViolations();

  if (v.dayAfterNight === 0 && v.consecutiveGt3 === 0) break;
  if (!removed && !filled) break;
}

for (let iter = 0; iter < 12; iter++) {
  const vStart = countViolations();
  if (vStart.dayAfterNight === 0 && vStart.consecutiveGt3 === 0) break;

  const removed = removeViolationsAllowFixed();
  const filled = refillCoverageIfNeeded();
  const v = countViolations();

  if (v.dayAfterNight === 0 && v.consecutiveGt3 === 0) break;
  if (!removed && !filled) break;
}

const out = [];
out.push(["Nurse", ...dates].join(","));
for (let i = 0; i < N; i++) {
  out.push([names[i], ...schedule[i]].join(","));
}

fs.writeFileSync(outputPath, out.join("\n") + "\n", "utf8");

let daysMeeting = 0;
let coveredSlots = 0;
for (let d = 0; d < D; d++) {
  const c = dayCounts(d);
  if (c.day >= 5 && c.night >= 4) daysMeeting++;
  coveredSlots += Math.min(c.day, 5) + Math.min(c.night, 4);
}

const requiredSlots = D * 9;
const coveragePercent = requiredSlots
  ? (coveredSlots / requiredSlots) * 100
  : 0;
const v = countViolations();
const totalHours = schedule.reduce((sum, row) => sum + nurseHours(row), 0);

console.log(
  JSON.stringify(
    {
      outputPath,
      coverageDays: `${daysMeeting}/${D}`,
      coveragePercent: Number(coveragePercent.toFixed(2)),
      violations: {
        maxConsecutiveWorkDaysGt3: v.consecutiveGt3,
        dayShiftAfterNightShift: v.dayAfterNight,
      },
      totalHours,
      first6Lines: out.slice(0, 6),
    },
    null,
    2,
  ),
);
