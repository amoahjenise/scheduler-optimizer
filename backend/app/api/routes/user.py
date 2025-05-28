from fastapi import APIRouter, HTTPException, Depends
from app.schemas.user import UserCreate
from app.db.deps import get_db
from app.models.user import User
from sqlalchemy.orm import Session

router = APIRouter()

@router.post("/")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = User(id=user.id)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return {"message": "User created", "user_id": db_user.id}

@router.delete("/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(user)
    db.commit()
    return {"message": f"User with id {user_id} deleted successfully"}
