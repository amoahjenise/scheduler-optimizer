from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.optimized_schedule import OptimizedSchedule
from app.schemas.optimized_schedule import OptimizedScheduleCreate
import uuid

router = APIRouter()

@router.post("/")
def generate_mock_optimized_schedule(payload: OptimizedScheduleCreate, db: Session = Depends(get_db)):
    optimized = OptimizedSchedule(
        schedule_id=payload.schedule_id,
        result=payload.result,
        finalized=payload.finalized
    )
    db.add(optimized)
    db.commit()
    db.refresh(optimized)
    return {"id": str(optimized.id)}

@router.get("/{schedule_id}")
def get_optimized_schedule(schedule_id: str, db: Session = Depends(get_db)):
    result = db.query(OptimizedSchedule).filter_by(schedule_id=schedule_id).first()
    return result
