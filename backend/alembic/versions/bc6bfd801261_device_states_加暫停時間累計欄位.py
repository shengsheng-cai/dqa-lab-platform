"""device_states 加暫停時間累計欄位

Revision ID: bc6bfd801261
Revises: e8a2c6f41b90
Create Date: 2026-07-26 15:25:29.623406

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bc6bfd801261'
down_revision: Union[str, Sequence[str], None] = 'e8a2c6f41b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """device_states 加暫停時間累計欄位（估算結束時間要把暫停扣回去）。"""
    op.add_column('device_states', sa.Column('paused_at', sa.DateTime(), nullable=True))
    op.add_column('device_states', sa.Column('pause_accum_seconds', sa.Float(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('device_states', 'pause_accum_seconds')
    op.drop_column('device_states', 'paused_at')
