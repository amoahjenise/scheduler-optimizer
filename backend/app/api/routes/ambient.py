"""
Ambient Documentation API Routes

Endpoints for AI-powered ambient documentation that captures
nurse-patient interactions and auto-fills EHR fields.
"""
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.ambient_session import AmbientSession, AmbientTemplate
from app.models.nurse import Nurse
from app.schemas.ambient import (
    AmbientSessionCreate,
    AmbientSessionUpdate,
    AmbientReviewSubmit,
    AmbientSessionResponse,
    AmbientSessionListResponse,
    AmbientTemplateResponse,
)
from app.core.auth import RequiredAuth, ManagerAuth

router = APIRouter()


# ── Helpers ──

def _get_nurse_for_user(db: Session, auth: RequiredAuth) -> Nurse:
    query = db.query(Nurse)
    if auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    nurse = query.filter(Nurse.user_id == auth.user_id).first()
    if not nurse:
        if auth.can_manage:
            detail = (
                "Ambient recording requires a linked nurse profile because sessions are stored against a nurse record. "
                "Your account is admin/manager, but no nurse profile is linked to this user in the selected organization. "
                "Use a nurse-linked account, or create/link a nurse profile to this account first."
            )
        else:
            detail = (
                "No nurse profile is linked to this account in the selected organization. "
                "This is usually a setup issue, not a role issue. Ask your manager/admin to add your nurse profile and link it to your user."
            )
        raise HTTPException(status_code=404, detail=detail)
    return nurse


def _simulate_ai_extraction(transcript: str) -> Dict[str, Any]:
    """
    Stub AI extraction — replace with real OpenAI / AWS Comprehend Medical call.
    Parses transcript and returns structured EHR fields.
    """
    extracted: Dict[str, Any] = {
        "chief_complaint": None,
        "vital_signs": {},
        "symptoms": [],
        "medications_discussed": [],
        "allergies_mentioned": [],
        "assessment": None,
        "plan": None,
        "pain_level": None,
        "diet": None,
        "activity_level": None,
        "fall_risk": None,
        "isolation_precautions": None,
        "iv_access": None,
        "labs_ordered": [],
        "follow_up": None,
    }

    text_lower = transcript.lower()

    # Simple keyword extraction demo
    if "pain" in text_lower:
        for i in range(11):
            if f"pain {i}" in text_lower or f"pain level {i}" in text_lower or f"pain is {i}" in text_lower:
                extracted["pain_level"] = i
                break

    if "blood pressure" in text_lower or "bp " in text_lower:
        extracted["vital_signs"]["bp"] = "See transcript"
    if "temperature" in text_lower or "temp " in text_lower or "fever" in text_lower:
        extracted["vital_signs"]["temp"] = "See transcript"
    if "heart rate" in text_lower or "pulse" in text_lower:
        extracted["vital_signs"]["hr"] = "See transcript"

    symptom_keywords = ["nausea", "vomiting", "dizziness", "headache", "fatigue", "cough", "shortness of breath", "diarrhea", "chest pain"]
    extracted["symptoms"] = [s for s in symptom_keywords if s in text_lower]

    if "allerg" in text_lower:
        extracted["allergies_mentioned"] = ["See transcript for details"]

    if "fall" in text_lower:
        extracted["fall_risk"] = "Assess"

    if "isolation" in text_lower or "precaution" in text_lower:
        extracted["isolation_precautions"] = "See transcript"

    # Assessment = first sentence-like chunk
    sentences = [s.strip() for s in transcript.split(".") if len(s.strip()) > 20]
    if sentences:
        extracted["chief_complaint"] = sentences[0]
    if len(sentences) > 1:
        extracted["assessment"] = sentences[1]

    return extracted


# ── Session CRUD ──

@router.post("", response_model=AmbientSessionResponse, status_code=201)
def start_session(
    body: AmbientSessionCreate,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Start a new ambient documentation session."""
    nurse = _get_nurse_for_user(db, auth)
    session = AmbientSession(
        organization_id=auth.organization_id or auth.user_id,
        nurse_id=nurse.id,
        patient_mrn=body.patient_mrn,
        status="recording",
        started_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=AmbientSessionListResponse)
def list_sessions(
    auth: RequiredAuth,
    status: Optional[str] = None,
    patient_mrn: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List ambient sessions for the authenticated user's organization."""
    org_id = auth.organization_id or auth.user_id
    query = db.query(AmbientSession).filter(AmbientSession.organization_id == org_id)
    # Non-managers only see their own sessions
    if not auth.can_manage:
        nurse = _get_nurse_for_user(db, auth)
        query = query.filter(AmbientSession.nurse_id == nurse.id)
    if status:
        query = query.filter(AmbientSession.status == status)
    if patient_mrn:
        query = query.filter(AmbientSession.patient_mrn == patient_mrn)
    total = query.count()
    sessions = query.order_by(AmbientSession.started_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AmbientSessionListResponse(sessions=sessions, total=total)


@router.get("/{session_id}", response_model=AmbientSessionResponse)
def get_session(
    session_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Get a specific ambient session."""
    session = db.query(AmbientSession).filter(AmbientSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.put("/{session_id}/transcript", response_model=AmbientSessionResponse)
def submit_transcript(
    session_id: UUID,
    body: AmbientSessionUpdate,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """
    Submit transcript text for a session and run AI extraction.
    Transitions session from 'recording' → 'draft' with extracted EHR data.
    """
    session = db.query(AmbientSession).filter(AmbientSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status not in ("recording", "processing"):
        raise HTTPException(status_code=400, detail=f"Cannot submit transcript for session in '{session.status}' status")

    session.status = "processing"
    if body.transcript:
        session.transcript = body.transcript
    db.flush()

    # Run AI extraction
    extracted = _simulate_ai_extraction(session.transcript or "")
    session.extracted_data = extracted
    session.confidence_score = 0.75  # Stub confidence
    session.status = "draft"
    session.ended_at = datetime.utcnow()
    if session.started_at:
        session.duration_seconds = int((session.ended_at - session.started_at).total_seconds())

    db.commit()
    db.refresh(session)
    return session


@router.put("/{session_id}/review", response_model=AmbientSessionResponse)
def review_session(
    session_id: UUID,
    body: AmbientReviewSubmit,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """
    Nurse reviews and optionally corrects AI-extracted data, then approves.
    Transitions session from 'draft' → 'reviewed'.
    """
    session = db.query(AmbientSession).filter(AmbientSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "draft":
        raise HTTPException(status_code=400, detail="Session must be in 'draft' status to review")

    session.reviewed_by = auth.user_id
    session.reviewed_at = datetime.utcnow()

    if body.corrections:
        session.nurse_corrections = body.corrections
        # Merge corrections into extracted data
        merged = dict(session.extracted_data or {})
        merged.update(body.corrections)
        session.extracted_data = merged

    session.status = "reviewed" if body.approved else "draft"

    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/commit", response_model=AmbientSessionResponse)
def commit_to_ehr(
    session_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """
    Commit reviewed session data to the EHR system.
    In production this would push via HL7 FHIR to the hospital EHR.
    """
    session = db.query(AmbientSession).filter(AmbientSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "reviewed":
        raise HTTPException(status_code=400, detail="Session must be reviewed before committing to EHR")

    # Stub: in production, push to FHIR endpoint
    session.ehr_commit_id = f"EHR-{session_id.hex[:8].upper()}"
    session.committed_at = datetime.utcnow()
    session.status = "committed"

    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
def discard_session(
    session_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Discard an ambient session (soft delete)."""
    session = db.query(AmbientSession).filter(AmbientSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "committed":
        raise HTTPException(status_code=400, detail="Cannot discard a committed session")
    session.status = "discarded"
    db.commit()


# ── Templates ──

@router.get("/templates", response_model=list[AmbientTemplateResponse])
def list_templates(
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """List available ambient documentation templates."""
    org_id = auth.organization_id or auth.user_id
    return db.query(AmbientTemplate).filter(
        (AmbientTemplate.organization_id == org_id) | (AmbientTemplate.is_default == True),
        AmbientTemplate.is_active == True,
    ).all()
