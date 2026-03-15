"""Expand handover schema for pediatric oncology template

Revision ID: c123456
Revises: 891a861393c6
Create Date: 2026-03-07 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c123456'
down_revision: Union[str, None] = 'c90e2ba6621b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to handovers table for pediatric oncology template
    
    # Header fields
    op.add_column('handovers', sa.Column('pertinent_issues', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('admit_date', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('anticipated_discharge', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('chemotherapies', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('prn_medications', sa.Text(), nullable=True))
    
    # Labs
    op.add_column('handovers', sa.Column('wbc', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('hgb', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('plt', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('anc', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('abnormal_labs', sa.Text(), nullable=True))
    
    # VS/Pain
    op.add_column('handovers', sa.Column('abnormal_vitals', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('bpews_score', sa.String(10), nullable=True))
    op.add_column('handovers', sa.Column('pain_scale', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('pca_nca_bolus', sa.Text(), nullable=True))
    
    # IV
    op.add_column('handovers', sa.Column('cvad_type', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('cvad_dressing', sa.String(100), nullable=True))
    op.add_column('handovers', sa.Column('iv_infusions', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('tpn', sa.Text(), nullable=True))
    
    # G.U.
    op.add_column('handovers', sa.Column('urine_output', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('io_00', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('io_06', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('io_12', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('io_18', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('foley', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('urine_sg', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('urine_ph', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('urine_glucose', sa.String(20), nullable=True))
    
    # Neurological
    op.add_column('handovers', sa.Column('neuro_normal', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('altered_loc', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('speech_changes', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('confusion', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('gcs_score', sa.String(10), nullable=True))
    op.add_column('handovers', sa.Column('neuro_notes', sa.Text(), nullable=True))
    
    # Resp/Cardio
    op.add_column('handovers', sa.Column('lung_assessment', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('oxygen_needs', sa.String(100), nullable=True))
    op.add_column('handovers', sa.Column('chest_tube_left', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('chest_tube_right', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('heart_rate_notes', sa.Text(), nullable=True))
    
    # G.I.
    op.add_column('handovers', sa.Column('gi_tenderness', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('gi_distention', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('gi_girth', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('vomiting', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('nausea', sa.Boolean(), nullable=True))
    op.add_column('handovers', sa.Column('bowel_movements', sa.Text(), nullable=True))
    
    # Nutrition
    op.add_column('handovers', sa.Column('po_intake', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('formula', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('continuous_feeding_rate', sa.String(20), nullable=True))
    op.add_column('handovers', sa.Column('tube_type', sa.String(20), nullable=True))  # NG, NJ, GT
    
    # Musculoskeletal
    op.add_column('handovers', sa.Column('mobility_restrictions', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('positioning', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('assistive_devices', sa.Text(), nullable=True))
    
    # Skin
    op.add_column('handovers', sa.Column('braden_q_score', sa.String(10), nullable=True))
    op.add_column('handovers', sa.Column('skin_care_plan', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('pressure_sore_staging', sa.Text(), nullable=True))
    
    # Psycho-Social
    op.add_column('handovers', sa.Column('psychosocial_notes', sa.Text(), nullable=True))
    
    # Page 2: Discharge Planning
    op.add_column('handovers', sa.Column('expected_discharge_date', sa.String(50), nullable=True))
    op.add_column('handovers', sa.Column('discharge_teaching', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('discharge_prescriptions', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('home_enteral_feeding', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('followup_appointments', sa.Text(), nullable=True))
    
    # Page 2: To Do & Follow Up
    op.add_column('handovers', sa.Column('todo_items', sa.Text(), nullable=True))
    op.add_column('handovers', sa.Column('followup_items', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove all added columns
    columns_to_remove = [
        'pertinent_issues', 'admit_date', 'anticipated_discharge', 'chemotherapies', 'prn_medications',
        'wbc', 'hgb', 'plt', 'anc', 'abnormal_labs',
        'abnormal_vitals', 'bpews_score', 'pain_scale', 'pca_nca_bolus',
        'cvad_type', 'cvad_dressing', 'iv_infusions', 'tpn',
        'urine_output', 'io_00', 'io_06', 'io_12', 'io_18', 'foley', 'urine_sg', 'urine_ph', 'urine_glucose',
        'neuro_normal', 'altered_loc', 'speech_changes', 'confusion', 'gcs_score', 'neuro_notes',
        'lung_assessment', 'oxygen_needs', 'chest_tube_left', 'chest_tube_right', 'heart_rate_notes',
        'gi_tenderness', 'gi_distention', 'gi_girth', 'vomiting', 'nausea', 'bowel_movements',
        'po_intake', 'formula', 'continuous_feeding_rate', 'tube_type',
        'mobility_restrictions', 'positioning', 'assistive_devices',
        'braden_q_score', 'skin_care_plan', 'pressure_sore_staging',
        'psychosocial_notes',
        'expected_discharge_date', 'discharge_teaching', 'discharge_prescriptions', 'home_enteral_feeding', 'followup_appointments',
        'todo_items', 'followup_items'
    ]
    for col in columns_to_remove:
        op.drop_column('handovers', col)
