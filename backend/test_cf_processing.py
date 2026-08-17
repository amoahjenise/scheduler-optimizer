#!/usr/bin/env python3
"""Test CF shift processing with actual data."""
import sys
sys.path.insert(0, '.')

from app.api.routes.optimized_schedule import RobustScheduler, SHIFT_CODES

# Test data for Tiffany and Trong
test_data = {
    "Tiffany Glodoviza": {
        "2025-08-24": "Z07",
        "2025-08-27": "Z07", 
        "2025-08-28": "Z07",
        "2025-09-01": "Z19",
        "2025-09-02": "Z23 B",
        "2025-09-03": "Z23 B",
        "2025-09-05": "CF-4 07",  # This is the composite CF
    },
    "Trong Tran Khoi": {
        "2025-08-25": "Z19",
        "2025-08-26": "Z23 B",
        "2025-08-29": "Z19",
        "2025-08-30": "Z23 B",
        "2025-08-31": "Z23 B",
        "2025-09-03": "Z19",
        "2025-09-05": "CF-11 07",  # This is the composite CF
    }
}

print("=" * 80)
print("TESTING COMPOSITE CF PROCESSING")
print("=" * 80)

for nurse_name, shifts in test_data.items():
    print(f"\n\n{nurse_name}:")
    print("-" * 80)
    
    total_hours = 0
    shift_count = 0
    count_12h = 0
    count_8h = 0
    
    for date, shift_code in shifts.items():
        clean_shift = shift_code.strip()
        
        # Test composite CF detection
        is_composite = RobustScheduler._is_composite_cf_shift(clean_shift)
        
        if is_composite:
            extracted = RobustScheduler._extract_shift_from_cf(clean_shift)
            print(f"  {date}: {shift_code:15s} → COMPOSITE CF")
            print(f"              Extracted shift: {extracted}")
            
            # Get shift info for extracted code
            if extracted in SHIFT_CODES:
                shift_info = SHIFT_CODES[extracted]
                hours = shift_info['hours']
                shift_type = shift_info['type']
                print(f"              Hours: {hours}, Type: {shift_type}")
                
                total_hours += hours
                shift_count += 1
                if hours >= 11:
                    count_12h += 1
                else:
                    count_8h += 1
            else:
                print(f"              ERROR: {extracted} not in SHIFT_CODES")
        else:
            # Regular shift
            if shift_code in SHIFT_CODES:
                shift_info = SHIFT_CODES[shift_code]
                hours = shift_info['hours']
                total_hours += hours
                shift_count += 1
                if hours >= 11:
                    count_12h += 1
                else:
                    count_8h += 1
                print(f"  {date}: {shift_code:15s} → {hours}h ({shift_info['type']})")
            else:
                print(f"  {date}: {shift_code:15s} → UNKNOWN")
    
    print(f"\n  SUMMARY:")
    print(f"    Total shifts: {shift_count}")
    print(f"    12h shifts: {count_12h}")
    print(f"    8h shifts: {count_8h}")
    print(f"    Total hours: {total_hours}h")
    print(f"    Display format: {count_12h}×12h" + (f" + {count_8h}×8h" if count_8h > 0 else ""))

print("\n" + "=" * 80)
