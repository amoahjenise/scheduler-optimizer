"""add deletion activities table

Revision ID: h1d2e3f4a5b6
Revises: h7c1d2e3f4a5
Create Date: 2026-03-11 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "h1d2e3f4a5b6"
down_revision = "h7c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deletion_activities",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("object_type", sa.String(length=50), nullable=False),
        sa.Column("object_id", sa.String(length=255), nullable=False),
        sa.Column("object_label", sa.String(length=255), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("performed_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("performed_by_name", sa.String(length=255), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_deletion_activities_organization_id"),
        "deletion_activities",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_deletion_activities_object_type"),
        "deletion_activities",
        ["object_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_deletion_activities_occurred_at"),
        "deletion_activities",
        ["occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_deletion_activities_occurred_at"), table_name="deletion_activities")
    op.drop_index(op.f("ix_deletion_activities_object_type"), table_name="deletion_activities")
    op.drop_index(op.f("ix_deletion_activities_organization_id"), table_name="deletion_activities")
    op.drop_table("deletion_activities")
