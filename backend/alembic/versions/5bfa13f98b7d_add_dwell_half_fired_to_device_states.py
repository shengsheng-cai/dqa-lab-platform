"""add dwell_half_fired to device_states

Revision ID: 5bfa13f98b7d
Revises: a2634d17f712
Create Date: 2026-05-19 01:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5bfa13f98b7d"
down_revision: Union[str, Sequence[str], None] = "a2634d17f712"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("device_states")}

    if "dwell_half_fired" not in cols:
        op.add_column(
            "device_states",
            sa.Column(
                "dwell_half_fired",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("device_states")}

    if "dwell_half_fired" in cols:
        with op.batch_alter_table("device_states") as batch_op:
            batch_op.drop_column("dwell_half_fired")
