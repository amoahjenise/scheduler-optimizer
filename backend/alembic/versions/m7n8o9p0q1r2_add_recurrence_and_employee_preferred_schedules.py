"""Add recurrence and employee preferred schedule tables.

Revision ID: m7n8o9p0q1r2
Revises: k9d3e4f5a6b7
Create Date: 2026-03-12 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'm7n8o9p0q1r2'
down_revision = 'k9d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create schedule_recurrences table
    op.create_table(
        'schedule_recurrences',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.String(length=1000), nullable=True),
        sa.Column('recurrence_type', sa.String(length=50), nullable=False, server_default='weekly'),
        sa.Column('pattern', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('cycle_length_days', sa.Integer(), nullable=False, server_default='7'),
        sa.Column('applicable_nurses', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schedule_recurrences_org_id'), 'schedule_recurrences', ['org_id'], unique=False)
    op.create_index(op.f('ix_schedule_recurrences_name'), 'schedule_recurrences', ['name'], unique=False)
    op.create_index(op.f('ix_schedule_recurrences_created_at'), 'schedule_recurrences', ['created_at'], unique=False)

    # Create employee_preferred_schedules table
    from sqlalchemy.dialects.postgresql import UUID
    
    op.create_table(
        'employee_preferred_schedules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.String(), nullable=False),
        sa.Column('nurse_id', UUID(as_uuid=True), nullable=False),
        sa.Column('preferred_pattern', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('period_start_date', sa.Date(), nullable=False),
        sa.Column('period_end_date', sa.Date(), nullable=False),
        sa.Column('constraints', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('source', sa.String(length=50), nullable=False, server_default='manual'),
        sa.Column('upload_filename', sa.String(length=255), nullable=True),
        sa.Column('upload_metadata', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending_review'),
        sa.Column('admin_notes', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['nurse_id'], ['nurses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_employee_preferred_schedules_org_id'), 'employee_preferred_schedules', ['org_id'], unique=False)
    op.create_index(op.f('ix_employee_preferred_schedules_nurse_id'), 'employee_preferred_schedules', ['nurse_id'], unique=False)
    op.create_index(op.f('ix_employee_preferred_schedules_period_start_date'), 'employee_preferred_schedules', ['period_start_date'], unique=False)

    # Create generated_schedule_snapshots table
    op.create_table(
        'generated_schedule_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.String(), nullable=False),
        sa.Column('recurrence_id', sa.Integer(), nullable=True),
        sa.Column('period_start_date', sa.Date(), nullable=False),
        sa.Column('period_end_date', sa.Date(), nullable=False),
        sa.Column('schedule_data', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('generated_at', sa.DateTime(), nullable=False),
        sa.Column('generation_method', sa.String(length=50), nullable=False),
        sa.Column('is_finalized', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('finalized_at', sa.DateTime(), nullable=True),
        sa.Column('adjustments', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recurrence_id'], ['schedule_recurrences.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_generated_schedule_snapshots_org_id'), 'generated_schedule_snapshots', ['org_id'], unique=False)
    op.create_index(op.f('ix_generated_schedule_snapshots_period_start_date'), 'generated_schedule_snapshots', ['period_start_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_generated_schedule_snapshots_period_start_date'), table_name='generated_schedule_snapshots')
    op.drop_index(op.f('ix_generated_schedule_snapshots_org_id'), table_name='generated_schedule_snapshots')
    op.drop_table('generated_schedule_snapshots')
    
    op.drop_index(op.f('ix_employee_preferred_schedules_period_start_date'), table_name='employee_preferred_schedules')
    op.drop_index(op.f('ix_employee_preferred_schedules_nurse_id'), table_name='employee_preferred_schedules')
    op.drop_index(op.f('ix_employee_preferred_schedules_org_id'), table_name='employee_preferred_schedules')
    op.drop_table('employee_preferred_schedules')
    
    op.drop_index(op.f('ix_schedule_recurrences_created_at'), table_name='schedule_recurrences')
    op.drop_index(op.f('ix_schedule_recurrences_name'), table_name='schedule_recurrences')
    op.drop_index(op.f('ix_schedule_recurrences_org_id'), table_name='schedule_recurrences')
    op.drop_table('schedule_recurrences')
