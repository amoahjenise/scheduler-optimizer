# /backend/app/api/routes/nurse.py
from datetime import datetime, timezone
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import UUID4

from app.db.deps import get_db
from app.models.nurse import Nurse
from app.models.organization import OrganizationMember, MemberRole
from app.schemas.nurse import NurseCreate, NurseUpdate, NurseResponse, NurseListResponse
from app.core.auth import OptionalAuth, ManagerAuth, AuthContext

router = APIRouter()

_SENIORITY_PATTERN = re.compile(r"^\s*(\d+)Y-(\d+(?:\.\d+)?)D\s*$")
_DAYS_PER_YEAR = 365.25


def _compute_live_seniority(raw: Optional[str], anchor_time: Optional[datetime]) -> Optional[str]:
    """Grow a stored seniority value by the time elapsed since anchor_time.

    Seniority is stored as "<years>Y-<days>D" (e.g. "3Y-283.95D") and
    represents experience, which keeps accruing for as long as someone is
    employed. Values in any other format are returned untouched.
    """
    if not raw:
        return raw

    match = _SENIORITY_PATTERN.match(raw)
    if not match:
        return raw

    years = int(match.group(1))
    days = float(match.group(2))

    if anchor_time is not None:
        now_utc = datetime.now(timezone.utc)
        at = anchor_time if anchor_time.tzinfo else anchor_time.replace(tzinfo=timezone.utc)
        days += max(0.0, (now_utc - at).total_seconds() / 86400.0)

    # Roll accumulated days over into whole years so the value stays readable.
    if days >= _DAYS_PER_YEAR:
        years += int(days // _DAYS_PER_YEAR)
        days = days % _DAYS_PER_YEAR

    days_str = f"{days:.2f}".rstrip("0").rstrip(".")
    return f"{years}Y-{days_str}D"


def _serialize_nurse_with_live_seniority(nurse: Nurse) -> dict:
    payload = NurseResponse.model_validate(nurse).model_dump()
    anchor = nurse.updated_at or nurse.created_at
    payload["seniority"] = _compute_live_seniority(payload.get("seniority"), anchor)
    return payload


def _resolve_user_scope(auth: AuthContext, query_user_id: Optional[str]) -> Optional[str]:
    """
    Resolve the effective user_id for data-scoping, enforcing IDOR protection.

    Rules:
    - Authenticated + org  → caller uses org filter; this helper is not needed.
    - Authenticated + no org → always use auth.user_id.  If the caller also
      passed a user_id param that doesn't match their JWT, reject with 403.
    - Unauthenticated → return None (caller should reject or return empty)
    """
    if auth.is_authenticated:
        if query_user_id and query_user_id != auth.user_id:
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access another user's data.",
            )
        return auth.user_id
    # Unauthenticated - never allow user_id bypass
    return None


def _assert_assistant_manager_membership(
    db: Session,
    *,
    organization_id: Optional[str],
    user_id: Optional[str],
):
    if not organization_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot validate assistant manager role without organization context",
        )

    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="Assistant manager staffing role requires a linked member account",
        )

    membership = (
        db.query(OrganizationMember)
        .filter(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
            OrganizationMember.is_active == True,
            OrganizationMember.is_approved == True,
        )
        .first()
    )
    if not membership or membership.role != MemberRole.ASSISTANT_MANAGER:
        raise HTTPException(
            status_code=400,
            detail="Staffing role assistant manager is only allowed for approved assistant manager members",
        )


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
        else:
            # No scope (org or user) -> return empty list, never expose all data
            return NurseListResponse(nurses=[], total=0, page=page, page_size=page_size)
    
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
        nurses=[_serialize_nurse_with_live_seniority(n) for n in nurses],
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
        else:
            # No scope -> cannot access any nurse
            raise HTTPException(status_code=404, detail="Nurse not found")
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    return _serialize_nurse_with_live_seniority(nurse)


@router.post("", response_model=NurseResponse, status_code=201)
def create_nurse(
    nurse_data: NurseCreate,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Create a new nurse profile. Requires the manage_nurses permission.
    """
    if not auth.is_authenticated or not auth.organization_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not auth.has_permission("manage_nurses"):
        raise HTTPException(
            status_code=403,
            detail="You do not have permission to manage staff",
        )

    org_id = auth.organization_id
    requested_user_id = nurse_data.user_id

    # Staff managers can create unlinked profiles by default and only link when explicitly selected.
    if auth.has_permission("manage_nurses"):
        effective_user_id = None
        if requested_user_id:
            membership = db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == requested_user_id,
                OrganizationMember.is_active == True,
                OrganizationMember.is_approved == True,
            ).first()
            if not membership:
                raise HTTPException(
                    status_code=400,
                    detail="Selected user is not an approved active member of this organization",
                )
            effective_user_id = requested_user_id
    else:
        # Non-managers cannot assign arbitrary links.
        effective_user_id = _resolve_user_scope(auth, user_id)

    # Check for duplicate name within organization
    existing_query = db.query(Nurse).filter(
        Nurse.name == nurse_data.name,
        Nurse.organization_id == org_id
    )
    
    if existing_query.first():
        raise HTTPException(
            status_code=400,
            detail=f"Nurse with name '{nurse_data.name}' already exists"
        )
    
    # Create nurse with organization_id
    if nurse_data.staffing_role == "assistant_manager":
        _assert_assistant_manager_membership(
            db,
            organization_id=org_id,
            user_id=effective_user_id,
        )

    nurse = Nurse(
        user_id=effective_user_id,
        organization_id=org_id,
        **nurse_data.model_dump(exclude={"user_id"})
    )
    
    db.add(nurse)
    db.commit()
    db.refresh(nurse)
    
    return _serialize_nurse_with_live_seniority(nurse)


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
        else:
            # No scope -> cannot access any nurse
            raise HTTPException(status_code=404, detail="Nurse not found")
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    # Update only provided fields
    update_data = nurse_data.model_dump(exclude_unset=True)

    # Seniority accrues against the row's last-updated timestamp. Saving any
    # other field moves that timestamp forward, so bank the time accrued so
    # far first — otherwise an unrelated edit would silently reset it.
    if "seniority" not in update_data:
        accrued = _compute_live_seniority(
            nurse.seniority, nurse.updated_at or nurse.created_at
        )
        if accrued != nurse.seniority:
            nurse.seniority = accrued

    # Allow manager/admin relinking or unlinking nurse profile ownership.
    if "user_id" in update_data:
        requested_user_id = update_data["user_id"]
        if not (auth.is_authenticated and auth.organization_id and auth.has_permission("manage_nurses")):
            raise HTTPException(
                status_code=403,
                detail="Only staff managers can change nurse profile ownership",
            )
        if requested_user_id:
            membership = db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == auth.organization_id,
                OrganizationMember.user_id == requested_user_id,
                OrganizationMember.is_active == True,
                OrganizationMember.is_approved == True,
            ).first()
            if not membership:
                raise HTTPException(
                    status_code=400,
                    detail="Selected user is not an approved active member of this organization",
                )
    
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

    next_user_id = update_data["user_id"] if "user_id" in update_data else nurse.user_id
    next_staffing_role = update_data.get("staffing_role", nurse.staffing_role)
    if next_staffing_role == "assistant_manager":
        _assert_assistant_manager_membership(
            db,
            organization_id=auth.organization_id or nurse.organization_id,
            user_id=next_user_id,
        )
    
    for field, value in update_data.items():
        setattr(nurse, field, value)
    
    db.commit()
    db.refresh(nurse)
    
    return _serialize_nurse_with_live_seniority(nurse)


@router.delete("/{nurse_id}", status_code=204)
def delete_nurse(
    nurse_id: UUID4,
    auth: OptionalAuth,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Delete a nurse profile. Requires the manage_nurses permission.
    """
    if not auth.has_permission("manage_nurses"):
        raise HTTPException(
            status_code=403,
            detail="You do not have permission to manage staff",
        )

    query = db.query(Nurse).filter(Nurse.id == nurse_id)

    if auth.is_authenticated and auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    else:
        effective_uid = _resolve_user_scope(auth, user_id)
        if effective_uid:
            query = query.filter(Nurse.user_id == effective_uid)
        else:
            # No scope -> cannot access any nurse
            raise HTTPException(status_code=404, detail="Nurse not found")
    
    nurse = query.first()
    
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    db.delete(nurse)
    db.commit()
    
    return None
