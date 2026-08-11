from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..config import settings
from .llm import llm_service
from .search import search_service


@dataclass
class RagResult:
    answer: str
    citations: list[dict]
    confidence: float
    should_escalate: bool


class RagService:
    def answer(self, db: Session, question: str, role: str) -> RagResult:
        hits = search_service.search(db, question, role)
        top_score = float(hits[0]["score"]) if hits else 0.0
        low_confidence = not hits or (settings.search_backend == "local" and top_score < settings.local_min_score)
        if low_confidence:
            return RagResult(
                answer="I couldn't find this in the approved policy documents. I can help you send the question to HR.",
                citations=[],
                confidence=top_score,
                should_escalate=True,
            )
        answer = llm_service.answer(question, hits)
        citations = []
        seen = set()
        for hit in hits:
            key = (hit["document_id"], hit.get("section_heading"), hit.get("page_number"))
            if key in seen:
                continue
            seen.add(key)
            citations.append({
                "document_id": hit["document_id"],
                "external_document_id": hit.get("external_document_id"),
                "title": hit["title"],
                "section": hit.get("section_heading"),
                "page": hit.get("page_number"),
                "version": hit.get("version"),
                "effective_date": hit.get("effective_date"),
                "source_url": hit.get("source_url"),
            })
            if len(citations) == 3:
                break
        return RagResult(answer=answer, citations=citations, confidence=top_score, should_escalate=False)


rag_service = RagService()
