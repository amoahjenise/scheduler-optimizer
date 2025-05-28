## schemas/user.py
from pydantic import BaseModel

class UserCreate(BaseModel):
    id: str  # Clerk user_id