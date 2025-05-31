from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.deps import get_db
from app.models.system_prompt import SystemPrompt
from app.schemas.system_prompt import SystemPrompt, SystemPromptCreate, SystemPromptUpdate

router = APIRouter()

@router.post("/", response_model=SystemPrompt, status_code=status.HTTP_201_CREATED)
def create_system_prompt(prompt_in: SystemPromptCreate, db: Session = Depends(get_db)):
    existing = db.query(SystemPrompt).filter(SystemPrompt.name == prompt_in.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Prompt with this name already exists")
    prompt = SystemPrompt(name=prompt_in.name, content=prompt_in.content)
    db.add(prompt)
    db.commit()
    db.refresh(prompt)
    return prompt

@router.get("/", response_model=List[SystemPrompt])
def list_system_prompts(db: Session = Depends(get_db)):
    return db.query(SystemPrompt).all()

@router.get("/{prompt_id}", response_model=SystemPrompt)
def get_system_prompt(prompt_id: int, db: Session = Depends(get_db)):
    prompt = db.query(SystemPrompt).filter(SystemPrompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt

@router.put("/{prompt_id}", response_model=SystemPrompt)
def update_system_prompt(prompt_id: int, prompt_in: SystemPromptUpdate, db: Session = Depends(get_db)):
    prompt = db.query(SystemPrompt).filter(SystemPrompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    prompt.name = prompt_in.name
    prompt.content = prompt_in.content
    db.commit()
    db.refresh(prompt)
    return prompt

@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_system_prompt(prompt_id: int, db: Session = Depends(get_db)):
    prompt = db.query(SystemPrompt).filter(SystemPrompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    db.delete(prompt)
    db.commit()
    return
