# Scheduler Optimizer

Internal scheduling and handover app for nursing teams.

## Repo Layout

- `backend/`: FastAPI API, SQLAlchemy models, Alembic migrations
- `frontend/`: Next.js app router frontend with Clerk auth
- `docs/`: project notes, troubleshooting, and ops docs
- `data/schedules/`: sample CSV fixtures used for schedule cleanup/testing

## Why The Root Was Cleaned

The repository root had one-off scripts, generated CSV outputs, and ad-hoc notes mixed with source code.
That makes onboarding harder and creates noise in reviews.

Current approach:

- Keep source code in `backend/` and `frontend/`
- Keep docs in `docs/`
- Keep reusable sample data in `data/schedules/`
- Remove throwaway/generated artifacts that are reproducible or obsolete

## Local Setup

### Backend

```bash
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Frontend:

- `NEXT_PUBLIC_API_BASE_URL`
- Clerk public settings

Backend:

- DB connection values
- Clerk/server auth settings

## Project Docs

- `docs/database-connection.md`
- `docs/testing-api-endpoints.md`
- `docs/bugfix-handover-refresh.md`
- `docs/translation-merge-notes.md`

## Notes On CSV Fixtures

CSV files that are still useful for debugging were moved to `data/schedules/`.
Superseded/generated CSV outputs were removed from root to keep the repo maintainable.

## Best-Practice Guardrails

- No absolute local paths inside committed scripts
- No generated output files in root
- Keep docs short, factual, and task-oriented
- Keep migration history in `backend/alembic/versions`
