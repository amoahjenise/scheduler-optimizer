"""add_shift_codes_tables

Revision ID: c4e8f2a3b5d7
Revises: 699d1ed2fe5b
Create Date: 2026-03-10 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e8f2a3b5d7'
down_revision: Union[str, None] = '699d1ed2fe5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create shift_codes table
    op.create_table(
        'shift_codes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=True),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('start_time', sa.String(length=10), nullable=False),
        sa.Column('end_time', sa.String(length=10), nullable=False),
        sa.Column('hours', sa.Float(), nullable=False),
        sa.Column('shift_type', sa.Enum('DAY', 'NIGHT', 'COMBINED', name='shifttype'), nullable=False),
        sa.Column('display_order', sa.Float(), nullable=True, default=0),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_shift_codes_organization_id'), 'shift_codes', ['organization_id'], unique=False)
    
    # Create time_slots table
    op.create_table(
        'time_slots',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('organization_id', sa.String(), nullable=True),
        sa.Column('slot', sa.String(length=20), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('duration', sa.String(length=20), nullable=False),
        sa.Column('maps_to', sa.Text(), nullable=False),
        sa.Column('display_order', sa.Float(), nullable=True, default=0),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_time_slots_organization_id'), 'time_slots', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_time_slots_organization_id'), table_name='time_slots')
    op.drop_table('time_slots')
    op.drop_index(op.f('ix_shift_codes_organization_id'), table_name='shift_codes')
    op.drop_table('shift_codes')
    op.execute('DROP TYPE IF EXISTS shifttype')
