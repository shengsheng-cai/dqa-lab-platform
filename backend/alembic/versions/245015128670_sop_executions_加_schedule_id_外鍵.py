"""sop_executions 加 schedule_id 外鍵

報告要印的受測樣品／案號／客戶都在 schedules 上，執行紀錄原本連不回去（BUG-009）。

Revision ID: 245015128670
Revises: c7e2a1f4d8b3
Create Date: 2026-08-10 20:24:51.165446

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '245015128670'
down_revision: Union[str, Sequence[str], None] = 'c7e2a1f4d8b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# autogenerate 另外偵測到要 drop 掉 line_bind_requests，已從這份 migration 移除：
# 那張表 97789ba91e84 早就 drop 過了，只是本機開發資料庫還停在更舊的狀態才被比出來。
# 留著會讓全新資料庫跑到這一步時因為表不存在而炸掉。
# SQLite 不支援 ALTER TABLE ADD CONSTRAINT，外鍵一律走 batch_alter_table 加具名約束
# （同 3dc9bb30d51f 為 fixture_loans 加 schedule_id 的做法）。


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sop_executions', sa.Column('schedule_id', sa.Integer(), nullable=True))
    op.create_index(
        op.f('ix_sop_executions_schedule_id'), 'sop_executions', ['schedule_id'], unique=False
    )
    with op.batch_alter_table('sop_executions') as batch_op:
        batch_op.create_foreign_key(
            'fk_sop_executions_schedule_id', 'schedules', ['schedule_id'], ['id']
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sop_executions') as batch_op:
        batch_op.drop_constraint('fk_sop_executions_schedule_id', type_='foreignkey')
    op.drop_index(op.f('ix_sop_executions_schedule_id'), table_name='sop_executions')
    op.drop_column('sop_executions', 'schedule_id')
