from datetime import datetime, timedelta

def validate_schedule(schedule_json, nurses_metadata, off_requests, head_nurses, chemo_certified, start_date, end_date):
    """
    schedule_json: dict nurse_name -> list of shift codes (one per day)
    nurses_metadata: dict nurse_name -> dict with 'contracted_hours', 'fulltime'(bool)
    off_requests: dict nurse_name -> set of dates nurse requested off
    head_nurses: set of nurse_names
    chemo_certified: set of nurse_names
    start_date, end_date: datetime.date objects
    
    Returns list of error strings. Empty if no errors.
    """

    errors = []
    num_days = (end_date - start_date).days + 1
    dates = [start_date + timedelta(days=i) for i in range(num_days)]
    
    # Coverage counters per day shift and night shift
    for day_index, day in enumerate(dates):
        day_shift_nurses = []
        night_shift_nurses = []
        
        # Count nurses per shift
        for nurse, shifts in schedule_json.items():
            if day_index >= len(shifts):
                errors.append(f"Schedule missing day {day} for nurse {nurse}")
                continue
            shift = shifts[day_index]
            
            # Check off requests honored
            if day in off_requests.get(nurse, set()) and shift != "OFF" and shift != "":
                errors.append(f"Nurse {nurse} assigned shift {shift} on off day {day}")
            
            # Collect nurses assigned to day/night shifts
            if shift in ["07", "Z07", "Z19"]:  # assume these are day shifts (adjust as needed)
                day_shift_nurses.append(nurse)
            elif shift in ["Z23", "Z23 B", "19"]:  # night shifts (adjust as needed)
                night_shift_nurses.append(nurse)
            elif shift in ["OFF", ""]:
                continue
            else:
                # Unknown shift code, warn or error
                errors.append(f"Unknown shift code {shift} for nurse {nurse} on {day}")

        # Validate coverage counts for day shift
        if len(day_shift_nurses) != 5:
            errors.append(f"Day shift coverage on {day} is {len(day_shift_nurses)} not 5")
        # Exactly 1 head nurse on day shift
        head_on_day = [n for n in day_shift_nurses if n in head_nurses]
        if len(head_on_day) != 1:
            errors.append(f"Day shift on {day} has {len(head_on_day)} head nurses, must be 1")
        # At least 2 chemo-certified on day shift
        chemo_on_day = [n for n in day_shift_nurses if n in chemo_certified]
        if len(chemo_on_day) < 2:
            errors.append(f"Day shift on {day} has {len(chemo_on_day)} chemo-certified nurses, minimum 2 required")

        # Validate coverage counts for night shift
        if len(night_shift_nurses) != 4:
            errors.append(f"Night shift coverage on {day} is {len(night_shift_nurses)} not 4")
        # No head nurse on night shift
        head_on_night = [n for n in night_shift_nurses if n in head_nurses]
        if len(head_on_night) != 0:
            errors.append(f"Night shift on {day} has {len(head_on_night)} head nurses, must be 0")
        # At least 2 chemo-certified on night shift
        chemo_on_night = [n for n in night_shift_nurses if n in chemo_certified]
        if len(chemo_on_night) < 2:
            errors.append(f"Night shift on {day} has {len(chemo_on_night)} chemo-certified nurses, minimum 2 required")

    # Validate max 3 consecutive working days
    for nurse, shifts in schedule_json.items():
        consec = 0
        for shift in shifts:
            if shift not in ["OFF", ""]:
                consec += 1
                if consec > 3:
                    errors.append(f"Nurse {nurse} works more than 3 consecutive days")
            else:
                consec = 0

    # Validate total hours assigned per nurse (approximate, based on shift code hours)
    # Define hours per shift code:
    hours_map = {
        "07": 8,
        "19": 8,
        "Z23": 12,
        "Z07": 12,
        "Z19": 12,
        "Z23 B": 12,
        "OFF": 0,
        "": 0
    }
    for nurse, shifts in schedule_json.items():
        total_hours = sum(hours_map.get(shift, 0) for shift in shifts)
        contracted = nurses_metadata[nurse]['contracted_hours']
        if abs(total_hours - contracted) > 8:  # allow 8-hour margin
            errors.append(f"Nurse {nurse} assigned {total_hours} hours vs contracted {contracted}")

    return errors
