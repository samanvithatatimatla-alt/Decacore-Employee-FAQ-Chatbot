from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException


class InMemoryRateLimiter:
    """Small demo-friendly fixed-window-ish limiter.

    For a multi-instance production deployment, replace this with Azure Cache for Redis
    or an API Management policy so the counter is shared across instances.
    """

    def __init__(self, limit: int = 30, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._events[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.limit:
                retry = max(1, int(self.window_seconds - (now - q[0])))
                raise HTTPException(status_code=429, detail=f"Too many chat requests. Retry in about {retry} seconds.")
            q.append(now)


chat_rate_limiter = InMemoryRateLimiter(limit=30, window_seconds=60)
