## models/user.py
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.sql import func
from uuid import uuid4
from app.db.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))  # Clerk user_id
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())