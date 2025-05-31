from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
from app.db.deps import get_db
from app.models.schedule import Schedule
from app.schemas.schedule import ScheduleCreate
import uuid, shutil, os, json
from app.services.textract_parser import parse_schedule_from_image

router = APIRouter(redirect_slashes=True)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload-schedule/")
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
    
@router.post("/")
async def create_schedule(
    period: str = Form(...),
    user_id: str = Form(...),
    notes: str = Form(""),
    rules: str = Form("{}"),
    employee_comments: str = Form("{}"),
    raw_images: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    file_paths = []
    for image in raw_images:
        filename = f"{uuid.uuid4()}_{image.filename}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        file_paths.append(filepath)

    schedule = Schedule(
        user_id=user_id,
        period=period,
        notes=notes,
        rules=json.loads(rules),
        raw_images=file_paths,
        employee_comments=json.loads(employee_comments)
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return {"id": str(schedule.id)}
