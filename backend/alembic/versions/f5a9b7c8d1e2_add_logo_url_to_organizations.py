"""add logo_url to organizations

Revision ID: f5a9b7c8d1e2
Revises: 3ec798f94e08
Create Date: 2025-06-08 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5a9b7c8d1e2'
down_revision: Union[str, None] = '3ec798f94e08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add logo_url column to organizations table
    op.add_column('organizations', sa.Column('logo_url', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove logo_url column
    op.drop_column('organizations', 'logo_url')
