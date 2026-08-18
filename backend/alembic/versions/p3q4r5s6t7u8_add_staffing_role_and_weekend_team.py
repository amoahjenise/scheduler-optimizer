"""add staffing role + weekend team to nurses and weekend rotation toggle to organizations

Revision ID: p3q4r5s6t7u8
Revises: c7a2e4b19d30
Create Date: 2026-08-17 22:50:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "p3q4r5s6t7u8"
down_revision = "c7a2e4b19d30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nurses' AND column_name = 'staffing_role'
            ) THEN
                ALTER TABLE nurses
                ADD COLUMN staffing_role VARCHAR(50) NOT NULL DEFAULT 'nurse';
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nurses' AND column_name = 'weekend_team'
            ) THEN
                ALTER TABLE nurses ADD COLUMN weekend_team VARCHAR(10);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'weekend_team_rotation_enabled'
            ) THEN
                ALTER TABLE organizations
                ADD COLUMN weekend_team_rotation_enabled BOOLEAN NOT NULL DEFAULT FALSE;
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
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'weekend_team_rotation_enabled'
            ) THEN
                ALTER TABLE organizations DROP COLUMN weekend_team_rotation_enabled;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nurses' AND column_name = 'weekend_team'
            ) THEN
                ALTER TABLE nurses DROP COLUMN weekend_team;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nurses' AND column_name = 'staffing_role'
            ) THEN
                ALTER TABLE nurses DROP COLUMN staffing_role;
            END IF;
        END
        $$;
        """
    )
