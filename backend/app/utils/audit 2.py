"""Audit logging utility for HIPAA-compliant access tracking.

Usage in routes:
    from app.utils.audit import log_audit
    log_audit(db, request, user_id="clerk_123", action="view",
              resource_type="handover", resource_id="abc-def",
              detail="Viewed handover for Room 301")
"""
import json
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import Request
from app.models.audit_log import AuditLog


def log_audit(
    db: Session,
    request: Optional[Request],
    *,
    user_id: str,
    user_name: Optional[str] = None,
    organization_id: Optional[str] = None,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    detail: Optional[str] = None,
    changed_fields: Optional[list[str]] = None,
) -> AuditLog:
    """Write an immutable audit log entry.

    Args:
        db: SQLAlchemy session
        request: FastAPI Request (for IP / User-Agent extraction)
        user_id: Clerk user ID or system identifier
        user_name: Optional display name
        organization_id: Org scope
        action: "view" | "create" | "update" | "delete" | "complete" | "export"
        resource_type: "handover" | "patient" | "schedule" etc.
        resource_id: Primary key of the affected record
        detail: Free-text description (e.g. "Updated WBC from 3.2 to 4.1")
        changed_fields: List of field names that were modified
    """
    ip = None
    ua = None
    if request:
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else None)
        ua = request.headers.get("user-agent", "")[:500]

    entry = AuditLog(
        organization_id=organization_id,
        user_id=user_id,
        user_name=user_name,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        changed_fields=json.dumps(changed_fields) if changed_fields else None,
        ip_address=ip,
        user_agent=ua,
    )
    db.add(entry)
    # Flush so the entry is persisted even if the caller doesn't commit separately
    db.flush()
    return entry


def diff_fields(old: dict, new: dict, ignore: set[str] | None = None) -> tuple[list[str], str]:
    """Compare two dicts and return (changed_field_names, human_summary).

    Useful for building audit detail when updating a handover.
    """
    ignore = ignore or {"updated_at", "created_at"}
    changed = []
    parts = []
    for key in new:
        if key in ignore:
            continue
        old_val = old.get(key)
        new_val = new[key]
        if new_val is not None and str(old_val) != str(new_val):
            changed.append(key)
            old_display = str(old_val)[:60] if old_val else "—"
            new_display = str(new_val)[:60] if new_val else "—"
            parts.append(f"{key}: {old_display} → {new_display}")
    summary = "; ".join(parts[:10])  # Cap at 10 field changes in summary
    if len(parts) > 10:
        summary += f" (+{len(parts) - 10} more)"
    return changed, summary
