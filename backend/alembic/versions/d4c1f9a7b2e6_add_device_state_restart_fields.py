"""add device state restart fields

Revision ID: d4c1f9a7b2e6
Revises: 5bfa13f98b7d
Create Date: 2026-07-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4c1f9a7b2e6"
down_revision: Union[str, Sequence[str], None] = "5bfa13f98b7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"]
        for column in sa.inspect(bind).get_columns("device_states")
    }
    additions = {
        "total_steps": sa.Column(
            "total_steps",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        "operator": sa.Column("operator", sa.String(), nullable=True),
        "operator_user_id": sa.Column(
            "operator_user_id",
            sa.Integer(),
            nullable=True,
        ),
        "skip_push": sa.Column(
            "skip_push",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("device_states", column)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"]
        for column in sa.inspect(bind).get_columns("device_states")
    }
    with op.batch_alter_table("device_states") as batch_op:
        for name in (
            "skip_push",
            "operator_user_id",
            "operator",
            "total_steps",
        ):
            if name in columns:
                batch_op.drop_column(name)
