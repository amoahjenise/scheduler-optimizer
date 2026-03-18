"""
Analytics Models for Pilot Study Metrics

Tracks efficiency metrics to demonstrate ROI for hospital procurement.
Key metrics needed for CHUM/MUHC pilot studies:
- Time savings per shift
- Scheduling conflicts avoided
- Handover completion rates
- Staff satisfaction (optional survey)
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Integer, Float, Text, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.db.database import Base


class AnalyticsEvent(Base):
    """
    Generic analytics event tracking
    """
    __tablename__ = "analytics_events"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Context
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    
    # Event details
    event_type = Column(String, nullable=False, index=True)  # page_view, action, timing, etc.
    event_name = Column(String, nullable=False, index=True)  # specific event name
    event_category = Column(String, nullable=True)  # scheduler, handover, patient, etc.
    
    # Event data
    properties = Column(JSONB, nullable=True)  # Flexible event properties
    
    # Session tracking
    session_id = Column(String, nullable=True)
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<AnalyticsEvent {self.event_type}:{self.event_name}>"


class SchedulingMetrics(Base):
    """
    Scheduling efficiency metrics
    
    Tracks time savings and quality metrics for schedule optimization.
    """
    __tablename__ = "scheduling_metrics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("optimized_schedules.id"), nullable=True)
    
    # Timing metrics
    schedule_creation_started_at = Column(DateTime, nullable=True)
    schedule_creation_completed_at = Column(DateTime, nullable=True)
    time_to_create_seconds = Column(Integer, nullable=True)  # Total time from start to finalize
    
    # Optimization metrics
    optimization_duration_seconds = Column(Float, nullable=True)  # OR-Tools solve time
    iterations_count = Column(Integer, nullable=True)
    
    # Quality metrics
    initial_conflicts_count = Column(Integer, nullable=True)
    final_conflicts_count = Column(Integer, nullable=True)
    conflicts_resolved = Column(Integer, nullable=True)
    
    # Coverage metrics
    shifts_covered = Column(Integer, nullable=True)
    shifts_total = Column(Integer, nullable=True)
    coverage_percentage = Column(Float, nullable=True)
    
    # Staff distribution
    nurses_assigned = Column(Integer, nullable=True)
    overtime_hours_total = Column(Float, nullable=True)
    undertime_hours_total = Column(Float, nullable=True)
    
    # Manual edits tracking
    manual_edits_count = Column(Integer, default=0)
    auto_suggestions_accepted = Column(Integer, default=0)
    auto_suggestions_rejected = Column(Integer, default=0)
    
    # Schedule period
    schedule_start_date = Column(DateTime, nullable=True)
    schedule_end_date = Column(DateTime, nullable=True)
    schedule_days = Column(Integer, nullable=True)
    
    # Comparison metrics (vs manual scheduling baseline)
    estimated_manual_time_seconds = Column(Integer, nullable=True)  # Based on industry benchmarks
    time_saved_seconds = Column(Integer, nullable=True)
    time_saved_percentage = Column(Float, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f"<SchedulingMetrics schedule={self.schedule_id}>"


class HandoverMetrics(Base):
    """
    Handover efficiency metrics
    
    Tracks handover completion rates and timing.
    """
    __tablename__ = "handover_metrics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Time period
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    period_type = Column(String, nullable=False)  # daily, weekly, monthly
    
    # Handover counts
    handovers_created = Column(Integer, default=0)
    handovers_completed = Column(Integer, default=0)
    handovers_pending = Column(Integer, default=0)
    completion_rate = Column(Float, nullable=True)
    
    # Timing metrics
    avg_completion_time_seconds = Column(Float, nullable=True)
    min_completion_time_seconds = Column(Float, nullable=True)
    max_completion_time_seconds = Column(Float, nullable=True)
    
    # Quality metrics
    handovers_with_alerts = Column(Integer, default=0)
    avg_notes_length = Column(Float, nullable=True)
    
    # Shift breakdown
    day_shift_handovers = Column(Integer, default=0)
    night_shift_handovers = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f"<HandoverMetrics {self.period_type} {self.period_start}>"


class UserActivityMetrics(Base):
    """
    User activity and engagement metrics
    """
    __tablename__ = "user_activity_metrics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    
    # Time period
    period_date = Column(DateTime, nullable=False, index=True)
    
    # Activity counts
    logins_count = Column(Integer, default=0)
    sessions_count = Column(Integer, default=0)
    total_session_duration_seconds = Column(Integer, default=0)
    
    # Feature usage
    schedules_viewed = Column(Integer, default=0)
    schedules_created = Column(Integer, default=0)
    handovers_created = Column(Integer, default=0)
    handovers_completed = Column(Integer, default=0)
    patients_added = Column(Integer, default=0)
    
    # Page views
    dashboard_views = Column(Integer, default=0)
    scheduler_views = Column(Integer, default=0)
    handover_views = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<UserActivityMetrics user={self.user_id} date={self.period_date}>"


class PilotStudyReport(Base):
    """
    Aggregated pilot study reports
    
    Pre-computed metrics for pilot study presentations.
    """
    __tablename__ = "pilot_study_reports"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Report period
    report_name = Column(String, nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    
    # Summary metrics
    total_schedules_created = Column(Integer, default=0)
    total_handovers_completed = Column(Integer, default=0)
    total_active_users = Column(Integer, default=0)
    
    # Time savings (key ROI metric)
    total_time_saved_hours = Column(Float, nullable=True)
    avg_time_saved_per_schedule_minutes = Column(Float, nullable=True)
    
    # Quality improvements
    avg_coverage_percentage = Column(Float, nullable=True)
    avg_conflicts_per_schedule = Column(Float, nullable=True)
    handover_completion_rate = Column(Float, nullable=True)
    
    # Estimated cost savings
    estimated_labor_cost_saved = Column(Float, nullable=True)  # Based on avg nurse hourly rate
    
    # Full report data
    report_data = Column(JSONB, nullable=True)  # Complete metrics breakdown
    
    # Status
    status = Column(String, default="draft")  # draft, finalized, exported
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, nullable=True)
    
    def __repr__(self):
        return f"<PilotStudyReport {self.report_name}>"
