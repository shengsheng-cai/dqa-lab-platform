"""fix calibration interval_days nullable drift

Revision ID: e8a2c6f41b90
Revises: d4c1f9a7b2e6
Create Date: 2026-07-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8a2c6f41b90"
down_revision: Union[str, Sequence[str], None] = "d4c1f9a7b2e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _interval_days_is_nullable() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns("device_calibrations")
    return next(
        column["nullable"]
        for column in columns
        if column["name"] == "interval_days"
    )


def upgrade() -> None:
    op.execute(sa.text(
        "UPDATE device_calibrations "
        "SET interval_days = 365 "
        "WHERE interval_days IS NULL"
    ))
    if _interval_days_is_nullable():
        with op.batch_alter_table("device_calibrations") as batch_op:
            batch_op.alter_column(
                "interval_days",
                existing_type=sa.Integer(),
                nullable=False,
            )


def downgrade() -> None:
    if not _interval_days_is_nullable():
        with op.batch_alter_table("device_calibrations") as batch_op:
            batch_op.alter_column(
                "interval_days",
                existing_type=sa.Integer(),
                nullable=True,
            )
