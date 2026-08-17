#!/usr/bin/env python3
"""Test composite CF code detection"""
import re

# Test the regex pattern
_COMPOSITE_CF_RE = re.compile(
    r"^CF[-\s]?\d+\s+(Z?(?:07|11|19|23|E15)(?:\s*B)?)\s*$", re.IGNORECASE
)

test_codes = [
    "CF-4 07",
    "CF-11 07",
    "CF-3 07",
    "CF-11 Z07",
    "CF 4 07",
    "cf-4 07",  # lowercase
    "CF-4",  # NOT composite (no shift code)
    "CF",  # NOT composite
    "07",  # just shift code
]

print("Testing composite CF regex:")
print("=" * 60)
for code in test_codes:
    match = _COMPOSITE_CF_RE.match(code.strip())
    if match:
        embedded = match.group(1).upper()
        print(f"✅ '{code}' → MATCH → embedded: '{embedded}'")
    else:
        print(f"❌ '{code}' → NO MATCH")
print("=" * 60)
