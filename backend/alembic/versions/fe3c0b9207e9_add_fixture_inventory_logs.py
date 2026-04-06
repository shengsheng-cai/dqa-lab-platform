"""add fixture inventory logs

Revision ID: fe3c0b9207e9
Revises: 778ca6655901
Create Date: 2026-04-06 20:53:18.530250

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fe3c0b9207e9'
down_revision: Union[str, Sequence[str], None] = '778ca6655901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # fixture_inventory_logs was already created via init_db.py
    # Add missing indexes (created in models but not in previous migrations)
    bind = op.get_bind()
    insp = sa.inspect(bind)

    fixture_loan_indexes = [i['name'] for i in insp.get_indexes('fixture_loans')]
    if 'ix_fixture_loans_due_date' not in fixture_loan_indexes:
        op.create_index('ix_fixture_loans_due_date', 'fixture_loans', ['due_date'], unique=False)
    if 'ix_fixture_loans_status' not in fixture_loan_indexes:
        op.create_index('ix_fixture_loans_status', 'fixture_loans', ['status'], unique=False)

    schedule_indexes = [i['name'] for i in insp.get_indexes('schedules')]
    if 'ix_schedules_device_id' not in schedule_indexes:
        op.create_index('ix_schedules_device_id', 'schedules', ['device_id'], unique=False)
    if 'ix_schedules_id' not in schedule_indexes:
        op.create_index('ix_schedules_id', 'schedules', ['id'], unique=False)

    user_indexes = [i['name'] for i in insp.get_indexes('users')]
    if 'ix_users_id' not in user_indexes:
        op.create_index('ix_users_id', 'users', ['id'], unique=False)
    if 'ix_users_username' not in user_indexes:
        op.create_index('ix_users_username', 'users', ['username'], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    user_indexes = [i['name'] for i in insp.get_indexes('users')]
    if 'ix_users_username' in user_indexes:
        op.drop_index('ix_users_username', table_name='users')
    if 'ix_users_id' in user_indexes:
        op.drop_index('ix_users_id', table_name='users')

    schedule_indexes = [i['name'] for i in insp.get_indexes('schedules')]
    if 'ix_schedules_id' in schedule_indexes:
        op.drop_index('ix_schedules_id', table_name='schedules')
    if 'ix_schedules_device_id' in schedule_indexes:
        op.drop_index('ix_schedules_device_id', table_name='schedules')

    fixture_loan_indexes = [i['name'] for i in insp.get_indexes('fixture_loans')]
    if 'ix_fixture_loans_status' in fixture_loan_indexes:
        op.drop_index('ix_fixture_loans_status', table_name='fixture_loans')
    if 'ix_fixture_loans_due_date' in fixture_loan_indexes:
        op.drop_index('ix_fixture_loans_due_date', table_name='fixture_loans')
