"""AI 送給模型的設備小抄，說法要跟畫面一致。

這份參考資料以前自己查設備狀態表，只要不在跑就寫「空閒可用」，於是排了維護、或還有
排程沒結案的機器都會被推薦出去——畫面同時把那台算成不可用。改吃 build_device_list
之後，兩邊是同一份判斷；這裡直接斷言小抄字串，不需要呼叫 Gemini。
"""

import datetime

import pytest

import app.ai as ai_module
from app.models import DeviceBlockedPeriod, Schedule, ScheduleStatus
from app.utils import _now_utc_naive


def _reset_cache():
    ai_module._device_context_cache["data"] = ""
    ai_module._device_context_cache["expires_at"] = ai_module._now_utc()


@pytest.mark.parametrize(
    "reason,expected",
    [
        ("冷凍壓縮機例行保養", "冷凍壓縮機例行保養"),
        # 原因是選填欄位，沒填時仍要說出不可用，不能因為少一句話就回到「空閒可用」
        (None, "已設定封鎖"),
    ],
)
def test_maintenance_device_is_not_called_available(patched_session, reason, expected):
    """排了維護時段的待機設備，小抄要寫不可用並帶上原因。"""
    _reset_cache()
    with patched_session("app.devices") as Session:
        now = _now_utc_naive()
        with Session() as db:
            db.add(
                DeviceBlockedPeriod(
                    device_id="CH-03",
                    start_time=now - datetime.timedelta(days=2),
                    end_time=now + datetime.timedelta(days=5),
                    reason=reason,
                )
            )
            db.commit()

        text = ai_module._query_device_context({"CH-03": {"status": "IDLE"}})

    assert f"CH-03：維護中，不可用（{expected}）" in text
    assert "空閒可用" not in text


def test_idle_device_without_maintenance_is_available(patched_session):
    """沒有維護也沒有排程掛著的待機設備，維持「空閒可用」。"""
    _reset_cache()
    with patched_session("app.devices"):
        text = ai_module._query_device_context({"CH-04": {"status": "IDLE"}})

    assert "CH-04：空閒可用（IDLE）" in text


def test_idle_device_with_unfinished_schedule_is_not_called_available(patched_session):
    """待機但還有排程沒結案的設備，樣品與治具都還在裡面，不得寫成可以用。"""
    _reset_cache()
    with patched_session("app.devices") as Session:
        with Session() as db:
            db.add(
                Schedule(
                    project_number="P-2026-001",
                    sample_name="樣品 A",
                    device_id="CH-02",
                    standard="IEC 60068",
                    conditions="[]",
                    status=ScheduleStatus.RUNNING,
                )
            )
            db.commit()

        text = ai_module._query_device_context({"CH-02": {"status": "IDLE"}})

    assert "CH-02：待機中，但有排程尚未結案，不可另外啟動測試" in text
    assert "空閒可用" not in text


def test_running_device_reports_its_test(patched_session):
    """執行中的設備寫出正在跑什麼，不得被當成可用。"""
    _reset_cache()
    with patched_session("app.devices"):
        text = ai_module._query_device_context(
            {"CH-01": {"status": "RUNNING", "running_sop_name": "Test Ab 低溫 -40°C"}}
        )

    assert "CH-01：RUNNING，執行中：Test Ab 低溫 -40°C" in text
    assert "空閒可用" not in text


def test_running_device_without_sop_name_omits_internal_code(patched_session):
    """沒記到 SOP 名的執行中設備只寫狀態，不得把內部代碼 STANDBY 當成測試名稱寫出去。"""
    _reset_cache()
    with patched_session("app.devices"):
        text = ai_module._query_device_context({"CH-01": {"status": "RUNNING"}})

    assert "- CH-01：RUNNING" in text
    assert "STANDBY" not in text


def test_running_device_with_maintenance_reports_running(patched_session):
    """正在跑又排了維護的設備寫「執行中」，跟設備卡與頂部計數同一條判準。

    只看維護旗標的話，這台會同時被說成執行中與不可用，畫面與小抄各說各話。
    """
    _reset_cache()
    with patched_session("app.devices") as Session:
        now = _now_utc_naive()
        with Session() as db:
            db.add(
                DeviceBlockedPeriod(
                    device_id="CH-01",
                    start_time=now - datetime.timedelta(hours=1),
                    end_time=now + datetime.timedelta(hours=1),
                    reason="例行保養",
                )
            )
            db.commit()

        text = ai_module._query_device_context(
            {"CH-01": {"status": "RUNNING", "running_sop_name": "Test Ab 低溫 -40°C"}}
        )

    assert "CH-01：RUNNING，執行中：Test Ab 低溫 -40°C" in text
    assert "不可用" not in text
