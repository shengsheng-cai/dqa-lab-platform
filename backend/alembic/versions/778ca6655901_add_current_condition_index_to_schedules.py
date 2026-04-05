"""add current_condition_index to schedules

Revision ID: 778ca6655901
Revises: 7c353118861b
Create Date: 2026-04-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '778ca6655901'
down_revision: Union[str, Sequence[str], None] = '7c353118861b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('schedules', sa.Column('current_condition_index', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('schedules', 'current_condition_index')
