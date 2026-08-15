"""Covers the caches added to keep repeat work off Azure OpenAI and off the Basic-tier database.

Runs fully offline like the rest of the suite — the embedding cache is exercised against
a stub so no Azure credentials are needed.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", f"sqlite:///{(ROOT / 'tests' / 'test_cache.db').as_posix()}")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("AUTO_SEED", "true")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("SEARCH_BACKEND", "local")
os.environ.setdefault("LLM_BACKEND", "offline")
os.environ.setdefault("NOTIFICATION_BACKEND", "log")

import pytest

from app.services import llm as llm_module
from app.services.cache import TTLCache, bump_data_version, dashboard_cache
from app.services.llm import llm_service, normalize_query


@pytest.fixture(autouse=True)
def clear_caches():
    llm_module._embed_query_cached.cache_clear()
    dashboard_cache.clear()
    yield
    llm_module._embed_query_cached.cache_clear()
    dashboard_cache.clear()


# ---------------------------------------------------------------------------
# Query embedding cache
# ---------------------------------------------------------------------------


def test_repeat_question_embeds_once(monkeypatch):
    calls = []

    def fake_embed(texts):
        calls.append(list(texts))
        return [[0.1, 0.2, 0.3] for _ in texts]

    monkeypatch.setattr(llm_service, "embed", fake_embed)

    first = llm_service.embed_query("How much PTO do I get?")
    second = llm_service.embed_query("How much PTO do I get?")

    assert first == second == [0.1, 0.2, 0.3]
    assert len(calls) == 1, "the second ask should not reach Azure OpenAI"


def test_phrasing_variants_share_one_embedding(monkeypatch):
    calls = []
    monkeypatch.setattr(llm_service, "embed", lambda texts: calls.append(list(texts)) or [[0.4, 0.5] for _ in texts])

    for variant in ["What is the remote work policy?", "what is the remote work policy", "  What Is The Remote Work Policy?  "]:
        assert llm_service.embed_query(variant) == [0.4, 0.5]

    assert len(calls) == 1, f"case and punctuation variants should collapse, got {calls}"
    # The normalized form is what gets embedded, so the vector does not depend on which
    # phrasing happened to arrive first.
    assert calls[0] == ["what is the remote work policy"]


def test_distinct_questions_are_not_conflated(monkeypatch):
    calls = []
    monkeypatch.setattr(llm_service, "embed", lambda texts: calls.append(list(texts)) or [[0.0] for _ in texts])

    llm_service.embed_query("How much PTO do I get?")
    llm_service.embed_query("What is the remote work policy?")

    assert len(calls) == 2


def test_caller_cannot_corrupt_the_cached_vector(monkeypatch):
    monkeypatch.setattr(llm_service, "embed", lambda texts: [[1.0, 2.0, 3.0] for _ in texts])

    vector = llm_service.embed_query("How much PTO do I get?")
    vector.append(999.0)

    assert llm_service.embed_query("How much PTO do I get?") == [1.0, 2.0, 3.0]


def test_normalize_query_collapses_noise():
    assert normalize_query("  How   much PTO?? ") == "how much pto"
    assert normalize_query("How much PTO?") == "how much pto"
    assert normalize_query("HOW  MUCH   PTO!!") == "how much pto"


def test_bulk_indexing_does_not_go_through_the_query_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(llm_service, "embed", lambda texts: calls.append(list(texts)) or [[0.0] for _ in texts])

    # embed() is the indexing path and must stay uncached — chunk text is seen once and
    # would only evict the queries that actually repeat.
    llm_service.embed(["chunk one"])
    llm_service.embed(["chunk one"])

    assert len(calls) == 2


# ---------------------------------------------------------------------------
# TTL cache and write invalidation
# ---------------------------------------------------------------------------


def test_ttl_cache_serves_the_cached_value():
    cache = TTLCache(ttl_seconds=60)
    calls = []

    def producer():
        calls.append(1)
        return len(calls)

    assert cache.get_or_set("k", producer) == 1
    assert cache.get_or_set("k", producer) == 1
    assert len(calls) == 1


def test_ttl_cache_separates_keys():
    cache = TTLCache(ttl_seconds=60)
    assert cache.get_or_set("a", lambda: "first") == "first"
    assert cache.get_or_set("b", lambda: "second") == "second"
    assert cache.get_or_set("a", lambda: "ignored") == "first"


def test_expired_entry_is_recomputed():
    cache = TTLCache(ttl_seconds=0)
    assert cache.get_or_set("k", lambda: "old") == "old"
    assert cache.get_or_set("k", lambda: "new") == "new"


def test_write_invalidates_the_cache():
    cache = TTLCache(ttl_seconds=60)
    assert cache.get_or_set("k", lambda: "before") == "before"
    bump_data_version()
    # A stale count on a dashboard is tolerable; a count from before a write the user
    # just made is the bug this guards against.
    assert cache.get_or_set("k", lambda: "after") == "after"
