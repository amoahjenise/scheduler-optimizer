"""
Burnout Prediction Service

Computes burnout risk scores from shift data and generates alerts.
Uses a weighted multi-factor model calibrated to nursing research:
  - Overtime & excessive hours
  - Consecutive days / schedule density
  - Night-shift disproportionality
  - Insufficient recovery windows
  - Erratic pattern variance
  - New-hire attrition risk (6-month cliff)
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.burnout import BurnoutSnapshot, BurnoutAlert, BurnoutConfig
from app.models.nurse import Nurse

DEFAULT_WEIGHTS: Dict[str, float] = {
    "overtime": 0.25,
    "schedule_density": 0.20,
    "night_shift_load": 0.15,
    "weekend_load": 0.10,
    "short_rest": 0.15,
    "pattern_disruption": 0.10,
    "tenure_risk": 0.05,
}


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _get_config(db: Session, organization_id: str) -> BurnoutConfig:
    config = db.query(BurnoutConfig).filter(
        BurnoutConfig.organization_id == organization_id
    ).first()
    if not config:
        config = BurnoutConfig(
            organization_id=organization_id,
            weights=DEFAULT_WEIGHTS,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def compute_factor_scores(metrics: Dict[str, Any], nurse: Nurse) -> Dict[str, float]:
    """Compute individual factor scores from raw metrics."""

    scores: Dict[str, float] = {}

    # Overtime: ratio of actual vs target hours over 14 days
    target_14d = (nurse.bi_weekly_target_hours or 75.0)
    hours_14d = metrics.get("hours_last_14d", 0.0)
    overtime_ratio = (hours_14d - target_14d) / max(target_14d, 1) if hours_14d > target_14d else 0.0
    scores["overtime"] = _clamp(overtime_ratio / 0.3)  # 30% overtime → score 1.0

    # Schedule density: consecutive days worked
    consecutive = metrics.get("consecutive_days_worked", 0)
    scores["schedule_density"] = _clamp((consecutive - 3) / 4)  # 3 days normal, 7+ → 1.0

    # Night shift load: night shifts as fraction of total in 14 days
    night_shifts = metrics.get("night_shifts_last_14d", 0)
    total_shifts_14d = max(metrics.get("total_shifts_last_14d", 1), 1)
    night_ratio = night_shifts / total_shifts_14d
    scores["night_shift_load"] = _clamp((night_ratio - 0.3) / 0.4)  # >30% starts scoring, >70% = 1.0

    # Weekend load
    weekend_shifts = metrics.get("weekend_shifts_last_14d", 0)
    expected_weekends = 2  # In 14 days, ~2 weekend sets
    scores["weekend_load"] = _clamp((weekend_shifts - expected_weekends) / 3)

    # Short rest: minimum rest hours between shifts
    min_rest = metrics.get("min_rest_hours_last_7d", 12.0)
    min_required = nurse.min_rest_hours_between_shifts or 11.0
    if min_rest < min_required:
        scores["short_rest"] = _clamp(1.0 - (min_rest / min_required))
    else:
        scores["short_rest"] = 0.0

    # Pattern disruption: coefficient of variation in shift start times
    variance_coeff = metrics.get("schedule_variance_coefficient", 0.0)
    scores["pattern_disruption"] = _clamp(variance_coeff / 0.5)

    # Tenure risk: new hires <180 days have elevated attrition risk
    tenure_days = metrics.get("tenure_days", 365)
    if tenure_days < 180:
        scores["tenure_risk"] = _clamp(1.0 - (tenure_days / 180))
    else:
        scores["tenure_risk"] = 0.0

    return scores


def compute_overall_risk(
    factor_scores: Dict[str, float],
    weights: Optional[Dict[str, float]] = None,
) -> float:
    """Weighted sum of factor scores → overall risk 0.0-1.0."""
    w = weights or DEFAULT_WEIGHTS
    total_weight = sum(w.values()) or 1.0
    score = sum(factor_scores.get(k, 0.0) * v for k, v in w.items())
    return _clamp(score / total_weight)


def classify_risk(score: float, config: BurnoutConfig) -> str:
    if score >= config.critical_threshold:
        return "critical"
    if score >= config.high_threshold:
        return "high"
    if score >= config.moderate_threshold:
        return "moderate"
    return "low"


def compute_trend(current: float, previous: Optional[float]) -> str:
    if previous is None:
        return "stable"
    delta = current - previous
    if delta > 0.05:
        return "worsening"
    if delta < -0.05:
        return "improving"
    return "stable"


def generate_alert_if_needed(
    db: Session,
    snapshot: BurnoutSnapshot,
    config: BurnoutConfig,
    nurse: Nurse,
) -> Optional[BurnoutAlert]:
    """Create an alert if the snapshot warrants one."""
    should_alert = False
    severity = "info"
    alert_type = "threshold_crossed"

    if snapshot.risk_level == "critical" and config.alert_on_critical:
        should_alert = True
        severity = "critical"
    elif snapshot.risk_level == "high" and config.alert_on_high:
        should_alert = True
        severity = "warning"
    elif snapshot.risk_level == "moderate" and config.alert_on_moderate:
        should_alert = True
        severity = "info"

    if snapshot.trend == "worsening" and config.alert_on_worsening_trend:
        should_alert = True
        alert_type = "trend_worsening"
        if severity == "info":
            severity = "warning"

    if not should_alert:
        return None

    # Build message
    nurse_name = nurse.name or "Nurse"
    recommendation = _build_recommendation(snapshot)

    alert = BurnoutAlert(
        organization_id=snapshot.organization_id,
        nurse_id=snapshot.nurse_id,
        snapshot_id=snapshot.id,
        alert_type=alert_type,
        severity=severity,
        title=f"{nurse_name}: {snapshot.risk_level.capitalize()} burnout risk",
        message=_build_alert_message(snapshot, nurse_name),
        recommendation=recommendation,
    )
    db.add(alert)
    return alert


def _build_alert_message(snapshot: BurnoutSnapshot, name: str) -> str:
    parts = [f"{name} has a {snapshot.risk_level} burnout risk (score: {snapshot.overall_risk_score:.0%})."]
    if snapshot.trend == "worsening":
        parts.append("Risk has been increasing over recent snapshots.")
    top_factors = []
    for key in ["overtime_score", "schedule_density_score", "short_rest_score", "night_shift_load_score"]:
        val = getattr(snapshot, key, None)
        if val and val >= 0.5:
            label = key.replace("_score", "").replace("_", " ").title()
            top_factors.append(label)
    if top_factors:
        parts.append(f"Top factors: {', '.join(top_factors)}.")
    return " ".join(parts)


def _build_recommendation(snapshot: BurnoutSnapshot) -> str:
    recs = []
    if (snapshot.overtime_score or 0) >= 0.5:
        recs.append("Reduce overtime hours in the next scheduling period.")
    if (snapshot.schedule_density_score or 0) >= 0.5:
        recs.append("Ensure at least 2 consecutive days off within the next week.")
    if (snapshot.short_rest_score or 0) >= 0.5:
        recs.append("Avoid back-to-back shifts with <11h rest between them.")
    if (snapshot.night_shift_load_score or 0) >= 0.5:
        recs.append("Rebalance night-shift distribution across the team.")
    if (snapshot.tenure_risk_score or 0) >= 0.5:
        recs.append("Schedule a check-in meeting — new hires in the 6-month risk window.")
    return " ".join(recs) if recs else "Monitor and review at next scheduling cycle."


def run_burnout_assessment(
    db: Session,
    organization_id: str,
    nurse: Nurse,
    metrics: Dict[str, Any],
) -> BurnoutSnapshot:
    """Run full burnout assessment for a single nurse and persist the result."""
    config = _get_config(db, organization_id)
    weights = config.weights or DEFAULT_WEIGHTS

    factor_scores = compute_factor_scores(metrics, nurse)
    overall = compute_overall_risk(factor_scores, weights)
    risk_level = classify_risk(overall, config)

    # Get previous snapshot for trend
    prev = db.query(BurnoutSnapshot).filter(
        BurnoutSnapshot.nurse_id == nurse.id,
        BurnoutSnapshot.organization_id == organization_id,
    ).order_by(BurnoutSnapshot.snapshot_date.desc()).first()

    trend = compute_trend(overall, prev.overall_risk_score if prev else None)

    snapshot = BurnoutSnapshot(
        organization_id=organization_id,
        nurse_id=nurse.id,
        overall_risk_score=overall,
        risk_level=risk_level,
        overtime_score=factor_scores.get("overtime"),
        schedule_density_score=factor_scores.get("schedule_density"),
        night_shift_load_score=factor_scores.get("night_shift_load"),
        weekend_load_score=factor_scores.get("weekend_load"),
        short_rest_score=factor_scores.get("short_rest"),
        pattern_disruption_score=factor_scores.get("pattern_disruption"),
        tenure_risk_score=factor_scores.get("tenure_risk"),
        metrics=metrics,
        previous_risk_score=prev.overall_risk_score if prev else None,
        trend=trend,
    )
    db.add(snapshot)
    db.flush()

    generate_alert_if_needed(db, snapshot, config, nurse)
    db.commit()
    db.refresh(snapshot)
    return snapshot
