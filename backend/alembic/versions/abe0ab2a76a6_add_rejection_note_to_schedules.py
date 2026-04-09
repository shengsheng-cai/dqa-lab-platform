"""add rejection_note to schedules

Revision ID: abe0ab2a76a6
Revises: fe3c0b9207e9
Create Date: 2026-04-09 15:13:07.389106

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'abe0ab2a76a6'
down_revision: Union[str, Sequence[str], None] = 'fe3c0b9207e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('schedules', sa.Column('rejection_note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('schedules', 'rejection_note')
