"""
Burnout & Retention Prediction API Routes

Endpoints for viewing burnout risk dashboards, nurse detail,
running assessments, managing alerts, and configuring thresholds.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.deps import get_db
from app.models.burnout import BurnoutSnapshot, BurnoutAlert, BurnoutConfig
from app.models.nurse import Nurse
from app.schemas.burnout import (
    BurnoutSnapshotResponse,
    BurnoutAlertResponse,
    AlertAcknowledge,
    BurnoutDashboardResponse,
    BurnoutTopRiskItem,
    BurnoutRiskBucketItem,
    BurnoutNurseDetail,
    BurnoutConfigUpdate,
    BurnoutConfigResponse,
)
from app.services.burnout_service import run_burnout_assessment, _get_config
from app.core.auth import RequiredAuth, ManagerAuth

router = APIRouter()


# ── Dashboard ──

@router.get("/dashboard", response_model=BurnoutDashboardResponse)
def burnout_dashboard(
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Manager dashboard showing risk distribution and active alerts."""
    org_id = auth.organization_id or auth.user_id

    # Get latest snapshot per nurse (subquery for max date per nurse)
    latest_sub = (
        db.query(
            BurnoutSnapshot.nurse_id,
            func.max(BurnoutSnapshot.snapshot_date).label("max_date"),
        )
        .filter(BurnoutSnapshot.organization_id == org_id)
        .group_by(BurnoutSnapshot.nurse_id)
        .subquery()
    )

    latest_snapshots: List[BurnoutSnapshot] = (
        db.query(BurnoutSnapshot)
        .join(
            latest_sub,
            (BurnoutSnapshot.nurse_id == latest_sub.c.nurse_id)
            & (BurnoutSnapshot.snapshot_date == latest_sub.c.max_date),
        )
        .filter(BurnoutSnapshot.organization_id == org_id)
        .all()
    )

    # Compute distribution
    dist = {"low": 0, "moderate": 0, "high": 0, "critical": 0}
    trend_summary = {"improving": 0, "stable": 0, "worsening": 0}
    for snap in latest_snapshots:
        dist[snap.risk_level] = dist.get(snap.risk_level, 0) + 1
        if snap.trend:
            trend_summary[snap.trend] = trend_summary.get(snap.trend, 0) + 1

    # Build nurse name lookup
    nurse_ids = [s.nurse_id for s in latest_snapshots]
    nurses_by_id: Dict[Any, str] = {
        n.id: n.name
        for n in db.query(Nurse).filter(Nurse.id.in_(nurse_ids)).all()
    }

    # Top risks (high + critical sorted by score desc)
    risk_buckets: Dict[str, List[BurnoutRiskBucketItem]] = {
        "low": [],
        "moderate": [],
        "high": [],
        "critical": [],
    }

    for s in sorted(
        latest_snapshots,
        key=lambda snap: snap.overall_risk_score,
        reverse=True,
    ):
        bucket = s.risk_level if s.risk_level in risk_buckets else "low"
        risk_buckets[bucket].append(
            BurnoutRiskBucketItem(
                nurse_id=s.nurse_id,
                nurse_name=nurses_by_id.get(s.nurse_id, "Unknown Nurse"),
                overall_risk_score=s.overall_risk_score,
                risk_level=s.risk_level,
            )
        )

    # Top risks (high + critical sorted by score desc)
    top_risk_snaps = sorted(
        [s for s in latest_snapshots if s.risk_level in ("high", "critical")],
        key=lambda s: s.overall_risk_score,
        reverse=True,
    )[:10]
    top_risks = [
        BurnoutTopRiskItem(
            id=s.id,
            nurse_id=s.nurse_id,
            nurse_name=nurses_by_id.get(s.nurse_id, "Unknown Nurse"),
            overall_risk_score=s.overall_risk_score,
            risk_level=s.risk_level,
            overtime_score=s.overtime_score,
            schedule_density_score=s.schedule_density_score,
            night_shift_load_score=s.night_shift_load_score,
            weekend_load_score=s.weekend_load_score,
            short_rest_score=s.short_rest_score,
            pattern_disruption_score=s.pattern_disruption_score,
            tenure_risk_score=s.tenure_risk_score,
            trend=s.trend,
            snapshot_date=s.snapshot_date,
        )
        for s in top_risk_snaps
    ]

    # Recent unacknowledged alerts
    recent_alerts = (
        db.query(BurnoutAlert)
        .filter(
            BurnoutAlert.organization_id == org_id,
            BurnoutAlert.acknowledged_at == None,
        )
        .order_by(BurnoutAlert.created_at.desc())
        .limit(20)
        .all()
    )

    total_nurses = db.query(Nurse).filter(Nurse.organization_id == org_id).count()

    return BurnoutDashboardResponse(
        total_nurses=total_nurses,
        risk_distribution=dist,
        risk_buckets=risk_buckets,
        top_risks=top_risks,
        recent_alerts=recent_alerts,
        trend_summary=trend_summary,
    )


# ── Nurse Detail ──

@router.get("/nurses/{nurse_id}", response_model=BurnoutNurseDetail)
def nurse_burnout_detail(
    nurse_id: UUID,
    auth: ManagerAuth,
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """Detailed burnout history for a specific nurse."""
    nurse = db.query(Nurse).filter(Nurse.id == nurse_id).first()
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse not found")

    since = datetime.utcnow() - timedelta(days=days)
    history = (
        db.query(BurnoutSnapshot)
        .filter(BurnoutSnapshot.nurse_id == nurse_id, BurnoutSnapshot.snapshot_date >= since)
        .order_by(BurnoutSnapshot.snapshot_date.desc())
        .all()
    )
    alerts = (
        db.query(BurnoutAlert)
        .filter(BurnoutAlert.nurse_id == nurse_id)
        .order_by(BurnoutAlert.created_at.desc())
        .limit(20)
        .all()
    )

    return BurnoutNurseDetail(
        nurse_id=nurse.id,
        nurse_name=nurse.name,
        current_snapshot=history[0] if history else None,
        history=history,
        alerts=alerts,
    )


# ── Run Assessment ──

@router.post("/assess", status_code=201)
def run_assessment(
    auth: ManagerAuth,
    nurse_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
):
    """
    Trigger burnout assessment.
    If nurse_id provided, assess one nurse. Otherwise assess all nurses in the org.
    Returns count of snapshots created.
    """
    org_id = auth.organization_id or auth.user_id

    if nurse_id:
        nurses = [db.query(Nurse).filter(Nurse.id == nurse_id, Nurse.organization_id == org_id).first()]
        if not nurses[0]:
            raise HTTPException(status_code=404, detail="Nurse not found")
    else:
        nurses = db.query(Nurse).filter(Nurse.organization_id == org_id).all()

    results = []
    for nurse in nurses:
        # Build metrics from available data (stub — production would query shift tables)
        metrics = _build_metrics_for_nurse(db, nurse)
        snapshot = run_burnout_assessment(db, org_id, nurse, metrics)
        results.append({"nurse_id": str(nurse.id), "risk_level": snapshot.risk_level, "score": snapshot.overall_risk_score})

    return {"assessed": len(results), "results": results}


def _build_metrics_for_nurse(db: Session, nurse: Nurse) -> Dict[str, Any]:
    """
    Build metrics dict from shift/schedule data.
    Stub implementation — returns reasonable defaults.
    In production, query OptimizedSchedule + ShiftCode tables.
    """
    import random
    # Deterministic seed from nurse ID for consistent demo results
    seed = int(str(nurse.id).replace("-", "")[:8], 16) % 10000
    rng = random.Random(seed)

    now = datetime.now(timezone.utc)
    created = nurse.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    tenure_days = (now - (created or now)).days

    return {
        "hours_last_7d": rng.uniform(30, 55),
        "hours_last_14d": rng.uniform(60, 100),
        "hours_last_30d": rng.uniform(120, 200),
        "overtime_hours_last_14d": rng.uniform(0, 20),
        "consecutive_days_worked": rng.randint(1, 8),
        "night_shifts_last_14d": rng.randint(0, 8),
        "total_shifts_last_14d": rng.randint(8, 14),
        "weekend_shifts_last_14d": rng.randint(0, 5),
        "avg_rest_hours_between_shifts": rng.uniform(8, 14),
        "min_rest_hours_last_7d": rng.uniform(7, 13),
        "schedule_variance_coefficient": rng.uniform(0, 0.6),
        "days_since_last_day_off": rng.randint(0, 7),
        "sick_calls_last_90d": rng.randint(0, 4),
        "swap_requests_last_30d": rng.randint(0, 3),
        "tenure_days": tenure_days,
    }


# ── Alerts ──

@router.get("/alerts", response_model=list[BurnoutAlertResponse])
def list_alerts(
    auth: ManagerAuth,
    acknowledged: Optional[bool] = None,
    severity: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List burnout alerts for the organization."""
    org_id = auth.organization_id or auth.user_id
    query = db.query(BurnoutAlert).filter(BurnoutAlert.organization_id == org_id)
    if acknowledged is not None:
        if acknowledged:
            query = query.filter(BurnoutAlert.acknowledged_at != None)
        else:
            query = query.filter(BurnoutAlert.acknowledged_at == None)
    if severity:
        query = query.filter(BurnoutAlert.severity == severity)
    return query.order_by(BurnoutAlert.created_at.desc()).limit(limit).all()


@router.put("/alerts/{alert_id}/acknowledge", response_model=BurnoutAlertResponse)
def acknowledge_alert(
    alert_id: UUID,
    body: AlertAcknowledge,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Acknowledge a burnout alert and optionally record action taken."""
    alert = db.query(BurnoutAlert).filter(BurnoutAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged_by = auth.user_id
    alert.acknowledged_at = datetime.utcnow()
    if body.action_taken:
        alert.action_taken = body.action_taken
    db.commit()
    db.refresh(alert)
    return alert


@router.put("/alerts/{alert_id}/resolve", response_model=BurnoutAlertResponse)
def resolve_alert(
    alert_id: UUID,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Mark alert as resolved."""
    alert = db.query(BurnoutAlert).filter(BurnoutAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(alert)
    return alert


# ── Config ──

@router.get("/config", response_model=BurnoutConfigResponse)
def get_config(
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Get burnout configuration for the organization."""
    org_id = auth.organization_id or auth.user_id
    config = _get_config(db, org_id)
    return config


@router.put("/config", response_model=BurnoutConfigResponse)
def update_config(
    body: BurnoutConfigUpdate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Update burnout thresholds and alert settings."""
    org_id = auth.organization_id or auth.user_id
    config = _get_config(db, org_id)

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(config, key, value)

    db.commit()
    db.refresh(config)
    return config
