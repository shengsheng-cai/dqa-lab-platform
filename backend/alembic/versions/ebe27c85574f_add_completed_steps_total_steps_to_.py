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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("error_logs")}

    if "completed_steps" not in cols:
        op.add_column("error_logs", sa.Column("completed_steps", sa.Integer(), nullable=True))
    if "total_steps" not in cols:
        op.add_column("error_logs", sa.Column("total_steps", sa.Integer(), nullable=True))

def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("error_logs")}

    if "total_steps" in cols:
        op.drop_column("error_logs", "total_steps")
    if "completed_steps" in cols:
        op.drop_column("error_logs", "completed_steps")
