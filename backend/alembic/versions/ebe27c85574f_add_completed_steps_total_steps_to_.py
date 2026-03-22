"""add completed_steps total_steps to error_logs
Revision ID: ebe27c85574f
Revises: cdd650ed8d87
Create Date: 2026-03-19 19:28:20.737091
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'ebe27c85574f'
down_revision: Union[str, Sequence[str], None] = 'cdd650ed8d87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('error_logs', sa.Column('completed_steps', sa.Integer(), nullable=True))
    op.add_column('error_logs', sa.Column('total_steps', sa.Integer(), nullable=True))

def downgrade() -> None:
    op.drop_column('error_logs', 'total_steps')
    op.drop_column('error_logs', 'completed_steps')
