"""
Analytics Service

Provides methods for tracking and aggregating analytics data
for pilot study ROI demonstration.
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.analytics import (
    AnalyticsEvent,
    SchedulingMetrics,
    HandoverMetrics,
    UserActivityMetrics,
    PilotStudyReport
)


# Industry benchmark: average time to create a weekly schedule manually
MANUAL_SCHEDULING_BENCHMARK_HOURS = 4.0  # per week
MANUAL_SCHEDULING_BENCHMARK_MINUTES_PER_NURSE = 5.0

# Average nurse hourly rate in Quebec (CAD)
NURSE_HOURLY_RATE_CAD = 45.0


class AnalyticsService:
    """
    Service for tracking and aggregating analytics data.
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    # ========== Event Tracking ==========
    
    def track_event(
        self,
        event_type: str,
        event_name: str,
        organization_id: Optional[UUID] = None,
        user_id: Optional[str] = None,
        event_category: Optional[str] = None,
        properties: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None
    ) -> AnalyticsEvent:
        """
        Track a generic analytics event.
        """
        event = AnalyticsEvent(
            event_type=event_type,
            event_name=event_name,
            organization_id=organization_id,
            user_id=user_id,
            event_category=event_category,
            properties=properties or {},
            session_id=session_id,
            timestamp=datetime.utcnow()
        )
        self.db.add(event)
        self.db.commit()
        return event
    
    def track_page_view(
        self,
        page_name: str,
        organization_id: Optional[UUID] = None,
        user_id: Optional[str] = None,
        properties: Optional[Dict[str, Any]] = None
    ) -> AnalyticsEvent:
        """
        Track a page view event.
        """
        return self.track_event(
            event_type="page_view",
            event_name=page_name,
            organization_id=organization_id,
            user_id=user_id,
            event_category="navigation",
            properties=properties
        )
    
    def track_action(
        self,
        action_name: str,
        category: str,
        organization_id: Optional[UUID] = None,
        user_id: Optional[str] = None,
        properties: Optional[Dict[str, Any]] = None
    ) -> AnalyticsEvent:
        """
        Track a user action event.
        """
        return self.track_event(
            event_type="action",
            event_name=action_name,
            organization_id=organization_id,
            user_id=user_id,
            event_category=category,
            properties=properties
        )
    
    # ========== Scheduling Metrics ==========
    
    def record_scheduling_metrics(
        self,
        organization_id: UUID,
        schedule_id: Optional[UUID] = None,
        time_to_create_seconds: Optional[int] = None,
        optimization_duration_seconds: Optional[float] = None,
        conflicts_resolved: Optional[int] = None,
        shifts_covered: Optional[int] = None,
        shifts_total: Optional[int] = None,
        nurses_assigned: Optional[int] = None,
        schedule_days: Optional[int] = None,
        **kwargs
    ) -> SchedulingMetrics:
        """
        Record metrics for a schedule creation.
        """
        # Calculate coverage percentage
        coverage_percentage = None
        if shifts_covered and shifts_total and shifts_total > 0:
            coverage_percentage = (shifts_covered / shifts_total) * 100
        
        # Estimate time saved
        estimated_manual_time = None
        time_saved = None
        time_saved_percentage = None
        
        if nurses_assigned and schedule_days:
            # Estimate based on industry benchmark
            estimated_manual_time = int(
                nurses_assigned * schedule_days * MANUAL_SCHEDULING_BENCHMARK_MINUTES_PER_NURSE * 60
            )
            
            if time_to_create_seconds:
                time_saved = estimated_manual_time - time_to_create_seconds
                time_saved_percentage = (time_saved / estimated_manual_time) * 100 if estimated_manual_time > 0 else 0
        
        metrics = SchedulingMetrics(
            organization_id=organization_id,
            schedule_id=schedule_id,
            time_to_create_seconds=time_to_create_seconds,
            optimization_duration_seconds=optimization_duration_seconds,
            conflicts_resolved=conflicts_resolved,
            shifts_covered=shifts_covered,
            shifts_total=shifts_total,
            coverage_percentage=coverage_percentage,
            nurses_assigned=nurses_assigned,
            schedule_days=schedule_days,
            estimated_manual_time_seconds=estimated_manual_time,
            time_saved_seconds=time_saved,
            time_saved_percentage=time_saved_percentage,
            schedule_creation_completed_at=datetime.utcnow(),
            **kwargs
        )
        self.db.add(metrics)
        self.db.commit()
        return metrics
    
    def get_scheduling_summary(
        self,
        organization_id: UUID,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get scheduling metrics summary for a time period.
        """
        query = self.db.query(SchedulingMetrics).filter(
            SchedulingMetrics.organization_id == organization_id
        )
        
        if start_date:
            query = query.filter(SchedulingMetrics.created_at >= start_date)
        if end_date:
            query = query.filter(SchedulingMetrics.created_at <= end_date)
        
        metrics = query.all()
        
        if not metrics:
            return {
                "total_schedules": 0,
                "total_time_saved_hours": 0,
                "avg_time_saved_percentage": 0,
                "avg_coverage_percentage": 0,
                "total_conflicts_resolved": 0
            }
        
        total_time_saved = sum(m.time_saved_seconds or 0 for m in metrics)
        avg_time_saved_pct = sum(m.time_saved_percentage or 0 for m in metrics) / len(metrics)
        avg_coverage = sum(m.coverage_percentage or 0 for m in metrics) / len(metrics)
        total_conflicts = sum(m.conflicts_resolved or 0 for m in metrics)
        
        return {
            "total_schedules": len(metrics),
            "total_time_saved_hours": round(total_time_saved / 3600, 1),
            "avg_time_saved_percentage": round(avg_time_saved_pct, 1),
            "avg_coverage_percentage": round(avg_coverage, 1),
            "total_conflicts_resolved": total_conflicts,
            "estimated_cost_saved_cad": round((total_time_saved / 3600) * NURSE_HOURLY_RATE_CAD, 2)
        }
    
    # ========== Handover Metrics ==========
    
    def record_handover_metrics(
        self,
        organization_id: UUID,
        period_start: datetime,
        period_end: datetime,
        period_type: str = "daily",
        handovers_created: int = 0,
        handovers_completed: int = 0,
        avg_completion_time_seconds: Optional[float] = None,
        **kwargs
    ) -> HandoverMetrics:
        """
        Record handover metrics for a time period.
        """
        completion_rate = None
        if handovers_created > 0:
            completion_rate = (handovers_completed / handovers_created) * 100
        
        metrics = HandoverMetrics(
            organization_id=organization_id,
            period_start=period_start,
            period_end=period_end,
            period_type=period_type,
            handovers_created=handovers_created,
            handovers_completed=handovers_completed,
            completion_rate=completion_rate,
            avg_completion_time_seconds=avg_completion_time_seconds,
            handovers_pending=handovers_created - handovers_completed,
            **kwargs
        )
        self.db.add(metrics)
        self.db.commit()
        return metrics
    
    def get_handover_summary(
        self,
        organization_id: UUID,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get handover metrics summary for a time period.
        """
        query = self.db.query(HandoverMetrics).filter(
            HandoverMetrics.organization_id == organization_id
        )
        
        if start_date:
            query = query.filter(HandoverMetrics.period_start >= start_date)
        if end_date:
            query = query.filter(HandoverMetrics.period_end <= end_date)
        
        metrics = query.all()
        
        if not metrics:
            return {
                "total_handovers_created": 0,
                "total_handovers_completed": 0,
                "avg_completion_rate": 0,
                "avg_completion_time_minutes": 0
            }
        
        total_created = sum(m.handovers_created for m in metrics)
        total_completed = sum(m.handovers_completed for m in metrics)
        avg_completion_rate = sum(m.completion_rate or 0 for m in metrics) / len(metrics)
        avg_time = sum(m.avg_completion_time_seconds or 0 for m in metrics) / len(metrics)
        
        return {
            "total_handovers_created": total_created,
            "total_handovers_completed": total_completed,
            "avg_completion_rate": round(avg_completion_rate, 1),
            "avg_completion_time_minutes": round(avg_time / 60, 1)
        }
    
    # ========== Pilot Study Report Generation ==========
    
    def generate_pilot_study_report(
        self,
        organization_id: UUID,
        report_name: str,
        period_start: datetime,
        period_end: datetime,
        created_by: Optional[str] = None
    ) -> PilotStudyReport:
        """
        Generate a comprehensive pilot study report.
        """
        # Get scheduling summary
        scheduling_summary = self.get_scheduling_summary(
            organization_id, period_start, period_end
        )
        
        # Get handover summary
        handover_summary = self.get_handover_summary(
            organization_id, period_start, period_end
        )
        
        # Get active users count
        active_users = self.db.query(
            func.count(func.distinct(AnalyticsEvent.user_id))
        ).filter(
            AnalyticsEvent.organization_id == organization_id,
            AnalyticsEvent.timestamp >= period_start,
            AnalyticsEvent.timestamp <= period_end
        ).scalar() or 0
        
        # Create report
        report = PilotStudyReport(
            organization_id=organization_id,
            report_name=report_name,
            period_start=period_start,
            period_end=period_end,
            total_schedules_created=scheduling_summary["total_schedules"],
            total_handovers_completed=handover_summary["total_handovers_completed"],
            total_active_users=active_users,
            total_time_saved_hours=scheduling_summary["total_time_saved_hours"],
            avg_time_saved_per_schedule_minutes=round(
                scheduling_summary["avg_time_saved_percentage"] * 
                MANUAL_SCHEDULING_BENCHMARK_HOURS * 60 / 100, 1
            ) if scheduling_summary["total_schedules"] > 0 else 0,
            avg_coverage_percentage=scheduling_summary["avg_coverage_percentage"],
            handover_completion_rate=handover_summary["avg_completion_rate"],
            estimated_labor_cost_saved=scheduling_summary["estimated_cost_saved_cad"],
            report_data={
                "scheduling": scheduling_summary,
                "handover": handover_summary,
                "period": {
                    "start": period_start.isoformat(),
                    "end": period_end.isoformat(),
                    "days": (period_end - period_start).days
                }
            },
            status="draft",
            created_by=created_by
        )
        
        self.db.add(report)
        self.db.commit()
        return report
    
    def get_pilot_study_reports(
        self,
        organization_id: UUID,
        status: Optional[str] = None
    ) -> List[PilotStudyReport]:
        """
        Get all pilot study reports for an organization.
        """
        query = self.db.query(PilotStudyReport).filter(
            PilotStudyReport.organization_id == organization_id
        )
        
        if status:
            query = query.filter(PilotStudyReport.status == status)
        
        return query.order_by(PilotStudyReport.created_at.desc()).all()
    
    def finalize_report(self, report_id: UUID) -> PilotStudyReport:
        """
        Finalize a pilot study report.
        """
        report = self.db.query(PilotStudyReport).filter(
            PilotStudyReport.id == report_id
        ).first()
        
        if report:
            report.status = "finalized"
            self.db.commit()
        
        return report


def get_analytics_service(db: Session) -> AnalyticsService:
    """
    Dependency injection helper for analytics service.
    """
    return AnalyticsService(db)
