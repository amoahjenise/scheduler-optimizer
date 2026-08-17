"""add handoff_retention_days to organizations

Revision ID: b4c1d7e9a2f3
Revises: 917981bb140a
Create Date: 2026-08-15 12:20:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "b4c1d7e9a2f3"
down_revision = "917981bb140a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'handoff_retention_days'
            ) THEN
                ALTER TABLE organizations
                ADD COLUMN handoff_retention_days INTEGER NOT NULL DEFAULT 30;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'handoff_retention_days'
            ) THEN
                ALTER TABLE organizations
                DROP COLUMN handoff_retention_days;
            END IF;
        END
        $$;
        """
    )
