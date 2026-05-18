"""
T-16: RAG 快取驗證測試
- chunk 數量相同但內容變更時，必須重新向量化
"""
import asyncio

import numpy as np

import app.rag as rag_module


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_warmup_rag_rebuilds_cache_when_chunk_content_changes(tmp_path, monkeypatch):
    cache_path = tmp_path / "rag_cache.pkl"
    monkeypatch.setattr(rag_module, "RAG_CACHE_PATH", cache_path)

    chunks_v1 = [
        {
            "std_key": "IEC 60068",
            "ver_key": "2-1",
            "test_key": "A",
            "text": "條件 A",
            "raw": {"sop_id": "SOP-A"},
        },
        {
            "std_key": "IEC 60068",
            "ver_key": "2-2",
            "test_key": "B",
            "text": "條件 B",
            "raw": {"sop_id": "SOP-B"},
        },
    ]
    chunks_v2 = [
        {
            "std_key": "IEC 60068",
            "ver_key": "2-1",
            "test_key": "A",
            "text": "條件 A（已更新）",
            "raw": {"sop_id": "SOP-A"},
        },
        {
            "std_key": "IEC 60068",
            "ver_key": "2-2",
            "test_key": "B",
            "text": "條件 B",
            "raw": {"sop_id": "SOP-B"},
        },
    ]

    stage = {"value": 1}

    def _fake_build_chunks():
        return chunks_v1 if stage["value"] == 1 else chunks_v2

    embed_calls = {"count": 0}

    async def _fake_embed(texts, task_type="RETRIEVAL_DOCUMENT"):
        embed_calls["count"] += 1
        return np.ones((len(texts), 4), dtype=np.float32)

    monkeypatch.setattr(rag_module, "_build_chunks", _fake_build_chunks)
    monkeypatch.setattr(rag_module, "_embed", _fake_embed)

    rag_module._CHUNKS = []
    rag_module._EMBEDDINGS = None
    _run_async(rag_module.warmup_rag())
    assert embed_calls["count"] == 1

    stage["value"] = 2
    rag_module._CHUNKS = []
    rag_module._EMBEDDINGS = None
    _run_async(rag_module.warmup_rag())
    assert embed_calls["count"] == 2
