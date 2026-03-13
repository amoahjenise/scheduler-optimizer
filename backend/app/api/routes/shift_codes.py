"""API routes for managing shift codes and time slots."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from app.db.deps import get_db
from app.models.shift_code import ShiftCode, TimeSlot, ShiftType
from app.schemas.shift_code import (
    ShiftCodeCreate, ShiftCodeUpdate, ShiftCodeResponse,
    TimeSlotCreate, TimeSlotUpdate, TimeSlotResponse,
    ShiftCodeFrontend, TimeSlotFrontend, ShiftCodesListResponse
)

router = APIRouter(prefix="/shift-codes", tags=["Shift Codes"])


# Default shift codes (used when organization has none)
DEFAULT_SHIFT_CODES = [
    {"code": "07", "start": "07:00", "end": "15:15", "hours": 7.5, "type": "day", "label": "Day 8hr (07:00-15:15)"},
    {"code": "Z07", "start": "07:00", "end": "19:25", "hours": 11.25, "type": "day", "label": "Day 12hr (07:00-19:25)"},
    {"code": "11", "start": "11:00", "end": "19:15", "hours": 7.5, "type": "day", "label": "Mid 8hr (11:00-19:15)"},
    {"code": "Z11", "start": "11:00", "end": "23:25", "hours": 11.25, "type": "day", "label": "Mid 12hr (11:00-23:25)"},
    {"code": "E15", "start": "15:00", "end": "23:15", "hours": 7.5, "type": "day", "label": "Evening 8hr (15:00-23:15)"},
    {"code": "23", "start": "23:00", "end": "07:15", "hours": 7.5, "type": "night", "label": "Night 8hr (23:00-07:15)"},
    {"code": "Z19", "start": "19:00", "end": "07:25", "hours": 11.25, "type": "night", "label": "Night 12hr (19:00-07:25)"},
    {"code": "Z23", "start": "23:00", "end": "07:25", "hours": 7.5, "type": "night", "label": "Night Finish (23:00-07:25)"},
    {"code": "Z23 B", "start": "23:00", "end": "07:25", "hours": 7.5, "type": "combined", "label": "Night Finish + Back at 19:00"},
]

DEFAULT_TIME_SLOTS = [
    {"slot": "D8-", "category": "Day", "duration": "8hr", "mapsTo": ["07"], "label": "Day 8hr"},
    {"slot": "E8-", "category": "Evening", "duration": "8hr", "mapsTo": ["E15"], "label": "Evening 8hr"},
    {"slot": "N8-", "category": "Night", "duration": "8hr", "mapsTo": ["23"], "label": "Night 8hr"},
    {"slot": "ZD12-", "category": "Day", "duration": "12hr", "mapsTo": ["Z07"], "label": "Day 12hr"},
    {"slot": "ZE2-", "category": "Evening", "duration": "Split", "mapsTo": ["Z19"], "label": "Evening Start (19:00-23:00)"},
    {"slot": "ZN-", "category": "Night", "duration": "12hr", "mapsTo": ["Z19", "Z23"], "label": "Night Split (19:00-07:25)"},
    {"slot": "Z11", "category": "Day", "duration": "12hr", "mapsTo": ["Z11"], "label": "Mid 12hr (11:00-23:25)"},
    {"slot": "I1", "category": "Day", "duration": "8hr", "mapsTo": ["11"], "label": "Mid 8hr (11:00-19:15)"},
]


@router.get("", response_model=ShiftCodesListResponse)
async def get_shift_codes(
    organization_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get shift codes and time slots for an organization.
    Falls back to system defaults if organization has none.
    """
    # Try to get organization-specific codes
    shift_codes = []
    time_slots = []
    
    if organization_id:
        # Get organization-specific or system defaults (where organization_id is null)
        db_shift_codes = db.query(ShiftCode).filter(
            or_(
                ShiftCode.organization_id == organization_id,
                ShiftCode.organization_id.is_(None)
            ),
            ShiftCode.is_active == True
        ).order_by(ShiftCode.display_order).all()
        
        db_time_slots = db.query(TimeSlot).filter(
            or_(
                TimeSlot.organization_id == organization_id,
                TimeSlot.organization_id.is_(None)
            ),
            TimeSlot.is_active == True
        ).order_by(TimeSlot.display_order).all()
        
        if db_shift_codes:
            shift_codes = [
                ShiftCodeFrontend(
                    code=sc.code,
                    start=sc.start_time,
                    end=sc.end_time,
                    hours=sc.hours,
                    type=sc.shift_type.value,
                    label=sc.label
                )
                for sc in db_shift_codes
            ]
        
        if db_time_slots:
            time_slots = [
                TimeSlotFrontend(
                    slot=ts.slot,
                    category=ts.category,
                    duration=ts.duration,
                    mapsTo=[s.strip() for s in ts.maps_to.split(",")],
                    label=ts.label
                )
                for ts in db_time_slots
            ]
    
    # Fall back to defaults if no organization-specific codes
    if not shift_codes:
        shift_codes = [ShiftCodeFrontend(**sc) for sc in DEFAULT_SHIFT_CODES]
    
    if not time_slots:
        time_slots = [TimeSlotFrontend(**ts) for ts in DEFAULT_TIME_SLOTS]
    
    return ShiftCodesListResponse(shift_codes=shift_codes, time_slots=time_slots)


@router.post("", response_model=ShiftCodeResponse)
async def create_shift_code(
    shift_code: ShiftCodeCreate,
    db: Session = Depends(get_db)
):
    """Create a new shift code for an organization."""
    db_shift_code = ShiftCode(
        organization_id=shift_code.organization_id,
        code=shift_code.code,
        label=shift_code.label,
        start_time=shift_code.start_time,
        end_time=shift_code.end_time,
        hours=shift_code.hours,
        shift_type=ShiftType(shift_code.shift_type.value),
        display_order=shift_code.display_order,
        is_active=shift_code.is_active
    )
    db.add(db_shift_code)
    db.commit()
    db.refresh(db_shift_code)
    return db_shift_code


@router.put("/{shift_code_id}", response_model=ShiftCodeResponse)
async def update_shift_code(
    shift_code_id: str,
    shift_code: ShiftCodeUpdate,
    db: Session = Depends(get_db)
):
    """Update an existing shift code."""
    db_shift_code = db.query(ShiftCode).filter(ShiftCode.id == shift_code_id).first()
    if not db_shift_code:
        raise HTTPException(status_code=404, detail="Shift code not found")
    
    update_data = shift_code.model_dump(exclude_unset=True)
    if "shift_type" in update_data and update_data["shift_type"]:
        update_data["shift_type"] = ShiftType(update_data["shift_type"].value)
    
    for key, value in update_data.items():
        setattr(db_shift_code, key, value)
    
    db.commit()
    db.refresh(db_shift_code)
    return db_shift_code


@router.delete("/{shift_code_id}")
async def delete_shift_code(
    shift_code_id: str,
    db: Session = Depends(get_db)
):
    """Delete a shift code."""
    db_shift_code = db.query(ShiftCode).filter(ShiftCode.id == shift_code_id).first()
    if not db_shift_code:
        raise HTTPException(status_code=404, detail="Shift code not found")
    
    db.delete(db_shift_code)
    db.commit()
    return {"message": "Shift code deleted"}


# Time Slots endpoints
@router.post("/time-slots", response_model=TimeSlotResponse)
async def create_time_slot(
    time_slot: TimeSlotCreate,
    db: Session = Depends(get_db)
):
    """Create a new time slot for an organization."""
    db_time_slot = TimeSlot(
        organization_id=time_slot.organization_id,
        slot=time_slot.slot,
        label=time_slot.label,
        category=time_slot.category,
        duration=time_slot.duration,
        maps_to=time_slot.maps_to,
        display_order=time_slot.display_order,
        is_active=time_slot.is_active
    )
    db.add(db_time_slot)
    db.commit()
    db.refresh(db_time_slot)
    return db_time_slot


@router.put("/time-slots/{time_slot_id}", response_model=TimeSlotResponse)
async def update_time_slot(
    time_slot_id: str,
    time_slot: TimeSlotUpdate,
    db: Session = Depends(get_db)
):
    """Update an existing time slot."""
    db_time_slot = db.query(TimeSlot).filter(TimeSlot.id == time_slot_id).first()
    if not db_time_slot:
        raise HTTPException(status_code=404, detail="Time slot not found")
    
    update_data = time_slot.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_time_slot, key, value)
    
    db.commit()
    db.refresh(db_time_slot)
    return db_time_slot


@router.delete("/time-slots/{time_slot_id}")
async def delete_time_slot(
    time_slot_id: str,
    db: Session = Depends(get_db)
):
    """Delete a time slot."""
    db_time_slot = db.query(TimeSlot).filter(TimeSlot.id == time_slot_id).first()
    if not db_time_slot:
        raise HTTPException(status_code=404, detail="Time slot not found")
    
    db.delete(db_time_slot)
    db.commit()
    return {"message": "Time slot deleted"}


@router.post("/initialize-defaults")
async def initialize_defaults(
    organization_id: str,
    db: Session = Depends(get_db)
):
    """
    Initialize default shift codes and time slots for an organization.
    Copies system defaults to the organization so they can be customized.
    """
    # Check if organization already has codes
    existing_codes = db.query(ShiftCode).filter(
        ShiftCode.organization_id == organization_id
    ).count()
    
    if existing_codes > 0:
        raise HTTPException(
            status_code=400, 
            detail="Organization already has shift codes. Delete them first to re-initialize."
        )
    
    # Create shift codes
    for idx, sc_data in enumerate(DEFAULT_SHIFT_CODES):
        db_shift_code = ShiftCode(
            organization_id=organization_id,
            code=sc_data["code"],
            label=sc_data["label"],
            start_time=sc_data["start"],
            end_time=sc_data["end"],
            hours=sc_data["hours"],
            shift_type=ShiftType(sc_data["type"]),
            display_order=idx
        )
        db.add(db_shift_code)
    
    # Create time slots
    for idx, ts_data in enumerate(DEFAULT_TIME_SLOTS):
        db_time_slot = TimeSlot(
            organization_id=organization_id,
            slot=ts_data["slot"],
            label=ts_data["label"],
            category=ts_data["category"],
            duration=ts_data["duration"],
            maps_to=",".join(ts_data["mapsTo"]),
            display_order=idx
        )
        db.add(db_time_slot)
    
    db.commit()
    
    return {"message": f"Initialized {len(DEFAULT_SHIFT_CODES)} shift codes and {len(DEFAULT_TIME_SLOTS)} time slots"}
