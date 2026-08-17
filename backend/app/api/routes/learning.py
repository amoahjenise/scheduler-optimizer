"""
Micro-Learning / Onboarding API Routes

Endpoints for managing learning modules, tracking progress,
and viewing onboarding dashboards.
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.deps import get_db
from app.models.learning import (
    LearningModule,
    LearningProgress,
    LearningPath,
    LearningAssignment,
    LearningAssignmentCompletion,
)
from app.models.nurse import Nurse
from app.schemas.learning import (
    LearningModuleCreate,
    LearningModuleUpdate,
    LearningModuleResponse,
    LearningModuleListResponse,
    ProgressUpdate,
    LearningProgressResponse,
    LearningPathCreate,
    LearningPathResponse,
    NurseOnboardingStatus,
    LearningDashboardResponse,
    LearningAssignmentCreate,
    LearningAssignmentUpdate,
    LearningAssignmentResponse,
    AssignmentCompletionResponse,
)
from app.core.auth import RequiredAuth, ManagerAuth, OrgAuth

router = APIRouter()


# ── Helpers ──

def _get_nurse_for_user(db: Session, auth: RequiredAuth) -> Nurse:
    query = db.query(Nurse)
    if auth.organization_id:
        query = query.filter(Nurse.organization_id == auth.organization_id)
    nurse = query.filter(Nurse.user_id == auth.user_id).first()
    if not nurse:
        raise HTTPException(status_code=404, detail="Nurse profile not found for authenticated user")
    return nurse


# ── Module CRUD (Manager) ──

@router.post("/modules", response_model=LearningModuleResponse, status_code=201)
def create_module(
    body: LearningModuleCreate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Create a new learning module."""
    module = LearningModule(
        organization_id=auth.organization_id or auth.user_id,
        created_by=auth.user_id,
        **body.model_dump(),
    )
    db.add(module)
    db.commit()
    db.refresh(module)
    return module


@router.get("/modules", response_model=LearningModuleListResponse)
def list_modules(
    auth: RequiredAuth,
    category: Optional[str] = None,
    published_only: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List learning modules available to the user."""
    org_id = auth.organization_id or auth.user_id
    query = db.query(LearningModule).filter(
        (LearningModule.organization_id == org_id) | (LearningModule.organization_id == None)
    )
    if published_only:
        query = query.filter(LearningModule.is_published == True)
    if category:
        query = query.filter(LearningModule.category == category)
    total = query.count()
    modules = query.order_by(LearningModule.sort_order, LearningModule.created_at).offset(
        (page - 1) * page_size
    ).limit(page_size).all()
    return LearningModuleListResponse(modules=modules, total=total)


@router.get("/modules/{module_id}", response_model=LearningModuleResponse)
def get_module(
    module_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    module = db.query(LearningModule).filter(LearningModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    return module


@router.put("/modules/{module_id}", response_model=LearningModuleResponse)
def update_module(
    module_id: UUID,
    body: LearningModuleUpdate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    module = db.query(LearningModule).filter(LearningModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(module, key, value)
    db.commit()
    db.refresh(module)
    return module


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(
    module_id: UUID,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    module = db.query(LearningModule).filter(LearningModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    db.delete(module)
    db.commit()


# ── Progress Tracking (Nurse) ──

@router.post("/modules/{module_id}/start", response_model=LearningProgressResponse)
def start_module(
    module_id: UUID,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Start or resume a learning module."""
    nurse = _get_nurse_for_user(db, auth)
    module = db.query(LearningModule).filter(LearningModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Check if already in progress
    progress = db.query(LearningProgress).filter(
        LearningProgress.nurse_id == nurse.id,
        LearningProgress.module_id == module_id,
    ).first()

    if progress:
        progress.status = "in_progress"
        progress.last_accessed_at = datetime.utcnow()
    else:
        total_steps = 0
        content = module.content or {}
        if module.content_type == "interactive":
            total_steps = len(content.get("steps", []))
        elif module.content_type == "quiz":
            total_steps = len(content.get("questions", []))
        elif module.content_type == "checklist":
            total_steps = len(content.get("items", []))

        progress = LearningProgress(
            nurse_id=nurse.id,
            module_id=module_id,
            organization_id=auth.organization_id or auth.user_id,
            status="in_progress",
            total_steps=total_steps,
            started_at=datetime.utcnow(),
            last_accessed_at=datetime.utcnow(),
        )
        db.add(progress)

    db.commit()
    db.refresh(progress)
    return progress


@router.put("/modules/{module_id}/progress", response_model=LearningProgressResponse)
def update_progress(
    module_id: UUID,
    body: ProgressUpdate,
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Update progress on a learning module (called incrementally from mobile client)."""
    nurse = _get_nurse_for_user(db, auth)
    progress = db.query(LearningProgress).filter(
        LearningProgress.nurse_id == nurse.id,
        LearningProgress.module_id == module_id,
    ).first()
    if not progress:
        raise HTTPException(status_code=404, detail="No progress record found. Start the module first.")

    if body.current_step is not None:
        progress.current_step = body.current_step
    if body.progress_percentage is not None:
        progress.progress_percentage = body.progress_percentage
    if body.time_spent_seconds is not None:
        progress.time_spent_seconds += body.time_spent_seconds
    if body.quiz_answers is not None:
        progress.quiz_answers = body.quiz_answers
    if body.checklist_state is not None:
        progress.checklist_state = body.checklist_state

    progress.last_accessed_at = datetime.utcnow()

    # Auto-complete detection
    module = db.query(LearningModule).filter(LearningModule.id == module_id).first()
    if module and body.progress_percentage is not None and body.progress_percentage >= 100:
        if module.content_type == "quiz" and body.quiz_answers:
            score = _grade_quiz(module.content or {}, body.quiz_answers)
            progress.quiz_score = score
            progress.quiz_attempts += 1
            progress.passed = score >= module.passing_score
            if progress.passed:
                progress.status = "completed"
                progress.completed_at = datetime.utcnow()
            else:
                progress.status = "failed"
        else:
            progress.status = "completed"
            progress.completed_at = datetime.utcnow()

    db.commit()
    db.refresh(progress)
    return progress


def _grade_quiz(content: dict, answers: dict) -> float:
    """Grade a quiz and return score as 0.0-1.0."""
    questions = content.get("questions", [])
    if not questions:
        return 1.0
    correct = 0
    for q in questions:
        qid = q.get("id", "")
        expected = q.get("correct_answer")
        given = answers.get(qid)
        if given is not None and str(given) == str(expected):
            correct += 1
    return correct / len(questions)


@router.get("/my-progress", response_model=list[LearningProgressResponse])
def my_progress(
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """Get all progress records for the authenticated nurse."""
    nurse = _get_nurse_for_user(db, auth)
    return (
        db.query(LearningProgress)
        .filter(LearningProgress.nurse_id == nurse.id)
        .order_by(LearningProgress.last_accessed_at.desc())
        .all()
    )


# ── Learning Paths ──

@router.post("/paths", response_model=LearningPathResponse, status_code=201)
def create_path(
    body: LearningPathCreate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Create a learning path (ordered collection of modules)."""
    # Calculate total estimated time
    module_ids_as_uuid = []
    total_minutes = 0
    for mid in body.module_ids:
        module = db.query(LearningModule).filter(LearningModule.id == mid).first()
        if module:
            total_minutes += module.estimated_duration_minutes
            module_ids_as_uuid.append(str(module.id))

    path = LearningPath(
        organization_id=auth.organization_id or auth.user_id,
        created_by=auth.user_id,
        title=body.title,
        description=body.description,
        category=body.category,
        module_ids=module_ids_as_uuid,
        target_roles=body.target_roles,
        is_required=body.is_required,
        estimated_total_minutes=total_minutes,
        is_published=True,
    )
    db.add(path)
    db.commit()
    db.refresh(path)
    return path


@router.get("/paths", response_model=list[LearningPathResponse])
def list_paths(
    auth: RequiredAuth,
    db: Session = Depends(get_db),
):
    """List learning paths."""
    org_id = auth.organization_id or auth.user_id
    return (
        db.query(LearningPath)
        .filter(
            (LearningPath.organization_id == org_id) | (LearningPath.organization_id == None),
            LearningPath.is_published == True,
        )
        .order_by(LearningPath.title)
        .all()
    )


# ── Manager Dashboard ──

@router.get("/dashboard", response_model=LearningDashboardResponse)
def learning_dashboard(
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Manager dashboard showing onboarding progress across all nurses."""
    org_id = auth.organization_id or auth.user_id

    nurses = db.query(Nurse).filter(Nurse.organization_id == org_id).all()
    modules = (
        db.query(LearningModule)
        .filter(
            (LearningModule.organization_id == org_id) | (LearningModule.organization_id == None),
            LearningModule.is_published == True,
        )
        .all()
    )
    paths = (
        db.query(LearningPath)
        .filter(
            (LearningPath.organization_id == org_id) | (LearningPath.organization_id == None),
            LearningPath.is_published == True,
        )
        .all()
    )

    mandatory_module_ids = {str(m.id) for m in modules if m.is_mandatory}
    total_modules = len(modules)

    nurse_statuses: List[NurseOnboardingStatus] = []
    fully_onboarded = 0
    in_progress = 0
    not_started_count = 0

    for nurse in nurses:
        progress_records = db.query(LearningProgress).filter(
            LearningProgress.nurse_id == nurse.id,
        ).all()

        completed = sum(1 for p in progress_records if p.status == "completed")
        in_prog = sum(1 for p in progress_records if p.status == "in_progress")
        pct = (completed / total_modules * 100) if total_modules > 0 else 0

        # Check mandatory completion
        completed_ids = {str(p.module_id) for p in progress_records if p.status == "completed"}
        mandatory_done = mandatory_module_ids.issubset(completed_ids)

        last_activity = None
        if progress_records:
            dates = [p.last_accessed_at for p in progress_records if p.last_accessed_at]
            last_activity = max(dates) if dates else None

        status = NurseOnboardingStatus(
            nurse_id=nurse.id,
            nurse_name=nurse.name,
            total_modules=total_modules,
            completed_modules=completed,
            in_progress_modules=in_prog,
            completion_percentage=round(pct, 1),
            mandatory_completed=mandatory_done,
            last_activity_at=last_activity,
        )
        nurse_statuses.append(status)

        if pct >= 100:
            fully_onboarded += 1
        elif completed > 0 or in_prog > 0:
            in_progress += 1
        else:
            not_started_count += 1

    return LearningDashboardResponse(
        total_nurses=len(nurses),
        fully_onboarded=fully_onboarded,
        in_progress=in_progress,
        not_started=not_started_count,
        modules_available=total_modules,
        paths_available=len(paths),
        nurse_statuses=nurse_statuses,
    )


# ── Assignments ──

def _viewer_team(db: Session, auth) -> Optional[str]:
    """Resolve the caller's team from their nurse profile, if one exists."""
    nurse = (
        db.query(Nurse)
        .filter(
            Nurse.organization_id == auth.organization_id,
            Nurse.user_id == auth.user_id,
        )
        .first()
    )
    return nurse.team if nurse else None


def _decorate_assignment(
    assignment: LearningAssignment,
    completed_user_ids: set,
    viewer_user_id: str,
) -> LearningAssignmentResponse:
    payload = LearningAssignmentResponse.model_validate(assignment)
    payload.completed_by_me = viewer_user_id in completed_user_ids
    payload.completed_count = len(completed_user_ids)
    return payload


@router.post("/assignments", response_model=LearningAssignmentResponse, status_code=201)
def create_assignment(
    body: LearningAssignmentCreate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Assign a module, link, or reading to the org or a specific team."""
    if body.assignment_type == "module" and not body.module_id:
        raise HTTPException(status_code=400, detail="module_id is required for module assignments")
    if body.assignment_type in ("link", "reading") and not body.url:
        raise HTTPException(status_code=400, detail="url is required for link and reading assignments")

    assignment = LearningAssignment(
        organization_id=auth.organization_id,
        title=body.title,
        description=body.description,
        assignment_type=body.assignment_type,
        module_id=UUID(body.module_id) if body.module_id else None,
        url=body.url,
        target_team=body.target_team or None,
        due_date=body.due_date,
        is_mandatory=body.is_mandatory,
        created_by=auth.user_id,
        created_by_name=auth.user_name,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    return _decorate_assignment(assignment, set(), auth.user_id)


@router.get("/assignments", response_model=list[LearningAssignmentResponse])
def list_assignments(
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """
    List assignments visible to the caller.

    Members see org-wide assignments plus assignments targeted at their team.
    Managers see all assignments in the organization.
    """
    query = db.query(LearningAssignment).filter(
        LearningAssignment.organization_id == auth.organization_id
    )

    if not auth.can_manage:
        team = _viewer_team(db, auth)
        if team:
            query = query.filter(
                (LearningAssignment.target_team == None) | (LearningAssignment.target_team == team)
            )
        else:
            query = query.filter(LearningAssignment.target_team == None)

    assignments = query.order_by(LearningAssignment.created_at.desc()).all()
    if not assignments:
        return []

    assignment_ids = [a.id for a in assignments]
    completions = (
        db.query(LearningAssignmentCompletion)
        .filter(LearningAssignmentCompletion.assignment_id.in_(assignment_ids))
        .all()
    )

    by_assignment: dict = {}
    for completion in completions:
        by_assignment.setdefault(completion.assignment_id, set()).add(completion.user_id)

    return [
        _decorate_assignment(a, by_assignment.get(a.id, set()), auth.user_id)
        for a in assignments
    ]


@router.patch("/assignments/{assignment_id}", response_model=LearningAssignmentResponse)
def update_assignment(
    assignment_id: UUID,
    body: LearningAssignmentUpdate,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Update an assignment's details, team target, or due date."""
    assignment = (
        db.query(LearningAssignment)
        .filter(
            LearningAssignment.id == assignment_id,
            LearningAssignment.organization_id == auth.organization_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    completed_user_ids = {
        c.user_id
        for c in db.query(LearningAssignmentCompletion)
        .filter(LearningAssignmentCompletion.assignment_id == assignment.id)
        .all()
    }
    return _decorate_assignment(assignment, completed_user_ids, auth.user_id)


@router.delete("/assignments/{assignment_id}", status_code=204)
def delete_assignment(
    assignment_id: UUID,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """Delete an assignment and its completion records."""
    assignment = (
        db.query(LearningAssignment)
        .filter(
            LearningAssignment.id == assignment_id,
            LearningAssignment.organization_id == auth.organization_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    db.query(LearningAssignmentCompletion).filter(
        LearningAssignmentCompletion.assignment_id == assignment.id
    ).delete(synchronize_session=False)
    db.delete(assignment)
    db.commit()
    return None


@router.post("/assignments/{assignment_id}/complete", response_model=AssignmentCompletionResponse)
def complete_assignment(
    assignment_id: UUID,
    auth: OrgAuth,
    db: Session = Depends(get_db),
):
    """Mark an assignment complete for the calling user."""
    assignment = (
        db.query(LearningAssignment)
        .filter(
            LearningAssignment.id == assignment_id,
            LearningAssignment.organization_id == auth.organization_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    existing = (
        db.query(LearningAssignmentCompletion)
        .filter(
            LearningAssignmentCompletion.assignment_id == assignment_id,
            LearningAssignmentCompletion.user_id == auth.user_id,
        )
        .first()
    )
    if existing:
        return existing

    completion = LearningAssignmentCompletion(
        assignment_id=assignment_id,
        organization_id=auth.organization_id,
        user_id=auth.user_id,
        user_name=auth.user_name,
    )
    db.add(completion)
    db.commit()
    db.refresh(completion)
    return completion


@router.get(
    "/assignments/{assignment_id}/completions",
    response_model=list[AssignmentCompletionResponse],
)
def list_assignment_completions(
    assignment_id: UUID,
    auth: ManagerAuth,
    db: Session = Depends(get_db),
):
    """List everyone who has completed a given assignment. Managers only."""
    assignment = (
        db.query(LearningAssignment)
        .filter(
            LearningAssignment.id == assignment_id,
            LearningAssignment.organization_id == auth.organization_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    return (
        db.query(LearningAssignmentCompletion)
        .filter(LearningAssignmentCompletion.assignment_id == assignment_id)
        .order_by(LearningAssignmentCompletion.completed_at.desc())
        .all()
    )
