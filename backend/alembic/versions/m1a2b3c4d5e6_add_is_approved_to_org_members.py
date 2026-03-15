"""add_is_approved_to_org_members

Revision ID: m1a2b3c4d5e6
Revises: h1d2e3f4a5b6
Create Date: 2026-03-13 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'm1a2b3c4d5e6'
down_revision = 'j3b4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_approved column to organization_members table
    # Default True so existing members are automatically approved
    op.add_column(
        'organization_members',
        sa.Column('is_approved', sa.Boolean(), nullable=False, server_default='true')
    )


def downgrade() -> None:
    op.drop_column('organization_members', 'is_approved')
