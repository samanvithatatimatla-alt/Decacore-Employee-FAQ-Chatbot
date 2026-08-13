import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.search import search_service

search_service.ensure_azure_index()
print("Azure AI Search index created/updated.")
