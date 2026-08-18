import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select

from app.database import Base, SessionLocal, engine
from app.models import User
from app.seed import seed_all
from app.services.search import search_service

Base.metadata.create_all(bind=engine)
with SessionLocal() as db:
    if (db.scalar(select(func.count(User.id))) or 0) == 0:
        seed_all(db)

# Defaults to the v1 question set; pass a path to score a different one, e.g.
#   python scripts/evaluate_retrieval.py data/seed_v3/evaluation_questions_v3.csv
questions = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "seed" / "evaluation_questions.csv"
rows = list(csv.DictReader(questions.open(encoding="utf-8-sig")))
print(f"questions: {questions.name}")
with SessionLocal() as db:
    total = hit = 0
    by_type: dict[str, list[int]] = {}
    misses = []
    for row in rows:
        expected = [x for x in (row.get("expected_document_id") or "").split("|") if x]
        if not expected or row.get("expected_status") == "not_found" or row.get("question_type") == "held_back":
            continue
        total += 1
        results = search_service.search(db, row["question"], "Manager", 5)
        actual = {r["external_document_id"] for r in results}
        ok = all(x in actual for x in expected)
        hit += int(ok)
        kind = row.get("question_type") or "unknown"
        by_type.setdefault(kind, [0, 0])
        by_type[kind][0] += int(ok)
        by_type[kind][1] += 1
        if not ok:
            misses.append((row["question_id"], row["question"], expected, [r["external_document_id"] for r in results]))

    print(f"all-expected-document recall@5: {hit}/{total} = {hit/total:.1%}")
    for kind, (correct, count) in sorted(by_type.items()):
        print(f"{kind:18} {correct:2}/{count:2} = {correct/count:.1%}")
    if misses:
        print("\nMisses:")
        for item in misses:
            print(item)
