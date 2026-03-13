"""merge_deletion_activities_and_nurse_target_fields

Revision ID: 77aaeb3c8342
Revises: h1d2e3f4a5b6, j8a2b3c4d5e6
Create Date: 2026-03-12 18:32:21.151851

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '77aaeb3c8342'
down_revision: Union[str, None] = ('h1d2e3f4a5b6', 'j8a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
