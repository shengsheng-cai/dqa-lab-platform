"""initial schema

Revision ID: a517a1796fda
Revises: 
Create Date: 2026-03-10 21:40:09.882129

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a517a1796fda'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("line_user_id", sa.String(), nullable=True),
        sa.Column("loan_limit", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("current_token", sa.String(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_current_token", "users", ["current_token"], unique=False)

    op.create_table(
        "fixtures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("interface_type", sa.String(), nullable=False),
        sa.Column("form_factor", sa.String(), nullable=False),
        sa.Column("size", sa.String(), nullable=True),
        sa.Column("purpose", sa.String(), nullable=True),
        sa.Column("estimated_usage", sa.Float(), nullable=True),
        sa.Column("total_quantity", sa.Integer(), nullable=False),
        sa.Column("shortage", sa.Integer(), nullable=False),
        sa.Column("usage_frequency", sa.Integer(), nullable=True),
        sa.Column("replacement_years", sa.String(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("keeper_name", sa.String(), nullable=True),
        sa.Column("keeper_user_id", sa.Integer(), nullable=True),
        sa.Column("deputy_name", sa.String(), nullable=True),
        sa.Column("vendor", sa.String(), nullable=True),
        sa.Column("model_number", sa.String(), nullable=True),
        sa.Column("spec", sa.Text(), nullable=True),
        sa.Column("lead_time", sa.String(), nullable=True),
        sa.Column("unit_price", sa.Float(), nullable=True),
        sa.Column("loan_count", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["keeper_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fixtures_id", "fixtures", ["id"], unique=False)
    op.create_index("ix_fixtures_interface_type", "fixtures", ["interface_type"], unique=False)

    op.create_table(
        "fixture_loans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fixture_id", sa.Integer(), nullable=False),
        sa.Column("borrower_name", sa.String(), nullable=False),
        sa.Column("borrower_user_id", sa.Integer(), nullable=True),
        sa.Column("device_id", sa.String(), nullable=True),
        sa.Column("project_name", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("loan_date", sa.DateTime(), nullable=False),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("return_date", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("return_condition", sa.String(), nullable=True),
        sa.Column("extension_note", sa.Text(), nullable=True),
        sa.Column("keeper_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["borrower_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["fixture_id"], ["fixtures.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fixture_loans_id", "fixture_loans", ["id"], unique=False)
    op.create_index("ix_fixture_loans_fixture_id", "fixture_loans", ["fixture_id"], unique=False)
    op.create_index("ix_fixture_loans_status", "fixture_loans", ["status"], unique=False)
    op.create_index("ix_fixture_loans_due_date", "fixture_loans", ["due_date"], unique=False)

    op.create_table(
        "sop_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sop_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("test_type", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("steps_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sop_templates_id", "sop_templates", ["id"], unique=False)
    op.create_index("ix_sop_templates_sop_id", "sop_templates", ["sop_id"], unique=True)

    op.create_table(
        "sop_executions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sop_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=True),
        sa.Column("operator", sa.String(), nullable=True),
        sa.Column("operator_user_id", sa.Integer(), nullable=True),
        sa.Column("test_started_at", sa.DateTime(), nullable=True),
        sa.Column("test_ended_at", sa.DateTime(), nullable=True),
        sa.Column("photo_before_path", sa.String(), nullable=True),
        sa.Column("photo_after_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sop_executions_id", "sop_executions", ["id"], unique=False)
    op.create_index("ix_sop_executions_sop_id", "sop_executions", ["sop_id"], unique=False)

    op.create_table(
        "device_data",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("humidity", sa.Float(), nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_device_data_id", "device_data", ["id"], unique=False)
    op.create_index("ix_device_data_device_id", "device_data", ["device_id"], unique=False)

    op.create_table(
        "device_states",
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("humidity", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("running_sop_id", sa.String(), nullable=True),
        sa.Column("running_sop_name", sa.String(), nullable=True),
        sa.Column("standard_id", sa.String(), nullable=True),
        sa.Column("active_sop_json", sa.Text(), nullable=True),
        sa.Column("completed_steps", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("sim_phase", sa.String(), nullable=True),
        sa.Column("sim_cycle", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("device_id"),
    )

    op.create_table(
        "error_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("error_type", sa.String(), nullable=False),
        sa.Column("sop_id", sa.String(), nullable=True),
        sa.Column("sop_name", sa.String(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("humidity", sa.Float(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_error_logs_id", "error_logs", ["id"], unique=False)
    op.create_index("ix_error_logs_device_id", "error_logs", ["device_id"], unique=False)

    op.create_table(
        "notification_failures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("notif_type", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=True),
        sa.Column("message_preview", sa.String(), nullable=True),
        sa.Column("error_msg", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_failures_id", "notification_failures", ["id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_notification_failures_id", table_name="notification_failures")
    op.drop_table("notification_failures")

    op.drop_index("ix_error_logs_device_id", table_name="error_logs")
    op.drop_index("ix_error_logs_id", table_name="error_logs")
    op.drop_table("error_logs")

    op.drop_table("device_states")

    op.drop_index("ix_device_data_device_id", table_name="device_data")
    op.drop_index("ix_device_data_id", table_name="device_data")
    op.drop_table("device_data")

    op.drop_index("ix_sop_executions_sop_id", table_name="sop_executions")
    op.drop_index("ix_sop_executions_id", table_name="sop_executions")
    op.drop_table("sop_executions")

    op.drop_index("ix_sop_templates_sop_id", table_name="sop_templates")
    op.drop_index("ix_sop_templates_id", table_name="sop_templates")
    op.drop_table("sop_templates")

    op.drop_index("ix_fixture_loans_due_date", table_name="fixture_loans")
    op.drop_index("ix_fixture_loans_status", table_name="fixture_loans")
    op.drop_index("ix_fixture_loans_fixture_id", table_name="fixture_loans")
    op.drop_index("ix_fixture_loans_id", table_name="fixture_loans")
    op.drop_table("fixture_loans")

    op.drop_index("ix_fixtures_interface_type", table_name="fixtures")
    op.drop_index("ix_fixtures_id", table_name="fixtures")
    op.drop_table("fixtures")

    op.drop_index("ix_users_current_token", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")
