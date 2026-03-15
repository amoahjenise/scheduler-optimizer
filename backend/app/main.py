from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# Use the main optimizer with RobustScheduler
from app.api.routes import user, schedule, system_prompts, webhook, patient, handover, nurse, organization, shift_codes, deletion_activity, scheduling
from app.api.routes import optimized_schedule
from app.api.routes import schedule_rules
from app.core.config import settings
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

app = FastAPI()

# CORS defaults are explicit to keep browser behavior predictable and secure.
# Browsers reject credentialed requests when allow_origins includes '*'.
cors_origins = settings.ALLOW_ORIGINS if settings.ALLOW_ORIGINS else [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
allow_all_origins = "*" in cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "API running"}
    
app.include_router(user.router, prefix="/users", tags=["Users"])
app.include_router(schedule.router, prefix="/schedules", tags=["Schedules"])
app.include_router(optimized_schedule.router, prefix="/optimize", tags=["Optimized Schedules"])
app.include_router(system_prompts.router, prefix="/system-prompt", tags=["system-prompts"])
app.include_router(nurse.router, prefix="/nurses", tags=["Nurses"])
app.include_router(patient.router, prefix="/patients", tags=["Patients"])
app.include_router(handover.router, prefix="/handovers", tags=["Handovers"])
app.include_router(deletion_activity.router, prefix="/deletion-activities", tags=["Deletion Activities"])
app.include_router(organization.router, prefix="/organizations", tags=["Organizations"])
app.include_router(shift_codes.router, tags=["Shift Codes"])
app.include_router(scheduling.router)
app.include_router(webhook.router)
app.include_router(schedule_rules.router, tags=["Schedule Rules"])
