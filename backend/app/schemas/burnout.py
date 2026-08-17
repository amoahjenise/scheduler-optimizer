"""Schemas for Burnout & Retention Prediction."""
from pydantic import BaseModel, UUID4, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class BurnoutSnapshotResponse(BaseModel):
    id: UUID4
    nurse_id: UUID4
    overall_risk_score: float
    risk_level: str
    overtime_score: Optional[float]
    schedule_density_score: Optional[float]
    night_shift_load_score: Optional[float]
    weekend_load_score: Optional[float]
    short_rest_score: Optional[float]
    pattern_disruption_score: Optional[float]
    tenure_risk_score: Optional[float]
    metrics: Optional[Dict[str, Any]]
    previous_risk_score: Optional[float]
    trend: Optional[str]
    snapshot_date: datetime

    class Config:
        from_attributes = True


class BurnoutAlertResponse(BaseModel):
    id: UUID4
    nurse_id: UUID4
    alert_type: str
    severity: str
    title: str
    message: str
    recommendation: Optional[str]
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]
    action_taken: Optional[str]
    resolved_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class AlertAcknowledge(BaseModel):
    action_taken: Optional[str] = None


class BurnoutTopRiskItem(BaseModel):
    """Snapshot enriched with nurse name for dashboard display."""
    id: UUID4
    nurse_id: UUID4
    nurse_name: str
    overall_risk_score: float
    risk_level: str
    overtime_score: Optional[float]
    schedule_density_score: Optional[float]
    night_shift_load_score: Optional[float]
    weekend_load_score: Optional[float]
    short_rest_score: Optional[float]
    pattern_disruption_score: Optional[float]
    tenure_risk_score: Optional[float]
    trend: Optional[str]
    snapshot_date: datetime

    class Config:
        from_attributes = True


class BurnoutDashboardResponse(BaseModel):
    """Aggregated view for manager dashboard."""
    total_nurses: int
    risk_distribution: Dict[str, int]  # {"low": 10, "moderate": 3, "high": 1, "critical": 0}
    top_risks: List[BurnoutTopRiskItem]
    recent_alerts: List[BurnoutAlertResponse]
    trend_summary: Dict[str, int]  # {"improving": 5, "stable": 7, "worsening": 2}


class BurnoutNurseDetail(BaseModel):
    """Detailed burnout profile for a single nurse."""
    nurse_id: UUID4
    nurse_name: str
    current_snapshot: Optional[BurnoutSnapshotResponse]
    history: List[BurnoutSnapshotResponse]
    alerts: List[BurnoutAlertResponse]


class BurnoutConfigUpdate(BaseModel):
    moderate_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    high_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    critical_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    weights: Optional[Dict[str, float]] = None
    alert_on_moderate: Optional[bool] = None
    alert_on_high: Optional[bool] = None
    alert_on_critical: Optional[bool] = None
    alert_on_worsening_trend: Optional[bool] = None


class BurnoutConfigResponse(BaseModel):
    id: UUID4
    organization_id: str
    moderate_threshold: float
    high_threshold: float
    critical_threshold: float
    weights: Optional[Dict[str, float]]
    alert_on_moderate: bool
    alert_on_high: bool
    alert_on_critical: bool
    alert_on_worsening_trend: bool

    class Config:
        from_attributes = True
