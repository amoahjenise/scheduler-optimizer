"""add role permissions and assistant manager role

Revision ID: c7a2e4b19d30
Revises: f2c4d6e8a9b1
Create Date: 2026-08-17

Adds per-organization permission sets for manager / assistant manager, and
introduces the assistant_manager role so a nurse can stand in for the manager.
"""
from alembic import op
import sqlalchemy as sa


revision = "c7a2e4b19d30"
down_revision = "f2c4d6e8a9b1"
branch_labels = None
depends_on = None


DELEGATABLE_PERMISSIONS = [
    "manage_nurses",
    "manage_schedules",
    "manage_patients",
    "manage_handovers",
    "manage_announcements",
    "manage_learning",
    "view_burnout",
    "manage_members",
    "manage_org_settings",
]


def upgrade() -> None:
    import json

    bind = op.get_bind()
    dialect = bind.dialect.name

    op.add_column(
        "organizations",
        sa.Column("manager_permissions", sa.JSON(), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("assistant_manager_permissions", sa.JSON(), nullable=True),
    )

    # Existing orgs keep today's behaviour: managers can do everything.
    perms = json.dumps(DELEGATABLE_PERMISSIONS)
    op.execute(
        sa.text(
            "UPDATE organizations SET manager_permissions = :perms, "
            "assistant_manager_permissions = :perms"
        ).bindparams(perms=perms)
    )

    if dialect == "postgresql":
        # Postgres enums must learn the new value explicitly.
        op.execute("COMMIT")
        op.execute("ALTER TYPE memberrole ADD VALUE IF NOT EXISTS 'assistant_manager'")


def downgrade() -> None:
    op.drop_column("organizations", "assistant_manager_permissions")
    op.drop_column("organizations", "manager_permissions")
    # Postgres cannot drop a single enum value; the extra role is left in place.
