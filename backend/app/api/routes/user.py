from fastapi import APIRouter, HTTPException
from app.schemas.user import UserCreate
from app.db.deps import get_db
from app.models.user import User
from sqlalchemy.orm import Session
from fastapi import Depends

router = APIRouter()

@router.post("/")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = User(id=user.id)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return {"message": "User created", "user_id": db_user.id}
