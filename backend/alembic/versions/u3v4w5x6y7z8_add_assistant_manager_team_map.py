"""add assistant manager team map to organizations

Revision ID: u3v4w5x6y7z8
Revises: s1t2u3v4w5x6
Create Date: 2026-08-18 10:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "u3v4w5x6y7z8"
down_revision: Union[str, Sequence[str], None] = "s1t2u3v4w5x6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("assistant_manager_team_map", sa.JSON(), nullable=True),
    )
    op.execute(
        """
        UPDATE organizations
        SET assistant_manager_team_map = '{}'::json
        WHERE assistant_manager_team_map IS NULL
        """
    )
    op.alter_column("organizations", "assistant_manager_team_map", nullable=False)


def downgrade() -> None:
    op.drop_column("organizations", "assistant_manager_team_map")
