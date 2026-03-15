"""merge_schedule_rules_and_org_members

Revision ID: 92763e937bd9
Revises: j2k3l4m5n6o7, m1a2b3c4d5e6
Create Date: 2026-03-14 15:42:29.503057

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '92763e937bd9'
down_revision: Union[str, None] = ('j2k3l4m5n6o7', 'm1a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
