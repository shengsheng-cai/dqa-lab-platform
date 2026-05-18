"""
T-15: fixtures API 補充測試
- delete_fixture：有 reserved/loaned 借用時不可刪除
"""
import datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

from app.fixtures import router as fixtures_router
from app.models import Base, Fixture, FixtureLoan


def _make_admin_app():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)

    import app.fixtures as fixtures_module
    original_session = fixtures_module.SessionLocal

    def _override_session():
        return TestSession()

    fixtures_module.SessionLocal = _override_session  # type: ignore[assignment]

    test_app = FastAPI()

    class RoleMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            request.state.user_role = "admin"
            return await call_next(request)

    test_app.add_middleware(RoleMiddleware)
    test_app.include_router(fixtures_router)

    return test_app, engine, TestSession, fixtures_module, original_session


@pytest.fixture()
def admin_client():
    app, engine, TestSession, fixtures_module, original_session = _make_admin_app()
    with TestClient(app) as client:
        yield client, TestSession
    fixtures_module.SessionLocal = original_session  # type: ignore[assignment]
    Base.metadata.drop_all(engine)


def _seed_fixture_with_loan(Session, loan_status: str) -> int:
    with Session() as db:
        fixture = Fixture(
            interface_type="USB",
            form_factor="Desktop",
            total_quantity=5,
            shortage=0,
            is_active=True,
        )
        db.add(fixture)
        db.flush()
        db.add(
            FixtureLoan(
                fixture_id=fixture.id,
                borrower_name="測試人員",
                quantity=1,
                status=loan_status,
                loan_date=datetime.datetime.now(),
            )
        )
        db.commit()
        return fixture.id


def test_delete_fixture_blocks_reserved_loan(admin_client):
    client, Session = admin_client
    fixture_id = _seed_fixture_with_loan(Session, "reserved")

    resp = client.delete(f"/api/fixtures/{fixture_id}")

    assert resp.status_code == 400
    assert "借出/預約未結束" in resp.json()["detail"]
