"""Update default targets from weekly to bi-weekly (75/63.75)

Revision ID: j1k2l3m4n5o6
Revises: h1d2e3f4a5b6
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'j1k2l3m4n5o6'
down_revision = '92763e937bd9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update organization defaults from weekly to bi-weekly
    # FT: 37.5 weekly → 75.0 bi-weekly
    # PT: 26.25 weekly → 63.75 bi-weekly
    op.execute("""
        UPDATE organizations
        SET full_time_weekly_target = 75.0
        WHERE full_time_weekly_target = 37.5
    """)
    op.execute("""
        UPDATE organizations
        SET part_time_weekly_target = 63.75
        WHERE part_time_weekly_target = 26.25
    """)

    # Update column defaults
    op.alter_column('organizations', 'full_time_weekly_target',
                    server_default='75.0')
    op.alter_column('organizations', 'part_time_weekly_target',
                    server_default='63.75')


def downgrade() -> None:
    # Revert bi-weekly to weekly
    op.execute("""
        UPDATE organizations
        SET full_time_weekly_target = 37.5
        WHERE full_time_weekly_target = 75.0
    """)
    op.execute("""
        UPDATE organizations
        SET part_time_weekly_target = 26.25
        WHERE part_time_weekly_target = 63.75
    """)
    op.alter_column('organizations', 'full_time_weekly_target',
                    server_default='37.5')
    op.alter_column('organizations', 'part_time_weekly_target',
                    server_default='26.25')
