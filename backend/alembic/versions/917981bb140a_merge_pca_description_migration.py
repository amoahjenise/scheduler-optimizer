"""merge_pca_description_migration

Revision ID: 917981bb140a
Revises: 4fc0490f36ae, n1o2p3q4r5s6
Create Date: 2026-03-23 18:28:54.188303

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '917981bb140a'
down_revision: Union[str, None] = ('4fc0490f36ae', 'n1o2p3q4r5s6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
