"""The add-a-missing-column step, against a table shaped like production's.

Production's `news_announcements` was created before the news feed existed, so it has
no `source`, `external_id` or `url`. `create_all` will not add them — it skips a table
that already exists — and every announcement query would then fail against a schema
that looks perfectly fine on a fresh local SQLite file.

So the table here is built by hand with the *old* column list rather than from the
model. Building it from the model would create the new columns too and the test would
pass while proving nothing.
"""

from __future__ import annotations

import os

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/test_migrations.db")

from sqlalchemy import create_engine, inspect, text  # noqa: E402

from app.migrations import ADDITIONS, ensure_columns  # noqa: E402

# The pre-feed shape, copied from what the model declared before this change.
LEGACY_TABLE = """
CREATE TABLE news_announcements (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    body TEXT NOT NULL,
    allowed_roles JSON,
    department VARCHAR(100),
    published BOOLEAN,
    published_at DATETIME,
    expires_at DATETIME,
    created_by INTEGER,
    created_at DATETIME
)
"""

NEW_COLUMNS = [column for _, column, _ in ADDITIONS]


def legacy_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}", future=True)
    with engine.begin() as conn:
        conn.execute(text(LEGACY_TABLE))
        conn.execute(
            text(
                "INSERT INTO news_announcements (id, title, body, published) "
                "VALUES ('existing-row', 'Open enrollment', 'Review your elections.', 1)"
            )
        )
    return engine


def test_adds_every_missing_column(tmp_path):
    engine = legacy_engine(tmp_path)
    before = {c["name"] for c in inspect(engine).get_columns("news_announcements")}
    assert not before & set(NEW_COLUMNS), "fixture is not actually the legacy shape"

    added = ensure_columns(engine)

    assert sorted(added) == sorted(f"news_announcements.{c}" for c in NEW_COLUMNS)
    after = {c["name"] for c in inspect(engine).get_columns("news_announcements")}
    assert set(NEW_COLUMNS) <= after


def test_existing_rows_survive_and_default_to_hr(tmp_path):
    """A row written before the column existed must end up owned by HR, not the feed.

    If it defaulted to the feed slug instead, the first nightly run would retire a
    banner someone wrote by hand.
    """
    engine = legacy_engine(tmp_path)
    ensure_columns(engine)

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT title, source, external_id, url FROM news_announcements WHERE id = 'existing-row'")
        ).one()

    assert row.title == "Open enrollment"
    assert row.source == "hr"
    assert row.external_id is None
    assert row.url is None


def test_running_it_twice_is_a_no_op(tmp_path):
    engine = legacy_engine(tmp_path)
    ensure_columns(engine)

    assert ensure_columns(engine) == []


def test_no_op_on_a_database_that_has_no_such_table(tmp_path):
    """Startup runs this before create_all has necessarily made anything."""
    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}", future=True)
    assert ensure_columns(engine) == []
