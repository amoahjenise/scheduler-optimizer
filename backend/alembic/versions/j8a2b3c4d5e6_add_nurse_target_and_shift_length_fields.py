"""add nurse target and preferred shift length fields

Revision ID: j8a2b3c4d5e6
Revises: h7c1d2e3f4a5
Create Date: 2026-03-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'j8a2b3c4d5e6'
down_revision: Union[str, None] = 'h7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('nurses', sa.Column('target_weekly_hours', sa.Float(), nullable=True))
    op.add_column('nurses', sa.Column('preferred_shift_length_hours', sa.Float(), nullable=True))

    # Backfill for existing records so targets are immediately usable.
    op.execute(
        """
        UPDATE nurses
        SET target_weekly_hours = CASE
            WHEN employment_type = 'part-time'
                 AND max_weekly_hours IS NOT NULL
                 AND max_weekly_hours > 0
                 AND max_weekly_hours <= 30
                THEN max_weekly_hours
            WHEN employment_type = 'part-time'
                THEN 26.25
            ELSE 37.5
        END
        WHERE target_weekly_hours IS NULL
        """
    )

    op.execute(
        """
        UPDATE nurses
        SET preferred_shift_length_hours = 11.25
        WHERE preferred_shift_length_hours IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column('nurses', 'preferred_shift_length_hours')
    op.drop_column('nurses', 'target_weekly_hours')
