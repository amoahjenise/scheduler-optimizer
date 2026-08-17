"""
Micro-Learning / Onboarding Models

Mobile-first training system for agency and intern nurses.
Bite-sized modules, progress tracking, and competency verification.
"""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Float, Text, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.db.database import Base


class LearningModule(Base):
    """
    A single training module (micro-lesson).

    Modules are short (3-10 min), mobile-optimized, and cover one competency.
    """
    __tablename__ = "learning_modules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=True, index=True)  # null = global/shared module

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=False, index=True)
    # Categories: orientation, safety, medication, equipment, charting, infection_control,
    #             patient_handling, emergency, compliance, specialty

    # Content
    content_type = Column(String, nullable=False, default="interactive")
    # interactive, video, quiz, checklist, simulation
    content = Column(JSONB, nullable=False)
    # Content schema depends on content_type:
    # interactive: { "steps": [{ "type": "text"|"image"|"tip"|"warning", "content": str, "media_url": str|null }] }
    # quiz: { "questions": [{ "id": str, "text": str, "type": "multiple_choice"|"true_false"|"ordering",
    #          "options": [str], "correct_answer": str|int|[int], "explanation": str }] }
    # checklist: { "items": [{ "id": str, "text": str, "critical": bool }] }

    # Metadata
    estimated_duration_minutes = Column(Integer, nullable=False, default=5)
    difficulty_level = Column(String, nullable=False, default="beginner")  # beginner, intermediate, advanced
    tags = Column(JSONB, nullable=True)  # ["oncology", "pediatric", "iv-therapy", ...]
    prerequisite_module_ids = Column(JSONB, nullable=True)  # Array of module UUIDs

    # Targeting
    target_roles = Column(JSONB, nullable=True)  # ["agency", "intern", "new_hire"] or null for all
    required_for_onboarding = Column(Boolean, default=False)
    is_mandatory = Column(Boolean, default=False)

    # Status
    is_published = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    passing_score = Column(Float, default=0.8)  # 80% needed to pass quiz modules

    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String, nullable=True)

    def __repr__(self):
        return f"<LearningModule {self.title} category={self.category}>"


class LearningProgress(Base):
    """
    Tracks a nurse's progress through a specific module.
    """
    __tablename__ = "learning_progress"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nurse_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    module_id = Column(UUID(as_uuid=True), ForeignKey("learning_modules.id"), nullable=False, index=True)
    organization_id = Column(String, nullable=False, index=True)

    status = Column(String, nullable=False, default="not_started")
    # not_started, in_progress, completed, failed, expired

    # Progress
    progress_percentage = Column(Float, default=0.0)
    current_step = Column(Integer, default=0)
    total_steps = Column(Integer, nullable=True)

    # Quiz results
    quiz_score = Column(Float, nullable=True)
    quiz_attempts = Column(Integer, default=0)
    quiz_answers = Column(JSONB, nullable=True)  # { "question_id": "selected_answer", ... }
    passed = Column(Boolean, nullable=True)

    # Checklist completion
    checklist_state = Column(JSONB, nullable=True)  # { "item_id": true/false, ... }

    # Timing
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    time_spent_seconds = Column(Integer, default=0)
    last_accessed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<LearningProgress nurse={self.nurse_id} module={self.module_id} status={self.status}>"


class LearningPath(Base):
    """
    An ordered collection of modules forming a learning track.
    E.g., "Agency Nurse Onboarding", "Chemo Certification Prep".
    """
    __tablename__ = "learning_paths"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=True, index=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)

    # Ordered list of module IDs
    module_ids = Column(JSONB, nullable=False, default=list)

    # Targeting
    target_roles = Column(JSONB, nullable=True)  # ["agency", "intern"]
    is_required = Column(Boolean, default=False)

    estimated_total_minutes = Column(Integer, nullable=True)
    is_published = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String, nullable=True)

    def __repr__(self):
        return f"<LearningPath {self.title}>"


class LearningAssignment(Base):
    """
    A manager-created assignment: a module, an external link, or a reading.

    target_team = None means the assignment applies to the whole organization.
    """
    __tablename__ = "learning_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(String, nullable=False, index=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # module | link | reading
    assignment_type = Column(String, nullable=False, default="module")
    module_id = Column(UUID(as_uuid=True), ForeignKey("learning_modules.id"), nullable=True)
    url = Column(String, nullable=True)

    target_team = Column(String, nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    is_mandatory = Column(Boolean, nullable=False, default=True)

    created_by = Column(String, nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<LearningAssignment {self.title} type={self.assignment_type}>"


class LearningAssignmentCompletion(Base):
    """Records that a specific user completed a specific assignment."""
    __tablename__ = "learning_assignment_completions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id", name="uq_assignment_user"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id = Column(
        UUID(as_uuid=True), ForeignKey("learning_assignments.id"), nullable=False, index=True
    )
    organization_id = Column(String, nullable=False, index=True)

    user_id = Column(String, nullable=False, index=True)
    user_name = Column(String, nullable=True)

    completed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return f"<LearningAssignmentCompletion assignment={self.assignment_id} user={self.user_id}>"
