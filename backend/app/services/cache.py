from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

# Every cached read is stamped with the data version current when it was produced, and
# a stamp that no longer matches is treated as a miss. Without this a 60s TTL would let
# the dashboard show counts from before a chat that has already been answered, which
# reads as a bug rather than as staleness. Writes are far rarer than reads here, so
# busting on write costs little and removes the whole class of "why is my number old"
# question — including in the test suite, which posts a chat and asserts on the counts
# immediately afterwards.
_version_lock = threading.Lock()
_version = 0


def data_version() -> int:
    with _version_lock:
        return _version


def bump_data_version() -> None:
    global _version
    with _version_lock:
        _version += 1


@event.listens_for(Session, "after_flush")
def _mark_session_wrote(session: Session, flush_context: Any) -> None:
    # Deliberately model-agnostic: any insert, update or delete bumps the version.
    # Over-invalidating only costs a recompute, whereas enumerating the models that
    # feed the dashboard would silently rot the moment a new one is added.
    if session.new or session.dirty or session.deleted:
        session.info["decacore_wrote"] = True


@event.listens_for(Session, "after_commit")
def _bump_on_commit(session: Session) -> None:
    if session.info.pop("decacore_wrote", False):
        bump_data_version()


class TTLCache:
    """Single-process cache for values that are expensive to compute and safe to be briefly stale.

    In-process on purpose. The app runs on one B1 instance, so a shared cache would mean
    standing up Azure Cache for Redis at roughly the cost of the compute it is helping.
    If this ever scales past one instance the entries stay correct — each worker simply
    keeps its own copy, exactly as `InMemoryRateLimiter` already does.
    """

    def __init__(self, ttl_seconds: float):
        self.ttl_seconds = ttl_seconds
        self._entries: dict[str, tuple[float, int, Any]] = {}
        self._lock = threading.Lock()

    def get_or_set(self, key: str, producer: Callable[[], Any]) -> Any:
        now = time.monotonic()
        version = data_version()
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                expires_at, stamped_version, value = entry
                if now < expires_at and stamped_version == version:
                    return value
        # Produced outside the lock: two concurrent misses may both compute, which is
        # cheaper than holding a lock across a database query and blocking every reader.
        value = producer()
        with self._lock:
            self._entries[key] = (now + self.ttl_seconds, version, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


# The dashboard and the home-screen FAQ list are approximate counters on a 5 DTU Basic
# database. A minute of staleness is invisible to a reader; the repeated full GROUP BY
# scans are not.
dashboard_cache = TTLCache(ttl_seconds=60)
