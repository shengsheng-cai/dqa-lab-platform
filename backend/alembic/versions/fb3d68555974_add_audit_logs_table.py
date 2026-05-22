"""add audit_logs table

Revision ID: fb3d68555974
Revises: abe0ab2a76a6
Create Date: 2026-05-06 15:05:13.266443

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fb3d68555974'
down_revision: Union[str, Sequence[str], None] = 'abe0ab2a76a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "audit_logs" in insp.get_table_names():
        return

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_id", "audit_logs", ["id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "audit_logs" not in insp.get_table_names():
        return
    idx = {i["name"] for i in insp.get_indexes("audit_logs")}
    if "ix_audit_logs_id" in idx:
        op.drop_index("ix_audit_logs_id", table_name="audit_logs")
    op.drop_table("audit_logs")
