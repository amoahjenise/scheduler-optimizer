"""add print shift layout mode to organizations

Revision ID: r7s8t9u0v1w2
Revises: p3q4r5s6t7u8
Create Date: 2026-08-18 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "r7s8t9u0v1w2"
down_revision = "p3q4r5s6t7u8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column(
            "print_shift_layout_mode",
            sa.String(length=32),
            nullable=False,
            server_default="separate",
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "print_shift_layout_mode")
