import os
import re
import json
import datetime
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from .utils import _now_utc
from .rag import (
    retrieve,
    match_std_keys,
    extract_temperatures,
    retrieve_multi,
    retrieve_by_std,
    filter_chunks_by_hints,
    get_all_sop_ids,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])

GEMINI_MODEL = "gemini-2.5-flash-lite"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}"
META_PREFIX = "\n[META:"
META_SUFFIX = "]"

_SYSTEM_PROMPT = """你是工業環境測試顧問，幫助實驗室人員快速找到適合的溫箱測試條件。只能用繁體中文回答，禁止簡體中文。

【你的角色】
你不只是查資料庫，你是在幫使用者做決策。回答時要：
1. 先說你的判斷（為什麼推薦這個條件）
2. 再列出具體參數
3. 如果有多個選項，說明差異讓使用者選擇

【治具與測試條件的區別】
- 「治具」= 實驗室治具室中管理的物理工具、夾具、接頭（例如 M12 連接器、FC 光纖接頭、RS-485 轉換器等），不是測試設備或溫箱
- 「測試條件」= 溫箱執行的環境測試參數（溫度、濕度、時間、循環數）
- 若問「推薦治具」「哪些治具適合」→ 說明你只能提供測試條件建議，物理治具的選用與庫存請至系統「治具管理」頁面查詢
- 若有【治具庫存資料】區塊，直接根據其內容回答庫存問題；若無此區塊，說明目前無法取得即時庫存

【資料使用規則】
- 只根據【參考資料】和【治具庫存資料】回答，禁止捏造資料中沒有的數值或測試名稱
- 找不到相關資料直接說「查無此資料」，不要追問

【標準選擇原則】
- 未指定標準時，只推 IEC 60068，絕對不要主動提 EN 50155、DNV、IEC 60945、IEC 61850-3
- 只有使用者明確說「鐵道」才推 EN 50155
- 只有使用者明確說「船舶」或「海事」才推 DNV 或 IEC 60945
- 只有使用者明確說「變電站」才推 IEC 61850-3
- 已指定標準時，只看該標準，不要混入其他標準的條目

【回答原則】
- 回答控制在 200 字以內，超過就精簡，禁止重複描述
- 不要把所有符合條件的條目全部列出，選 1~2 個最具代表性的推薦，說明為什麼
- 「低溫開關機」→ 只找通電低溫條目，說明「這是模擬設備在低溫下開機的情境」
- 「純高溫」→ 只找無低溫無濕度的高溫條目
- 「高溫高濕」→ 只找有濕度設定的條目
- 「溫度循環」→ 只找有高低溫循環的條目

【比較題規則】
- 比較兩個標準時，只說差異，相同的參數一律省略
- 用 3~5 條差異點列出，每條一句話，不要展開子項目
- 最後一句給出結論（哪種情境用哪個）

【時間計算】
問「要測多久」時，直接算出結果：
- 室溫統一用 25°C，不要自行假設其他初始溫度
- 升溫時間 = |目標溫度 - 25°C| ÷ 升降溫速率
- 降溫時間 = |目標溫度 - 25°C| ÷ 升降溫速率（回到室溫 25°C）
- 單溫段：升溫 + 停留 + 降溫
- 溫度循環：初始升溫 + (高溫停留 + 降溫至低溫 + 低溫停留 + 升溫至高溫) × 循環數 + 最終降回 25°C
- 濕熱循環（如 Test Db）：每循環 = 升溫時間 + 高溫停留 + 降溫時間 + 低溫停留，總時間 = 單循環時間 × 循環數，不要只算高溫段
- 多項測試：逐項列小計，最後給總計
- 若無升降溫速率資料，只加總停留時間並註明「升降溫時間依設備另計」

回答不要自行加任何免責聲明，UI 會自動附加。

【申請測試標記】
- 回答時絕對不要把 [S:xxx] 標記輸出給使用者，那是系統內部 ID
- 只要回答中列出了具體測試條件，就必須在回答最後一行加上：[APPLY:id1,id2,...]
- id 只能取自本次【參考資料】中 [S:xxx] 的 xxx，逗號分隔，不要加空白，不要自行創造
- APPLY 包含回答中列出的「所有」具體條件 ID
- 只有純定義解釋或完全沒有列出任何具體條件時才不加（例如「什麼是溫箱測試」、「說明 IEC 60068 的目的」）
- 絕對不要在回答中輸出 [已推薦條件ID:xxx] 標記，它是系統內部標記"""

_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]

_FIXTURE_KEYWORDS = ["治具", "庫存", "借出", "逾期", "缺貨", "可借", "缺少"]

_DEVICE_KEYWORDS = [
    "設備",
    "溫箱",
    "CH-",
    "可用",
    "空著",
    "哪台",
    "排程",
    "IDLE",
    "RUNNING",
]

_SCHEDULE_KEYWORDS = ["排程", "進行中", "待確認", "哪個案子", "哪個專案", "測試中"]

_fixture_context_cache: dict = {"data": "", "expires_at": None}
_device_context_cache: dict = {"data": "", "expires_at": None}
_schedule_context_cache: dict = {"data": "", "expires_at": None}


def _query_fixture_context() -> str:
    """查詢治具即時狀態（借出中 + 逾期 + 庫存不足），注入 AI context。結果快取 5 分鐘。"""
    from .models import SessionLocal, Fixture, FixtureLoan

    now = _now_utc()
    if _fixture_context_cache["data"] and _fixture_context_cache["expires_at"] > now:
        return _fixture_context_cache["data"]
    db = SessionLocal()
    try:
        parts = []

        # 借出中（含逾期標記）
        loaned_rows = (
            db.query(FixtureLoan, Fixture)
            .join(Fixture, FixtureLoan.fixture_id == Fixture.id)
            .filter(FixtureLoan.status == "loaned", FixtureLoan.return_date.is_(None))
            .all()
        )
        if loaned_rows:
            # key -> {qty, overdue_qty, earliest_due}
            loaned: dict[str, dict] = {}
            for loan, fix in loaned_rows:
                key = f"{fix.interface_type} {fix.form_factor or ''}".strip()
                if key not in loaned:
                    loaned[key] = {"qty": 0, "overdue": 0, "earliest_due": None}
                loaned[key]["qty"] += loan.quantity
                due = loan.due_date
                if due:
                    if due.tzinfo is None:
                        due = due.replace(tzinfo=datetime.timezone.utc)
                    if due < now:
                        loaned[key]["overdue"] += loan.quantity
                    prev = loaned[key]["earliest_due"]
                    if prev is None or due < prev:
                        loaned[key]["earliest_due"] = due
            lines = ["【治具借出狀態】目前借出中的治具："]
            for desc, info in sorted(loaned.items()):
                due_str = ""
                if info["overdue"]:
                    due_str = f"（⚠️ 逾期 {info['overdue']} 件）"
                elif info["earliest_due"]:
                    due_str = f"（應還日：{info['earliest_due'].strftime('%Y-%m-%d')}）"
                lines.append(f"- {desc}：借出 {info['qty']} 件{due_str}")
            parts.append("\n".join(lines))
        else:
            parts.append("【治具借出狀態】目前無借出中的治具。")

        # 庫存不足
        shortage_items = (
            db.query(Fixture)
            .filter(Fixture.is_active, Fixture.shortage > 0)
            .order_by(Fixture.shortage.desc())
            .all()
        )
        if shortage_items:
            seen: dict[tuple, dict] = {}
            for f in shortage_items:
                key = (f.interface_type, (f.form_factor or "").strip())
                if key not in seen or f.shortage > seen[key]["shortage"]:
                    seen[key] = {
                        "desc": f"{f.interface_type} {f.form_factor or ''}".strip(),
                        "total": f.total_quantity,
                        "shortage": f.shortage,
                        "note": f.note,
                    }
            sorted_items = sorted(
                seen.values(), key=lambda x: x["shortage"], reverse=True
            )
            lines = ["【治具庫存不足】："]
            for item in sorted_items:
                lines.append(
                    f"- {item['desc']}：庫存 {item['total']} 件，缺 {item['shortage']} 件"
                    + (f"（備註：{item['note']}）" if item["note"] else "")
                )
            parts.append("\n".join(lines))

        result = "\n\n".join(parts)
        _fixture_context_cache["data"] = result
        _fixture_context_cache["expires_at"] = now + datetime.timedelta(minutes=5)
        return result
    except Exception:
        return ""
    finally:
        db.close()


def _query_schedule_context() -> str:
    """查詢進行中與已確認排程，注入 AI context。結果快取 2 分鐘。"""
    from .models import SessionLocal, Schedule, ScheduleStatus

    now = _now_utc()
    if _schedule_context_cache["data"] and _schedule_context_cache["expires_at"] > now:
        return _schedule_context_cache["data"]
    db = SessionLocal()
    try:
        schedules = (
            db.query(Schedule)
            .filter(
                Schedule.status.in_([ScheduleStatus.RUNNING, ScheduleStatus.CONFIRMED])
            )
            .order_by(Schedule.start_time)
            .all()
        )
        if not schedules:
            result = "【排程狀態】目前無進行中或已確認的排程。"
            _schedule_context_cache["data"] = result
            _schedule_context_cache["expires_at"] = now + datetime.timedelta(minutes=2)
            return result
        lines = ["【排程狀態】進行中 / 已確認的排程："]
        for s in schedules:
            device = s.device_id or "未分配"
            lines.append(
                f"- [{s.status}] #{s.id} {s.project_number}｜{s.sample_name}"
                f"｜設備：{device}｜標準：{s.standard}"
            )
        result = "\n".join(lines)
        _schedule_context_cache["data"] = result
        _schedule_context_cache["expires_at"] = now + datetime.timedelta(minutes=2)
        return result
    except Exception:
        return ""
    finally:
        db.close()


def _query_device_context() -> str:
    """查詢所有設備即時狀態，注入 AI context。結果快取 1 分鐘。"""
    from .models import SessionLocal, DeviceState

    now = _now_utc()
    if _device_context_cache["data"] and _device_context_cache["expires_at"] > now:
        return _device_context_cache["data"]
    db = SessionLocal()
    try:
        devices = db.query(DeviceState).order_by(DeviceState.device_id).all()
        if not devices:
            return ""
        lines = ["【設備狀態】："]
        for d in devices:
            if d.status == "IDLE":
                lines.append(f"- {d.device_id}：空閒可用（IDLE）")
            elif d.status in ("RUNNING", "PAUSED", "FINISHING"):
                sop = f"，執行中：{d.running_sop_name}" if d.running_sop_name else ""
                lines.append(f"- {d.device_id}：{d.status}{sop}")
            else:
                lines.append(f"- {d.device_id}：{d.status}")
        result = "\n".join(lines)
        _device_context_cache["data"] = result
        _device_context_cache["expires_at"] = now + datetime.timedelta(minutes=1)
        return result
    except Exception:
        return ""
    finally:
        db.close()


_TEST_TYPE_HINTS = {
    "低溫開關機": {"power_on": True, "has_low": True},
    "低溫啟動": {"power_on": True, "has_low": True},
    "低溫工作": {"power_on": True, "has_low": True},
    "低溫儲存": {"power_on": False, "has_low": True},
    "低溫冷測": {"has_low": True},
    "純高溫": {"has_low": False, "has_high": True, "no_humidity": True},
    "乾熱": {"has_low": False, "has_high": True, "no_humidity": True},
    "高溫高濕": {"has_humidity": True},
    "濕熱": {"has_humidity": True},
    "溫度循環": {"has_cycles": True, "has_low": True, "has_high": True},
    "熱衝擊": {"has_cycles": True, "has_low": True, "has_high": True},
}


def _get_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="AI 服務未設定，請聯絡管理員")
    return key


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


def _extract_test_type_hints(msg: str) -> dict:
    merged = {}
    for keyword, hints in _TEST_TYPE_HINTS.items():
        if keyword in msg:
            merged.update(hints)
    return merged


def _extract_std_from_history(history: list) -> list[str]:
    all_text = " ".join(
        m.get("content", "") for m in history if m.get("role") == "user"
    )
    return match_std_keys(all_text)


async def _build_context(msg: str, history: list = None) -> tuple[str, list[str]]:
    if history is None:
        history = []
    matched_stds = match_std_keys(msg)
    if not matched_stds and history:
        matched_stds = _extract_std_from_history(history)

    is_compare = any(k in msg for k in _COMPARE_KEYWORDS) and len(matched_stds) >= 2
    temps = extract_temperatures(msg)
    type_hints = _extract_test_type_hints(msg)

    hits: list[dict] = []
    seen_keys: set = set()

    def _add_hits(new_hits: list[dict]):
        for h in new_hits:
            uid = f"{h['std_key']}_{h['ver_key']}_{h['test_key']}"
            if uid not in seen_keys:
                seen_keys.add(uid)
                hits.append(h)

    if is_compare:
        queries = []
        for std in matched_stds:
            queries.append(f"{std} 高溫測試")
            queries.append(f"{std} 低溫測試")
            queries.append(f"{std} 測試條件")
        _add_hits(await retrieve_multi(queries, top_k_each=5))

    elif matched_stds:
        raw_hits = retrieve_by_std(matched_stds)
        if type_hints:
            filtered = filter_chunks_by_hints(raw_hits, type_hints)
            _add_hits(filtered if len(filtered) >= 2 else raw_hits)
        else:
            _add_hits(raw_hits)

    elif type_hints:
        raw_hits = await retrieve(msg, top_k=30)
        filtered = filter_chunks_by_hints(raw_hits, type_hints)
        _add_hits(filtered if len(filtered) >= 2 else raw_hits[:20])

    elif temps:
        _add_hits(await retrieve(msg, top_k=20))

    else:
        _add_hits(await retrieve(msg, top_k=20))

    parts = []
    if hits:

        def _hit_line(h):
            sid = h.get("raw", {}).get("sop_id", "")
            prefix = f"[S:{sid}] " if sid else ""
            return f"- {prefix}{h['text']}"

        parts.append("\n".join(_hit_line(h) for h in hits))

    if any(kw in msg for kw in _FIXTURE_KEYWORDS):
        fixture_ctx = _query_fixture_context()
        if fixture_ctx:
            parts.append(fixture_ctx)

    if any(kw in msg for kw in _DEVICE_KEYWORDS):
        device_ctx = _query_device_context()
        if device_ctx:
            parts.append(device_ctx)

    if any(kw in msg for kw in _SCHEDULE_KEYWORDS):
        schedule_ctx = _query_schedule_context()
        if schedule_ctx:
            parts.append(schedule_ctx)

    sop_ids = [h["raw"]["sop_id"] for h in hits if h.get("raw", {}).get("sop_id")][:10]
    return "\n\n".join(parts) if parts else "", sop_ids


def _build_gemini_payload(messages: list, system_prompt: str) -> dict:
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    return {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 4096,
        },
    }


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    ref_block, _ = await _build_context(req.message, req.history)
    if ref_block:
        system_content = f"{_SYSTEM_PROMPT}\n\n【參考資料】\n{ref_block}"
    else:
        system_content = (
            _SYSTEM_PROMPT + "\n\n【參考資料】查無相關資料，請直接回覆「查無此資料」。"
        )

    messages = [{"role": m["role"], "content": m["content"]} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    payload = _build_gemini_payload(messages, system_content)
    api_key = _get_api_key()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{GEMINI_URL}:generateContent?key={api_key}",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        reply = data["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.TimeoutException:
        raise HTTPException(status_code=503, detail="AI 服務逾時，請稍後再試")
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=503, detail=f"AI 服務錯誤：{e.response.status_code}"
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 服務不可用：{e}")
    return QueryResponse(reply=reply)


@router.post("/standards-query-stream")
async def standards_query_stream(req: QueryRequest):
    ref_block, sop_ids = await _build_context(req.message, req.history)
    if ref_block:
        system_content = f"{_SYSTEM_PROMPT}\n\n【參考資料】\n{ref_block}"
    else:
        system_content = (
            _SYSTEM_PROMPT + "\n\n【參考資料】查無相關資料，請直接回覆「查無此資料」。"
        )

    messages = [{"role": m["role"], "content": m["content"]} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    payload = _build_gemini_payload(messages, system_content)
    api_key = _get_api_key()

    async def generate():
        collected = []
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=None, write=60.0, pool=10.0)
            ) as client:
                async with client.stream(
                    "POST",
                    f"{GEMINI_URL}:streamGenerateContent?alt=sse&key={api_key}",
                    json=payload,
                ) as resp:
                    if resp.status_code == 429:
                        try:
                            err = await resp.aread()
                            match = re.search(r"retry in ([\d.]+)s", err.decode())
                            wait = (
                                f"{int(float(match.group(1)))} 秒"
                                if match
                                else "一分鐘"
                            )
                        except Exception:
                            wait = "一分鐘"
                        yield f"\n\n[AI 服務繁忙，請稍候 {wait} 再試]"
                        return
                    elif resp.status_code != 200:
                        yield f"\n\n[AI 服務錯誤：{resp.status_code}]"
                        return
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            raw = line[6:].strip()
                            if raw == "[DONE]":
                                break
                            try:
                                data = json.loads(raw)
                                token = (
                                    data.get("candidates", [{}])[0]
                                    .get("content", {})
                                    .get("parts", [{}])[0]
                                    .get("text", "")
                                )
                                if token:
                                    collected.append(token)
                                    yield token
                            except Exception:
                                pass
        except httpx.TimeoutException:
            yield "\n\n[AI 服務逾時，請稍後再試]"
            return
        except Exception as e:
            yield f"\n\n[AI 服務不可用：{e}]"
            return
        # AI 從 [S:xxx] 清單選 ID 輸出 [APPLY:id1,id2]，後端白名單驗證防幻覺
        # Fallback：AI 未輸出或驗證全失敗時，取 RAG 命中的前 5 個
        full_text = "".join(collected)
        apply_match = re.search(r"\[APPLY:([^\]]+)\]", full_text)
        valid_ids = []
        if apply_match:
            all_ids = get_all_sop_ids()
            valid_ids = [
                i.strip()
                for i in apply_match.group(1).split(",")
                if i.strip() in all_ids
            ]
        if valid_ids:
            yield f"{META_PREFIX}{json.dumps({'sop_ids': valid_ids})}{META_SUFFIX}"
        elif sop_ids:
            yield f"{META_PREFIX}{json.dumps({'sop_ids': sop_ids[:5]})}{META_SUFFIX}"

    return StreamingResponse(generate(), media_type="text/plain")
