"""add weekly hour target settings to organizations

Revision ID: h7c1d2e3f4a5
Revises: d9f1a2b3c4e5
Create Date: 2026-03-11 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h7c1d2e3f4a5'
down_revision: Union[str, None] = 'd9f1a2b3c4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'organizations',
        sa.Column('full_time_weekly_target', sa.Float(), nullable=False, server_default=sa.text('37.5'))
    )
    op.add_column(
        'organizations',
        sa.Column('part_time_weekly_target', sa.Float(), nullable=False, server_default=sa.text('22.5'))
    )


def downgrade() -> None:
    op.drop_column('organizations', 'part_time_weekly_target')
    op.drop_column('organizations', 'full_time_weekly_target')
