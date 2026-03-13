#!/usr/bin/env python3
"""Test fuzzy nurse name matching for AI refinement"""

# Simulate the matching logic
def find_matching_nurse(suggested_name: str, nurse_name_map: dict) -> str | None:
    """Find matching nurse using exact, partial, and fuzzy matching."""
    suggested_lower = suggested_name.lower().strip()
    
    # Exact match
    if suggested_lower in nurse_name_map:
        return nurse_name_map[suggested_lower]
    
    # Partial match - check if suggested name is contained in any nurse name
    for nurse_lower, nurse_actual in nurse_name_map.items():
        if suggested_lower in nurse_lower or nurse_lower in suggested_lower:
            print(f"  Partial match: '{suggested_name}' matched to '{nurse_actual}'")
            return nurse_actual
    
    # Try matching by first and last word (handles truncated names)
    suggested_words = suggested_lower.split()
    if len(suggested_words) >= 2:
        first_word = suggested_words[0]
        last_word = suggested_words[-1]
        for nurse_lower, nurse_actual in nurse_name_map.items():
            nurse_words = nurse_lower.split()
            if len(nurse_words) >= 2 and nurse_words[-1] == last_word and first_word in nurse_lower:
                print(f"  Fuzzy match: '{suggested_name}' matched to '{nurse_actual}'")
                return nurse_actual
    
    return None

# Test cases
test_nurses = {
    "allycia seidel": "Allycia Seidel",
    "demitra sita": "Demitra Sita",
    "florent vidal": "Florent Vidal",
    "jasmine-ketya ain": "Jasmine-Ketya ain",
    "marianna ddeo": "Marianna ddeo"
}

test_inputs = [
    "Allycia Seidel",     # exact match (case insensitive)
    "asmine-Ketya ain",   # truncated first name
    "arianna ddeo",       # truncated first name
    "Demitra Sita",       # exact match
    "Florent Vidal"       # exact match
]

print("Testing fuzzy nurse name matching:")
print("=" * 60)

for test_input in test_inputs:
    result = find_matching_nurse(test_input, test_nurses)
    if result:
        print(f"✓ '{test_input}' -> '{result}'")
    else:
        print(f"✗ '{test_input}' -> NOT FOUND")
    print()
