from pydantic import BaseModel

class SystemPrompt(BaseModel):
    id: int
    name: str
    content: str

    class Config:
        from_attributes = True

class SystemPromptUpdate(BaseModel):
    content: str
