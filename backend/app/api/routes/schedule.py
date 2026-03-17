from fastapi import APIRouter, Depends, UploadFile, File, Form, Header
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.deps import get_db
from app.models.schedule import Schedule
from app.schemas.schedule import ScheduleCreate
from app.core.auth import get_optional_auth, AuthContext
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
    auth: AuthContext = Depends(get_optional_auth),
    db: Session = Depends(get_db)
):
    file_paths = []
    for image in raw_images:
        filename = f"{uuid.uuid4()}_{image.filename}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        file_paths.append(filepath)

    # Use organization_id if available
    org_id = auth.organization_id if auth.is_authenticated else None

    # Always derive user_id from the verified JWT when the user is authenticated.
    # The form-supplied user_id is only a fallback for unauthenticated (legacy) calls.
    # This prevents a user from creating records owned by another user.
    if auth.is_authenticated and auth.user_id:
        if user_id and user_id != auth.user_id:
            from fastapi import HTTPException as _HTTPException
            raise _HTTPException(
                status_code=403,
                detail="Not authorized to create records on behalf of another user.",
            )
        effective_user_id = auth.user_id
    else:
        effective_user_id = user_id

    schedule = Schedule(
        user_id=effective_user_id,
        organization_id=org_id,
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
