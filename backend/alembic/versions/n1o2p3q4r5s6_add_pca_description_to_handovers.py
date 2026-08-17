"""add_pca_description_to_handovers

Revision ID: n1o2p3q4r5s6
Revises: m7n8o9p0q1r2
Create Date: 2026-03-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n1o2p3q4r5s6'
down_revision: Union[str, None] = 'm7n8o9p0q1r2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add pca_description column to handovers table."""
    op.add_column('handovers', sa.Column('pca_description', sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove pca_description column from handovers table."""
    op.drop_column('handovers', 'pca_description')
