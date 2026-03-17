"""Add nurse leave status columns

Revision ID: add_leave_status_001
Revises: 
Create Date: 2026-03-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_leave_status_001'
down_revision = None  # Update this to the latest revision ID
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add leave status columns to nurses table
    op.add_column('nurses', sa.Column('is_on_maternity_leave', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('nurses', sa.Column('is_on_sick_leave', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('nurses', sa.Column('is_on_sabbatical', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    # Remove leave status columns
    op.drop_column('nurses', 'is_on_sabbatical')
    op.drop_column('nurses', 'is_on_sick_leave')
    op.drop_column('nurses', 'is_on_maternity_leave')
