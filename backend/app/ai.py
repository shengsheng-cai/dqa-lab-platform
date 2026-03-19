import httpx
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from .rag import (
    retrieve,
    retrieve_by_std,
    retrieve_multi,
    match_std_keys,
    extract_temperatures,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen2.5:7b"

# 免責聲明由前端固定顯示，system prompt 不再重複
_SYSTEM_PROMPT = """你是工業環境測試法規顧問，專注於溫箱測試。
只能用繁體中文回答，禁止簡體中文。
回答簡潔，推薦時標注法規正式版本號（例如 IEC 60068-2-1:2007）。
你只能根據【參考資料】區塊的內容回答。
若參考資料中找不到相關條目，請說「查無此資料」。
禁止引用參考資料以外的任何標準版本號、測試名稱或數值參數。"""

_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]


async def _warmup_ollama():
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            await client.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": False,
                },
            )
        print(f"✅ Ollama warm-up 完成（{OLLAMA_MODEL}）")
    except Exception as e:
        print(f"⚠️  Ollama warm-up 失敗：{e}")


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


async def _build_messages(req: QueryRequest) -> list:
    """
    查詢路由策略：
    1. 比對到標準名稱（含簡寫）且有比較關鍵字 → retrieve_multi 跨標準搜尋
    2. 比對到單一標準名稱（含簡寫）→ retrieve_by_std 撈該標準全部條目
    3. 含明確溫度數字（如 -40°C）→ 向量搜尋 + 溫度直接過濾補強
    4. 其他 → 一般向量搜尋 top_k=5
    """
    msg = req.message

    # fix: 使用 match_std_keys 支援簡寫比對（如 '50155'、'60068'）
    matched_stds = match_std_keys(msg)
    is_compare = any(k in msg for k in _COMPARE_KEYWORDS) and len(matched_stds) >= 2
    temps = extract_temperatures(msg)

    hits: list[dict] = []
    seen_keys: set = set()

    def _add_hits(new_hits: list[dict]):
        for h in new_hits:
            uid = f"{h['std_key']}_{h['ver_key']}_{h['test_key']}"
            if uid not in seen_keys:
                seen_keys.add(uid)
                hits.append(h)

    if is_compare:
        # 跨標準比較：對每個標準分別搜尋高溫/低溫/通用
        queries = []
        for std in matched_stds:
            queries.append(f"{std} 高溫測試")
            queries.append(f"{std} 低溫測試")
            queries.append(f"{std} 測試條件")
        _add_hits(await retrieve_multi(queries, top_k_each=3))

    elif len(matched_stds) == 1:
        # 點名單一標準：直接撈該標準全部條目
        _add_hits(retrieve_by_std(matched_stds))

    elif temps:
        # 含明確溫度：向量搜尋 + 溫度直接過濾雙保險
        _add_hits(await retrieve(msg, top_k=8))
        for chunk in _get_chunks_by_temp(temps):
            _add_hits([chunk])

    else:
        # 一般查詢
        _add_hits(await retrieve(msg, top_k=5))

    if hits:
        ref_block = "\n".join(f"- {h['text']}" for h in hits)
        system_content = f"{_SYSTEM_PROMPT}\n\n【參考資料】\n{ref_block}"
    else:
        system_content = (
            _SYSTEM_PROMPT + "\n\n【參考資料】查無相關資料，請直接回覆「查無此資料」。"
        )

    messages = [{"role": "system", "content": system_content}]
    for h in req.history:
        messages.append(h)
    messages.append({"role": "user", "content": msg})
    return messages


def _get_chunks_by_temp(temps: list[float]) -> list[dict]:
    """從 _CHUNKS 直接過濾含有指定溫度的條目，補強向量搜尋在溫度數字上的不足。"""
    from .rag import _CHUNKS

    results = []
    for chunk in _CHUNKS:
        raw = chunk.get("raw", {})
        chunk_temps = set()
        for key in ("target_temperature", "high_temperature", "low_temperature"):
            v = raw.get(key)
            if v is not None:
                chunk_temps.add(float(v))
        if any(abs(t - ct) < 0.5 for t in temps for ct in chunk_temps):
            results.append(chunk)
    return results


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    messages = await _build_messages(req)

    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"num_ctx": 4096, "temperature": 0.1, "top_p": 0.4},
            },
        )
        response.raise_for_status()
        data = response.json()

    return QueryResponse(reply=data["message"]["content"])


@router.post("/standards-query-stream")
async def standards_query_stream(req: QueryRequest):
    messages = await _build_messages(req)

    async def generate():
        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream(
                "POST",
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {"num_ctx": 4096, "temperature": 0.1, "top_p": 0.4},
                },
            ) as response:
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            token = data.get("message", {}).get("content", "")
                            if token:
                                yield token
                        except Exception:
                            pass

    return StreamingResponse(generate(), media_type="text/plain")
