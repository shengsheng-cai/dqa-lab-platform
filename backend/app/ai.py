import httpx
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from .standards import get_standard_tree

router = APIRouter(prefix="/api/ai", tags=["ai"])

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "gemma3:4b"

_SYSTEM_PROMPT_CACHE: Optional[str] = None


def _build_system_prompt() -> str:
    global _SYSTEM_PROMPT_CACHE
    if _SYSTEM_PROMPT_CACHE is not None:
        return _SYSTEM_PROMPT_CACHE

    tree = get_standard_tree()
    lines = [
        "You are a professional industrial environmental testing standards consultant.",
        "CRITICAL LANGUAGE RULE: You MUST respond in Traditional Chinese (zh-TW) ONLY.",
        "CRITICAL LANGUAGE RULE: Simplified Chinese is STRICTLY FORBIDDEN.",
        "Traditional Chinese examples: 台灣、設備、標準、測試、循環、資訊、評估、導航、娛樂、通過、進行、穩態",
        "Simplified Chinese examples (DO NOT USE): 设备、标准、测试、循环、信息、评估、导航、娱乐、通过、进行、稳态",
        "FORMAT RULE: Do NOT use markdown code blocks (```). Use - or numbers for lists directly.",
        "CONTENT RULE: Only recommend test standards from the list below. Do not recommend standards outside this list.",
        "DISCLAIMER RULE: At the end of every reply, add a blank line then this exact disclaimer:",
        "「⚠️ 本建議僅供初步評估參考，實際測試條件與判定標準請以原始法規文件為準，並由授權工程師確認。」",
        "DISCLAIMER RULE: When recommending a specific standard, include its official version number (e.g. IEC 60068-2-1:2007).",
        "BREVITY RULE: Keep replies concise. Maximum 400 Chinese characters for simple questions, 600 for complex ones. Do not repeat information.",
        "Based on the user's product description and requirements, recommend the most suitable standards, versions and test conditions, and explain your reasoning.",
        "",
        "=== 支援的環境測試標準 ===",
    ]

    for std_key, std_data in tree.items():
        lines.append(f"\n【{std_data['label']}】{std_data.get('description', '')}")
        for ver_key, ver_data in std_data["versions"].items():
            lines.append(
                f"  版本：{ver_data['label']} — {ver_data.get('description', '')}"
            )
            for test_key, test_data in ver_data["tests"].items():
                lines.append(f"    - {test_data['name']}")

    _SYSTEM_PROMPT_CACHE = "\n".join(lines)
    return _SYSTEM_PROMPT_CACHE


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
        print(f"⚠️  Ollama warm-up 失敗（服務可能尚未啟動）：{e}")


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


def _build_messages(req: QueryRequest) -> list:
    """
    組裝送給 Ollama 的 messages。
    fix: 前端已在 message 加入 TC_PREFIX，後端不再重複加前綴，避免雙重前綴。
    history 內容也是前端傳入的乾淨字串，直接使用。
    """
    messages = [{"role": "system", "content": _build_system_prompt()}]
    for h in req.history:
        messages.append(h)
    messages.append({"role": "user", "content": req.message})
    return messages


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    messages = _build_messages(req)
    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"num_ctx": 2048, "temperature": 0.3, "num_predict": 512},
            },
        )
        response.raise_for_status()
        data = response.json()
    reply = data["message"]["content"]
    return QueryResponse(reply=reply)


@router.post("/standards-query-stream")
async def standards_query_stream(req: QueryRequest):
    messages = _build_messages(req)

    async def generate():
        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream(
                "POST",
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "num_ctx": 2048,
                        "temperature": 0.3,
                        "num_predict": 512,
                    },
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
