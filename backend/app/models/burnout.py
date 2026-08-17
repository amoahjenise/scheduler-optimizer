"""
Burnout & Retention Prediction Models

Uses shift data, overtime patterns, and engagement signals to
predict nurse burnout risk and alert managers before attrition.
"""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Float, Text, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.db.database import Base


class BurnoutSnapshot(Base):
    """
    Point-in-time burnout risk assessment for a single nurse.

    Computed periodically (daily/weekly) from shift data, overtime,
    schedule density, and behavioral signals.
    """
    __tablename__ = "burnout_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)
    nurse_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Risk scores (0.0 = no risk, 1.0 = critical)
    overall_risk_score = Column(Float, nullable=False, default=0.0)
    risk_level = Column(String, nullable=False, default="low")  # low, moderate, high, critical

    # Contributing factor scores (each 0.0 - 1.0)
    overtime_score = Column(Float, nullable=True)           # Excessive hours
    schedule_density_score = Column(Float, nullable=True)   # Too many consecutive shifts
    night_shift_load_score = Column(Float, nullable=True)   # Disproportionate night shifts
    weekend_load_score = Column(Float, nullable=True)       # Too many weekend shifts
    short_rest_score = Column(Float, nullable=True)         # Insufficient rest between shifts
    pattern_disruption_score = Column(Float, nullable=True) # Erratic scheduling patterns
    tenure_risk_score = Column(Float, nullable=True)        # New hires / 6-month cliff

    # Raw metrics used to compute scores
    metrics = Column(JSONB, nullable=True)
    # {
    #   "hours_last_7d": float,
    #   "hours_last_14d": float,
    #   "hours_last_30d": float,
    #   "overtime_hours_last_14d": float,
    #   "consecutive_days_worked": int,
    #   "night_shifts_last_14d": int,
    #   "weekend_shifts_last_14d": int,
    #   "avg_rest_hours_between_shifts": float,
    #   "min_rest_hours_last_7d": float,
    #   "schedule_variance_coefficient": float,
    #   "days_since_last_day_off": int,
    #   "sick_calls_last_90d": int,
    #   "swap_requests_last_30d": int,
    #   "tenure_days": int
    # }

    # Trend
    previous_risk_score = Column(Float, nullable=True)
    trend = Column(String, nullable=True)  # improving, stable, worsening

    snapshot_date = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<BurnoutSnapshot nurse={self.nurse_id} risk={self.risk_level}>"


class BurnoutAlert(Base):
    """
    Alert generated when a nurse's risk crosses a threshold.
    Delivered to their manager for proactive intervention.
    """
    __tablename__ = "burnout_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)
    nurse_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    snapshot_id = Column(UUID(as_uuid=True), ForeignKey("burnout_snapshots.id"), nullable=False)

    alert_type = Column(String, nullable=False)  # threshold_crossed, trend_worsening, consecutive_high
    severity = Column(String, nullable=False, default="warning")  # info, warning, critical
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    recommendation = Column(Text, nullable=True)

    # Manager action tracking
    acknowledged_by = Column(String, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    action_taken = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def __repr__(self):
        return f"<BurnoutAlert nurse={self.nurse_id} severity={self.severity}>"


class BurnoutConfig(Base):
    """
    Per-organization configuration for burnout thresholds.
    """
    __tablename__ = "burnout_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, unique=True, index=True)

    # Thresholds for risk levels
    moderate_threshold = Column(Float, default=0.4)
    high_threshold = Column(Float, default=0.6)
    critical_threshold = Column(Float, default=0.8)

    # Weight configuration for scoring factors
    weights = Column(JSONB, nullable=True)
    # Default weights: {
    #   "overtime": 0.25, "schedule_density": 0.20, "night_shift_load": 0.15,
    #   "weekend_load": 0.10, "short_rest": 0.15, "pattern_disruption": 0.10, "tenure_risk": 0.05
    # }

    # Alert settings
    alert_on_moderate = Column(Boolean, default=False)
    alert_on_high = Column(Boolean, default=True)
    alert_on_critical = Column(Boolean, default=True)
    alert_on_worsening_trend = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<BurnoutConfig org={self.organization_id}>"
