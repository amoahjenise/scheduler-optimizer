const fs = require("fs");

const inputPath =
  "/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/shared_input_from_chat.csv";
const outputPath =
  "/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/good_output_from_shared_input.csv";

const DAY_CODES = new Set(["Z07", "07", "11", "E15"]);
const NIGHT_CODES = new Set(["Z19", "Z23", "Z23 B", "23"]);
const WORK_CODES = new Set([...DAY_CODES, ...NIGHT_CODES]);

function parseCsv(content) {
  return content
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.split(","));
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

function canAssign(schedule, fixed, nurseIdx, dayIdx, code) {
  if (schedule[nurseIdx][dayIdx] !== "") return false;
  if (fixed[nurseIdx][dayIdx]) return false;

  const type = shiftType(code);
  const prev = dayIdx > 0 ? schedule[nurseIdx][dayIdx - 1] : "";
  const next =
    dayIdx < schedule[nurseIdx].length - 1
      ? schedule[nurseIdx][dayIdx + 1]
      : "";

  if (type === "day" && shiftType(prev) === "night") return false;
  if (type === "night" && shiftType(next) === "day") return false;

  let run = 1;
  let i = dayIdx - 1;
  while (i >= 0 && isWorking(schedule[nurseIdx][i])) {
    run++;
    i--;
  }
  i = dayIdx + 1;
  while (i < schedule[nurseIdx].length && isWorking(schedule[nurseIdx][i])) {
    run++;
    i++;
  }
  if (run > 3) return false;

  return true;
}

function nurseHours(row) {
  let c = 0;
  for (const code of row) {
    if (isWorking(code)) c++;
  }
  return c * 8;
}

const raw = fs.readFileSync(inputPath, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const dateCols = header.slice(1);
const nurses = rows.slice(1);

const names = nurses.map((r) => r[0]);
const D = dateCols.length;
const N = names.length;

const schedule = nurses.map((r) => {
  const out = [];
  for (let d = 0; d < D; d++) {
    out.push(sanitizeCell(r[d + 1] || ""));
  }
  return out;
});

const fixed = nurses.map((r, ni) => {
  const arr = [];
  for (let d = 0; d < D; d++) {
    arr.push(schedule[ni][d] !== "");
  }
  return arr;
});

const tailSet = new Set(["Z19", "Z23", "Z23 B", "23"]);
for (let i = 0; i < N; i++) {
  for (let d = 0; d < D - 1; d++) {
    if (tailSet.has(schedule[i][d]) && schedule[i][d + 1] === "Z23") {
      schedule[i][d + 1] = "";
      fixed[i][d + 1] = false;
    }
  }
}

const targetHours = (75 / 14) * D;

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

function pickCandidate(dayIdx, code) {
  const candidates = [];
  for (let i = 0; i < N; i++) {
    if (!canAssign(schedule, fixed, i, dayIdx, code)) continue;
    const hrs = nurseHours(schedule[i]);
    const deficit = targetHours - hrs;
    candidates.push({ i, deficit, hrs });
  }
  candidates.sort((a, b) => {
    if (b.deficit !== a.deficit) return b.deficit - a.deficit;
    return a.hrs - b.hrs;
  });
  return candidates.length ? candidates[0].i : -1;
}

function fillCoverage() {
  for (let d = 0; d < D; d++) {
    let counts = dayCounts(d);

    while (counts.day < 5) {
      const idx = pickCandidate(d, "Z07");
      if (idx < 0) break;
      schedule[idx][d] = "Z07";
      counts.day++;
    }

    while (counts.night < 4) {
      const idx = pickCandidate(d, "Z23");
      if (idx < 0) break;
      schedule[idx][d] = "Z23";
      counts.night++;
    }
  }
}

fillCoverage();

for (let round = 0; round < 3; round++) {
  for (let i = 0; i < N; i++) {
    let hrs = nurseHours(schedule[i]);
    if (hrs >= targetHours) continue;

    for (let d = 0; d < D; d++) {
      if (schedule[i][d] !== "" || fixed[i][d]) continue;
      const counts = dayCounts(d);
      const tryCodes =
        counts.day <= counts.night ? ["Z07", "Z23"] : ["Z23", "Z07"];
      let assigned = false;
      for (const c of tryCodes) {
        if (canAssign(schedule, fixed, i, d, c)) {
          schedule[i][d] = c;
          assigned = true;
          break;
        }
      }
      if (assigned) {
        hrs = nurseHours(schedule[i]);
        if (hrs >= targetHours) break;
      }
    }
  }
}

function enforceConstraints() {
  for (let i = 0; i < N; i++) {
    // no day shift immediately after a night shift
    for (let d = 1; d < D; d++) {
      if (
        shiftType(schedule[i][d - 1]) === "night" &&
        shiftType(schedule[i][d]) === "day"
      ) {
        if (!fixed[i][d]) schedule[i][d] = "";
        else if (!fixed[i][d - 1]) schedule[i][d - 1] = "";
      }
    }

    // max consecutive working days = 3
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
          if (!fixed[i][k]) {
            schedule[i][k] = "";
            len--;
          }
        }
      }
    }
  }
}

enforceConstraints();
fillCoverage();

const out = [];
out.push(["Nurse", ...dateCols].join(","));
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
const totalHours = schedule.reduce((s, r) => s + nurseHours(r), 0);
const avgAbsDelta =
  schedule.reduce((s, r) => s + Math.abs(nurseHours(r) - targetHours), 0) / N;

console.log(
  JSON.stringify(
    {
      outputPath,
      nurses: N,
      days: D,
      coveragePercent: Number(coveragePercent.toFixed(2)),
      daysMeetingCoverage: daysMeeting,
      totalHours,
      avgAbsHourDeltaVsTarget: Number(avgAbsDelta.toFixed(2)),
      preview: out.slice(0, 5),
    },
    null,
    2,
  ),
);
