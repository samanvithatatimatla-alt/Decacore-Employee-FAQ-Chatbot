"""Guards against SQL that SQLite accepts and Azure SQL rejects.

The test suite runs on SQLite; production runs on Azure SQL. Some SQLAlchemy
constructs compile to T-SQL that SQL Server will not parse, so a query can pass
every local test and 500 in production. These two have already done exactly that:

  - `Column.is_(True)`  compiles to `col IS 1`. SQLite accepts it; SQL Server
    allows IS only with NULL, so it is a syntax error there.
  - `.nullslast()`      compiles to `ORDER BY col DESC NULLS LAST`. SQL Server has
    no NULLS LAST/FIRST clause at all.

Write `where(Model.flag)` instead of `where(Model.flag.is_(True))` — a bare boolean
column renders as `= 1` and works on both. For null ordering, order by a COALESCE.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pytest
from sqlalchemy import func, or_, select
from sqlalchemy.dialects import mssql, sqlite

from app.models import DocumentVersion, Favorite, Message, NewsAnnouncement

APP = ROOT / "app"

FORBIDDEN = {
    ".is_(True)": "renders as `IS 1`, which SQL Server cannot parse — use the bare column",
    ".is_(False)": "renders as `IS 0`, which SQL Server cannot parse — use `~Model.flag`",
    ".nullslast(": "NULLS LAST is not valid T-SQL — order by func.coalesce(...) instead",
    ".nullsfirst(": "NULLS FIRST is not valid T-SQL — order by func.coalesce(...) instead",
}


def test_no_dialect_incompatible_constructs_in_source():
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        for needle, why in FORBIDDEN.items():
            for i, line in enumerate(text.splitlines(), start=1):
                if needle in line:
                    offenders.append(f"{path.relative_to(ROOT)}:{i}  {needle}  — {why}")
    assert not offenders, "SQL Server incompatible constructs found:\n  " + "\n  ".join(offenders)


@pytest.mark.parametrize(
    "name,stmt",
    [
        (
            "announcements",
            select(NewsAnnouncement.id)
            .where(NewsAnnouncement.published, or_(NewsAnnouncement.expires_at.is_(None), NewsAnnouncement.expires_at > func.now()))
            .order_by(NewsAnnouncement.published_at.desc()),
        ),
        (
            "document updates",
            select(DocumentVersion.id)
            .where(DocumentVersion.is_current, DocumentVersion.version_number > 1)
            .order_by(DocumentVersion.uploaded_at.desc()),
        ),
        (
            "favourites ordering",
            select(Favorite.id).order_by(func.coalesce(Favorite.last_viewed_at, Favorite.created_at).desc()),
        ),
        (
            "escalated message count",
            select(func.count(Message.id)).where(Message.escalated),
        ),
    ],
)
def test_queries_compile_to_valid_tsql(name, stmt):
    rendered = str(stmt.compile(dialect=mssql.dialect()))
    assert not re.search(r"\bIS\s+[01]\b", rendered), f"{name}: `IS 1`/`IS 0` is not valid T-SQL\n{rendered}"
    assert "NULLS LAST" not in rendered and "NULLS FIRST" not in rendered, f"{name}: NULLS ordering is not valid T-SQL\n{rendered}"
    # The same statement must still be valid on the dialect the tests run against.
    str(stmt.compile(dialect=sqlite.dialect()))


def test_bare_boolean_column_renders_as_equality():
    # The positive case this whole module exists to enforce.
    rendered = str(select(NewsAnnouncement.id).where(NewsAnnouncement.published).compile(dialect=mssql.dialect()))
    assert "published = 1" in rendered
