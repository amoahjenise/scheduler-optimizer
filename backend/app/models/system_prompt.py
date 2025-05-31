from sqlalchemy import Column, Integer, String, Text
from app.db.database import Base

class SystemPrompt(Base):
    __tablename__ = "system_prompts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    content = Column(Text, nullable=False)
