import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from .standards import get_standard_tree

router = APIRouter(prefix="/api/ai", tags=["ai"])

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen2.5:7b"


def _build_system_prompt() -> str:
    """
    將 STANDARD_TREE 摘要成文字，嵌入 system prompt。
    只列出法規、版本、測試條件名稱與關鍵參數，不列完整步驟。
    """
    tree = get_standard_tree()
    lines = [
        "你是一位專業的工業環境測試法規顧問。",
        "以下是本系統支援的所有環境測試標準，請根據使用者描述的產品與需求，推薦最適合的法規、版本與測試條件。",
        "無論使用者用什麼語言提問，請一律使用繁體中文回覆，不可使用簡體中文。",
        "只能從以下清單中推薦，不可推薦清單以外的標準。",
    ]

    for std_key, std_data in tree.items():
        lines.append(f"\n【{std_data['label']}】{std_data.get('description', '')}")
        for ver_key, ver_data in std_data["versions"].items():
            lines.append(
                f"  版本：{ver_data['label']} — {ver_data.get('description', '')}"
            )
            for test_key, test_data in ver_data["tests"].items():
                params = []
                if test_data.get("high_temperature"):
                    params.append(f"高溫 {test_data['high_temperature']}°C")
                if test_data.get("low_temperature"):
                    params.append(f"低溫 {test_data['low_temperature']}°C")
                if test_data.get("target_temperature"):
                    params.append(f"目標溫度 {test_data['target_temperature']}°C")
                if test_data.get("dwell_time_hours"):
                    params.append(f"停留 {test_data['dwell_time_hours']}h")
                if test_data.get("cycles"):
                    params.append(f"{test_data['cycles']} 循環")
                if test_data.get("humidity_rh_percent"):
                    params.append(f"濕度 {test_data['humidity_rh_percent']}%RH")
                param_str = "、".join(params) if params else ""
                lines.append(f"    - {test_data['name']}（{param_str}）")

    return "\n".join(lines)


class QueryRequest(BaseModel):
    message: str
    history: Optional[list] = []


class QueryResponse(BaseModel):
    reply: str


@router.post("/standards-query", response_model=QueryResponse)
async def standards_query(req: QueryRequest):
    """
    法規諮詢助手：使用者描述產品與需求，LLM 推薦適合的法規與測試條件。
    """
    system_prompt = _build_system_prompt()

    messages = [{"role": "system", "content": system_prompt}]

    # 帶入歷史對話（多輪支援）
    for h in req.history:
        messages.append(h)

    messages.append({"role": "user", "content": req.message})

    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
            },
        )
        response.raise_for_status()
        data = response.json()

    reply = data["message"]["content"]
    return QueryResponse(reply=reply)
