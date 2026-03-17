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


def _resolve_user_scope(auth: AuthContext, query_user_id: Optional[str]) -> Optional[str]:
    """
    Resolve the effective user_id for data-scoping, enforcing IDOR protection.

    Rules:
    - Authenticated + org  → caller uses org filter; this helper is not needed.
    - Authenticated + no org → always use auth.user_id.  If the caller also
      passed a user_id param that doesn't match their JWT, reject with 403.
    - Unauthenticated → use the query param as-is (legacy / dev compatibility).
    """
    if auth.is_authenticated:
        if query_user_id and query_user_id != auth.user_id:
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access another user's data.",
            )
        return auth.user_id
    return query_user_id


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

    # Filter by organization if available, else by the authenticated user's ID.
    # _resolve_user_scope() prevents IDOR by rejecting mismatched user_id params.
    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    else:
        effective_uid = _resolve_user_scope(auth, user_id)
        if effective_uid:
            query = query.filter(Nurse.user_id == effective_uid)
    
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

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    else:
        effective_uid = _resolve_user_scope(auth, user_id)
        if effective_uid:
            query = query.filter(Nurse.user_id == effective_uid)
    
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
    effective_user_id = _resolve_user_scope(auth, user_id)

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

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    else:
        effective_uid = _resolve_user_scope(auth, user_id)
        if effective_uid:
            query = query.filter(Nurse.user_id == effective_uid)
    
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
        else:
            uid = _resolve_user_scope(auth, user_id)
            if uid:
                existing_query = existing_query.filter(Nurse.user_id == uid)
        
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

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    else:
        effective_uid = _resolve_user_scope(auth, user_id)
        if effective_uid:
            query = query.filter(Nurse.user_id == effective_uid)
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    db.delete(nurse)
    db.commit()
    
    return None
