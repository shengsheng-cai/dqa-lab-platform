"""排程 service result 的共用 HTTP 轉換。"""

from fastapi import HTTPException

from .schedule_service import ScheduleStartCode, ScheduleStartResult


def schedule_start_http_error(result: ScheduleStartResult) -> HTTPException:
    """將排程啟動結果轉為 routes 共用的 HTTP 錯誤。"""
    status_code = {
        ScheduleStartCode.NOT_FOUND: 404,
        ScheduleStartCode.BROKEN: 400,
        ScheduleStartCode.NOT_STARTABLE: 400,
        ScheduleStartCode.RETRYABLE_FAILURE: 503,
    }.get(result.code, 409)
    return HTTPException(
        status_code=status_code,
        detail=result.detail or "排程目前無法啟動",
    )
