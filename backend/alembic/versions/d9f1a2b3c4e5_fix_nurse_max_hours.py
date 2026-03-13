"""fix_nurse_max_hours

Revision ID: d9f1a2b3c4e5
Revises: c4e8f2a3b5d7
Create Date: 2025-01-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9f1a2b3c4e5'
down_revision: Union[str, None] = 'c4e8f2a3b5d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Fix max_weekly_hours for all existing nurses.
    
    Full-time nurses: Should be 37.5 hours/week (instead of old 40)
    Part-time nurses: Should be 22.5 hours/week (instead of old 24 or other values)
    
    Also updates any nurses with 60h (old part-time default) to proper values.
    """
    
    # Update full-time nurses with old 40h default to new 37.5h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 37.5 
        WHERE employment_type = 'full-time' AND max_weekly_hours = 40.0
    """)
    
    # Update full-time nurses with incorrect 60h to 37.5h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 37.5 
        WHERE employment_type = 'full-time' AND max_weekly_hours = 60.0
    """)
    
    # Update part-time nurses with old 24h default to new 22.5h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 22.5 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 24.0
    """)
    
    # Update part-time nurses with incorrect 60h to 22.5h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 22.5 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 60.0
    """)
    
    # Update part-time nurses with old 40h (if marked as part-time) to 22.5h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 22.5 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 40.0
    """)


def downgrade() -> None:
    """Revert max_weekly_hours changes (restore old defaults)."""
    # Revert full-time nurses back to 40h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 40.0 
        WHERE employment_type = 'full-time' AND max_weekly_hours = 37.5
    """)
    
    # Revert part-time nurses back to 24h
    op.execute("""
        UPDATE nurses 
        SET max_weekly_hours = 24.0 
        WHERE employment_type = 'part-time' AND max_weekly_hours = 22.5
    """)
