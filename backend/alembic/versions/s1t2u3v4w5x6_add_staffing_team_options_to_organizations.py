"""add staffing team options to organizations

Revision ID: s1t2u3v4w5x6
Revises: r7s8t9u0v1w2
Create Date: 2026-08-18 09:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "s1t2u3v4w5x6"
down_revision: Union[str, Sequence[str], None] = "r7s8t9u0v1w2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("staffing_team_options", sa.JSON(), nullable=True),
    )

    op.execute(
        """
        UPDATE organizations
        SET staffing_team_options = '["Team A", "Team B"]'::json
        WHERE staffing_team_options IS NULL
        """
    )

    op.alter_column("organizations", "staffing_team_options", nullable=False)


def downgrade() -> None:
    op.drop_column("organizations", "staffing_team_options")
