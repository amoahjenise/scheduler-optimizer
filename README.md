# Scheduler Optimizer

Healthcare-focused scheduling and handover platform.

## Product Scope

This app is designed for clinical teams to:

1. Create and optimize nurse schedules from OCR or manual data.
2. Manage handoff workflows (day/night) tied to active patients.
3. Manage nurses, patient records, and organization-level settings.
4. Provide operational visibility (dashboard, activities, schedule status).

## Core Modules

- Scheduler Optimizer (`/scheduler`)
	- OCR-assisted schedule capture
	- Rule-based + AI-assisted optimization
	- Draft persistence and finalized schedule management
	- Shift code and staff requirement handling

- Shift Handover (`/handover`)
	- Day/night handoff workflow
	- Patient-level report management
	- Printable handoff support

- Nurse Management (`/nurses`)
	- Nurse profile CRUD
	- Certification and workload fields

- Patient Management (`/patients`)
	- Patient census CRUD
	- Active/inactive filtering

- Dashboard (`/dashboard`)
	- Current shift visibility
	- Recent activity feed
	- Operational shortcuts

- Schedule Management (`/schedules`, `/admin/schedules`)
	- Draft/finalized schedule viewing and governance

- Settings (`/settings`)
	- Organization-level config and branding
	- Weekly targets and operational options

## Trust & Compliance Surface

Frontpage includes trust controls expected for healthcare-grade tooling:

- Signed BAA
- AES-256 encryption at rest + TLS in transit
- Audit logs
- Reliability-focused uptime/support posture

## Architecture

Monorepo with separate backend and frontend applications:

- `backend/`: FastAPI + SQLAlchemy + Alembic
- `frontend/`: Next.js (App Router) + TypeScript + Clerk auth

### Backend (FastAPI)

- API routes under `backend/app/api/routes`
- ORM models under `backend/app/models`
- DB migrations under `backend/alembic/versions`

### Frontend (Next.js)

- App routes under `frontend/src/app`
- Shared API client under `frontend/src/app/lib/api.ts`
- Global layout/style under `frontend/src/app/layout.tsx` and `frontend/src/app/globals.css`

## Requirements

- Python 3.10+
- Node.js 18+
- npm 9+

## Local Development

### 1) Backend

From repo root:

```bash
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
```

Run migrations:

```bash
alembic upgrade head
```

Start API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Frontend

From repo root:

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Configure as needed (frontend and backend):

- Frontend:
	- `NEXT_PUBLIC_API_BASE_URL`
	- Clerk public keys/settings
- Backend:
	- Database connection settings
	- Auth-related settings

## Build & Validation

Frontend production build:

```bash
cd frontend
npm run build
```

## Data & Migration Policy

Alembic revision files are intentionally kept. They are required for reliable schema history, reproducible upgrades, rollback support, and team synchronization across environments.

## Repository Conventions

- Keep this README as the single source of project-level specification.
- Keep migration history in `backend/alembic/versions`.
- Keep page layout consistency via shared classes in `globals.css`.
