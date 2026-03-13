"""Enhance shifts with paid multiplier, update nurse FTE fields, and add new scheduling models.

Revision ID: k9d3e4f5a6b7
Revises: 77aaeb3c8342
Create Date: 2026-03-12 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = 'k9d3e4f5a6b7'
down_revision = '77aaeb3c8342'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Enhance shift_codes table
    op.add_column('shift_codes', sa.Column('total_hours', sa.Float(), nullable=True))
    op.add_column('shift_codes', sa.Column('unpaid_break_hours', sa.Float(), nullable=False, server_default='0.75'))
    op.add_column('shift_codes', sa.Column('paid_hours', sa.Float(), nullable=True))
    op.add_column('shift_codes', sa.Column('paid_multiplier', sa.Float(), nullable=False, server_default='1.0'))
    op.add_column('shift_codes', sa.Column('shift_category', sa.String(50), nullable=False, server_default='Standard'))
    
    # Migrate old 'hours' column to 'total_hours' if it exists, then drop it
    op.execute('''
        UPDATE shift_codes 
        SET total_hours = hours, paid_hours = hours - unpaid_break_hours
        WHERE total_hours IS NULL
    ''')
    
    op.drop_column('shift_codes', 'hours')
    op.alter_column('shift_codes', 'total_hours', nullable=False)
    op.alter_column('shift_codes', 'paid_hours', nullable=False)

    # 2. Enhance nurses table with FTE contract fields
    op.add_column('nurses', sa.Column('fte_value', sa.Float(), nullable=False, server_default='1.0'))
    op.add_column('nurses', sa.Column('bi_weekly_target_hours', sa.Float(), nullable=False, server_default='75.0'))
    op.add_column('nurses', sa.Column('max_hours_per_24h', sa.Float(), nullable=False, server_default='12.5'))
    op.add_column('nurses', sa.Column('min_rest_hours_between_shifts', sa.Float(), nullable=False, server_default='11.0'))
    op.add_column('nurses', sa.Column('weekend_requirement_ratio', sa.Float(), nullable=False, server_default='0.5'))

    # 3. Create schedule_demands table (per-cell staffing requirements)
    op.create_table(
        'schedule_demands',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('shift_code_id', sa.String(), nullable=False),
        sa.Column('date', sa.String(10), nullable=False),
        sa.Column('global_daily_target', sa.Integer(), nullable=False, server_default='12'),
        sa.Column('min_staff_required', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('skill_requirements', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('actual_staff_assigned', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_calculated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shift_code_id'], ['shift_codes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_schedule_demands_organization_id', 'schedule_demands', ['organization_id'])
    op.create_index('ix_schedule_demands_date', 'schedule_demands', ['date'])

    # 4. Create shift_templates table (reusable daily/weekly/monthly templates)
    op.create_table(
        'shift_templates',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('template_type', sa.String(20), nullable=False),
        sa.Column('pattern', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('applicable_shift_codes', sa.Text(), nullable=True),
        sa.Column('applicable_roles', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_shift_templates_organization_id', 'shift_templates', ['organization_id'])

    # 5. Create time_off_requests table (for vacation, sick leave, etc.)
    op.create_table(
        'time_off_requests',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('nurse_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('start_date', sa.String(10), nullable=False),
        sa.Column('end_date', sa.String(10), nullable=False),
        sa.Column('reason', sa.String(50), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('approved_by_id', sa.String(), nullable=True),
        sa.Column('approval_timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('denial_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['nurse_id'], ['nurses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_time_off_requests_organization_id', 'time_off_requests', ['organization_id'])
    op.create_index('ix_time_off_requests_nurse_id', 'time_off_requests', ['nurse_id'])
    op.create_index('ix_time_off_requests_start_date', 'time_off_requests', ['start_date'])

    # 6. Create nurse_hours_reconciliation table (28-day tracking)
    op.create_table(
        'nurse_hours_reconciliation',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=False),
        sa.Column('nurse_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('period_start_date', sa.String(10), nullable=False),
        sa.Column('period_end_date', sa.String(10), nullable=False),
        sa.Column('bi_weekly_target', sa.Float(), nullable=False),
        sa.Column('hours_worked', sa.Float(), nullable=False, server_default='0'),
        sa.Column('hours_worked_with_vacation_offset', sa.Float(), nullable=False, server_default='0'),
        sa.Column('adjusted_target', sa.Float(), nullable=False),
        sa.Column('delta', sa.Float(), nullable=False, server_default='0'),
        sa.Column('balancing_shift_needed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('balancing_shift_hours', sa.Float(), nullable=True),
        sa.Column('balancing_shift_recommended_date', sa.String(10), nullable=True),
        sa.Column('vacation_days_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['nurse_id'], ['nurses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_nurse_hours_reconciliation_organization_id', 'nurse_hours_reconciliation', ['organization_id'])
    op.create_index('ix_nurse_hours_reconciliation_nurse_id', 'nurse_hours_reconciliation', ['nurse_id'])
    op.create_index('ix_nurse_hours_reconciliation_period_start', 'nurse_hours_reconciliation', ['period_start_date'])


def downgrade():
    # Drop new tables
    op.drop_index('ix_nurse_hours_reconciliation_period_start')
    op.drop_index('ix_nurse_hours_reconciliation_nurse_id')
    op.drop_index('ix_nurse_hours_reconciliation_organization_id')
    op.drop_table('nurse_hours_reconciliation')
    
    op.drop_index('ix_time_off_requests_start_date')
    op.drop_index('ix_time_off_requests_nurse_id')
    op.drop_index('ix_time_off_requests_organization_id')
    op.drop_table('time_off_requests')
    
    op.drop_index('ix_shift_templates_organization_id')
    op.drop_table('shift_templates')
    
    op.drop_index('ix_schedule_demands_date')
    op.drop_index('ix_schedule_demands_organization_id')
    op.drop_table('schedule_demands')
    
    # Revert nurses table changes
    op.drop_column('nurses', 'weekend_requirement_ratio')
    op.drop_column('nurses', 'min_rest_hours_between_shifts')
    op.drop_column('nurses', 'max_hours_per_24h')
    op.drop_column('nurses', 'bi_weekly_target_hours')
    op.drop_column('nurses', 'fte_value')
    
    # Revert shift_codes table changes
    op.add_column('shift_codes', sa.Column('hours', sa.Float(), nullable=False))
    op.execute('''
        UPDATE shift_codes 
        SET hours = total_hours
        WHERE hours IS NULL
    ''')
    op.drop_column('shift_codes', 'shift_category')
    op.drop_column('shift_codes', 'paid_multiplier')
    op.drop_column('shift_codes', 'paid_hours')
    op.drop_column('shift_codes', 'unpaid_break_hours')
    op.drop_column('shift_codes', 'total_hours')
