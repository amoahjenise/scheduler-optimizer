from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import user, schedule, optimized_schedule
from app.core.config import settings

app = FastAPI()


# CORS for frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "API running"}

app.include_router(user.router, prefix="/users", tags=["Users"])
app.include_router(schedule.router, prefix="/schedules", tags=["Schedules"])
app.include_router(optimized_schedule.router, prefix="/optimized", tags=["Optimized Schedules"])
