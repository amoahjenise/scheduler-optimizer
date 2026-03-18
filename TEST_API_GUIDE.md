# Testing API Endpoints Directly

After the security fixes, all CREATE/UPDATE/DELETE endpoints require authentication.

## Required Headers

Every mutating API request must include:

```bash
Authorization: Bearer <JWT_TOKEN>
X-Organization-ID: <YOUR_ORG_ID>
```

## How to Get These Values

### 1. Get Your JWT Token

**Option A: From Browser Console**

1. Open your app in the browser and login
2. Open Developer Tools (F12)
3. Go to Console tab
4. Run:

```javascript
// Get token from Clerk
const token = await window.Clerk.session.getToken();
console.log("Token:", token);
```

**Option B: From Network Tab**

1. Open Developer Tools (F12)
2. Go to Network tab
3. Make any request in the UI (like creating a nurse)
4. Click on the request
5. Look at Request Headers → Find `Authorization: Bearer ...`
6. Copy the token

### 2. Get Your Organization ID

**From Browser Console:**

```javascript
// Get from localStorage (correct key)
const orgId = localStorage.getItem("chronofy_current_org");
console.log("Org ID:", orgId);

// Or get both token and org ID at once:
const token = await window.Clerk.session.getToken();
const orgId = localStorage.getItem("chronofy_current_org");
console.log("Authorization: Bearer " + token);
console.log("X-Organization-ID: " + orgId);
```

**Or from the database:**

```bash
cd backend
python3 -c "
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.models.organization import Organization

engine = create_engine(settings.DATABASE_URL)
Session = sessionmaker(bind=engine)
session = Session()

orgs = session.query(Organization).all()
for org in orgs:
    print(f'Organization: {org.name}')
    print(f'ID: {org.id}')
"
```

## Example API Calls

### Create Handover

```bash
curl -X POST http://localhost:8000/handovers/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -H "X-Organization-ID: YOUR_ORG_ID_HERE" \
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

### Create Nurse

```bash
curl -X POST http://localhost:8000/api/v1/nurses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -H "X-Organization-ID: YOUR_ORG_ID_HERE" \
  -d '{
    "name": "Jane Smith",
    "employee_id": "E12345",
    "seniority": 5
  }'
```

## Troubleshooting

### Error: "Authentication required"

- Make sure you're logged in via Clerk
- Check that both headers are present
- Verify the JWT token hasn't expired (tokens expire after some time)
- Verify you're a member of the organization

### Error: "Invalid token"

- Your JWT may have expired - get a new one
- Make sure the token is properly formatted: `Bearer <token>`

### Error: "Not authorized"

- You're trying to access data from another organization
- Make sure your X-Organization-ID matches an org you're a member of

## Token Expiration

JWT tokens expire! If you get "Invalid token" or "Token has expired":

1. Login again in the frontend
2. Get a fresh token using the methods above

## Clerk Configuration (Backend)

Your backend needs these environment variables set in `.env`:

```bash
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
CLERK_PUBLIC_KEY=pk_test_...
```

Check if these are set:

```bash
cd backend
python3 -c "from app.core.config import settings; print('Clerk Key:', settings.CLERK_SECRET_KEY[:20] + '...' if settings.CLERK_SECRET_KEY else 'NOT SET')"
```

## Frontend Configuration

Your frontend needs these in `.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```
