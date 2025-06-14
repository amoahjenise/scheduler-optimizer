# /backend/app/api/routes/optimized_schedule.py
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import UUID4
from sqlalchemy.orm import Session
from typing import Dict, List
from app.db.deps import get_db
from app.core.config import settings
from app.models.optimized_schedule import OptimizedSchedule
from app.schemas.optimized_schedule import OptimizeRequest, OptimizeResponse
from openai import OpenAI
import json
import logging
from ortools.sat.python import cp_model
from app.api.routes.system_prompts import get_system_prompt
from datetime import datetime, timedelta
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

router = APIRouter(redirect_slashes=True)

client = OpenAI(
    api_key=settings.OPENAI_API_KEY,
    timeout=360.0
)

class ScheduleOptimizer:
    @staticmethod
    def validate_input_data(req: OptimizeRequest):
        if not req.dates:
            raise HTTPException(status_code=400, detail="Dates list cannot be empty")
        if not req.nurses:
            raise HTTPException(status_code=400, detail="Nurses list cannot be empty")
        if req.assignments:        
            for nurse, shifts in req.assignments.items():
                if len(shifts) != len(req.dates):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Assignment length for nurse {nurse} doesn't match dates length"
                    )
                for shift in shifts:
                    if shift and not isinstance(shift, str):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid shift code {shift} for nurse {nurse}"
                        )

    @staticmethod
    def build_prompt_for_constraints_parsing(req: OptimizeRequest, db: Session) -> str:
        prompt_template = get_system_prompt(db).content  # Access the content attribute

        nurses_json = json.dumps(
            [n.dict() if hasattr(n, "dict") else n for n in req.nurses],
            indent=2,
            ensure_ascii=False,
        )

        notes = req.notes or "No additional notes"
        comments_json = json.dumps(req.comments or {}, indent=2, ensure_ascii=False)

        return prompt_template.format(
            start_date=req.dates[0],
            end_date=req.dates[-1],
            nurses_list=nurses_json,
            notes=notes,
            comments_json=comments_json,
        )
    
    @staticmethod
    def parse_ai_response(raw_response: str) -> Dict:
        try:
            return json.loads(raw_response)
        except json.JSONDecodeError:
            try:
                json_str = raw_response.split("```")[1].strip()
                if json_str.startswith("json"):
                    json_str = json_str[4:].strip()
                return json.loads(json_str)
            except (IndexError, json.JSONDecodeError) as e:
                # logger.error(f"Failed to parse AI response: {e}\nResponse: {raw_response}")
                raise HTTPException(status_code=400, detail="Could not parse AI response as valid JSON")

    @staticmethod
    def create_fallback_schedule(assignments, constraints, date_list, nurses, day_shift_codes, night_shift_codes, shift_code_to_idx) -> Dict:
        num_days = len(date_list)
        num_nurses = len(nurses)
        day_count = constraints["shiftRequirements"]["dayShift"]["count"]
        night_count = constraints["shiftRequirements"]["nightShift"]["count"]
        chemo_nurses = [i for i, nurse in enumerate(nurses) if nurse.get("isChemoCertified")]

        fallback_schedule = {n["name"]: [] for n in nurses}
        filled_count = {d: {"day": 0, "night": 0} for d in range(num_days)}

        for n_idx, nurse in enumerate(nurses):
            nurse_name = nurse.get("name")
            for d_idx, date in enumerate(date_list):
                shift_code = assignments.get(nurse_name, [None]*num_days)[d_idx]
                if shift_code in shift_code_to_idx:
                    shift_type = "day" if shift_code in day_shift_codes else "night"
                    if filled_count[d_idx][shift_type] < (day_count if shift_type == "day" else night_count):
                        fallback_schedule[nurse_name].append({
                            "id": str(uuid.uuid4()),
                            "date": date,
                            "shift": shift_code,
                            "shiftType": shift_type,
                            "hours": constraints["shiftsInfo"].get(shift_code, {}).get("hours", 0),
                            "startTime": constraints["shiftsInfo"].get(shift_code, {}).get("startTime", ""),
                            "endTime": constraints["shiftsInfo"].get(shift_code, {}).get("endTime", "")
                        })
                        filled_count[d_idx][shift_type] += 1
                    else:
                        fallback_schedule[nurse_name].append({
                            "id": str(uuid.uuid4()),
                            "date": date,
                            "shift": "OFF",
                            "shiftType": "off",
                            "hours": 0,
                            "startTime": "",
                            "endTime": ""
                        })
                else:
                    fallback_schedule[nurse_name].append({
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": "OFF",
                        "shiftType": "off",
                        "hours": 0,
                        "startTime": "",
                        "endTime": ""
                    })

        for d_idx, date in enumerate(date_list):
            for shift_type, shift_codes, max_count in [("day", day_shift_codes, day_count), ("night", night_shift_codes, night_count)]:
                needed = max_count - filled_count[d_idx][shift_type]
                available_nurses = [i for i in range(num_nurses) if fallback_schedule[nurses[i]["name"]][d_idx]["shift"] == "OFF"]

                for nurse_idx in available_nurses:
                    if needed <= 0:
                        break
                    shift_code = shift_codes[0]
                    if constraints["shiftRequirements"][f"{shift_type}Shift"]["minChemoCertified"] > 0 and nurse_idx not in chemo_nurses:
                        continue
                    fallback_schedule[nurses[nurse_idx]["name"]][d_idx] = {
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": shift_code,
                        "shiftType": shift_type,
                        "hours": constraints["shiftsInfo"].get(shift_code, {}).get("hours", 0),
                        "startTime": constraints["shiftsInfo"].get(shift_code, {}).get("startTime", ""),
                        "endTime": constraints["shiftsInfo"].get(shift_code, {}).get("endTime", "")
                    }
                    filled_count[d_idx][shift_type] += 1
                    needed -= 1

        return fallback_schedule

    @staticmethod
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    def call_openai_with_retry(messages, model="gpt-3.5-turbo", max_tokens=2000):
        return client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.1,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )

    @staticmethod
    def optimize_schedule_with_ortools(assignments: Dict, constraints: Dict) -> Dict:
        start_date = constraints["dateRange"]["start"]
        end_date = constraints["dateRange"]["end"]
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        delta_days = (end_dt - start_dt).days + 1
        date_list = [(start_dt + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(delta_days)]
        nurses = constraints["nurses"]
        num_nurses = len(nurses)
        num_days = len(date_list)
        nurse_name_to_idx = {nurse["name"]: idx for idx, nurse in enumerate(nurses)}
        day_shift_codes = constraints["shiftRequirements"]["dayShift"]["shiftCodes"]
        night_shift_codes = constraints["shiftRequirements"]["nightShift"]["shiftCodes"]
        all_shift_codes = day_shift_codes + night_shift_codes + ["OFF"]
        shift_code_to_idx = {code: idx for idx, code in enumerate(all_shift_codes)}
        model = cp_model.CpModel()
        shifts = {}

        # Create shift variables
        for n in range(num_nurses):
            for d in range(num_days):
                for s in range(len(all_shift_codes)):
                    shifts[(n, d, s)] = model.NewBoolVar(f"shift_n{n}_d{d}_s{s}")

        # Each nurse must have exactly one shift per day
        for n in range(num_nurses):
            for d in range(num_days):
                model.AddExactlyOne(shifts[(n, d, s)] for s in range(len(all_shift_codes)))

        # Shift requirements
        day_count = constraints["shiftRequirements"]["dayShift"]["count"]
        night_count = constraints["shiftRequirements"]["nightShift"]["count"]

        for d in range(num_days):
            model.Add(
                sum(shifts[(n, d, shift_code_to_idx[code])]
                    for n in range(num_nurses)
                    for code in day_shift_codes) == day_count
            )
            model.Add(
                sum(shifts[(n, d, shift_code_to_idx[code])]
                    for n in range(num_nurses)
                    for code in night_shift_codes) == night_count
            )

        # Chemo certified requirements
        is_chemo_certified = [n.get("isChemoCertified", False) for n in nurses]

        for d in range(num_days):
            model.Add(
                sum(shifts[(n, d, shift_code_to_idx[code])]
                    for n in range(num_nurses)
                    for code in day_shift_codes
                    if is_chemo_certified[n]) >= constraints["shiftRequirements"]["dayShift"]["minChemoCertified"]
            )
            model.Add(
                sum(shifts[(n, d, shift_code_to_idx[code])]
                    for n in range(num_nurses)
                    for code in night_shift_codes
                    if is_chemo_certified[n]) >= constraints["shiftRequirements"]["nightShift"]["minChemoCertified"]
            )

        # No more than 3 consecutive working days
        off_shift_idx = shift_code_to_idx["OFF"]
        for n in range(num_nurses):
            for d in range(num_days - 3):
                model.Add(
                    sum(shifts[(n, d + i, s)]
                        for i in range(4)
                        for s in range(len(all_shift_codes))
                        if s != off_shift_idx) <= 3
                )

        # No day shift after night shift
        for n in range(num_nurses):
            for d in range(num_days - 1):
                for ns in [shift_code_to_idx[code] for code in night_shift_codes]:
                    for ds in [shift_code_to_idx[code] for code in day_shift_codes]:
                        model.AddBoolOr([
                            shifts[(n, d, ns)].Not(),
                            shifts[(n, d + 1, ds)].Not()
                        ])

        # Weekend constraints (at least one day off per weekend)
        for n in range(num_nurses):
            for week_start in range(0, num_days - 6, 7):
                # Saturday (day 5) or Sunday (day 6) must be off
                saturday_vars = [shifts[(n, week_start + 5, s)] for s in range(len(all_shift_codes)) if s != off_shift_idx]
                sunday_vars = [shifts[(n, week_start + 6, s)] for s in range(len(all_shift_codes)) if s != off_shift_idx]

                if saturday_vars and sunday_vars:
                    # At least one off on weekend days
                    model.AddBoolOr([shifts[(n, week_start + 5, off_shift_idx)], shifts[(n, week_start + 6, off_shift_idx)]])

        # Enforce assignments preferences strictly only if given (non-empty shift code)
        ASSIGNMENT_PENALTY = 100
        assignment_violations = []
        for nurse_name, nurse_assignments in assignments.items():
            if nurse_name not in nurse_name_to_idx:
                continue
            n = nurse_name_to_idx[nurse_name]
            for d, shift_code in enumerate(nurse_assignments):
                if not shift_code or shift_code == "" or shift_code == "OFF":
                    # Nurse did not put preference - do not enforce
                    continue
                if shift_code not in shift_code_to_idx:
                    continue
                s = shift_code_to_idx[shift_code]
                violation = model.NewBoolVar(f"assignment_violation_n{n}_d{d}")
                # If nurse must work shift s on day d, then shifts[(n,d,s)] == 1; violation if not assigned
                model.Add(shifts[(n, d, s)] == 1).OnlyEnforceIf(violation.Not())
                model.Add(shifts[(n, d, s)] == 0).OnlyEnforceIf(violation)
                assignment_violations.append(violation)

        # Balance workload: minimize difference between max and min shifts worked per nurse
        total_shifts = [
            sum(shifts[(n, d, s)]
                for d in range(num_days)
                for s in range(len(all_shift_codes))
                if all_shift_codes[s] != "OFF")
            for n in range(num_nurses)
        ]

        max_shifts = model.NewIntVar(0, num_days, "max_shifts")
        min_shifts = model.NewIntVar(0, num_days, "min_shifts")
        model.AddMaxEquality(max_shifts, total_shifts)
        model.AddMinEquality(min_shifts, total_shifts)
        model.Minimize(ASSIGNMENT_PENALTY * sum(assignment_violations) + (max_shifts - min_shifts) * 10)

        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 8
        solver.parameters.max_time_in_seconds = 120
        status = solver.Solve(model)

        logger.info(f"Total nurses: {len(nurses)}")
        logger.info(f"Chemo-certified nurses: {len([n for n in nurses if n['isChemoCertified']])}")
        logger.info(f"Total required shifts per day: day={day_count}, night={night_count}")
        logger.info(f"Total required shifts: {(day_count + night_count) * num_days}")

        chemo_required_per_day = (
            constraints["shiftRequirements"]["dayShift"]["minChemoCertified"]
            + constraints["shiftRequirements"]["nightShift"]["minChemoCertified"]
        )
        chemo_required_total = chemo_required_per_day * num_days
        chemo_available_total = sum(
            1 for nurse in nurses if nurse.get("isChemoCertified")
        ) * num_days

        logger.info(f"Chemo-certified nurses needed: {chemo_required_total}, available: {chemo_available_total}")
        if chemo_available_total < chemo_required_total:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient chemo-certified nurses: "
                    f"required {chemo_required_total} total across {num_days} days, "
                    f"but only {chemo_available_total} available. "
                    f"Please adjust the chemo coverage requirements or provide more certified nurses."
                )
            )

        total_required_shifts = (day_count + night_count) * num_days
        max_possible_shifts = num_nurses * num_days  # each nurse can work at most one shift per day

        if total_required_shifts > max_possible_shifts:
            logger.warning(f"Infeasible: Required shifts ({total_required_shifts}) exceed available slots ({max_possible_shifts})")
            raise HTTPException(
                status_code=400,
                detail=f"Not enough nurse capacity to meet shift requirements: need {total_required_shifts}, but have {max_possible_shifts} possible assignments"
            )

        if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            logger.warning(f"OR-Tools failed with status {status}. Using fallback.")
            return ScheduleOptimizer.create_fallback_schedule(
                assignments, constraints, date_list, nurses,
                day_shift_codes, night_shift_codes, shift_code_to_idx
            )

        optimized_schedule = {}
        for n, nurse in enumerate(nurses):
            nurse_name = nurse["name"]
            optimized_schedule[nurse_name] = []
            for d, date in enumerate(date_list):
                assigned = False
                for s, shift_code in enumerate(all_shift_codes):
                    if solver.Value(shifts[(n, d, s)]) == 1:
                        shift_info = constraints["shiftsInfo"].get(shift_code, {})
                        optimized_schedule[nurse_name].append({
                            "id": str(uuid.uuid4()),
                            "date": date,
                            "shift": shift_code,
                            "shiftType": "day" if shift_code in day_shift_codes else "night" if shift_code in night_shift_codes else "off",
                            "hours": shift_info.get("hours", 0),
                            "startTime": shift_info.get("startTime", ""),
                            "endTime": shift_info.get("endTime", "")
                        })
                        assigned = True
                        break
                if not assigned:
                    optimized_schedule[nurse_name].append({
                        "id": str(uuid.uuid4()),
                        "date": date,
                        "shift": "OFF",
                        "shiftType": "off",
                        "hours": 0,
                        "startTime": "",
                        "endTime": ""
                    })

        non_off_count = sum(
            1 for n, nurse_days in optimized_schedule.items()
            for day in nurse_days if day["shift"] != "OFF"
        )
        logger.info(f"OR-Tools assigned {non_off_count} working shifts")

        return optimized_schedule
        
    @staticmethod
    def refine_schedule_with_ai(schedule: Dict, constraints: Dict, assignments: Dict, db: Session) -> Dict:
        try:
            simplified_constraints = {
                "shiftRequirements": constraints["shiftRequirements"],
                "nurses": [
                    {"name": n["name"], "isChemoCertified": n.get("isChemoCertified", False)}
                    for n in constraints["nurses"]
                ]
            }

            prompt = (
                "Refine this nurse schedule while strictly keeping:\n"
                f"- These assignments: {json.dumps(assignments, indent=2)}\n"
                f"- These requirements: {json.dumps(simplified_constraints, indent=2)}\n"
                "Make minimal changes to improve fairness. Return ONLY the refined JSON schedule."
            )

            response = ScheduleOptimizer.call_openai_with_retry([
                {"role": "system", "content": "You are a nurse scheduling expert that refines schedules while strictly following constraints."},
                {"role": "user", "content": prompt}
            ])

            raw = response.choices[0].message.content
            refined_schedule = ScheduleOptimizer.parse_ai_response(raw)

            # Validate structure
            for nurse_name, days in refined_schedule.items():
                if not isinstance(days, list):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Refined schedule for {nurse_name} is invalid. Expected list of shift entries, got: {type(days).__name__}"
                    )

                for i, day in enumerate(days):
                    if not isinstance(day, dict):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Each day entry for {nurse_name} must be a dict, got: {type(day).__name__}"
                        )
                    if "id" not in day:
                        day["id"] = str(uuid.uuid4())
                    if "startTime" not in day:
                        day["startTime"] = ""
                    if "endTime" not in day:
                        day["endTime"] = ""

            if all(day["shift"] == "OFF" for days in schedule.values() for day in days):
                logger.warning("Skipping AI refinement — base schedule is all OFF")
                return schedule

        except Exception as e:
            logger.error(f"AI refinement failed: {e}")
            logger.error(f"Refined schedule (raw): {json.dumps(schedule, indent=2)}")
            return schedule

@router.post("/", response_model=OptimizeResponse)
async def optimize_schedule(req: OptimizeRequest, db: Session = Depends(get_db)):
    # Validate input
    ScheduleOptimizer.validate_input_data(req)

    # Parse constraints from input using AI
    prompt = ScheduleOptimizer.build_prompt_for_constraints_parsing(req, db)
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "Parse user scheduling input into structured JSON constraints only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=4000,
        response_format={"type": "json_object"},
    )

    raw_constraints = response.choices[0].message.content
    constraints = ScheduleOptimizer.parse_ai_response(raw_constraints)

    # Step 1: Generate base schedule with OR-Tools optimization
    schedule = ScheduleOptimizer.optimize_schedule_with_ortools(
        assignments=req.assignments or {},
        constraints=constraints,
    )

    # Step 2: Refine with AI
    refined_schedule = ScheduleOptimizer.refine_schedule_with_ai(
        schedule=schedule,
        constraints=constraints,
        assignments=req.assignments or {},
        db=db
    )

    # Save to database
    new_schedule = OptimizedSchedule(
        schedule_id=req.schedule_id,
        result=refined_schedule,
        finalized=False,
    )
    db.add(new_schedule)
    db.commit()
    db.refresh(new_schedule)

    return {"optimized_schedule": refined_schedule, "id": str(new_schedule.id)}