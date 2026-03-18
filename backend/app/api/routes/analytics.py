"""
Analytics API Routes

Endpoints for tracking and retrieving analytics data
for pilot study ROI demonstration.
"""
from datetime import datetime, timedelta
from typing import Optional, List, Any, Dict
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.deps import get_db
from app.services.analytics_service import AnalyticsService
from app.core.auth import RequiredAuth, AdminAuth


router = APIRouter()


# ========== Schemas ==========

class AnalyticsEventCreate(BaseModel):
    event_type: str
    event_name: str
    event_category: Optional[str] = None
    properties: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None


class SchedulingMetricsCreate(BaseModel):
    schedule_id: Optional[UUID] = None
    time_to_create_seconds: Optional[int] = None
    optimization_duration_seconds: Optional[float] = None
    conflicts_resolved: Optional[int] = None
    shifts_covered: Optional[int] = None
    shifts_total: Optional[int] = None
    nurses_assigned: Optional[int] = None
    schedule_days: Optional[int] = None


class PilotStudyReportCreate(BaseModel):
    report_name: str
    period_start: datetime
    period_end: datetime


class PilotStudyReportResponse(BaseModel):
    id: UUID
    report_name: str
    period_start: datetime
    period_end: datetime
    total_schedules_created: int
    total_handovers_completed: int
    total_active_users: int
    total_time_saved_hours: Optional[float]
    avg_time_saved_per_schedule_minutes: Optional[float]
    avg_coverage_percentage: Optional[float]
    handover_completion_rate: Optional[float]
    estimated_labor_cost_saved: Optional[float]
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True


class AnalyticsSummary(BaseModel):
    scheduling: Dict[str, Any]
    handover: Dict[str, Any]
    period: Dict[str, Any]


# ========== Event Tracking ==========

@router.post("/events", status_code=201)
async def track_event(
    event: AnalyticsEventCreate,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Track an analytics event.
    """
    service = AnalyticsService(db)
    
    result = service.track_event(
        event_type=event.event_type,
        event_name=event.event_name,
        event_category=event.event_category,
        properties=event.properties,
        session_id=event.session_id,
        organization_id=UUID(auth.organization_id) if auth.organization_id else None,
        user_id=auth.user_id
    )
    
    return {"id": str(result.id), "status": "tracked"}


@router.post("/page-view", status_code=201)
async def track_page_view(
    page_name: str,
    auth: RequiredAuth,
    properties: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db)
):
    """
    Track a page view event.
    """
    service = AnalyticsService(db)
    
    result = service.track_page_view(
        page_name=page_name,
        organization_id=UUID(auth.organization_id) if auth.organization_id else None,
        user_id=auth.user_id,
        properties=properties
    )
    
    return {"id": str(result.id), "status": "tracked"}


# ========== Scheduling Metrics ==========

@router.post("/scheduling-metrics", status_code=201)
async def record_scheduling_metrics(
    metrics: SchedulingMetricsCreate,
    auth: RequiredAuth,
    db: Session = Depends(get_db)
):
    """
    Record metrics for a schedule creation.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    result = service.record_scheduling_metrics(
        organization_id=UUID(auth.organization_id),
        **metrics.model_dump()
    )
    
    return {
        "id": str(result.id),
        "time_saved_seconds": result.time_saved_seconds,
        "time_saved_percentage": result.time_saved_percentage,
        "estimated_cost_saved": round(
            (result.time_saved_seconds or 0) / 3600 * 45, 2
        )  # $45/hr avg
    }


@router.get("/scheduling-summary")
async def get_scheduling_summary(
    auth: AdminAuth,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get scheduling metrics summary for the organization.
    Admin only.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    return service.get_scheduling_summary(
        organization_id=UUID(auth.organization_id),
        start_date=start_date,
        end_date=end_date
    )


# ========== Handover Metrics ==========

@router.get("/handover-summary")
async def get_handover_summary(
    auth: AdminAuth,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get handover metrics summary for the organization.
    Admin only.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    return service.get_handover_summary(
        organization_id=UUID(auth.organization_id),
        start_date=start_date,
        end_date=end_date
    )


# ========== Pilot Study Reports ==========

@router.post("/pilot-reports", response_model=PilotStudyReportResponse)
async def create_pilot_study_report(
    report: PilotStudyReportCreate,
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Generate a new pilot study report.
    Admin only.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    result = service.generate_pilot_study_report(
        organization_id=UUID(auth.organization_id),
        report_name=report.report_name,
        period_start=report.period_start,
        period_end=report.period_end,
        created_by=auth.user_id
    )
    
    return result


@router.get("/pilot-reports", response_model=List[PilotStudyReportResponse])
async def list_pilot_study_reports(
    auth: AdminAuth,
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    List all pilot study reports for the organization.
    Admin only.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    return service.get_pilot_study_reports(
        organization_id=UUID(auth.organization_id),
        status=status
    )


@router.post("/pilot-reports/{report_id}/finalize", response_model=PilotStudyReportResponse)
async def finalize_pilot_study_report(
    report_id: UUID,
    auth: AdminAuth,
    db: Session = Depends(get_db)
):
    """
    Finalize a pilot study report.
    Admin only.
    """
    service = AnalyticsService(db)
    
    result = service.finalize_report(report_id)
    if not result:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return result


# ========== Dashboard Summary ==========

@router.get("/dashboard")
async def get_analytics_dashboard(
    auth: AdminAuth,
    period_days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db)
):
    """
    Get analytics dashboard data for the admin panel.
    Admin only.
    """
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    service = AnalyticsService(db)
    
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=period_days)
    
    scheduling = service.get_scheduling_summary(
        organization_id=UUID(auth.organization_id),
        start_date=start_date,
        end_date=end_date
    )
    
    handover = service.get_handover_summary(
        organization_id=UUID(auth.organization_id),
        start_date=start_date,
        end_date=end_date
    )
    
    return {
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": period_days
        },
        "scheduling": scheduling,
        "handover": handover,
        "roi_summary": {
            "total_time_saved_hours": scheduling["total_time_saved_hours"],
            "estimated_cost_saved_cad": scheduling["estimated_cost_saved_cad"],
            "efficiency_gain_percentage": scheduling["avg_time_saved_percentage"]
        }
    }
