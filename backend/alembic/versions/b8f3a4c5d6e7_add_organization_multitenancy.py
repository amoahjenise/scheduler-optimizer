"""Add organization multi-tenancy support

Revision ID: b8f3a4c5d6e7
Revises: a794836b7dfa
Create Date: 2026-03-08 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8f3a4c5d6e7'
down_revision: Union[str, None] = '1526b52bd3a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create organizations table
    op.create_table(
        'organizations',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False, unique=True, index=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('timezone', sa.String(50), default='America/Montreal'),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('invite_code', sa.String(20), nullable=True, unique=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    
    # Create organization_members table
    op.create_table(
        'organization_members',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('organization_id', sa.String(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.String(), nullable=False, index=True),
        sa.Column('user_email', sa.String(255), nullable=True),
        sa.Column('user_name', sa.String(255), nullable=True),
        sa.Column('role', sa.Enum('admin', 'manager', 'nurse', name='memberrole'), nullable=False, default='nurse'),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('organization_id', 'user_id', name='uq_org_user'),
    )
    
    # Add organization_id to existing tables
    # These columns are nullable initially to allow existing data to remain valid
    
    # Schedules table
    op.add_column('schedules', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_schedules_organization',
        'schedules', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_schedules_organization_id', 'schedules', ['organization_id'])
    
    # Nurses table
    op.add_column('nurses', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_nurses_organization',
        'nurses', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_nurses_organization_id', 'nurses', ['organization_id'])
    
    # Patients table
    op.add_column('patients', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_patients_organization',
        'patients', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_patients_organization_id', 'patients', ['organization_id'])
    
    # Handovers table (inherits from patient, but add for explicit filtering)
    op.add_column('handovers', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_handovers_organization',
        'handovers', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_handovers_organization_id', 'handovers', ['organization_id'])
    
    # System prompts table (org-specific prompts)
    op.add_column('system_prompts', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_system_prompts_organization',
        'system_prompts', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_system_prompts_organization_id', 'system_prompts', ['organization_id'])


def downgrade() -> None:
    # Remove organization_id from tables
    op.drop_constraint('fk_system_prompts_organization', 'system_prompts', type_='foreignkey')
    op.drop_index('ix_system_prompts_organization_id', 'system_prompts')
    op.drop_column('system_prompts', 'organization_id')
    
    op.drop_constraint('fk_handovers_organization', 'handovers', type_='foreignkey')
    op.drop_index('ix_handovers_organization_id', 'handovers')
    op.drop_column('handovers', 'organization_id')
    
    op.drop_constraint('fk_patients_organization', 'patients', type_='foreignkey')
    op.drop_index('ix_patients_organization_id', 'patients')
    op.drop_column('patients', 'organization_id')
    
    op.drop_constraint('fk_nurses_organization', 'nurses', type_='foreignkey')
    op.drop_index('ix_nurses_organization_id', 'nurses')
    op.drop_column('nurses', 'organization_id')
    
    op.drop_constraint('fk_schedules_organization', 'schedules', type_='foreignkey')
    op.drop_index('ix_schedules_organization_id', 'schedules')
    op.drop_column('schedules', 'organization_id')
    
    # Drop organization tables
    op.drop_table('organization_members')
    op.drop_table('organizations')
    
    # Drop enum
    sa.Enum(name='memberrole').drop(op.get_bind())
