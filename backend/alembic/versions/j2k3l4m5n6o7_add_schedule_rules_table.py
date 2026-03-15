"""add schedule_rules table

Revision ID: j2k3l4m5n6o7
Revises: h1d2e3f4a5b6
Create Date: 2026-03-14 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "j2k3l4m5n6o7"
down_revision = "h1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.String(255), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False, server_default="default"),
        sa.Column("rules_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("schedule_rules")
