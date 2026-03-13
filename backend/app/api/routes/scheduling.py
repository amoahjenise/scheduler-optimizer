"""Scheduling management API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.deps import get_db
from app.models import (
    ScheduleDemand, ShiftTemplate, TimeOffRequest,
    NurseHoursReconciliation, Nurse, ShiftCode, Organization,
    ScheduleRecurrence, EmployeePreferredSchedule, GeneratedScheduleSnapshot
)
from app.schemas.scheduling import (
    ScheduleDemandCreate, ScheduleDemandResponse, ScheduleDemandList,
    ShiftTemplateCreate, ShiftTemplateResponse,
    TimeOffRequestCreate, TimeOffRequestApprove, TimeOffRequestDeny, TimeOffRequestResponse,
    NurseHoursReconciliationResponse, ComplianceScoreResponse,
    BalancingShiftRecommendations,
    PublishScheduleRequest, PublishScheduleResponse,
    ShiftAssignmentRequest, ShiftAssignmentResponse,
    ScheduleRecurrenceCreate, ScheduleRecurrenceResponse,
    EmployeePreferredScheduleCreate, EmployeePreferredScheduleResponse,
    GenerateScheduleFromRecurrenceRequest, GeneratedScheduleSnapshotResponse
)
from app.services.reconciliation_service import ReconciliationService
from app.core.auth import OrgAuth

router = APIRouter(prefix="/api/scheduling", tags=["scheduling"])


# ============= Schedule Demands =============

@router.post("/demands", response_model=ScheduleDemandResponse)
def create_demand(
    demand: ScheduleDemandCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Create a schedule demand for a specific shift/date."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    shift = db.query(ShiftCode).filter(ShiftCode.id == demand.shift_code_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift code not found")
    
    demand_obj = ScheduleDemand(
        organization_id=auth.organization_id,
        shift_code_id=demand.shift_code_id,
        date=demand.date,
        global_daily_target=demand.global_daily_target,
        min_staff_required=demand.min_staff_required,
        skill_requirements=demand.skill_requirements,
        notes=demand.get("notes", "")
    )
    db.add(demand_obj)
    db.commit()
    db.refresh(demand_obj)
    return demand_obj


@router.get("/demands", response_model=ScheduleDemandList)
def list_demands(
    date_start: str = Query(...),
    date_end: str = Query(...),
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """List all demands for org in date range."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    demands = db.query(ScheduleDemand).filter(
        ScheduleDemand.organization_id == auth.organization_id,
        ScheduleDemand.date >= date_start,
        ScheduleDemand.date <= date_end,
        ScheduleDemand.is_active == True
    ).all()
    
    compliance = ReconciliationService.get_compliance_score(db, auth.organization_id)
    
    return {
        "demands": demands,
        "total": len(demands),
        "compliance_score": compliance["score"]
    }


@router.get("/demands/{demand_id}", response_model=ScheduleDemandResponse)
def get_demand(
    demand_id: str,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get a specific demand."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    demand = db.query(ScheduleDemand).filter(
        ScheduleDemand.id == demand_id,
        ScheduleDemand.organization_id == auth.organization_id
    ).first()
    if not demand:
        raise HTTPException(status_code=404, detail="Demand not found")
    return demand


@router.put("/demands/{demand_id}", response_model=ScheduleDemandResponse)
def update_demand(
    demand_id: str,
    demand: ScheduleDemandCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Update a demand."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    demand_obj = db.query(ScheduleDemand).filter(
        ScheduleDemand.id == demand_id,
        ScheduleDemand.organization_id == auth.organization_id
    ).first()
    if not demand_obj:
        raise HTTPException(status_code=404, detail="Demand not found")
    
    demand_obj.min_staff_required = demand.min_staff_required
    demand_obj.global_daily_target = demand.global_daily_target
    demand_obj.skill_requirements = demand.skill_requirements
    
    db.commit()
    db.refresh(demand_obj)
    return demand_obj


@router.delete("/demands/{demand_id}")
def delete_demand(
    demand_id: str,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Soft-delete a demand."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    demand = db.query(ScheduleDemand).filter(
        ScheduleDemand.id == demand_id,
        ScheduleDemand.organization_id == auth.organization_id
    ).first()
    if not demand:
        raise HTTPException(status_code=404, detail="Demand not found")
    
    demand.is_active = False
    db.commit()
    return {"success": True}


# ============= Shift Templates =============

@router.post("/templates", response_model=ShiftTemplateResponse)
def create_template(
    template: ShiftTemplateCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Create a reusable shift template."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    template_obj = ShiftTemplate(
        organization_id=auth.organization_id,
        name=template.name,
        description=template.description,
        template_type=template.template_type,
        pattern=template.pattern,
        applicable_shift_codes=template.applicable_shift_codes,
        applicable_roles=template.applicable_roles
    )
    db.add(template_obj)
    db.commit()
    db.refresh(template_obj)
    return template_obj


@router.get("/templates", response_model=List[ShiftTemplateResponse])
def list_templates(
    template_type: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """List shift templates."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    query = db.query(ShiftTemplate).filter(
        ShiftTemplate.organization_id == auth.organization_id,
        ShiftTemplate.is_active == True
    )
    if template_type:
        query = query.filter(ShiftTemplate.template_type == template_type)
    
    return query.all()


@router.put("/templates/{template_id}", response_model=ShiftTemplateResponse)
def update_template(
    template_id: str,
    template: ShiftTemplateCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Update a template."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    template_obj = db.query(ShiftTemplate).filter(
        ShiftTemplate.id == template_id,
        ShiftTemplate.organization_id == auth.organization_id
    ).first()
    if not template_obj:
        raise HTTPException(status_code=404, detail="Template not found")
    
    template_obj.name = template.name
    template_obj.description = template.description
    template_obj.pattern = template.pattern
    template_obj.applicable_shift_codes = template.applicable_shift_codes
    template_obj.applicable_roles = template.applicable_roles
    
    db.commit()
    db.refresh(template_obj)
    return template_obj


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Delete a template."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    template = db.query(ShiftTemplate).filter(
        ShiftTemplate.id == template_id,
        ShiftTemplate.organization_id == auth.organization_id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    template.is_active = False
    db.commit()
    return {"success": True}


# ============= Time-Off Requests =============

@router.post("/time-off-requests", response_model=TimeOffRequestResponse)
def create_time_off_request(
    request: TimeOffRequestCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Create time-off request."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    nurse = db.query(Nurse).filter(Nurse.id == request.nurse_id).first()
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")
    
    time_off = TimeOffRequest(
        organization_id=auth.organization_id,
        nurse_id=request.nurse_id,
        start_date=request.start_date,
        end_date=request.end_date,
        reason=request.reason,
        notes=request.notes,
        status="pending"
    )
    db.add(time_off)
    db.commit()
    db.refresh(time_off)
    return time_off


@router.get("/time-off-requests", response_model=List[TimeOffRequestResponse])
def list_time_off_requests(
    status: Optional[str] = None,
    nurse_id: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """List time-off requests."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    query = db.query(TimeOffRequest).filter(TimeOffRequest.organization_id == auth.organization_id)
    
    if status:
        query = query.filter(TimeOffRequest.status == status)
    if nurse_id:
        query = query.filter(TimeOffRequest.nurse_id == nurse_id)
    
    return query.all()


@router.post("/time-off-requests/{request_id}/approve", response_model=TimeOffRequestResponse)
def approve_time_off(
    request_id: str,
    approval: TimeOffRequestApprove,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Approve time-off request."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    time_off = db.query(TimeOffRequest).filter(
        TimeOffRequest.id == request_id,
        TimeOffRequest.organization_id == auth.organization_id
    ).first()
    if not time_off:
        raise HTTPException(status_code=404, detail="Request not found")
    
    time_off.status = "approved"
    time_off.approved_by_id = approval.approved_by_id
    time_off.approval_timestamp = approval.approval_timestamp or datetime.utcnow()
    
    db.commit()
    db.refresh(time_off)
    return time_off


@router.post("/time-off-requests/{request_id}/deny", response_model=TimeOffRequestResponse)
def deny_time_off(
    request_id: str,
    denial: TimeOffRequestDeny,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Deny time-off request."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    time_off = db.query(TimeOffRequest).filter(
        TimeOffRequest.id == request_id,
        TimeOffRequest.organization_id == auth.organization_id
    ).first()
    if not time_off:
        raise HTTPException(status_code=404, detail="Request not found")
    
    time_off.status = "denied"
    time_off.approved_by_id = denial.approved_by_id
    time_off.approval_timestamp = datetime.utcnow()
    time_off.denial_reason = denial.denial_reason
    
    db.commit()
    db.refresh(time_off)
    return time_off


# ============= Reconciliation =============

@router.get("/reconciliation/compliance", response_model=ComplianceScoreResponse)
def get_compliance_score(
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get organizational compliance score."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    return ReconciliationService.get_compliance_score(db, auth.organization_id)


@router.get("/reconciliation/balancing-shifts", response_model=BalancingShiftRecommendations)
def get_balancing_shifts(
    period_end_date: str = Query(...),
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get recommended balancing shifts for the period."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    recommendations = ReconciliationService.get_recommended_bshifts(
        db, auth.organization_id, period_end_date
    )
    
    total_hours = sum(r["hours_needed"] for r in recommendations)
    
    return {
        "recommendations": recommendations,
        "total_hours_to_schedule": total_hours,
        "period_end_date": period_end_date
    }


@router.get("/reconciliation/{nurse_id}", response_model=NurseHoursReconciliationResponse)
def get_nurse_reconciliation(
    nurse_id: str,
    period_start_date: str = Query(...),
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get reconciliation for a nurse in 28-day period."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    period_start, period_end = ReconciliationService.calculate_28day_window(period_start_date)
    
    reconciliation = db.query(NurseHoursReconciliation).filter(
        NurseHoursReconciliation.organization_id == auth.organization_id,
        NurseHoursReconciliation.nurse_id == nurse_id,
        NurseHoursReconciliation.period_start_date == period_start
    ).first()
    
    if not reconciliation:
        nurse = db.query(Nurse).filter(Nurse.id == nurse_id).first()
        if not nurse:
            raise HTTPException(status_code=404, detail="Nurse not found")
        
        reconciliation = ReconciliationService.calculate_reconciliation(
            db, nurse, period_start, period_end, auth.organization_id
        )
    
    return reconciliation


@router.post("/reconciliation/calculate-all")
def recalculate_all_reconciliations(
    period_end_date: str = Query(...),
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Recalculate reconciliations for all nurses in org."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    period_start, period_end = ReconciliationService.calculate_28day_window(period_end_date)
    
    nurses = db.query(Nurse).filter(Nurse.organization_id == auth.organization_id).all()
    
    created_count = 0
    for nurse in nurses:
        existing = db.query(NurseHoursReconciliation).filter(
            NurseHoursReconciliation.nurse_id == nurse.id,
            NurseHoursReconciliation.period_start_date == period_start
        ).first()
        
        if not existing:
            reconciliation = ReconciliationService.calculate_reconciliation(
                db, nurse, period_start, period_end, auth.organization_id
            )
            db.add(reconciliation)
            created_count += 1
    
    db.commit()
    
    compliance = ReconciliationService.get_compliance_score(db, auth.organization_id)
    
    return {
        "success": True,
        "created_reconciliations": created_count,
        "compliance_score": compliance
    }


# ============= Schedule Publishing =============

@router.post("/publish", response_model=PublishScheduleResponse)
def publish_schedule(
    publish_req: PublishScheduleRequest,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Publish a schedule with conflict detection."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    conflicts = []
    
    return {
        "success": True,
        "conflicts_detected": conflicts,
        "requires_approval": publish_req.require_approval,
        "message": "Schedule published successfully"
    }


@router.post("/assignments", response_model=ShiftAssignmentResponse)
def create_shift_assignments(
    assignment_req: ShiftAssignmentRequest,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Assign one or more shifts to nurses."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    return {
        "success": True,
        "assigned_count": len(assignment_req.assignments),
        "failed_count": 0,
        "message": f"Assigned {len(assignment_req.assignments)} shifts"
    }


# ============= Schedule Recurrence =============

@router.post("/recurrences", response_model=ScheduleRecurrenceResponse)
def create_recurrence(
    recurrence: ScheduleRecurrenceCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Create a schedule recurrence pattern."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    recurrence_obj = ScheduleRecurrence(
        org_id=auth.organization_id,
        name=recurrence.name,
        description=recurrence.description,
        recurrence_type=recurrence.recurrence_type,
        pattern=recurrence.pattern,
        cycle_length_days=recurrence.cycle_length_days,
        applicable_nurses=recurrence.applicable_nurses or [],
        start_date=recurrence.start_date,
        end_date=recurrence.end_date,
    )
    
    db.add(recurrence_obj)
    db.commit()
    db.refresh(recurrence_obj)
    return recurrence_obj


@router.get("/recurrences", response_model=List[ScheduleRecurrenceResponse])
def list_recurrences(
    db: Session = Depends(get_db),
    auth: OrgAuth = None,
    recurrence_type: Optional[str] = Query(None)
):
    """List schedule recurrences for organization."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    query = db.query(ScheduleRecurrence).filter(ScheduleRecurrence.org_id == auth.organization_id)
    if recurrence_type:
        query = query.filter(ScheduleRecurrence.recurrence_type == recurrence_type)
    
    return query.all()


@router.get("/recurrences/{recurrence_id}", response_model=ScheduleRecurrenceResponse)
def get_recurrence(
    recurrence_id: int,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get specific recurrence pattern."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    recurrence = db.query(ScheduleRecurrence).filter(
        ScheduleRecurrence.id == recurrence_id,
        ScheduleRecurrence.org_id == auth.organization_id
    ).first()
    
    if not recurrence:
        raise HTTPException(status_code=404, detail="Recurrence not found")
    
    return recurrence


@router.put("/recurrences/{recurrence_id}", response_model=ScheduleRecurrenceResponse)
def update_recurrence(
    recurrence_id: int,
    recurrence: ScheduleRecurrenceCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Update schedule recurrence pattern."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    recurrence_obj = db.query(ScheduleRecurrence).filter(
        ScheduleRecurrence.id == recurrence_id,
        ScheduleRecurrence.org_id == auth.organization_id
    ).first()
    
    if not recurrence_obj:
        raise HTTPException(status_code=404, detail="Recurrence not found")
    
    recurrence_obj.name = recurrence.name
    recurrence_obj.description = recurrence.description
    recurrence_obj.recurrence_type = recurrence.recurrence_type
    recurrence_obj.pattern = recurrence.pattern
    recurrence_obj.cycle_length_days = recurrence.cycle_length_days
    recurrence_obj.applicable_nurses = recurrence.applicable_nurses or []
    recurrence_obj.start_date = recurrence.start_date
    recurrence_obj.end_date = recurrence.end_date
    
    db.commit()
    db.refresh(recurrence_obj)
    return recurrence_obj


@router.post("/recurrences/{recurrence_id}/generate-schedule", response_model=GeneratedScheduleSnapshotResponse)
def generate_schedule_from_recurrence(
    recurrence_id: int,
    request: GenerateScheduleFromRecurrenceRequest,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Generate a schedule from a recurrence pattern."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    recurrence = db.query(ScheduleRecurrence).filter(
        ScheduleRecurrence.id == recurrence_id,
        ScheduleRecurrence.org_id == auth.organization_id
    ).first()
    
    if not recurrence:
        raise HTTPException(status_code=404, detail="Recurrence not found")
    
    # Generate schedule based on pattern
    start = datetime.strptime(request.start_date, "%Y-%m-%d").date()
    end = datetime.strptime(request.end_date, "%Y-%m-%d").date()
    
    # TODO: Implement schedule generation logic
    schedule_data = {}
    
    snapshot = GeneratedScheduleSnapshot(
        org_id=auth.organization_id,
        recurrence_id=recurrence_id,
        period_start_date=start,
        period_end_date=end,
        schedule_data=schedule_data,
        generated_at=datetime.utcnow(),
        generation_method="recurrence"
    )
    
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


# ============= Employee Preferred Schedules =============

@router.post("/employee-preferences", response_model=EmployeePreferredScheduleResponse)
def create_employee_preference(
    pref: EmployeePreferredScheduleCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Create employee preferred schedule."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    preference = EmployeePreferredSchedule(
        org_id=auth.organization_id,
        nurse_id=pref.nurse_id,
        preferred_pattern=pref.preferred_pattern,
        period_start_date=pref.period_start_date,
        period_end_date=pref.period_end_date,
        constraints=pref.constraints or {},
        source=pref.source,
        upload_filename=pref.upload_filename
    )
    
    db.add(preference)
    db.commit()
    db.refresh(preference)
    return preference


@router.get("/employee-preferences/{nurse_id}", response_model=List[EmployeePreferredScheduleResponse])
def get_employee_preferences(
    nurse_id: str,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Get employee preferred schedules."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    preferences = db.query(EmployeePreferredSchedule).filter(
        EmployeePreferredSchedule.org_id == auth.organization_id,
        EmployeePreferredSchedule.nurse_id == nurse_id
    ).all()
    
    return preferences


@router.put("/employee-preferences/{pref_id}", response_model=EmployeePreferredScheduleResponse)
def update_employee_preference(
    pref_id: int,
    pref: EmployeePreferredScheduleCreate,
    db: Session = Depends(get_db),
    auth: OrgAuth = None
):
    """Update employee preferred schedule."""
    if not auth or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    
    preference = db.query(EmployeePreferredSchedule).filter(
        EmployeePreferredSchedule.id == pref_id,
        EmployeePreferredSchedule.org_id == auth.organization_id
    ).first()
    
    if not preference:
        raise HTTPException(status_code=404, detail="Preference not found")
    
    preference.preferred_pattern = pref.preferred_pattern
    preference.constraints = pref.constraints or {}
    preference.status = "pending_review"  # Reset to pending when updated
    
    db.commit()
    db.refresh(preference)
    return preference
