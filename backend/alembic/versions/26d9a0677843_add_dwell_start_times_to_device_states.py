"""add dwell start times to device_states

Revision ID: 26d9a0677843
Revises: ebe27c85574f
Create Date: 2026-03-27 22:44:28.784060

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '26d9a0677843'
down_revision: Union[str, Sequence[str], None] = 'ebe27c85574f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    def has_table(table_name: str) -> bool:
        return table_name in sa.inspect(bind).get_table_names()

    def has_column(table_name: str, column_name: str) -> bool:
        if not has_table(table_name):
            return False
        cols = {c["name"] for c in sa.inspect(bind).get_columns(table_name)}
        return column_name in cols

    def has_index(table_name: str, index_name: str) -> bool:
        if not has_table(table_name):
            return False
        idx = {i["name"] for i in sa.inspect(bind).get_indexes(table_name)}
        return index_name in idx

    if not has_table("demo_tokens"):
        op.create_table(
            "demo_tokens",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("token", sa.String(), nullable=False),
            sa.Column("label", sa.String(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("max_uses", sa.Integer(), nullable=True),
            sa.Column("use_count", sa.Integer(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("demo_tokens") and not has_index("demo_tokens", op.f("ix_demo_tokens_id")):
        op.create_index(op.f("ix_demo_tokens_id"), "demo_tokens", ["id"], unique=False)
    if has_table("demo_tokens") and not has_index("demo_tokens", op.f("ix_demo_tokens_token")):
        op.create_index(op.f("ix_demo_tokens_token"), "demo_tokens", ["token"], unique=True)

    if not has_table("device_blocked_periods"):
        op.create_table(
            "device_blocked_periods",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("device_id", sa.String(), nullable=False),
            sa.Column("start_time", sa.DateTime(), nullable=False),
            sa.Column("end_time", sa.DateTime(), nullable=False),
            sa.Column("reason", sa.String(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("device_blocked_periods") and not has_index("device_blocked_periods", op.f("ix_device_blocked_periods_device_id")):
        op.create_index(op.f("ix_device_blocked_periods_device_id"), "device_blocked_periods", ["device_id"], unique=False)
    if has_table("device_blocked_periods") and not has_index("device_blocked_periods", op.f("ix_device_blocked_periods_id")):
        op.create_index(op.f("ix_device_blocked_periods_id"), "device_blocked_periods", ["id"], unique=False)

    if not has_table("line_bind_requests"):
        op.create_table(
            "line_bind_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("line_user_id", sa.String(), nullable=False),
            sa.Column("requested_name", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("matched_user_id", sa.Integer(), nullable=True),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["matched_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("line_bind_requests") and not has_index("line_bind_requests", op.f("ix_line_bind_requests_id")):
        op.create_index(op.f("ix_line_bind_requests_id"), "line_bind_requests", ["id"], unique=False)
    if has_table("line_bind_requests") and not has_index("line_bind_requests", op.f("ix_line_bind_requests_line_user_id")):
        op.create_index(op.f("ix_line_bind_requests_line_user_id"), "line_bind_requests", ["line_user_id"], unique=False)
    if has_table("line_bind_requests") and not has_index("line_bind_requests", op.f("ix_line_bind_requests_status")):
        op.create_index(op.f("ix_line_bind_requests_status"), "line_bind_requests", ["status"], unique=False)

    if not has_table("schedules"):
        op.create_table(
            "schedules",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_number", sa.String(), nullable=False),
            sa.Column("sample_name", sa.String(), nullable=False),
            sa.Column("applicant_name", sa.String(), nullable=True),
            sa.Column("applicant_user_id", sa.Integer(), nullable=True),
            sa.Column("device_id", sa.String(), nullable=True),
            sa.Column("standard", sa.String(), nullable=False),
            sa.Column("conditions", sa.Text(), nullable=False),
            sa.Column("start_time", sa.DateTime(), nullable=True),
            sa.Column("end_time", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("confirmed_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["applicant_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("schedules") and not has_index("schedules", "ix_schedules_device_id"):
        op.create_index("ix_schedules_device_id", "schedules", ["device_id"], unique=False)
    if has_table("schedules") and not has_index("schedules", op.f("ix_schedules_id")):
        op.create_index(op.f("ix_schedules_id"), "schedules", ["id"], unique=False)
    if has_table("schedules") and not has_index("schedules", "ix_schedules_status"):
        op.create_index("ix_schedules_status", "schedules", ["status"], unique=False)

    if not has_table("step_records"):
        op.create_table(
            "step_records",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("execution_id", sa.Integer(), nullable=False),
            sa.Column("step_id", sa.Integer(), nullable=False),
            sa.Column("completed", sa.Boolean(), nullable=False),
            sa.Column("parameters", sa.Text(), nullable=True),
            sa.Column("photos", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["execution_id"], ["sop_executions.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("step_records") and not has_index("step_records", op.f("ix_step_records_execution_id")):
        op.create_index(op.f("ix_step_records_execution_id"), "step_records", ["execution_id"], unique=False)
    if has_table("step_records") and not has_index("step_records", op.f("ix_step_records_id")):
        op.create_index(op.f("ix_step_records_id"), "step_records", ["id"], unique=False)

    if not has_table("purchase_orders"):
        op.create_table(
            "purchase_orders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("fixture_id", sa.Integer(), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.Column("unit_price", sa.Float(), nullable=True),
            sa.Column("total_price", sa.Float(), nullable=True),
            sa.Column("vendor", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("ordered_at", sa.DateTime(), nullable=True),
            sa.Column("arrived_at", sa.DateTime(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["fixture_id"], ["fixtures.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if has_table("purchase_orders") and not has_index("purchase_orders", op.f("ix_purchase_orders_fixture_id")):
        op.create_index(op.f("ix_purchase_orders_fixture_id"), "purchase_orders", ["fixture_id"], unique=False)
    if has_table("purchase_orders") and not has_index("purchase_orders", op.f("ix_purchase_orders_id")):
        op.create_index(op.f("ix_purchase_orders_id"), "purchase_orders", ["id"], unique=False)

    if has_table("device_states") and not has_column("device_states", "dwell_high_start"):
        op.add_column("device_states", sa.Column("dwell_high_start", sa.DateTime(), nullable=True))
    if has_table("device_states") and not has_column("device_states", "dwell_low_start"):
        op.add_column("device_states", sa.Column("dwell_low_start", sa.DateTime(), nullable=True))

    if has_table("fixture_loans") and not has_index("fixture_loans", op.f("ix_fixture_loans_id")):
        op.create_index(op.f("ix_fixture_loans_id"), "fixture_loans", ["id"], unique=False)
    if has_table("fixtures") and not has_index("fixtures", op.f("ix_fixtures_id")):
        op.create_index(op.f("ix_fixtures_id"), "fixtures", ["id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f('ix_fixtures_id'), table_name='fixtures')
    op.drop_index(op.f('ix_fixture_loans_id'), table_name='fixture_loans')
    op.drop_column('device_states', 'dwell_low_start')
    op.drop_column('device_states', 'dwell_high_start')
    op.drop_index(op.f('ix_purchase_orders_id'), table_name='purchase_orders')
    op.drop_index(op.f('ix_purchase_orders_fixture_id'), table_name='purchase_orders')
    op.drop_table('purchase_orders')
    op.drop_index(op.f('ix_step_records_id'), table_name='step_records')
    op.drop_index(op.f('ix_step_records_execution_id'), table_name='step_records')
    op.drop_table('step_records')
    op.drop_index('ix_schedules_status', table_name='schedules')
    op.drop_index(op.f('ix_schedules_id'), table_name='schedules')
    op.drop_index('ix_schedules_device_id', table_name='schedules')
    op.drop_table('schedules')
    op.drop_index(op.f('ix_line_bind_requests_status'), table_name='line_bind_requests')
    op.drop_index(op.f('ix_line_bind_requests_line_user_id'), table_name='line_bind_requests')
    op.drop_index(op.f('ix_line_bind_requests_id'), table_name='line_bind_requests')
    op.drop_table('line_bind_requests')
    op.drop_index(op.f('ix_device_blocked_periods_id'), table_name='device_blocked_periods')
    op.drop_index(op.f('ix_device_blocked_periods_device_id'), table_name='device_blocked_periods')
    op.drop_table('device_blocked_periods')
    op.drop_index(op.f('ix_demo_tokens_token'), table_name='demo_tokens')
    op.drop_index(op.f('ix_demo_tokens_id'), table_name='demo_tokens')
    op.drop_table('demo_tokens')
    # ### end Alembic commands ###
