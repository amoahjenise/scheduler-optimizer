"""allow unlinked nurse profiles

Revision ID: f2c4d6e8a9b1
Revises: e7a2b1c6d9f0
Create Date: 2026-08-17 00:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2c4d6e8a9b1"
down_revision: Union[str, None] = "e7a2b1c6d9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nurse profiles can exist before account linking.
    op.alter_column("nurses", "user_id", existing_type=sa.String(), nullable=True)

    # Clean up legacy bug pattern: many nurse profiles in the same org linked to
    # the same admin/manager account instead of being explicitly linked.
    op.execute(
        """
        WITH duplicated_links AS (
            SELECT organization_id, user_id
            FROM nurses
            WHERE organization_id IS NOT NULL
              AND user_id IS NOT NULL
            GROUP BY organization_id, user_id
            HAVING COUNT(*) > 1
        )
        UPDATE nurses n
        SET user_id = NULL
        FROM duplicated_links dl
        JOIN organization_members om
          ON om.organization_id = dl.organization_id
         AND om.user_id = dl.user_id
        WHERE n.organization_id = dl.organization_id
          AND n.user_id = dl.user_id
          AND om.role IN ('admin', 'manager')
        """
    )


def downgrade() -> None:
    # Revert by assigning a deterministic placeholder before restoring NOT NULL.
    op.execute(
        """
        UPDATE nurses
        SET user_id = CONCAT('unlinked-', id::text)
        WHERE user_id IS NULL
        """
    )
    op.alter_column("nurses", "user_id", existing_type=sa.String(), nullable=False)
