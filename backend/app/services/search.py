from __future__ import annotations

import math
import re
import threading
from collections import Counter
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Document, SearchChunk
from .ingestion import chunk_pdf
from .llm import llm_service
from .storage import storage_service

STOP = {"the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "my", "i", "do", "does", "can", "how", "what", "when", "with"}

QUERY_EXPANSIONS = {
    "vacation": ["pto", "paid time off", "leave"],
    "holiday": ["pto", "paid time off"],
    "sick": ["medical absence", "sick leave"],
    "call out": ["sick leave", "absence"],
    "baby": ["parental leave", "family leave", "health welfare benefits", "benefits enrollment", "qualifying life event"],
    "adopt": ["adoptive parent", "parental leave", "family leave", "benefits enrollment", "qualifying life event"],
    "kid": ["child", "parental leave", "family leave"],
    "401k": ["401 k", "retirement", "financial benefits"],
    "paycheck": ["payroll", "pay date", "compensation"],
    "paychecks": ["payroll", "pay date", "compensation"],
    "trip": ["travel", "expense", "reimbursement"],
    "uber": ["rideshare", "travel", "expense"],
    "conference": ["learning development", "reimbursement", "travel"],
    "cert": ["certification", "learning development", "reimbursement"],
    "remote": ["hybrid", "work from another location", "remote work"],
    "another state": ["remote", "payroll", "work from another location"],
    "leaving": ["offboarding", "separation", "final pay", "pto"],
    "quit": ["onboarding offboarding", "separation", "final pay", "equipment return", "access on separation"],
    "equipment": ["onboarding offboarding", "equipment return"],
    "laptop": ["onboarding offboarding", "equipment return"],
    "account shutoff": ["information security", "access on separation"],
    "login": ["information security", "access on separation"],
    "books": ["learning development", "learning materials", "reimbursement"],
    "part time": ["parental leave", "return to work", "benefits"],
    "austin": ["payroll", "site specific working hours", "hybrid core hours"],
    "gym": ["wellness", "benefits"],
    "death": ["bereavement", "compassionate leave", "immediate family"],
    "dies": ["bereavement", "compassionate leave", "immediate family"],
    "died": ["bereavement", "compassionate leave", "immediate family"],
    "funeral": ["bereavement", "compassionate leave", "immediate family"],
    "parent": ["immediate family", "bereavement", "family leave"],
    "dental": ["health welfare benefits", "insurance"],
    "vision": ["health welfare benefits", "insurance"],
}


def tokens(text: str) -> list[str]:
    return [x for x in re.findall(r"[a-z0-9]+", text.lower()) if x not in STOP and len(x) > 1]


def expand_query(query: str) -> str:
    lower = query.lower()
    additions: list[str] = []
    for phrase, expansion in QUERY_EXPANSIONS.items():
        if phrase in lower:
            additions.extend(expansion)
    return query + (" " + " ".join(additions) if additions else "")


def local_score(query: str, content: str) -> float:
    q = Counter(tokens(expand_query(query)))
    d = Counter(tokens(content))
    if not q or not d:
        return 0.0
    dot = sum(q[t] * d.get(t, 0) for t in q)
    qn = math.sqrt(sum(v * v for v in q.values()))
    dn = math.sqrt(sum(v * v for v in d.values()))
    return dot / (qn * dn) if qn and dn else 0.0


class SearchService:
    def __init__(self):
        self._client_instance = None
        self._client_lock = threading.Lock()

    def index_document(self, db: Session, document: Document) -> int:
        data = storage_service.read_bytes(document.blob_path)
        chunks = chunk_pdf(data)
        db.execute(delete(SearchChunk).where(SearchChunk.document_id == document.id))
        rows = []
        for chunk in chunks:
            rows.append(
                SearchChunk(
                    # Underscore, not colon: this id is also the Azure AI Search
                    # document key, and keys may only contain letters, digits,
                    # underscore, dash or equals. A colon is rejected at upload
                    # with InvalidDocumentKey, so every chunk silently fails to
                    # index and the bot answers from nothing.
                    id=f"{document.id}_{chunk.chunk_index}",
                    document_id=document.id,
                    external_document_id=document.external_document_id,
                    chunk_index=chunk.chunk_index,
                    content=chunk.content,
                    section_heading=chunk.section_heading,
                    page_number=chunk.page_number,
                    title=document.title,
                    category=document.category,
                    allowed_roles=document.allowed_roles or [],
                    version=document.version,
                    effective_date=document.effective_date,
                    source_url=document.source_url,
                )
            )
        db.add_all(rows)
        db.commit()
        if settings.search_backend == "azure":
            self._azure_upsert(rows)
        return len(rows)

    def delete_document(self, db: Session, document_id: str) -> None:
        ids = list(db.scalars(select(SearchChunk.id).where(SearchChunk.document_id == document_id)))
        db.execute(delete(SearchChunk).where(SearchChunk.document_id == document_id))
        db.commit()
        if settings.search_backend == "azure" and ids:
            self._azure_client().delete_documents(documents=[{"id": x} for x in ids])

    def search(self, db: Session, query: str, role: str, top_k: int | None = None) -> list[dict]:
        top_k = top_k or settings.local_search_top_k
        if settings.search_backend == "azure":
            return self._azure_search(query, role, top_k)

        rows = db.scalars(select(SearchChunk)).all()
        # Keep the best chunk per document. This deliberately diversifies local retrieval so
        # multi-policy questions do not waste all top-k slots on neighboring chunks from one PDF.
        best_by_document: dict[str, tuple[float, SearchChunk]] = {}
        for row in rows:
            if role != "HRAdmin" and role not in (row.allowed_roles or []):
                continue
            searchable = f"{row.title} {row.title} {row.section_heading or ''} {row.content}"
            score = local_score(query, searchable)
            if score <= 0:
                continue
            current = best_by_document.get(row.document_id)
            if current is None or score > current[0]:
                best_by_document[row.document_id] = (score, row)
        scored = list(best_by_document.values())
        scored.sort(key=lambda x: (x[0], x[1].effective_date or date.min), reverse=True)
        return [self._to_dict(row, score) for score, row in scored[:top_k]]

    @staticmethod
    def _to_dict(row: SearchChunk, score: float) -> dict:
        return {
            "id": row.id,
            "document_id": row.document_id,
            "external_document_id": row.external_document_id,
            "content": row.content,
            "title": row.title,
            "category": row.category,
            "section_heading": row.section_heading,
            "page_number": row.page_number,
            "allowed_roles": row.allowed_roles,
            "version": row.version,
            "effective_date": row.effective_date.isoformat() if row.effective_date else None,
            "source_url": row.source_url,
            "score": score,
        }

    def _azure_credential(self):
        if settings.azure_search_api_key:
            from azure.core.credentials import AzureKeyCredential

            return AzureKeyCredential(settings.azure_search_api_key)
        from azure.identity import DefaultAzureCredential

        return DefaultAzureCredential()

    def _azure_client(self):
        # One client per process. SearchClient owns an HTTP connection pool, so building
        # a new one per search meant a new TLS handshake on every question instead of
        # reusing a warm connection.
        if self._client_instance is None:
            with self._client_lock:
                if self._client_instance is None:
                    self._client_instance = self._build_azure_client()
        return self._client_instance

    def reset_client(self) -> None:
        """Drop the cached client. For tests that switch backends mid-process."""
        with self._client_lock:
            self._client_instance = None

    def _build_azure_client(self):
        from azure.search.documents import SearchClient

        if not settings.azure_search_endpoint:
            raise RuntimeError("AZURE_SEARCH_ENDPOINT is required for SEARCH_BACKEND=azure")
        return SearchClient(settings.azure_search_endpoint, settings.azure_search_index, self._azure_credential())

    def ensure_azure_index(self) -> None:
        from azure.search.documents.indexes import SearchIndexClient
        from azure.search.documents.indexes.models import (
            HnswAlgorithmConfiguration,
            SearchableField,
            SearchField,
            SearchFieldDataType,
            SearchIndex,
            SimpleField,
            VectorSearch,
            VectorSearchProfile,
        )

        endpoint = settings.azure_search_endpoint
        if not endpoint:
            raise RuntimeError("AZURE_SEARCH_ENDPOINT is required")
        client = SearchIndexClient(endpoint, self._azure_credential())
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True),
            SimpleField(name="document_id", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="external_document_id", type=SearchFieldDataType.String, filterable=True),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=settings.azure_openai_embedding_dimensions,
                vector_search_profile_name="default-vector-profile",
            ),
            SearchableField(name="title", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="category", type=SearchFieldDataType.String, filterable=True, facetable=True),
            SearchableField(name="section_heading", type=SearchFieldDataType.String),
            SimpleField(name="page_number", type=SearchFieldDataType.Int32),
            SearchField(name="allowed_roles", type=SearchFieldDataType.Collection(SearchFieldDataType.String), filterable=True),
            SimpleField(name="version", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="effective_date", type=SearchFieldDataType.String, filterable=True, sortable=True),
            SimpleField(name="source_url", type=SearchFieldDataType.String),
        ]
        vector_search = VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="default-hnsw")],
            profiles=[VectorSearchProfile(name="default-vector-profile", algorithm_configuration_name="default-hnsw")],
        )
        index = SearchIndex(name=settings.azure_search_index, fields=fields, vector_search=vector_search)
        client.create_or_update_index(index)

    def _azure_upsert(self, rows: list[SearchChunk]) -> None:
        if not rows:
            return
        embeddings = llm_service.embed([r.content for r in rows])
        docs = []
        # strict=True: if the embedding call returns fewer vectors than chunks,
        # a lenient zip silently drops the remainder and those chunks never make
        # it into the index — the policy text is then simply missing from answers,
        # with nothing in the logs. Better to fail the upsert loudly.
        for row, emb in zip(rows, embeddings, strict=True):
            docs.append({
                "id": row.id,
                "document_id": row.document_id,
                "external_document_id": row.external_document_id,
                "content": row.content,
                "content_vector": emb,
                "title": row.title,
                "category": row.category,
                "section_heading": row.section_heading,
                "page_number": row.page_number,
                "allowed_roles": row.allowed_roles,
                "version": row.version,
                "effective_date": row.effective_date.isoformat() if row.effective_date else None,
                "source_url": row.source_url,
            })
        self._azure_client().merge_or_upload_documents(docs)

    def _azure_search(self, query: str, role: str, top_k: int) -> list[dict]:
        from azure.search.documents.models import VectorizedQuery

        # embed_query, not embed: repeat questions reuse the vector instead of paying a
        # round trip to Azure OpenAI. The FAQ list on the home screen makes this common —
        # those questions are clicked, so they arrive byte-identical every time.
        vector = llm_service.embed_query(query)
        vector_query = VectorizedQuery(vector=vector, k_nearest_neighbors=top_k, fields="content_vector")
        filter_expr = None if role == "HRAdmin" else f"allowed_roles/any(r: r eq '{role.replace("'", "''")}')"
        results = self._azure_client().search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            vector_filter_mode="preFilter",
            top=top_k,
            select=[
                "id", "document_id", "external_document_id", "content", "title", "category", "section_heading",
                "page_number", "allowed_roles", "version", "effective_date", "source_url",
            ],
        )
        return [{**dict(r), "score": float(r.get("@search.score") or 0.0)} for r in results]


search_service = SearchService()
