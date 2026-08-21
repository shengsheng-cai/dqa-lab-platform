"""移除校驗證書號碼

Revision ID: c4a9e21d7f63
Revises: b7f4c2e91a05
Create Date: 2026-08-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4a9e21d7f63"
down_revision: Union[str, Sequence[str], None] = "b7f4c2e91a05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("device_calibrations") as batch_op:
        batch_op.drop_column("certificate_number")


def downgrade() -> None:
    with op.batch_alter_table("device_calibrations") as batch_op:
        batch_op.add_column(
            sa.Column("certificate_number", sa.String(length=100), nullable=True)
        )
