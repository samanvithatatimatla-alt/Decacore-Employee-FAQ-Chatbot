"""Company news ingest: parsing, idempotency, and who is allowed to trigger it.

Every test runs against a saved copy of the real Quadrant feed
(`fixtures/quadrant_blog_feed.xml`), so the suite makes no network call and does not
break when the blog publishes. `news_feed.refresh` takes the document as an argument
for exactly this reason.

The property that matters most here is the last one: HR writes banners into the same
table, and a nightly job that could unpublish or overwrite them would be worse than
having no ticker at all.
"""

from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/test_news.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import NewsAnnouncement  # noqa: E402
from app.services import news_feed  # noqa: E402

FEED = (Path(__file__).parent / "fixtures" / "quadrant_blog_feed.xml").read_bytes()

HR_ADMIN = {"X-Dev-User-Email": "hr.admin@bluepeak.example"}
EMPLOYEE = {"X-Dev-User-Email": "marietta.baudone@gmail.com"}


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        # Each test owns the feed-sourced rows outright; HR rows are created per-test.
        session.query(NewsAnnouncement).delete()
        session.commit()
        yield session


def feed_rows(db):
    return db.scalars(
        select(NewsAnnouncement).where(NewsAnnouncement.source == settings.news_feed_source)
    ).all()


# --- parsing ---------------------------------------------------------------


def test_parse_reads_every_item():
    items = news_feed.parse(FEED)
    assert len(items) == 10
    assert all(i.title and i.url and i.external_id for i in items)


def test_parse_orders_newest_first():
    dates = [i.published_at for i in news_feed.parse(FEED) if i.published_at]
    assert dates == sorted(dates, reverse=True)


def test_summary_is_plain_text():
    """Descriptions arrive as HTML inside CDATA; a ticker renders text."""
    for item in news_feed.parse(FEED):
        assert "<" not in item.summary and ">" not in item.summary
        assert "&lt;" not in item.summary and "&amp;" not in item.summary


def test_summary_drops_the_wordpress_footer():
    """Every WordPress description ends "The post X appeared first on Y." """
    assert all("appeared first on" not in i.summary for i in news_feed.parse(FEED))


def test_summary_is_short_enough_for_one_line():
    assert all(len(i.summary) <= 221 for i in news_feed.parse(FEED))


def test_item_without_a_link_is_skipped():
    xml = b"""<rss version="2.0"><channel>
      <item><title>No link here</title><description>x</description></item>
      <item><title>Real post</title><link>https://example.com/a</link></item>
    </channel></rss>"""
    items = news_feed.parse(xml)
    assert [i.title for i in items] == ["Real post"]


def test_guid_falls_back_to_the_link():
    xml = b"""<rss version="2.0"><channel>
      <item><title>T</title><link>https://example.com/a</link></item>
    </channel></rss>"""
    assert news_feed.parse(xml)[0].external_id == "https://example.com/a"


def test_malformed_xml_raises_feed_error():
    with pytest.raises(news_feed.FeedError):
        news_feed.parse(b"<rss><channel><item>")


def test_entity_expansion_bomb_is_refused():
    """Verified against Python 3.12: xml.etree *does* expand internal entities.

    Four levels already produce 3000 characters and each further level multiplies by
    ten, so a small hostile response can exhaust the worker. The DTD is refused before
    the parser ever sees it.
    """
    bomb = b"""<?xml version="1.0"?>
    <!DOCTYPE lolz [
     <!ENTITY lol "lol">
     <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
     <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
    ]>
    <rss><channel><item><title>&lol3;</title>
    <link>https://example.com/a</link></item></channel></rss>"""
    with pytest.raises(news_feed.FeedError, match="DTD or entity"):
        news_feed.parse(bomb)


def test_external_entity_is_refused():
    """xml.etree already blocks this one, but the DTD guard should catch it first."""
    xxe = b"""<?xml version="1.0"?>
    <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
    <rss><channel><item><title>&xxe;</title>
    <link>https://example.com/a</link></item></channel></rss>"""
    with pytest.raises(news_feed.FeedError):
        news_feed.parse(xxe)


def test_the_real_feed_has_no_dtd():
    """The guard is only safe to keep if legitimate input never trips it."""
    news_feed.parse(FEED)  # would raise if it did


# --- ingest ----------------------------------------------------------------


def test_refresh_creates_capped_published_items(db):
    result = news_feed.refresh(db, FEED)

    assert result.created == settings.news_feed_max_items
    rows = feed_rows(db)
    assert len(rows) == settings.news_feed_max_items
    assert all(r.published and r.url and r.external_id for r in rows)
    # Company news is for everyone and never expires on a timer.
    assert all(r.allowed_roles == [] and r.expires_at is None for r in rows)


def test_refresh_is_idempotent(db):
    news_feed.refresh(db, FEED)
    before = {r.id for r in feed_rows(db)}

    second = news_feed.refresh(db, FEED)

    assert second.created == 0
    assert second.updated == 0
    assert {r.id for r in feed_rows(db)} == before


def test_refresh_updates_an_edited_post(db):
    news_feed.refresh(db, FEED)
    row = feed_rows(db)[0]
    row.title = "Stale title"
    db.commit()

    result = news_feed.refresh(db, FEED)

    assert result.updated == 1
    db.refresh(row)
    assert row.title != "Stale title"


def test_post_dropped_from_the_feed_leaves_the_ticker(db):
    news_feed.refresh(db, FEED)
    kept = news_feed.parse(FEED)[0]

    trimmed = f"""<rss version="2.0"><channel>
      <item><title>{kept.title}</title><link>{kept.url}</link>
      <guid>{kept.external_id}</guid></item>
    </channel></rss>""".encode()
    result = news_feed.refresh(db, trimmed)

    assert result.retired == settings.news_feed_max_items - 1
    published = [r for r in feed_rows(db) if r.published]
    assert len(published) == 1
    # Retired, not deleted — the row stays as the record that we once showed it.
    assert len(feed_rows(db)) == settings.news_feed_max_items


def test_refresh_never_touches_hr_written_items(db):
    """The property this whole design exists to protect."""
    hr = NewsAnnouncement(
        title="Open enrollment closes Friday",
        body="Review your elections.",
        allowed_roles=[],
        published=True,
        source="hr",
    )
    db.add(hr)
    db.commit()
    hr_id = hr.id

    news_feed.refresh(db, FEED)
    # ... and again with an empty feed, the run most likely to retire things it
    # should not: every feed row gets unpublished, and HR's must survive that.
    news_feed.refresh(db, b'<rss version="2.0"><channel></channel></rss>')

    db.expire_all()
    survivor = db.get(NewsAnnouncement, hr_id)
    assert survivor is not None
    assert survivor.published is True
    assert survivor.title == "Open enrollment closes Friday"
    assert survivor.source == "hr"


# --- demo seed ---------------------------------------------------------------


def test_demo_headlines_are_not_seeded_in_production(db, monkeypatch):
    """The invented BluePeak headlines are a local-demo affordance.

    They are dated from first boot, so on a real deployment they sort ahead of genuine
    posts carrying their own publication dates — which is how three fictional headlines
    ended up being the only news anyone saw.
    """
    from app import seed

    monkeypatch.setattr(settings, "env", "prod")
    assert seed.seed_announcements(db) == 0
    assert db.query(NewsAnnouncement).count() == 0

    monkeypatch.setattr(settings, "env", "dev")
    assert seed.seed_announcements(db) == 3


# --- endpoint --------------------------------------------------------------


def test_refresh_endpoint_rejects_an_employee():
    with TestClient(app) as client:
        assert client.post("/api/admin/news/refresh", headers=EMPLOYEE).status_code == 403


def test_refresh_endpoint_rejects_a_wrong_secret(monkeypatch):
    monkeypatch.setattr(settings, "news_refresh_token", "correct-secret")
    with TestClient(app) as client:
        response = client.post(
            "/api/admin/news/refresh",
            headers={"X-Refresh-Token": "wrong-secret", **HR_ADMIN},
        )
    # Presenting a bad secret must not silently fall through to the HRAdmin path.
    assert response.status_code == 401


def test_refresh_endpoint_rejects_an_unresolved_keyvault_reference(monkeypatch):
    """App Service hands the app the literal reference when it cannot resolve one.

    That string is committed in infra/terraform/settings.tf, so treating it as a
    valid secret would open the endpoint to anyone who has read the repo.
    """
    reference = "@Microsoft.KeyVault(SecretUri=https://qthr-decacore-kv.vault.azure.net/secrets/news-refresh-token)"
    monkeypatch.setattr(settings, "news_refresh_token", reference)
    with TestClient(app) as client:
        response = client.post("/api/admin/news/refresh", headers={"X-Refresh-Token": reference})
    assert response.status_code == 401


def test_refresh_endpoint_reports_upstream_failure_as_502(monkeypatch):
    """A dead feed must fail the scheduled job rather than report a quiet success."""
    def boom(url, timeout=20.0):
        raise news_feed.FeedError("Could not fetch")

    monkeypatch.setattr(news_feed, "fetch", boom)
    with TestClient(app) as client:
        assert client.post("/api/admin/news/refresh", headers=HR_ADMIN).status_code == 502


def test_refresh_endpoint_ingests_and_shows_up_on_the_ticker(monkeypatch):
    monkeypatch.setattr(news_feed, "fetch", lambda url, timeout=20.0: FEED)
    with TestClient(app) as client:
        response = client.post("/api/admin/news/refresh", headers=HR_ADMIN)
        assert response.status_code == 200
        assert response.json()["triggered_by"] == "manual:hr.admin@bluepeak.example"

        items = client.get("/api/announcements", headers=EMPLOYEE).json()["items"]

    ingested = [i for i in items if i["source"] == settings.news_feed_source]
    assert len(ingested) == settings.news_feed_max_items
    assert all(i["url"] for i in ingested)
