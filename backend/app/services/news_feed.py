"""Company news for the ticker, ingested from a public RSS feed.

The ask was to pull the ticker from Quadrant's LinkedIn company page. That is not
readable: the page 302s to a login wall, and the only sanctioned way to read an
organisation's posts is the Community Management API, which needs a super admin of
that LinkedIn Page to verify a reviewed app. Scraping it with a session cookie would
break LinkedIn's User Agreement and the markup, so the source here is Quadrant's own
WordPress feed instead — public, stable, permitted by their robots.txt, and carrying
most of the same posts.

Nothing below is LinkedIn-specific, so if that access ever lands, this module keeps
its shape and only `fetch` and `parse` change.

Feed rows and HR rows live in the same table, told apart by `source`. Everything here
is scoped to one source slug, which is what makes the nightly run unable to disturb a
banner someone wrote by hand.
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import NewsAnnouncement

logger = logging.getLogger("decacore")

# WordPress appends this to every RSS description. It is not part of the post and
# reads badly in a one-line ticker: "... The post Journey to LLMs appeared first on
# Quadrant Technologies."
WP_BOILERPLATE = re.compile(r"\s*The post\s.*?\sappeared first on\s.*?[.．]?\s*$", re.I | re.S)
TAG = re.compile(r"<[^>]+>")
WHITESPACE = re.compile(r"\s+")


@dataclass
class FeedItem:
    external_id: str
    title: str
    summary: str
    url: str
    published_at: datetime | None


class FeedError(RuntimeError):
    """The feed could not be fetched or parsed. Never raised past the router."""


def _clean(raw: str | None, limit: int) -> str:
    """RSS description -> one line of plain text.

    Descriptions are HTML inside CDATA. The ticker renders text, so tags come out,
    entities are decoded, and the WordPress footer is dropped. Truncation is on a word
    boundary because a ticker cut mid-word looks like a bug.
    """
    if not raw:
        return ""
    text = html.unescape(raw)
    text = TAG.sub(" ", text)
    text = html.unescape(text)  # entities can survive one pass inside a tag payload
    text = WP_BOILERPLATE.sub("", text)
    text = WHITESPACE.sub(" ", text).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:.—-") + "…"


def _published(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    # A feed may omit the offset. Treat a naive timestamp as UTC rather than dropping
    # the item — the ticker orders by this, and None sorts to the bottom.
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


# Any document type declaration. A legitimate RSS feed has none — WordPress emits a
# bare <?xml?> and goes straight into <rss> — so this is only ever seen on something
# hand-crafted, which is exactly the case worth refusing. See _reject_dtd.
DOCTYPE = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.I)


def _reject_dtd(raw: bytes) -> None:
    """Refuse a feed carrying a DTD, before it reaches the parser.

    Measured on Python 3.12 rather than assumed. `xml.etree` already blocks the
    dangerous half: an external entity (`<!ENTITY xxe SYSTEM "file:///etc/passwd">`)
    raises "undefined entity" instead of reading the file, so there is no XXE or
    entity-driven SSRF here.

    What it does *not* block is internal entity expansion — four levels of nesting
    expanded to 3000 characters, and each further level multiplies by ten, so a small
    response can exhaust the worker's memory. That is a denial of service against the
    app from whoever controls the feed.

    Refusing the declaration outright is what `defusedxml.forbid_dtd` does, and doing
    it here avoids adding a dependency that has not shipped a release since 2021 for a
    single call site. Only the first chunk is scanned: a DTD is only valid in the
    prolog, so a declaration further in is not one the parser would honour anyway.
    """
    if DOCTYPE.search(raw[:4096]):
        raise FeedError("Feed declares a DTD or entity; refusing to parse it")


def parse(xml: bytes | str) -> list[FeedItem]:
    """RSS 2.0 <item> elements -> FeedItems, newest first.

    Uses the stdlib parser rather than adding a feed library: the shape needed here is
    five fields from one well-formed document, and `feedparser` would be a dependency
    carried into production for that.
    """
    _reject_dtd(xml if isinstance(xml, bytes) else xml.encode("utf-8", "ignore"))
    try:
        # noqa justified by _reject_dtd above, which strips the one attack this
        # parser is actually vulnerable to. Do not remove one without the other.
        root = ElementTree.fromstring(xml)  # noqa: S314
    except ElementTree.ParseError as exc:
        raise FeedError(f"Feed is not well-formed XML: {exc}") from exc

    items: list[FeedItem] = []
    for node in root.iter("item"):
        title = _clean(node.findtext("title"), 300)
        link = (node.findtext("link") or "").strip()
        if not title or not link:
            # Both are required to render a ticker entry that goes anywhere.
            continue
        # <guid> is the feed's own stable id. Falling back to the link keeps a feed
        # that omits guid working, and the link is stable enough to dedupe on.
        guid = (node.findtext("guid") or "").strip() or link
        items.append(
            FeedItem(
                external_id=guid[:500],
                title=title,
                summary=_clean(node.findtext("description"), 220),
                url=link[:800],
                published_at=_published(node.findtext("pubDate")),
            )
        )

    items.sort(key=lambda i: (i.published_at is not None, i.published_at or datetime.min.replace(tzinfo=UTC)), reverse=True)
    return items


# The real feed is ~17 KB. This is a ceiling on a hostile or broken response, not a
# tuning knob — a feed anywhere near it is already wrong.
MAX_FEED_BYTES = 8 * 1024 * 1024


def fetch(url: str, timeout: float = 20.0) -> bytes:
    """GET the feed. Redirects are followed — the canonical feed URL 301s to /feed/."""
    try:
        response = httpx.get(
            url,
            timeout=timeout,
            follow_redirects=True,
            headers={
                # Identify the caller. A default python-httpx UA is the kind of thing
                # a WAF blocks, and an operator reading their access log deserves to
                # know who this is.
                "User-Agent": "DecaCore-QBot-NewsTicker/1.0 (+internal HR assistant)",
                "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            },
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise FeedError(f"Could not fetch {url}: {exc}") from exc
    if len(response.content) > MAX_FEED_BYTES:
        raise FeedError(f"Feed at {url} is {len(response.content)} bytes; refusing to parse it")
    return response.content


@dataclass
class RefreshResult:
    created: int = 0
    updated: int = 0
    retired: int = 0
    total_in_feed: int = 0

    def as_dict(self) -> dict:
        return {
            "created": self.created,
            "updated": self.updated,
            "retired": self.retired,
            "total_in_feed": self.total_in_feed,
        }


def refresh(db: Session, xml: bytes | str | None = None) -> RefreshResult:
    """Bring the feed-owned rows in line with the feed. HR's rows are never touched.

    Pass `xml` to ingest a document already in hand; otherwise the configured URL is
    fetched. Tests use the first form so the suite makes no network calls.
    """
    source = settings.news_feed_source
    if xml is None:
        xml = fetch(settings.news_feed_url)

    items = parse(xml)[: settings.news_feed_max_items]
    result = RefreshResult(total_in_feed=len(items))

    existing = {
        row.external_id: row
        for row in db.scalars(select(NewsAnnouncement).where(NewsAnnouncement.source == source)).all()
        if row.external_id
    }
    keep: set[str] = set()

    for item in items:
        keep.add(item.external_id)
        row = existing.get(item.external_id)
        if row is None:
            db.add(
                NewsAnnouncement(
                    title=item.title,
                    body=item.summary,
                    # Company news is for everyone, and it is not department-scoped.
                    allowed_roles=[],
                    department=None,
                    published=True,
                    published_at=item.published_at or datetime.now(UTC),
                    # No expiry: an item leaves the ticker by dropping out of the feed
                    # and being retired below, not by aging out on a timer.
                    expires_at=None,
                    created_by=None,
                    source=source,
                    external_id=item.external_id,
                    url=item.url,
                )
            )
            result.created += 1
            continue
        # A post edited upstream should read the same here. published_at is refreshed
        # too, because WordPress moves it when a post is republished.
        changed = (
            row.title != item.title
            or row.body != item.summary
            or row.url != item.url
            or not row.published
        )
        row.title = item.title
        row.body = item.summary
        row.url = item.url
        row.published = True
        if item.published_at:
            row.published_at = item.published_at
        if changed:
            result.updated += 1

    # Anything this source published before but the feed no longer carries comes off
    # the ticker. Unpublished rather than deleted: the row is the record that we once
    # showed it, and the set is bounded by how many posts the blog has ever had.
    for external_id, row in existing.items():
        if external_id not in keep and row.published:
            row.published = False
            result.retired += 1

    db.commit()
    logger.info(
        "news feed refresh source=%s created=%s updated=%s retired=%s in_feed=%s",
        source, result.created, result.updated, result.retired, result.total_in_feed,
    )
    return result
