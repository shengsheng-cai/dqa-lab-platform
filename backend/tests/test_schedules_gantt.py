import datetime

import app.schedules as schedules_module
from app.models import DeviceBlockedPeriod
from app.schedules import router as schedules_router


def test_gantt_does_not_silently_drop_blocked_periods_after_500(api_client):
    """第 501 筆也要送到前端，否則它落在現在時，啟動鈕會被錯誤放行。"""
    with api_client(
        schedules_module,
        schedules_router,
        role="admin",
        app_state={"AICM_CACHE": {}},
    ) as (client, Session):
        start = datetime.datetime(2026, 1, 1)
        with Session() as db:
            db.add_all([
                DeviceBlockedPeriod(
                    device_id="CH-01",
                    start_time=start + datetime.timedelta(minutes=index),
                    end_time=start + datetime.timedelta(days=1, minutes=index),
                    reason=f"period-{index}",
                )
                for index in range(501)
            ])
            db.commit()

        response = client.get("/api/schedules/gantt")

    assert response.status_code == 200
    periods = response.json()["blocked_periods"]
    assert len(periods) == 501
    assert periods[-1]["reason"] == "period-500"
