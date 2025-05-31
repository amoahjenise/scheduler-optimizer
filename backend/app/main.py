from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import user, schedule, optimized_schedule, webhook
from app.core.config import settings
from app.services.textract_parser import parse_schedule_from_image

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

@app.post("/upload-schedule/")
async def upload_schedule(
    file: UploadFile = File(...),
    start_date: str = Form(...),
    end_date: str = Form(...)
):
    contents = await file.read()
    try:
        from datetime import datetime
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()

        result = parse_schedule_from_image(contents, start, end)
        return result
    except Exception as e:
        return {"error": str(e)}
    
app.include_router(user.router, prefix="/users", tags=["Users"])
app.include_router(schedule.router, prefix="/schedules", tags=["Schedules"])
app.include_router(optimized_schedule.router, prefix="/optimized", tags=["Optimized Schedules"])
app.include_router(webhook.router)  
