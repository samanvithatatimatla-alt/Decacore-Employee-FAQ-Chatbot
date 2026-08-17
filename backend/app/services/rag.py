from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..config import settings
from .guardrails import UserProfile, canned_reply, profile_reply
from .llm import llm_service
from .search import relevance_score, search_service

NO_MATCH = "I couldn't find this in the approved policy documents. I can help you send the question to HR."


@dataclass
class RagResult:
    answer: str
    citations: list[dict]
    confidence: float
    should_escalate: bool


@dataclass
class RagStream:
    """Everything but the answer text, which is consumed from `chunks`.

    Retrieval finishes before the model starts writing, so citations and confidence
    are already known when the first token goes out. That lets the chat endpoint send
    its `meta` frame immediately instead of holding the connection until the whole
    answer exists.
    """

    citations: list[dict]
    confidence: float
    should_escalate: bool
    chunks: Iterator[str] = field(default_factory=lambda: iter(()))
    # Raw backend score alongside the relevance figure in `confidence`. They differ on
    # Azure, where the backend score is RRF and says nothing about relevance — logging
    # both is what makes azure_min_score tunable from real traffic.
    raw_score: float = 0.0


class RagService:
    def stream(self, db: Session, question: str, role: str, profile: UserProfile | None = None) -> RagStream:
        # "What is my role?" is answered from the asker's own employee record. It is
        # checked before the scope rules so it doesn't get brushed off as small talk,
        # and before search because no policy document contains the answer.
        mine = profile_reply(question, profile)
        if mine is not None:
            return RagStream(citations=[], confidence=1.0, should_escalate=False, chunks=iter([mine]))

        # Greetings, small talk and plainly non-HR asks never reach search or the
        # LLM. Confidence is 1.0 because the reply is exactly right for the message,
        # and no escalation is offered — there is nothing for HR to answer.
        fixed = canned_reply(question)
        if fixed is not None:
            return RagStream(citations=[], confidence=1.0, should_escalate=False, chunks=iter([fixed]))

        hits = search_service.search(db, question, role)
        top_score = float(hits[0]["score"]) if hits else 0.0

        # Both backends get a relevance floor, but they cannot share a number: the local
        # scorer returns cosine similarity, while Azure returns an RRF score that only
        # ranks hits against each other. Azure therefore always came back with something
        # and `not hits` was the only way to fail — which is why the deployed app
        # effectively never offered to send a question to HR. Re-scoring Azure's top hit
        # with the local scorer puts both on the same scale.
        if hits:
            relevance = top_score if settings.search_backend == "local" else relevance_score(question, hits[0])
            threshold = settings.local_min_score if settings.search_backend == "local" else settings.azure_min_score
            low_confidence = relevance < threshold
        else:
            relevance = 0.0
            low_confidence = True
        if low_confidence:
            return RagStream(
                citations=[],
                confidence=relevance,
                should_escalate=True,
                chunks=iter([NO_MATCH]),
                raw_score=top_score,
            )

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

        return RagStream(
            citations=citations,
            confidence=relevance,
            should_escalate=False,
            chunks=llm_service.answer_stream(question, hits),
            raw_score=top_score,
        )

    def answer(self, db: Session, question: str, role: str, profile: UserProfile | None = None) -> RagResult:
        """Blocking form, for callers that want the finished answer in one piece."""
        prepared = self.stream(db, question, role, profile)
        return RagResult(
            answer="".join(prepared.chunks),
            citations=prepared.citations,
            confidence=prepared.confidence,
            should_escalate=prepared.should_escalate,
        )


rag_service = RagService()
