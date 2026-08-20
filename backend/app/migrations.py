"""The smallest thing that can add a column to a table that already exists.

`Base.metadata.create_all` creates missing *tables* and nothing else. It will not
touch a table that is already there, so a column added to a model afterwards simply
never appears in any database that has booted once — and every query then fails with
"invalid column name" against a schema that looks fine locally, because a fresh
SQLite file gets the new column for free.

That is not a hypothetical: production has been running since before the news feed
existed, so `news_announcements` there predates `source`, `external_id` and `url`.

This is deliberately not Alembic. There is one forward-only step, it has to run on
both SQLite and Azure SQL, and adding a migration tool plus a version table to a
project with no migration history is a bigger change than the problem warrants. If a
second or third step ever lands, that trade flips — take this as the point to
reconsider, not as a pattern to keep extending.

Adds only. Nothing here drops or retypes a column, so running it against an
already-migrated database is a no-op and running it twice is safe.
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("decacore")

# (table, column, DDL type fragment). The fragment has to parse on both dialects:
# `ALTER TABLE t ADD col ...` is valid T-SQL and valid SQLite (which treats the
# COLUMN keyword as optional), and VARCHAR/NOT NULL/DEFAULT all mean the same thing
# on each. A NOT NULL column added to a table with rows needs the DEFAULT — without
# it SQL Server rejects the statement outright.
ADDITIONS: list[tuple[str, str, str]] = [
    ("news_announcements", "source", "VARCHAR(40) NOT NULL DEFAULT 'hr'"),
    ("news_announcements", "external_id", "VARCHAR(500) NULL"),
    ("news_announcements", "url", "VARCHAR(800) NULL"),
]


def ensure_columns(engine: Engine) -> list[str]:
    """Add any column in ADDITIONS that the live schema is missing.

    Returns the columns it added, so startup can log something when it actually did
    work and stay quiet when it did not.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    added: list[str] = []

    for table, column, ddl in ADDITIONS:
        if table not in tables:
            # create_all will build it from the model, new columns included.
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            continue
        # Table and column names here are module constants, never user input.
        statement = text(f"ALTER TABLE {table} ADD {column} {ddl}")
        try:
            with engine.begin() as conn:
                conn.execute(statement)
        except Exception:
            # A concurrent instance winning the race is the expected failure: App
            # Service can run several workers, and they all boot at once. Log and
            # carry on rather than crashing the app — if the column genuinely is
            # missing, the next query says so far more clearly than a traceback here.
            logger.exception("Could not add %s.%s; continuing", table, column)
            continue
        added.append(f"{table}.{column}")

    return added
