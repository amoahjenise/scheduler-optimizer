# Translation File Duplicate Keys - Merge Summary

## Date: March 23, 2026

## Problem

The frontend/src/i18n/messages/en.json and fr.json files contained multiple duplicate keys that were causing build errors. This occurred because new translations were added at the end of the files instead of being merged with existing sections.

## Duplicates Found and Merged

### EN.JSON (English)

#### Top-Level Duplicates

1. **updatingDashboard** (within `dashboard` object)

   - Appeared twice in the dashboard section
   - Merged: kept the last occurrence

2. **bedLabel** (within `patients` object)

   - Appeared twice in the patients section
   - Merged: kept the last occurrence

3. **patients** object

   - First occurrence: ~lines 163-200 (partial definition)
   - Second occurrence: ~lines 281-360 (complete definition)
   - Result: Merged both definitions, resulting in 87 unique keys

4. **settings** object

   - First occurrence: ~lines 230-260 (basic settings)
   - Second occurrence: ~lines 367-530 (detailed settings)
   - Result: Merged both definitions, resulting in 165 unique keys

5. **handover** object

   - First occurrence: ~lines 145-162 (basic handover)
   - Second occurrence: ~lines 528-730 (detailed handover)
   - Result: Merged both definitions, resulting in 185 unique keys

6. **scheduler** object

   - First occurrence: ~lines 123-140 (basic scheduler)
   - Second occurrence: ~lines 732-1150 (detailed scheduler)
   - Result: Merged both definitions, resulting in 323 unique keys

   **Within scheduler, these keys were duplicated:**

   - `optimize` (appeared in both sections)
   - `back` (appeared in both sections)
   - `shifts` (appeared in both sections)
   - `nurse` (appeared in both sections)
   - `summary` (appeared in both sections)
   - `action` (appeared in both sections)

### FR.JSON (French)

#### Similar Duplicates Found

The fr.json file had similar duplicate keys, primarily within the `scheduler` object:

- `back`
- `shifts`
- `nurse`
- `summary`
- `action`

All were successfully merged.

## Solution Applied

1. Created a Python script (`fix_duplicates.py`) that:

   - Parses JSON files with duplicate keys
   - Automatically merges duplicate objects recursively
   - For primitive duplicate values, keeps the last occurrence
   - Preserves all unique keys from both occurrences

2. Backup files created:

   - `en.json.backup` - original English file with duplicates
   - `fr.json.backup` - original French file with duplicates

3. Replaced original files with merged versions

## Verification

✅ Both en.json and fr.json are now valid JSON
✅ All duplicate keys have been merged
✅ Build successfully completes with no errors
✅ Total of 17 top-level keys in each file (consistent structure)

### Key Counts After Merge:

- **dashboard**: 76 keys
- **scheduler**: 323 keys
- **handover**: 185 keys
- **patients**: 87 keys
- **settings**: 165 keys

## Files Modified

- `/frontend/src/i18n/messages/en.json` - Fixed (backup: en.json.backup)
- `/frontend/src/i18n/messages/fr.json` - Fixed (backup: fr.json.backup)

## Build Status

✅ **Build successful** - No duplicate key errors
✅ All routes compiled successfully
✅ No validation or linting errors related to translations

## Recommendations

1. **Going forward**: When adding new translations, merge them into existing sections rather than appending at the end
2. **Backup files**: The .backup files can be removed after verifying everything works correctly
3. **Process**: Use a linter or JSON validator in your CI/CD to catch duplicate keys early
4. **Script**: Keep the `fix_duplicates.py` script for future reference if needed

## Notes

- The merge strategy preserved all unique keys from both occurrences of duplicate objects
- When the same primitive key appeared twice with different values, the last value was kept (as is standard JSON behavior)
- No data was lost; all unique translation keys were preserved in the final merged files
