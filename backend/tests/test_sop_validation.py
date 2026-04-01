"""
T-01: _validate_start_sop_input 單元測試
純 dict 操作 + HTTPException，不需 DB。
"""
import pytest
from fastapi import HTTPException

from app.sop import _validate_start_sop_input, DEVICE_IDS


def test_missing_sop_id_raises_400():
    with pytest.raises(HTTPException) as exc:
        _validate_start_sop_input({"sop_id": "", "device_id": "CH-01"}, {"CH-01": {}})
    assert exc.value.status_code == 400
    assert "sop_id" in exc.value.detail


def test_invalid_device_id_raises_400():
    with pytest.raises(HTTPException) as exc:
        _validate_start_sop_input({"sop_id": "sop1", "device_id": "XX-99"}, {})
    assert exc.value.status_code == 400
    assert "device_id" in exc.value.detail


def test_device_not_in_cache_raises_404():
    with pytest.raises(HTTPException) as exc:
        _validate_start_sop_input({"sop_id": "sop1", "device_id": "CH-01"}, {})
    assert exc.value.status_code == 404


def test_valid_input_returns_tuple():
    cache = {"CH-01": {"status": "IDLE", "temperature": 25.0}}
    sop_id, device_id, device = _validate_start_sop_input(
        {"sop_id": "IEC-Ba-85-168", "device_id": "CH-01"}, cache
    )
    assert sop_id == "IEC-Ba-85-168"
    assert device_id == "CH-01"
    assert device["status"] == "IDLE"


def test_default_device_id_is_ch01():
    """payload 未帶 device_id → 預設 CH-01"""
    cache = {"CH-01": {"status": "IDLE"}}
    _, device_id, _ = _validate_start_sop_input({"sop_id": "sop1"}, cache)
    assert device_id == "CH-01"


def test_all_valid_device_ids_accepted():
    """DEVICE_IDS 中的每個設備都能通過驗證"""
    for did in DEVICE_IDS:
        cache = {did: {"status": "IDLE"}}
        _, device_id, _ = _validate_start_sop_input(
            {"sop_id": "sop1", "device_id": did}, cache
        )
        assert device_id == did
