import httpx  # <--- imported for OLLAMA_URL request
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from .standards import get_standard_tree

# 定義 AI 模組的路由器
router = APIRouter(prefix="/api/ai", tags=["ai"])

# OLLAMA_URL 是 Ollama 服務的 URL
OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.1:8b"

# 重啟後自動重建
_SYSTEM_PROMPT_CACHE: Optional[str] = None


def _build_system_prompt() -> str:
    global _SYSTEM_PROMPT_CACHE
    if _SYSTEM_PROMPT_CACHE is not None:
        return _SYSTEM_PROMPT_CACHE

    # 取得標準樹的資料
    tree = get_standard_tree()

    # 建立系統提示的內容
    lines = [
        "你是工業環境測試法規顧問，專注於溫箱測試。",
        "只能用繁體中文回答，禁止簡體中文。繁體範例：設備、測試、標準、循環、穩態。",
        "回答簡潔不重複，推薦時標注法規正式版本號（例如 IEC 60068-2-1:2007）。",
        "",
        "本系統支援的測試條件：",
    ]

    # 取得各個標準的測試名稱
    for std_key, std_data in tree.items():
        test_names = []
        for ver_data in std_data["versions"].values():
            for test_data in ver_data["tests"].values():
                test_names.append(test_data["name"])
        lines.append(f"{std_key}：{'、'.join(test_names)}")

    # 將內容組合成系統提示
    _SYSTEM_PROMPT_CACHE = "\n".join(lines)
    return _SYSTEM_PROMPT_CACHE


# 套用 Ollama 服務的暖機功能
async def _warmup_ollama():
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            # 發送訊息給 Ollama 服務，檢查是否有回應
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
        # 如果有錯誤，就打印出錯誤訊息
        print(f"⚠️  Ollama warm-up 失敗（服務可能尚未啟動）：{e}")


# 定義查詢模型的請求類別
class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


# 定義查詢模型的回應類別
class QueryResponse(BaseModel):
    reply: str


def _build_messages(req: QueryRequest) -> list:
    """組裝送給 Ollama 的 messages，history 為前端傳入的乾淨字串。"""
    # 取得系統提示內容
    messages = [{"role": "system", "content": _build_system_prompt()}]

    # 將 history 陣列加入訊息列表中
    for h in req.history:
        messages.append(h)

    # 將使用者輸入的訊息加到最後面
    messages.append({"role": "user", "content": req.message})

    return messages


# 定義查詢模型的路由器
@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    # 取得訊息列表
    messages = _build_messages(req)

    # 發送訊息給 Ollama 服務，檢查是否有回應
    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"num_ctx": 2048, "temperature": 0.0, "top_p": 0.9},
            },
        )

        # 如果有錯誤，就丟掉錯誤
        response.raise_for_status()

        # 取得回應的 JSON 資料
        data = response.json()

    # 取得 Ollama 的回覆
    reply = data["message"]["content"]

    # 回傳查詢模型的回應
    return QueryResponse(reply=reply)


# 定義查詢模型的流式資料路由器
@router.post("/standards-query-stream")
async def standards_query_stream(req: QueryRequest):
    # 取得訊息列表
    messages = _build_messages(req)

    # 建立一個產生器，供 Ollama 服務回應的資料
    async def generate():
        async with httpx.AsyncClient(timeout=180.0) as client:
            # 發送訊息給 Ollama 服務，檢查是否有回應
            async with client.stream(
                "POST",
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "num_ctx": 2048,
                        "temperature": 0.0,
                        "top_p": 0.9,
                    },
                },
            ) as response:
                # 取得 Ollama 的回應
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            token = data.get("message", {}).get("content", "")
                            if token:
                                yield token
                        except Exception:
                            pass

    # 回傳查詢模型的流式資料
    return StreamingResponse(generate(), media_type="text/plain")
