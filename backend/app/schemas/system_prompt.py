from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class SystemPromptBase(BaseModel):
    name: str
    content: str

class SystemPromptCreate(SystemPromptBase):
    pass

class SystemPromptUpdate(BaseModel):
    content: Optional[str] = None

class SystemPromptInDBBase(SystemPromptBase):
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        orm_mode = True

class SystemPrompt(SystemPromptInDBBase):
    pass
