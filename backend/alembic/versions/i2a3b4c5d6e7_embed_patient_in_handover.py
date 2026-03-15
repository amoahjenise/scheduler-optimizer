"""Embed patient demographic fields directly in handovers table.

This migration supports HIPAA-conscious architecture: patient PII is stored
directly on the handover (temporary communication record) rather than in a
separate permanent patients table.  patient_id becomes nullable so new
handovers can be created without a linked patient row.

Revision ID: i2a3b4c5d6e7
Revises: m7n8o9p0q1r2
Create Date: 2026-03-12
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "i2a3b4c5d6e7"
down_revision = "m7n8o9p0q1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add patient demographic columns to handovers
    op.add_column("handovers", sa.Column("p_first_name", sa.String(100), nullable=True))
    op.add_column("handovers", sa.Column("p_last_name", sa.String(100), nullable=True))
    op.add_column("handovers", sa.Column("p_room_number", sa.String(20), nullable=True))
    op.add_column("handovers", sa.Column("p_bed", sa.String(10), nullable=True))
    op.add_column("handovers", sa.Column("p_mrn", sa.String(50), nullable=True))
    op.add_column("handovers", sa.Column("p_diagnosis", sa.String(255), nullable=True))
    op.add_column("handovers", sa.Column("p_date_of_birth", sa.DateTime, nullable=True))
    op.add_column("handovers", sa.Column("p_age", sa.String(50), nullable=True))
    op.add_column("handovers", sa.Column("p_attending_physician", sa.String(100), nullable=True))

    # 2. Backfill: copy patient info from the patients table into existing handover rows
    op.execute(
        """
        UPDATE handovers
        SET p_first_name        = patients.first_name,
            p_last_name         = patients.last_name,
            p_room_number       = patients.room_number,
            p_bed               = patients.bed,
            p_mrn               = patients.mrn,
            p_diagnosis         = patients.diagnosis,
            p_date_of_birth     = patients.date_of_birth,
            p_age               = patients.age,
            p_attending_physician = patients.attending_physician
        FROM patients
        WHERE handovers.patient_id = patients.id
        """
    )

    # 3. Make patient_id nullable (new handovers won't require a patient row)
    op.alter_column("handovers", "patient_id", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # Restore patient_id as NOT NULL (will fail if any NULLs exist)
    op.alter_column("handovers", "patient_id", existing_type=sa.String(), nullable=False)

    # Drop the embedded patient columns
    op.drop_column("handovers", "p_attending_physician")
    op.drop_column("handovers", "p_age")
    op.drop_column("handovers", "p_date_of_birth")
    op.drop_column("handovers", "p_diagnosis")
    op.drop_column("handovers", "p_mrn")
    op.drop_column("handovers", "p_bed")
    op.drop_column("handovers", "p_room_number")
    op.drop_column("handovers", "p_last_name")
    op.drop_column("handovers", "p_first_name")
