"""Add announcements, notifications, learning assignments, and nurse team

Revision ID: d4f6a8c0b2e5
Revises: c2d4e6f8a1b3
Create Date: 2026-08-16

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd4f6a8c0b2e5'
down_revision = 'c2d4e6f8a1b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Nurse team (used for targeting announcements and assignments) ──
    op.add_column('nurses', sa.Column('team', sa.String(), nullable=True))
    op.create_index('ix_nurses_team', 'nurses', ['team'], unique=False)

    # ── Announcements ──
    op.create_table(
        'announcements',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('target_team', sa.String(), nullable=True),
        sa.Column('is_pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_announcements_organization_id', 'announcements', ['organization_id'])
    op.create_index('ix_announcements_target_team', 'announcements', ['target_team'])

    # ── Notifications ──
    op.create_table(
        'notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=True),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False, server_default='info'),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('link', sa.String(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notifications_organization_id', 'notifications', ['organization_id'])
    op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
    op.create_index('ix_notifications_is_read', 'notifications', ['is_read'])

    # ── Learning assignments ──
    op.create_table(
        'learning_assignments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('assignment_type', sa.String(), nullable=False, server_default='module'),
        sa.Column('module_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('url', sa.String(), nullable=True),
        sa.Column('target_team', sa.String(), nullable=True),
        sa.Column('due_date', sa.DateTime(), nullable=True),
        sa.Column('is_mandatory', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['module_id'], ['learning_modules.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_learning_assignments_organization_id', 'learning_assignments', ['organization_id'])
    op.create_index('ix_learning_assignments_target_team', 'learning_assignments', ['target_team'])

    op.create_table(
        'learning_assignment_completions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assignment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('user_name', sa.String(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['assignment_id'], ['learning_assignments.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('assignment_id', 'user_id', name='uq_assignment_user'),
    )
    op.create_index(
        'ix_learning_assignment_completions_assignment_id',
        'learning_assignment_completions',
        ['assignment_id'],
    )
    op.create_index(
        'ix_learning_assignment_completions_organization_id',
        'learning_assignment_completions',
        ['organization_id'],
    )
    op.create_index(
        'ix_learning_assignment_completions_user_id',
        'learning_assignment_completions',
        ['user_id'],
    )


def downgrade() -> None:
    op.drop_table('learning_assignment_completions')
    op.drop_table('learning_assignments')
    op.drop_table('notifications')
    op.drop_table('announcements')
    op.drop_index('ix_nurses_team', table_name='nurses')
    op.drop_column('nurses', 'team')
