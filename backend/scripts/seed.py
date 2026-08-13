import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import Base, SessionLocal, engine
from app.seed import seed_all

Base.metadata.create_all(bind=engine)
with SessionLocal() as db:
    print(seed_all(db))
