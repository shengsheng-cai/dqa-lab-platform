"""
RAG 模組 — 從 STANDARD_TREE 自動產生知識庫，使用 Ollama nomic-embed-text 向量化，
numpy 餘弦相似度搜尋，零額外套件依賴（除 numpy）。
"""

import re
import httpx
import numpy as np
from typing import Optional
from .standards import get_standard_tree

OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
OLLAMA_EMBED_MODEL = "nomic-embed-text"

# In-memory 知識庫
_CHUNKS: list[dict] = []
_EMBEDDINGS: Optional[np.ndarray] = None  # shape: (N, dim)

# 使用者可能的簡寫 → 對應到 STANDARD_TREE 的完整 std_key
# 涵蓋各種不完整、省略、口語化寫法
_STD_ALIAS_MAP: dict[str, str] = {
    # IEC 60068
    "IEC 60068": "IEC 60068",
    "60068": "IEC 60068",
    "iec60068": "IEC 60068",
    # EN 50155
    "EN 50155": "EN 50155",
    "50155": "EN 50155",
    "en50155": "EN 50155",
    # IEC 61850-3
    "IEC 61850-3": "IEC 61850-3",
    "IEC 61850": "IEC 61850-3",
    "61850": "IEC 61850-3",
    "iec61850": "IEC 61850-3",
    # IEC 60945
    "IEC 60945": "IEC 60945",
    "60945": "IEC 60945",
    "iec60945": "IEC 60945",
    # DNV
    "DNV": "DNV",
    "dnv": "DNV",
}

# 比較關鍵字
_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]


def _build_chunks() -> list[dict]:
    """將 STANDARD_TREE 展開成 chunk，每個包含完整參數與說明。"""
    tree = get_standard_tree()
    chunks = []

    for std_key, std_data in tree.items():
        std_name = std_data.get("name", std_key)
        for ver_key, ver_data in std_data["versions"].items():
            for test_key, test in ver_data["tests"].items():
                parts = [
                    f"標準：{std_name}（{std_key}）",
                    f"版本：{ver_key}",
                    f"測試條件：{test.get('name', test_key)}",
                    f"說明：{test.get('description', '')}",
                ]
                if test.get("target_temperature") is not None:
                    parts.append(f"目標溫度：{test['target_temperature']}°C")
                if test.get("high_temperature") is not None:
                    parts.append(f"高溫：{test['high_temperature']}°C")
                if test.get("low_temperature") is not None:
                    parts.append(f"低溫：{test['low_temperature']}°C")
                if test.get("humidity_rh_percent") is not None:
                    parts.append(f"濕度：{test['humidity_rh_percent']}% RH")
                if test.get("dwell_time_hours") is not None:
                    parts.append(f"停留時間：{test['dwell_time_hours']} 小時")
                if test.get("ramp_rate") is not None:
                    parts.append(f"升降溫速率：{test['ramp_rate']}°C/min")
                if test.get("cycles") is not None:
                    parts.append(f"循環次數：{test['cycles']} 次")
                if test.get("power_on") is not None:
                    parts.append(
                        f"通電狀態：{'通電' if test['power_on'] else '非通電'}"
                    )

                chunks.append(
                    {
                        "std_key": std_key,
                        "ver_key": ver_key,
                        "test_key": test_key,
                        "text": "，".join(parts),
                        "raw": test,
                    }
                )

    return chunks


async def _embed(texts: list[str]) -> np.ndarray:
    """呼叫 Ollama nomic-embed-text，回傳 numpy array。"""
    vectors = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for text in texts:
            resp = await client.post(
                OLLAMA_EMBED_URL,
                json={"model": OLLAMA_EMBED_MODEL, "prompt": text},
            )
            resp.raise_for_status()
            vectors.append(resp.json()["embedding"])
    return np.array(vectors, dtype=np.float32)


async def warmup_rag():
    """啟動時呼叫：建立 chunks + 向量化，存入 in-memory。"""
    global _CHUNKS, _EMBEDDINGS
    print("⏳ RAG 知識庫建立中...")

    try:
        _CHUNKS = _build_chunks()
        texts = [c["text"] for c in _CHUNKS]
        _EMBEDDINGS = await _embed(texts)
        norms = np.linalg.norm(_EMBEDDINGS, axis=1, keepdims=True)
        _EMBEDDINGS = _EMBEDDINGS / np.clip(norms, 1e-9, None)
        print(f"✅ RAG 完成：{len(_CHUNKS)} 個測試條件已向量化")
    except Exception as e:
        print(f"⚠️  RAG 向量化失敗（nomic-embed-text 是否已安裝？）：{e}")
        print("   執行：ollama pull nomic-embed-text")
        _CHUNKS = []
        _EMBEDDINGS = None


async def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """查詢最相關的 top_k 個測試條件。"""
    if _EMBEDDINGS is None or len(_CHUNKS) == 0:
        return []

    q_vec = await _embed([query])
    q_norm = q_vec / np.clip(np.linalg.norm(q_vec), 1e-9, None)
    scores = (_EMBEDDINGS @ q_norm.T).flatten()
    top_indices = np.argsort(scores)[::-1][:top_k]

    return [{**_CHUNKS[i], "score": float(scores[i])} for i in top_indices]


def match_std_keys(msg: str) -> list[str]:
    """
    從使用者訊息中比對出對應的 STANDARD_TREE std_key。
    支援簡寫、省略、口語化（如 '50155'、'60068'、'IEC 61850'）。
    回傳去重後的 std_key 清單（使用 STANDARD_TREE 的完整 key）。
    """
    found = set()
    msg_lower = msg.lower().replace("-", "").replace(" ", "")

    for alias, std_key in _STD_ALIAS_MAP.items():
        alias_norm = alias.lower().replace("-", "").replace(" ", "")
        if alias_norm in msg_lower:
            found.add(std_key)

    return list(found)


def retrieve_by_std(std_keys: list[str]) -> list[dict]:
    """
    直接用 STANDARD_TREE std_key 精確比對，不經過向量搜尋。
    確保點名標準時撈到該標準所有條目。
    """
    if not _CHUNKS:
        return []

    results = []
    for chunk in _CHUNKS:
        if chunk["std_key"] in std_keys:
            results.append(chunk)
    return results


def extract_temperatures(text: str) -> list[float]:
    """從 query 文字抽取溫度數字，例如 '-40°C' → [-40.0]。"""
    matches = re.findall(r"[-+]?\d+(?:\.\d+)?(?=\s*°[Cc]|度)", text)
    return [float(m) for m in matches]


async def retrieve_multi(queries: list[str], top_k_each: int = 3) -> list[dict]:
    """
    多個 query 分別搜尋，結果合併去重。
    適用於跨標準比較問題。
    """
    seen_keys = set()
    results = []
    for q in queries:
        hits = await retrieve(q, top_k=top_k_each)
        for h in hits:
            uid = f"{h['std_key']}_{h['ver_key']}_{h['test_key']}"
            if uid not in seen_keys:
                seen_keys.add(uid)
                results.append(h)
    return results
