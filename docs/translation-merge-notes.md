# Translation Merge Notes

## What broke

`frontend/src/i18n/messages/en.json` and `frontend/src/i18n/messages/fr.json` had duplicate keys.
That caused JSON/build errors.

## Why it happened

Some translation updates were appended instead of merged into existing sections.

## What was done

- Duplicate objects were merged (for example `scheduler`, `handover`, `settings`, `patients`)
- Primitive conflicts kept the last value
- Both locale files were validated after merge

## Current status

- `en.json` valid
- `fr.json` valid
- frontend build unblocked

## Rule going forward

When adding translations, edit the existing key block in-place.
Do not append a second copy of the same section at the end of the file.
