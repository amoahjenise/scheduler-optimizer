# /backend/app/api/routes/nurse.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import UUID4

from app.db.deps import get_db
from app.models.nurse import Nurse
from app.schemas.nurse import NurseCreate, NurseUpdate, NurseResponse, NurseListResponse
from app.core.auth import OptionalAuth, ManagerAuth, AuthContext

router = APIRouter()


@router.get("", response_model=NurseListResponse)
def list_nurses(
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    List all nurses. Filters by organization if auth context has org, 
    otherwise falls back to user_id filter for backward compatibility.
    """
    query = db.query(Nurse)
    
    # Filter by organization if available, else by user_id
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    elif user_id:
        query = query.filter(Nurse.user_id == user_id)
    
    # Apply search filter if provided
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (Nurse.name.ilike(search_pattern)) |
            (Nurse.employee_id.ilike(search_pattern))
        )
    
    # Get total count
    total = query.count()
    
    # Apply pagination
    nurses = query.order_by(Nurse.name).offset((page - 1) * page_size).limit(page_size).all()
    
    return NurseListResponse(
        nurses=nurses,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/{nurse_id}", response_model=NurseResponse)
def get_nurse(
    nurse_id: UUID4,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Get a specific nurse by ID.
    """
    query = db.query(Nurse).filter(Nurse.id == nurse_id)
    
    # Filter by organization if available, else by user_id
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    elif user_id:
        query = query.filter(Nurse.user_id == user_id)
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    return nurse


@router.post("", response_model=NurseResponse, status_code=201)
def create_nurse(
    nurse_data: NurseCreate,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Create a new nurse profile.
    """
    # Determine organization_id and effective user_id
    org_id = auth.organization_id if auth.is_authenticated else None
    effective_user_id = user_id or (auth.user_id if auth.is_authenticated else None)
    
    # Check for duplicate name within organization or user's nurses
    existing_query = db.query(Nurse).filter(Nurse.name == nurse_data.name)
    if org_id:
        existing_query = existing_query.filter(Nurse.organization_id == org_id)
    elif effective_user_id:
        existing_query = existing_query.filter(Nurse.user_id == effective_user_id)
    
    if existing_query.first():
        raise HTTPException(
            status_code=400,
            detail=f"Nurse with name '{nurse_data.name}' already exists"
        )
    
    # Create nurse with organization_id if available
    nurse = Nurse(
        user_id=effective_user_id,
        organization_id=org_id,
        **nurse_data.model_dump()
    )
    
    db.add(nurse)
    db.commit()
    db.refresh(nurse)
    
    return nurse


@router.put("/{nurse_id}", response_model=NurseResponse)
def update_nurse(
    nurse_id: UUID4,
    nurse_data: NurseUpdate,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Update an existing nurse profile.
    """
    query = db.query(Nurse).filter(Nurse.id == nurse_id)
    
    # Filter by organization if available, else by user_id
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    elif user_id:
        query = query.filter(Nurse.user_id == user_id)
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    # Update only provided fields
    update_data = nurse_data.model_dump(exclude_unset=True)
    
    # Check for name conflict if name is being changed
    if "name" in update_data and update_data["name"] != nurse.name:
        existing_query = db.query(Nurse).filter(
            Nurse.name == update_data["name"],
            Nurse.id != nurse_id
        )
        if auth.is_authenticated and auth.organization_id:
            existing_query = existing_query.filter(Nurse.organization_id == auth.organization_id)
        elif user_id:
            existing_query = existing_query.filter(Nurse.user_id == user_id)
        
        if existing_query.first():
            raise HTTPException(
                status_code=400,
                detail=f"Nurse with name '{update_data['name']}' already exists"
            )
    
    for field, value in update_data.items():
        setattr(nurse, field, value)
    
    db.commit()
    db.refresh(nurse)
    
    return nurse


@router.delete("/{nurse_id}", status_code=204)
def delete_nurse(
    nurse_id: UUID4,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Delete a nurse profile.
    """
    query = db.query(Nurse).filter(Nurse.id == nurse_id)
    
    # Filter by organization if available, else by user_id
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    elif user_id:
        query = query.filter(Nurse.user_id == user_id)
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    db.delete(nurse)
    db.commit()
    
    return None
