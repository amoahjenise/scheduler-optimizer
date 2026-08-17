# API Testing Notes

For mutating endpoints (`POST`, `PATCH`, `PUT`, `DELETE`), both headers are required:

```text
Authorization: Bearer <jwt>
X-Organization-ID: <org-id>
```

## Quick way to grab values

From browser console while logged in:

```javascript
const token = await window.Clerk.session.getToken();
const orgId = localStorage.getItem("chronofy_current_org");
console.log({ token, orgId });
```

## Example: create handover

```bash
curl -X POST http://localhost:8000/handovers/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -H "X-Organization-ID: <org-id>" \
  -d '{
    "shift_date": "2026-03-17T22:01:23.123Z",
    "shift_type": "day",
    "outgoing_nurse": "jenise amoah",
    "p_first_name": "John",
    "p_last_name": "Doe",
    "p_room_number": "B7.01",
    "p_diagnosis": "SCIDS - Heme-Onc",
    "p_date_of_birth": "2022-03-17",
    "p_age": "04 years"
  }'
```

## Example: create nurse

```bash
curl -X POST http://localhost:8000/api/v1/nurses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -H "X-Organization-ID: <org-id>" \
  -d '{
    "name": "Jane Smith",
    "employee_id": "E12345",
    "seniority": 5
  }'
```

## Troubleshooting checklist

1. Token is valid and not expired
2. Org ID is the one you are actually a member of
3. Backend is running on `:8000`
4. Frontend points to the same backend

If you get `401` or `403`, regenerate token first before deeper debugging.
