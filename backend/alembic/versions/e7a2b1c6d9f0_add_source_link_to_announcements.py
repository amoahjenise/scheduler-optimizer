"""add source_link to announcements

Revision ID: e7a2b1c6d9f0
Revises: d4f6a8c0b2e5
Create Date: 2026-08-17 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e7a2b1c6d9f0"
down_revision: Union[str, None] = "d4f6a8c0b2e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("announcements", sa.Column("source_link", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("announcements", "source_link")
