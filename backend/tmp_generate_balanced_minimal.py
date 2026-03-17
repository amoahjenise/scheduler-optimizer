import csv
import json
import re

input_path = "/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/shared_input_from_chat.csv"
output_path = "/Users/graandzenizer/Desktop/Dev/scheduler-optimizer/good_output_balanced_minimal.csv"

DAY_CODES = {"Z07", "07", "11", "E15"}
NIGHT_CODES = {"Z19", "Z23", "Z23 B", "23"}
WORK_CODES = DAY_CODES | NIGHT_CODES
PUNCT_RE = re.compile(r"^[.\-—_]+$")


def norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def sanitize(raw: str) -> str:
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    if PUNCT_RE.fullmatch(s):
        return ""

    s = norm_spaces(s.upper())

    if re.fullmatch(r"\*+", s):
        return "OFF"

    if re.fullmatch(r"CF\*+", s) or s == "CF" or s.startswith("CF "):
        return "OFF/C"

    no_star = norm_spaces(s.replace("*", ""))
    if not no_star:
        return "OFF"

    if no_star == "R":
        return ""
    if no_star in {"23 B", "Z23B"}:
        return "Z23 B"
    if no_star in {"OFF", "OFF/C"}:
        return no_star
    if no_star in WORK_CODES:
        return no_star

    return ""


def shift_type(code: str) -> str:
    if code in DAY_CODES:
        return "day"
    if code in NIGHT_CODES:
        return "night"
    return "off"


def is_work(code: str) -> bool:
    return code in WORK_CODES


def can_assign(schedule, fixed, nurse_idx, day_idx, code):
    if schedule[nurse_idx][day_idx] != "" or fixed[nurse_idx][day_idx]:
        return False

    st = shift_type(code)
    prev = schedule[nurse_idx][day_idx - 1] if day_idx > 0 else ""
    nxt = schedule[nurse_idx][day_idx + 1] if day_idx < len(schedule[nurse_idx]) - 1 else ""

    if st == "day" and shift_type(prev) == "night":
        return False
    if st == "night" and shift_type(nxt) == "day":
        return False

    run = 1
    i = day_idx - 1
    while i >= 0 and is_work(schedule[nurse_idx][i]):
        run += 1
        i -= 1

    i = day_idx + 1
    while i < len(schedule[nurse_idx]) and is_work(schedule[nurse_idx][i]):
        run += 1
        i += 1

    return run <= 3


def nurse_hours(row):
    return sum(8 for code in row if is_work(code))


with open(input_path, newline="", encoding="utf-8") as f:
    rows = list(csv.reader(f))

header = rows[0]
dates = header[1:]
name_rows = rows[1:]

names = [r[0] for r in name_rows]
N = len(names)
D = len(dates)

schedule = []
for row in name_rows:
    schedule.append([sanitize(row[d + 1] if d + 1 < len(row) else "") for d in range(D)])

fixed = [[cell != "" for cell in row] for row in schedule]

night_tail = {"Z19", "Z23", "Z23 B", "23"}
for i in range(N):
    for d in range(D - 1):
        if schedule[i][d] in night_tail and schedule[i][d + 1] == "Z23":
            schedule[i][d + 1] = ""
            fixed[i][d + 1] = False


def day_counts(day_idx):
    day = 0
    night = 0
    for i in range(N):
        st = shift_type(schedule[i][day_idx])
        if st == "day":
            day += 1
        elif st == "night":
            night += 1
    return day, night


added_count = [0] * N


def pick_candidate(day_idx, code):
    cands = []
    for i in range(N):
        if not can_assign(schedule, fixed, i, day_idx, code):
            continue
        cands.append((added_count[i], nurse_hours(schedule[i]), i))
    cands.sort()
    return cands[0][2] if cands else -1


for d in range(D):
    day, night = day_counts(d)

    while day < 5:
        idx = pick_candidate(d, "Z07")
        if idx < 0:
            break
        schedule[idx][d] = "Z07"
        added_count[idx] += 1
        day += 1

    while night < 4:
        idx = pick_candidate(d, "Z23")
        if idx < 0:
            break
        schedule[idx][d] = "Z23"
        added_count[idx] += 1
        night += 1


def coverage_metrics():
    days_meeting = 0
    covered_slots = 0
    for d in range(D):
        day, night = day_counts(d)
        if day >= 5 and night >= 4:
            days_meeting += 1
        covered_slots += min(day, 5) + min(night, 4)
    required = D * 9
    pct = (covered_slots / required * 100.0) if required else 0.0
    return days_meeting, pct


viol_consec = 0
viol_day_after_night = 0
for i in range(N):
    run = 0
    for d in range(D):
        code = schedule[i][d]
        if is_work(code):
            run += 1
            if run > 3:
                viol_consec += 1
        else:
            run = 0

        if d > 0 and shift_type(schedule[i][d - 1]) == "night" and shift_type(code) == "day":
            viol_day_after_night += 1

out_rows = [["Nurse", *dates]]
for i, name in enumerate(names):
    out_rows.append([name, *schedule[i]])

with open(output_path, "w", newline="", encoding="utf-8") as f:
    csv.writer(f).writerows(out_rows)

days_meeting, coverage_pct = coverage_metrics()
total_hours = sum(nurse_hours(r) for r in schedule)

first6 = []
with open(output_path, encoding="utf-8") as f:
    for _ in range(6):
        line = f.readline()
        if not line:
            break
        first6.append(line.rstrip("\n"))

print(
    json.dumps(
        {
            "outputPath": output_path,
            "nurses": N,
            "days": D,
            "coverageDays": days_meeting,
            "coveragePercent": round(coverage_pct, 2),
            "totalHours": total_hours,
            "violations": {
                "consecutive_gt_3": viol_consec,
                "day_after_night": viol_day_after_night,
            },
            "first6": first6,
        },
        indent=2,
    )
)
