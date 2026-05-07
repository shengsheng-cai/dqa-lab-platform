"""add device calibration maintenance

Revision ID: a2634d17f712
Revises: fb3d68555974
Create Date: 2026-05-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2634d17f712'
down_revision: Union[str, Sequence[str], None] = 'fb3d68555974'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'device_calibrations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.String(length=20), nullable=False),
        sa.Column('calibration_date', sa.DateTime(), nullable=False),
        sa.Column('next_calibration_date', sa.DateTime(), nullable=False),
        sa.Column('interval_days', sa.Integer(), nullable=True),
        sa.Column('certificate_number', sa.String(length=100), nullable=True),
        sa.Column('result', sa.String(length=10), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_device_calibrations_id', 'device_calibrations', ['id'], unique=False)
    op.create_index('ix_device_calibrations_device_id', 'device_calibrations', ['device_id'], unique=False)

    op.create_table(
        'device_maintenances',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.String(length=20), nullable=False),
        sa.Column('maintenance_date', sa.DateTime(), nullable=False),
        sa.Column('maintenance_type', sa.String(length=50), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('performed_by', sa.String(length=100), nullable=False),
        sa.Column('next_maintenance_date', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_device_maintenances_id', 'device_maintenances', ['id'], unique=False)
    op.create_index('ix_device_maintenances_device_id', 'device_maintenances', ['device_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_device_maintenances_device_id', table_name='device_maintenances')
    op.drop_index('ix_device_maintenances_id', table_name='device_maintenances')
    op.drop_table('device_maintenances')

    op.drop_index('ix_device_calibrations_device_id', table_name='device_calibrations')
    op.drop_index('ix_device_calibrations_id', table_name='device_calibrations')
    op.drop_table('device_calibrations')
