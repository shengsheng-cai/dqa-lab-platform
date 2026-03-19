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

GEMINI_MODEL = GEMINI_MODEL = "gemini-2.5-flash-lite"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}"

_SYSTEM_PROMPT = """你是工業環境測試法規顧問，專注於溫箱測試。
只能用繁體中文回答，禁止簡體中文。
回答簡潔，推薦時標注法規正式版本號（例如 IEC 60068-2-1:2007）。
你只能根據【參考資料】區塊的內容回答。
若參考資料中找不到相關條目，請說「查無此資料」。
禁止引用參考資料以外的任何標準版本號、測試名稱或數值參數。"""

_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]


def _get_api_key() -> str:
    return os.environ["GEMINI_API_KEY"]


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


async def _build_context(msg: str) -> str:
    """RAG 檢索，top_k=20 確保跨法規問題都能撈到。"""
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
        queries = []
        for std in matched_stds:
            queries.append(f"{std} 高溫測試")
            queries.append(f"{std} 低溫測試")
            queries.append(f"{std} 測試條件")
        _add_hits(await retrieve_multi(queries, top_k_each=5))

    elif len(matched_stds) == 1:
        _add_hits(retrieve_by_std(matched_stds))

    elif temps:
        _add_hits(await retrieve(msg, top_k=20))
        for chunk in _get_chunks_by_temp(temps):
            _add_hits([chunk])

    else:
        # 一般查詢：top_k=20，確保跨法規都能撈到
        _add_hits(await retrieve(msg, top_k=20))

    if hits:
        return "\n".join(f"- {h['text']}" for h in hits)
    return ""


def _get_chunks_by_temp(temps: list[float]) -> list[dict]:
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


def _build_gemini_payload(messages: list, system_prompt: str) -> dict:
    """將 OpenAI 格式的 messages 轉換成 Gemini API 格式。"""
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    return {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1000,
        },
    }


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    ref_block = await _build_context(req.message)
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
    ref_block = await _build_context(req.message)
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
