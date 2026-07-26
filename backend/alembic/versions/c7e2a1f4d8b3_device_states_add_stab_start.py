"""device_states 加常溫穩定計時起點 stab_start

Revision ID: c7e2a1f4d8b3
Revises: bc6bfd801261
Create Date: 2026-07-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7e2a1f4d8b3'
down_revision: Union[str, Sequence[str], None] = 'bc6bfd801261'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """回常溫後的常溫穩定計時起點；重啟後接回剩餘穩定時間。"""
    op.add_column('device_states', sa.Column('stab_start', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('device_states', 'stab_start')
