"""add_nurse_certifications_and_update_max_hours

Revision ID: c738afb7118b
Revises: g6b0c9d2e3f4
Create Date: 2026-03-10 18:59:09.863313

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c738afb7118b'
down_revision: Union[str, None] = 'g6b0c9d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add new certification columns to nurses table
    op.add_column('nurses', sa.Column('is_transplant_certified', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('nurses', sa.Column('is_renal_certified', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('nurses', sa.Column('is_charge_certified', sa.Boolean(), nullable=False, server_default='false'))
    
    # Update max_weekly_hours for full-time nurses: 40.0 -> 37.5
    # Part-time nurses proportionally (e.g., 30.0 -> 28.125, but we'll update common values)
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 37.5 
        WHERE employment_type = 'full-time' AND max_weekly_hours = 40.0
    """)
    
    # Update common part-time hours proportionally (40/37.5 = 0.9375 ratio)
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 30.0 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 32.0
    """)
    
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 22.5 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 24.0
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # Remove certification columns
    op.drop_column('nurses', 'is_charge_certified')
    op.drop_column('nurses', 'is_renal_certified')
    op.drop_column('nurses', 'is_transplant_certified')
    
    # Revert max_weekly_hours changes
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 40.0 
        WHERE employment_type = 'full-time' AND max_weekly_hours = 37.5
    """)
    
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 32.0 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 30.0
    """)
    
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 24.0 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 22.5
    """)
