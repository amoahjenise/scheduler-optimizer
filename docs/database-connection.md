# Database Connection Notes

This is the short path I use when I need to confirm schedule data quickly.

## Fast check from backend

```bash
cd backend
python check_schedules.py
```

That script gives a quick view of schedule count, finalized count, and org IDs.

## Direct SQL check (psql)

Use `DATABASE_URL` from `backend/.env`.

```bash
psql "<DATABASE_URL>"
```

Useful queries:

```sql
SELECT COUNT(*) FROM optimized_schedules;

SELECT COUNT(*)
FROM optimized_schedules
WHERE finalized = true;

SELECT id, organization_id, finalized, created_at
FROM optimized_schedules
ORDER BY created_at DESC
LIMIT 50;

SELECT organization_id,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE finalized = true) AS finalized_total
FROM optimized_schedules
GROUP BY organization_id;
```

## If dashboard shows no schedules

1. Confirm backend is up on `:8000`
2. Confirm frontend is up on `:3000`
3. Verify API request includes both auth and org headers
4. Check that schedule rows have the expected `organization_id`

## Common fixes

- Missing schema updates:

```bash
cd backend
alembic upgrade head
```

- Missing org ID on old rows:

```sql
UPDATE optimized_schedules
SET organization_id = '<org-id>'
WHERE organization_id IS NULL;
```

Use this only when you are sure those rows belong to that org.
