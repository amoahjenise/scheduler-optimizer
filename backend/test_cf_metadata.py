#!/usr/bin/env python3
"""Test CF-4 07 through the actual _get_shift_metadata flow"""
import sys
import re

# Simulate the _is_composite_cf_shift check
_COMPOSITE_CF_RE = re.compile(
    r"^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)\s*$", re.IGNORECASE
)

def _is_composite_cf_shift(code: str) -> bool:
    """True when *code* is a composite CF+shift like 'CF-4 07'."""
    if not code:
        return False
    return bool(_COMPOSITE_CF_RE.match(code.strip()))

def _extract_shift_from_cf(code: str) -> str:
    """Extract the shift component from a composite CF code."""
    if not code:
        return ""
    m = _COMPOSITE_CF_RE.match(code.strip())
    return m.group(1).upper() if m else ""

def _get_shift_metadata(shift_code: str, shifts_info: dict):
    """Simulate _get_shift_metadata with composite CF fix"""
    code_upper = shift_code.strip().upper()
    
    # CRITICAL: Handle composite CF codes FIRST
    if _is_composite_cf_shift(shift_code):
        match = re.search(r'CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)', code_upper)
        if match:
            embedded_code = match.group(1).strip()
            # Recursively get metadata for the embedded shift code
            embedded_meta = _get_shift_metadata(embedded_code, shifts_info)
            print(f"  📍 Composite CF '{shift_code}' → extracted '{embedded_code}' → {embedded_meta}")
            return embedded_meta
    
    # Check shifts_info lookup
    if shift_code in shifts_info:
        info = shifts_info[shift_code]
        result = {
            "type": info.get("type", "day"),
            "hours": info.get("hours", 12),
            "start": info.get("startTime", "07:00"),
            "end": info.get("endTime", "19:00"),
        }
        print(f"  📍 Found '{shift_code}' in shifts_info → {result}")
        return result
    
    # Fallback logic
    if "D" in code_upper or "07" in code_upper or "11" in code_upper:
        if "8" in code_upper:
            return {"type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"}
        return {"type": "day", "hours": 11.25, "start": "07:00", "end": "19:25"}
    
    return {"type": "day", "hours": 7.5, "start": "07:00", "end": "15:15"}

# Simulate SHIFT_CODES lookup table
SHIFT_CODES = {
    "07": {"type": "day", "hours": 7.5, "startTime": "07:00", "endTime": "15:15"},
    "Z07": {"type": "day", "hours": 11.25, "startTime": "07:00", "endTime": "19:25"},
}

print("=" * 70)
print("TEST 1: Direct call with 'CF-4 07' (Step 3 scenario)")
print("=" * 70)
result = _get_shift_metadata("CF-4 07", SHIFT_CODES)
print(f"RESULT: {result}")
print(f"✅ PASS" if result["type"] == "day" and result["hours"] == 7.5 else f"❌ FAIL")

print("\n" + "=" * 70)
print("TEST 2: Pre-extracted '07' (Step 1 scenario)")
print("=" * 70)
extracted = _extract_shift_from_cf("CF-4 07")
print(f"Extracted: '{extracted}'")
result2 = _get_shift_metadata(extracted, SHIFT_CODES)
print(f"RESULT: {result2}")
print(f"✅ PASS" if result2["type"] == "day" and result2["hours"] == 7.5 else f"❌ FAIL")

print("\n" + "=" * 70)
print("TEST 3: With uppercase 'CF-11 Z07'")
print("=" * 70)
result3 = _get_shift_metadata("CF-11 Z07", SHIFT_CODES)
print(f"RESULT: {result3}")
print(f"✅ PASS" if result3["type"] == "day" and result3["hours"] == 11.25 else f"❌ FAIL")
