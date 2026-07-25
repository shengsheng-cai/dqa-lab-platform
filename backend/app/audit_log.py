"""稽核寫入 helper（與 auth 無關，獨立成模組）。

audit.py 放的是需要 require_admin 的查詢／匯出 router，會 import auth；把純寫入的
log_audit 抽到這裡（只依賴 models + utils），讓 auth.py 及其他模組能直接頂層 import，
不用再各自在函式內 import 避開 audit↔auth 循環。
"""
from typing import Optional

from .models import AuditLog
from .utils import _now_utc_naive


def log_audit(
    db,
    actor: str,
    role: Optional[str],
    action: str,
    entity_type: str,
    entity_id: str,
    detail: Optional[str] = None,
):
    db.add(AuditLog(
        timestamp=_now_utc_naive(),
        actor=actor,
        role=role,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        detail=detail,
    ))
