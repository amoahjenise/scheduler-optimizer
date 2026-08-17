"""add org team and room options

Revision ID: c2d4e6f8a1b3
Revises: b4c1d7e9a2f3
Create Date: 2026-08-16 13:20:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "c2d4e6f8a1b3"
down_revision = "b4c1d7e9a2f3"
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
                  AND column_name = 'team_options'
            ) THEN
                ALTER TABLE organizations
                ADD COLUMN team_options JSONB NOT NULL
                DEFAULT '["Heme-Onc","ENT","Pink","Blue","Psych","Renal"]'::jsonb;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'room_options'
            ) THEN
                ALTER TABLE organizations
                ADD COLUMN room_options JSONB NOT NULL
                DEFAULT '["B7.01","B7.02","B7.03","B7.04","B7.05","B7.06","B7.07","B7.08","B7.09","B7.10","B7.11","B7.12","B7.13","B7.14","B7.15","B7.16"]'::jsonb;
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
                  AND column_name = 'team_options'
            ) THEN
                ALTER TABLE organizations
                DROP COLUMN team_options;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'organizations'
                  AND column_name = 'room_options'
            ) THEN
                ALTER TABLE organizations
                DROP COLUMN room_options;
            END IF;
        END
        $$;
        """
    )
