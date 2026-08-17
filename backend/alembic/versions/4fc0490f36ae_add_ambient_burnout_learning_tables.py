"""add_ambient_burnout_learning_tables

Revision ID: 4fc0490f36ae
Revises: 18f3593ea487
Create Date: 2026-03-23 16:31:56.794795

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '4fc0490f36ae'
down_revision: Union[str, None] = '18f3593ea487'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ambient_sessions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('nurse_id', sa.UUID(), nullable=False),
        sa.Column('patient_mrn', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('transcript', sa.Text(), nullable=True),
        sa.Column('extracted_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('reviewed_by', sa.String(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('nurse_corrections', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('confidence_score', sa.Float(), nullable=True),
        sa.Column('ehr_commit_id', sa.String(), nullable=True),
        sa.Column('committed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ambient_sessions_nurse_id', 'ambient_sessions', ['nurse_id'])
    op.create_index('ix_ambient_sessions_organization_id', 'ambient_sessions', ['organization_id'])
    op.create_index('ix_ambient_sessions_patient_mrn', 'ambient_sessions', ['patient_mrn'])
    op.create_index('ix_ambient_sessions_status', 'ambient_sessions', ['status'])

    op.create_table('ambient_templates',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('interaction_type', sa.String(), nullable=False),
        sa.Column('fields_schema', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ambient_templates_organization_id', 'ambient_templates', ['organization_id'])

    op.create_table('burnout_configs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('moderate_threshold', sa.Float(), nullable=True),
        sa.Column('high_threshold', sa.Float(), nullable=True),
        sa.Column('critical_threshold', sa.Float(), nullable=True),
        sa.Column('weights', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('alert_on_moderate', sa.Boolean(), nullable=True),
        sa.Column('alert_on_high', sa.Boolean(), nullable=True),
        sa.Column('alert_on_critical', sa.Boolean(), nullable=True),
        sa.Column('alert_on_worsening_trend', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_burnout_configs_organization_id', 'burnout_configs', ['organization_id'], unique=True)

    op.create_table('burnout_snapshots',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('nurse_id', sa.UUID(), nullable=False),
        sa.Column('overall_risk_score', sa.Float(), nullable=False),
        sa.Column('risk_level', sa.String(), nullable=False),
        sa.Column('overtime_score', sa.Float(), nullable=True),
        sa.Column('schedule_density_score', sa.Float(), nullable=True),
        sa.Column('night_shift_load_score', sa.Float(), nullable=True),
        sa.Column('weekend_load_score', sa.Float(), nullable=True),
        sa.Column('short_rest_score', sa.Float(), nullable=True),
        sa.Column('pattern_disruption_score', sa.Float(), nullable=True),
        sa.Column('tenure_risk_score', sa.Float(), nullable=True),
        sa.Column('metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('previous_risk_score', sa.Float(), nullable=True),
        sa.Column('trend', sa.String(), nullable=True),
        sa.Column('snapshot_date', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_burnout_snapshots_nurse_id', 'burnout_snapshots', ['nurse_id'])
    op.create_index('ix_burnout_snapshots_organization_id', 'burnout_snapshots', ['organization_id'])
    op.create_index('ix_burnout_snapshots_snapshot_date', 'burnout_snapshots', ['snapshot_date'])

    op.create_table('burnout_alerts',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('nurse_id', sa.UUID(), nullable=False),
        sa.Column('snapshot_id', sa.UUID(), nullable=False),
        sa.Column('alert_type', sa.String(), nullable=False),
        sa.Column('severity', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('recommendation', sa.Text(), nullable=True),
        sa.Column('acknowledged_by', sa.String(), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(), nullable=True),
        sa.Column('action_taken', sa.Text(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['snapshot_id'], ['burnout_snapshots.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_burnout_alerts_nurse_id', 'burnout_alerts', ['nurse_id'])
    op.create_index('ix_burnout_alerts_organization_id', 'burnout_alerts', ['organization_id'])
    op.create_index('ix_burnout_alerts_created_at', 'burnout_alerts', ['created_at'])

    op.create_table('learning_modules',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('estimated_duration_minutes', sa.Integer(), nullable=False),
        sa.Column('difficulty_level', sa.String(), nullable=False),
        sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('prerequisite_module_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('target_roles', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('required_for_onboarding', sa.Boolean(), nullable=True),
        sa.Column('is_mandatory', sa.Boolean(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=True),
        sa.Column('passing_score', sa.Float(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_learning_modules_category', 'learning_modules', ['category'])
    op.create_index('ix_learning_modules_organization_id', 'learning_modules', ['organization_id'])

    op.create_table('learning_progress',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('nurse_id', sa.UUID(), nullable=False),
        sa.Column('module_id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('progress_percentage', sa.Float(), nullable=True),
        sa.Column('current_step', sa.Integer(), nullable=True),
        sa.Column('total_steps', sa.Integer(), nullable=True),
        sa.Column('quiz_score', sa.Float(), nullable=True),
        sa.Column('quiz_attempts', sa.Integer(), nullable=True),
        sa.Column('quiz_answers', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('passed', sa.Boolean(), nullable=True),
        sa.Column('checklist_state', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('time_spent_seconds', sa.Integer(), nullable=True),
        sa.Column('last_accessed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['module_id'], ['learning_modules.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_learning_progress_nurse_id', 'learning_progress', ['nurse_id'])
    op.create_index('ix_learning_progress_module_id', 'learning_progress', ['module_id'])
    op.create_index('ix_learning_progress_organization_id', 'learning_progress', ['organization_id'])

    op.create_table('learning_paths',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('module_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('target_roles', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('is_required', sa.Boolean(), nullable=True),
        sa.Column('estimated_total_minutes', sa.Integer(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_learning_paths_organization_id', 'learning_paths', ['organization_id'])


def downgrade() -> None:
    op.drop_table('learning_paths')
    op.drop_table('learning_progress')
    op.drop_table('learning_modules')
    op.drop_table('burnout_alerts')
    op.drop_table('burnout_snapshots')
    op.drop_table('burnout_configs')
    op.drop_table('ambient_templates')
    op.drop_table('ambient_sessions')
