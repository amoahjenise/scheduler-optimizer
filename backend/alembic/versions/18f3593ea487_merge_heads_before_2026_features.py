"""merge_heads_before_2026_features

Revision ID: 18f3593ea487
Revises: add_leave_status_001, j1k2l3m4n5o6
Create Date: 2026-03-23 16:31:42.350140

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '18f3593ea487'
down_revision: Union[str, None] = ('add_leave_status_001', 'j1k2l3m4n5o6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
