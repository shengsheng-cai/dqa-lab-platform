"""
RAG 模組 — 從 STANDARD_TREE 自動產生知識庫，使用 Gemini embedding API 向量化，
numpy 餘弦相似度搜尋，零額外套件依賴（除 numpy、google-genai）。
"""

import os
import re
import asyncio
import pickle
from pathlib import Path
from functools import lru_cache
import numpy as np
from typing import Optional
from google import genai
from google.genai import types as genai_types
from .standards import get_standard_tree

GEMINI_EMBED_MODEL = "gemini-embedding-001"
RAG_CACHE_PATH = Path(__file__).parent.parent / "rag_cache.pkl"

_CHUNKS: list[dict] = []
_EMBEDDINGS: Optional[np.ndarray] = None

_STD_ALIAS_MAP: dict[str, str] = {
    "IEC 60068": "IEC 60068",
    "60068": "IEC 60068",
    "iec60068": "IEC 60068",
    "EN 50155": "EN 50155",
    "50155": "EN 50155",
    "en50155": "EN 50155",
    "IEC 61850-3": "IEC 61850-3",
    "IEC 61850": "IEC 61850-3",
    "61850": "IEC 61850-3",
    "iec61850": "IEC 61850-3",
    "IEC 60945": "IEC 60945",
    "60945": "IEC 60945",
    "iec60945": "IEC 60945",
    "DNV": "DNV",
    "dnv": "DNV",
}

_COMPARE_KEYWORDS = ["和", "與", "vs", "比較", "差異", "不同"]

# query embedding LRU cache（最多快取 64 筆，節省 Gemini Embedding 配額）
_query_embed_cache: dict[str, np.ndarray] = {}
_QUERY_CACHE_MAX = 64


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "")
    return genai.Client(api_key=api_key)


def _build_chunks() -> list[dict]:
    """將 STANDARD_TREE 展開成 chunk，包含完整參數、說明與語義標籤。"""
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

                # 語義標籤：幫助口語查詢命中
                semantic_tags = []
                has_low = test.get("low_temperature") is not None
                has_high = (
                    test.get("high_temperature") is not None
                    or test.get("target_temperature") is not None
                )
                has_humidity = test.get("humidity_rh_percent") is not None
                has_cycles = (test.get("cycles") or 1) > 1
                is_powered = test.get("power_on", False)

                if is_powered and has_low:
                    semantic_tags.append("低溫開關機 低溫工作 通電低溫")
                elif has_low and not is_powered:
                    semantic_tags.append("低溫儲存 低溫測試 非通電低溫")
                if has_high and not has_low and not has_humidity:
                    semantic_tags.append("純高溫 乾熱 高溫測試")
                if has_humidity:
                    semantic_tags.append("高溫高濕 濕熱 濕度測試")
                if has_cycles and has_low and has_high:
                    semantic_tags.append("溫度循環 熱衝擊 循環測試")

                if semantic_tags:
                    parts.append(f"語義標籤：{'、'.join(semantic_tags)}")

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


async def _embed(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> np.ndarray:
    """呼叫 Gemini embedding API，批次處理避免 rate limit。"""
    client = _get_client()
    BATCH_SIZE = 20
    all_vectors = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        result = client.models.embed_content(
            model=GEMINI_EMBED_MODEL,
            contents=batch,
            config=genai_types.EmbedContentConfig(task_type=task_type),
        )
        all_vectors.extend([e.values for e in result.embeddings])
        if i + BATCH_SIZE < len(texts):
            await asyncio.sleep(5)

    return np.array(all_vectors, dtype=np.float32)


async def warmup_rag():
    """啟動時呼叫：優先讀取本地快取，避免重複消耗 Gemini API 配額。"""
    global _CHUNKS, _EMBEDDINGS

    if RAG_CACHE_PATH.exists():
        try:
            with open(RAG_CACHE_PATH, "rb") as f:
                cached = pickle.load(f)
            _CHUNKS = cached["chunks"]
            _EMBEDDINGS = cached["embeddings"]
            print(f"✅ RAG 從快取載入：{len(_CHUNKS)} 個測試條件")
            return
        except Exception as e:
            print(f"⚠️  RAG 快取讀取失敗，重新向量化：{e}")

    print("⏳ RAG 知識庫建立中（分批向量化，約需 20 秒）...")
    try:
        _CHUNKS = _build_chunks()
        texts = [c["text"] for c in _CHUNKS]
        _EMBEDDINGS = await _embed(texts, task_type="RETRIEVAL_DOCUMENT")
        norms = np.linalg.norm(_EMBEDDINGS, axis=1, keepdims=True)
        _EMBEDDINGS = _EMBEDDINGS / np.clip(norms, 1e-9, None)
        print(f"✅ RAG 完成：{len(_CHUNKS)} 個測試條件已向量化")
        with open(RAG_CACHE_PATH, "wb") as f:
            pickle.dump({"chunks": _CHUNKS, "embeddings": _EMBEDDINGS}, f)
        print(f"✅ RAG 快取已儲存：{RAG_CACHE_PATH}")
    except Exception as e:
        print(f"⚠️  RAG 向量化失敗：{e}")
        _CHUNKS = []
        _EMBEDDINGS = None


async def _embed_query_cached(query: str) -> np.ndarray:
    """帶 LRU cache 的 query embedding，避免同對話重複打 API。"""
    if query in _query_embed_cache:
        return _query_embed_cache[query]

    q_vec = await _embed([query], task_type="RETRIEVAL_QUERY")
    q_norm = q_vec / np.clip(np.linalg.norm(q_vec), 1e-9, None)

    # 超過上限時清掉最舊的一筆
    if len(_query_embed_cache) >= _QUERY_CACHE_MAX:
        oldest_key = next(iter(_query_embed_cache))
        del _query_embed_cache[oldest_key]

    _query_embed_cache[query] = q_norm
    return q_norm


async def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """查詢最相關的 top_k 個測試條件。"""
    if _EMBEDDINGS is None or len(_CHUNKS) == 0:
        return []

    q_norm = await _embed_query_cached(query)
    scores = (_EMBEDDINGS @ q_norm.T).flatten()
    top_indices = np.argsort(scores)[::-1][:top_k]

    return [{**_CHUNKS[i], "score": float(scores[i])} for i in top_indices]


def match_std_keys(msg: str) -> list[str]:
    """從使用者訊息中比對出對應的 std_key。"""
    found = set()
    msg_lower = msg.lower().replace("-", "").replace(" ", "")

    for alias, std_key in _STD_ALIAS_MAP.items():
        alias_norm = alias.lower().replace("-", "").replace(" ", "")
        if alias_norm in msg_lower:
            found.add(std_key)

    return list(found)


def retrieve_by_std(std_keys: list[str]) -> list[dict]:
    """直接用 std_key 精確比對，不經過向量搜尋。"""
    if not _CHUNKS:
        return []
    return [c for c in _CHUNKS if c["std_key"] in std_keys]


def extract_temperatures(text: str) -> list[float]:
    """從 query 文字抽取溫度數字。"""
    matches = re.findall(r"[-+]?\d+(?:\.\d+)?(?=\s*°[Cc]|度)", text)
    return [float(m) for m in matches]


async def retrieve_multi(queries: list[str], top_k_each: int = 3) -> list[dict]:
    """多個 query 分別搜尋，結果合併去重。"""
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
