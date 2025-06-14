from datetime import datetime, timedelta
import random

def simple_scheduler(nurses, start_date, end_date, off_requests, head_nurses, chemo_certified):
    """
    nurses: list of nurse names (string)
    off_requests: dict nurse -> set of datetime.date off days
    head_nurses, chemo_certified: sets of nurse names
    Returns: dict nurse -> list of shifts (str) for each day in date range
    """

    num_days = (end_date - start_date).days + 1
    schedule = {nurse: ["OFF"]*num_days for nurse in nurses}

    dates = [start_date + timedelta(days=i) for i in range(num_days)]

    # To keep track of consecutive working days
    consecutive_days = {nurse: 0 for nurse in nurses}

    # Shift pools
    day_shifts = ["07"]*5  # 5 day shifts per day
    night_shifts = ["Z23"]*4  # 4 night shifts per day

    for day_idx, date in enumerate(dates):
        # Assign day shifts first
        available_nurses = [n for n in nurses if date not in off_requests.get(n, set()) and consecutive_days[n] < 3]
        random.shuffle(available_nurses)

        day_assigned = 0
        night_assigned = 0

        # Assign exactly 1 head nurse on day shift
        head_day_candidates = [n for n in available_nurses if n in head_nurses]
        if not head_day_candidates:
            # No head nurse available, assign UNCOV
            print(f"Warning: No head nurse available on day {date}")
        else:
            head_nurse = head_day_candidates[0]
            schedule[head_nurse][day_idx] = "07"
            consecutive_days[head_nurse] += 1
            available_nurses.remove(head_nurse)
            day_assigned += 1

        # Assign other 4 day shifts
        for nurse in available_nurses:
            if day_assigned >= 5:
                break
            schedule[nurse][day_idx] = "07"
            consecutive_days[nurse] += 1
            day_assigned += 1

        # Assign night shifts - no head nurse
        night_candidates = [n for n in nurses if n not in head_nurses and date not in off_requests.get(n, set()) and consecutive_days[n] < 3]
        random.shuffle(night_candidates)

        for nurse in night_candidates:
            if night_assigned >= 4:
                break
            schedule[nurse][day_idx] = "Z23"
            consecutive_days[nurse] += 1
            night_assigned += 1

        # Reset consecutive days for nurses who got OFF
        for nurse in nurses:
            if schedule[nurse][day_idx] == "OFF":
                consecutive_days[nurse] = 0

    return schedule
