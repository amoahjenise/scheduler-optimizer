from fastapi import APIRouter, Depends, UploadFile, File, Form, Header, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.deps import get_db
from app.models.schedule import Schedule
from app.schemas.schedule import ScheduleCreate
from app.core.auth import get_optional_auth, AuthContext, OrgAuth
import uuid, shutil, os, json, re
from app.services.textract_parser import parse_schedule_from_image

router = APIRouter(redirect_slashes=True)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Allowed file extensions for uploads (security)
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'}


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename to prevent path traversal attacks.
    Removes path components and only keeps the base filename with allowed characters.
    """
    if not filename:
        return "unnamed"
    
    # Get just the base filename (remove any path components)
    filename = os.path.basename(filename)
    
    # Remove any null bytes (common attack vector)
    filename = filename.replace('\x00', '')
    
    # Keep only alphanumeric, dots, hyphens, underscores
    filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    
    # Limit length
    if len(filename) > 100:
        name, ext = os.path.splitext(filename)
        filename = name[:100-len(ext)] + ext
    
    return filename or "unnamed"


def validate_file_extension(filename: str) -> bool:
    """Check if the file has an allowed extension."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


@router.post("/upload-schedule/")
async def upload_schedule(
    file: UploadFile = File(...),
    start_date: str = Form(...),
    end_date: str = Form(...),
    auth: AuthContext = Depends(get_optional_auth)
):
    """Upload and parse a schedule image. Requires authentication."""
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Validate file extension
    if not validate_file_extension(file.filename or ""):
        raise HTTPException(status_code=400, detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")
    
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
    # Require authentication
    if not auth.is_authenticated or not auth.organization_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    file_paths = []
    for image in raw_images:
        # Validate file extension
        if not validate_file_extension(image.filename or ""):
            raise HTTPException(
                status_code=400, 
                detail=f"File type not allowed for '{image.filename}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        # Sanitize filename to prevent path traversal
        safe_filename = sanitize_filename(image.filename or "unnamed")
        filename = f"{uuid.uuid4()}_{safe_filename}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        
        # Verify the path is within UPLOAD_DIR (defense in depth)
        abs_upload_dir = os.path.abspath(UPLOAD_DIR)
        abs_filepath = os.path.abspath(filepath)
        if not abs_filepath.startswith(abs_upload_dir):
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        file_paths.append(filepath)

    # Use authenticated organization_id
    org_id = auth.organization_id

    # Use user_id from verified JWT
    effective_user_id = auth.user_id

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
