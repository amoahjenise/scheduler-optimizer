"""Schedule Rules API routes - persist and retrieve scheduling rules per org."""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional, List
import logging

from app.db.deps import get_db
from app.models.schedule_rule import ScheduleRule
from app.schemas.schedule_rule import (
    ScheduleRuleCreate,
    ScheduleRuleUpdate,
    ScheduleRuleResponse,
)
from app.core.auth import OrgAuth

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/schedule-rules", response_model=List[ScheduleRuleResponse], tags=["Schedule Rules"])
def list_schedule_rules(
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """List all schedule rules for the organization (newest first)."""
    rules = (
        db.query(ScheduleRule)
        .filter(ScheduleRule.organization_id == auth.organization_id)
        .order_by(desc(ScheduleRule.updated_at))
        .all()
    )
    return rules


@router.get("/schedule-rules/latest", response_model=Optional[ScheduleRuleResponse], tags=["Schedule Rules"])
def get_latest_schedule_rule(
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """Get the most recently updated schedule rule for the organization."""
    rule = (
        db.query(ScheduleRule)
        .filter(ScheduleRule.organization_id == auth.organization_id)
        .order_by(desc(ScheduleRule.updated_at))
        .first()
    )
    return rule


@router.post("/schedule-rules", response_model=ScheduleRuleResponse, tags=["Schedule Rules"])
def save_schedule_rule(
    payload: ScheduleRuleCreate,
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """Create or update (upsert) the 'default' schedule rule for the org.

    If a rule with the same name already exists for the org, it is updated
    in place; otherwise a new row is created.
    """
    existing = (
        db.query(ScheduleRule)
        .filter(
            ScheduleRule.organization_id == auth.organization_id,
            ScheduleRule.name == payload.name,
        )
        .first()
    )
    if existing:
        existing.rules_text = payload.rules_text
        existing.created_by = auth.user_id
        db.commit()
        db.refresh(existing)
        return existing

    new_rule = ScheduleRule(
        organization_id=auth.organization_id,
        name=payload.name,
        rules_text=payload.rules_text,
        created_by=auth.user_id,
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return new_rule


@router.delete("/schedule-rules/{rule_id}", tags=["Schedule Rules"])
def delete_schedule_rule(
    rule_id: int,
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """Delete a schedule rule by ID."""
    rule = (
        db.query(ScheduleRule)
        .filter(ScheduleRule.id == rule_id, ScheduleRule.organization_id == auth.organization_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Schedule rule not found")
    db.delete(rule)
    db.commit()
    return {"detail": "Deleted"}
