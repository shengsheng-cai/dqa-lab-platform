import os
import json
import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from .rag import (
    retrieve,
    match_std_keys,
    extract_temperatures,
    retrieve_multi,
    retrieve_by_std,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])

GEMINI_MODEL = "gemini-2.5-flash-lite"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}"

_SYSTEM_PROMPT = """你是工業環境測試顧問，幫助實驗室人員快速找到適合的溫箱測試條件。只能用繁體中文回答，禁止簡體中文。

【你的角色】
你不只是查資料庫，你是在幫使用者做決策。回答時要：
1. 先說你的判斷（為什麼推薦這個條件）
2. 再列出具體參數
3. 如果有多個選項，說明差異讓使用者選擇

【資料使用規則】
- 只根據【參考資料】回答，禁止引用資料以外的版本號、數值或測試名稱
- 找不到相關資料直接說「查無此資料」，不要追問

【標準選擇原則】
- 未指定標準時，只推 IEC 60068，絕對不要主動提 EN 50155、DNV、IEC 60945、IEC 61850-3
- 只有使用者明確說「鐵道」才推 EN 50155
- 只有使用者明確說「船舶」或「海事」才推 DNV 或 IEC 60945
- 只有使用者明確說「變電站」才推 IEC 61850-3
- 已指定標準時，只看該標準，不要混入其他標準的條目

【回答原則】
- 不要把所有符合條件的條目全部列出，選 1~2 個最具代表性的推薦，說明為什麼
- 「低溫開關機」→ 只找通電低溫條目，說明「這是模擬設備在低溫下開機的情境」
- 「純高溫」→ 只找無低溫無濕度的高溫條目
- 「高溫高濕」→ 只找有濕度設定的條目
- 「溫度循環」→ 只找有高低溫循環的條目

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

回答結尾固定加：⚠️ 本建議僅供初步評估參考，實際條件請以原始法規文件為準。"""

_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]

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
    return os.environ["GEMINI_API_KEY"]


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


def _filter_chunks_by_hints(chunks: list[dict], hints: dict) -> list[dict]:
    results = []
    for c in chunks:
        raw = c.get("raw", {})
        if hints.get("power_on") is not None:
            if raw.get("power_on") != hints["power_on"]:
                continue
        if hints.get("has_low") and raw.get("low_temperature") is None:
            continue
        if (
            hints.get("has_high")
            and raw.get("high_temperature") is None
            and raw.get("target_temperature") is None
        ):
            continue
        if hints.get("no_humidity") and raw.get("humidity_rh_percent") is not None:
            continue
        if hints.get("has_humidity") and raw.get("humidity_rh_percent") is None:
            continue
        if hints.get("has_cycles") and (
            raw.get("cycles") is None or raw.get("cycles", 1) <= 1
        ):
            continue
        results.append(c)
    return results


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


async def _build_context(msg: str, history: list = []) -> str:
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
            filtered = _filter_chunks_by_hints(raw_hits, type_hints)
            _add_hits(filtered if len(filtered) >= 2 else raw_hits)
        else:
            _add_hits(raw_hits)

    elif type_hints:
        raw_hits = await retrieve(msg, top_k=30)
        filtered = _filter_chunks_by_hints(raw_hits, type_hints)
        _add_hits(filtered if len(filtered) >= 2 else raw_hits[:20])

    elif temps:
        _add_hits(await retrieve(msg, top_k=20))

    else:
        _add_hits(await retrieve(msg, top_k=20))

    if hits:
        return "\n".join(f"- {h['text']}" for h in hits)
    return ""


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
            "maxOutputTokens": 1500,
        },
    }


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    ref_block = await _build_context(req.message, req.history)
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

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{GEMINI_URL}:generateContent?key={api_key}",
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    reply = data["candidates"][0]["content"]["parts"][0]["text"]
    return QueryResponse(reply=reply)


@router.post("/standards-query-stream")
async def standards_query_stream(req: QueryRequest):
    ref_block = await _build_context(req.message, req.history)
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
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{GEMINI_URL}:streamGenerateContent?alt=sse&key={api_key}",
                json=payload,
            ) as resp:
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
                                yield token
                        except Exception:
                            pass

    return StreamingResponse(generate(), media_type="text/plain")
