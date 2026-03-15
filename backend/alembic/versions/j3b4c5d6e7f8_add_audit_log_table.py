"""Add audit_log table for HIPAA compliance.

Tracks every view, create, update, and delete action on patient-related
records (handovers, patients) with user ID, timestamp, IP address, and
a summary of the change.

Revision ID: j3b4c5d6e7f8
Revises: i2a3b4c5d6e7
Create Date: 2026-03-13
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "j3b4c5d6e7f8"
down_revision = "i2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.String(), nullable=True, index=True),
        sa.Column("user_id", sa.String(), nullable=False, index=True),
        sa.Column("user_name", sa.String(200), nullable=True),
        sa.Column(
            "action",
            sa.String(20),
            nullable=False,
            index=True,
            comment="view | create | update | delete | complete | export | login | logout",
        ),
        sa.Column(
            "resource_type",
            sa.String(50),
            nullable=False,
            index=True,
            comment="handover | patient | schedule | etc.",
        ),
        sa.Column("resource_id", sa.String(), nullable=True, index=True),
        sa.Column(
            "detail",
            sa.Text,
            nullable=True,
            comment="Human-readable summary, e.g. 'Updated WBC from 3.2 to 4.1'",
        ),
        sa.Column(
            "changed_fields",
            sa.Text,
            nullable=True,
            comment="JSON list of field names that changed",
        ),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )

    # Composite index for common queries: "who touched this resource?"
    op.create_index(
        "ix_audit_resource_lookup",
        "audit_log",
        ["resource_type", "resource_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_resource_lookup", table_name="audit_log")
    op.drop_table("audit_log")
