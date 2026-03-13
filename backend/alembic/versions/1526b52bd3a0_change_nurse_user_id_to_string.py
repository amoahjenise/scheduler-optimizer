"""change_nurse_user_id_to_string

Revision ID: 1526b52bd3a0
Revises: 0ff328c93174
Create Date: 2026-03-07 23:31:04.730188

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg


# revision identifiers, used by Alembic.
revision: str = '1526b52bd3a0'
down_revision: Union[str, None] = '0ff328c93174'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create nurses table with user_id as String (Clerk-compatible)."""
    op.create_table(
        'nurses',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(), nullable=False, index=True),
        sa.Column('name', sa.String(), nullable=False, index=True),
        sa.Column('employee_id', sa.String(), nullable=True),
        sa.Column('employment_type', sa.String(), nullable=False, server_default='full-time'),
        sa.Column('max_weekly_hours', sa.Float(), nullable=False, server_default='40.0'),
        sa.Column('is_chemo_certified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('other_certifications', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    """Drop nurses table."""
    op.drop_table('nurses')
