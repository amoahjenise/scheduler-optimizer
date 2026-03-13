"""add organization_id to optimized_schedules

Revision ID: g6b0c9d2e3f4
Revises: f5a9b7c8d1e2
Create Date: 2025-06-08 12:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g6b0c9d2e3f4'
down_revision: Union[str, None] = 'f5a9b7c8d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add organization_id column to optimized_schedules table
    op.add_column('optimized_schedules', sa.Column('organization_id', sa.String(), nullable=True))
    op.create_index('ix_optimized_schedules_organization_id', 'optimized_schedules', ['organization_id'])


def downgrade() -> None:
    # Remove organization_id column
    op.drop_index('ix_optimized_schedules_organization_id', table_name='optimized_schedules')
    op.drop_column('optimized_schedules', 'organization_id')
