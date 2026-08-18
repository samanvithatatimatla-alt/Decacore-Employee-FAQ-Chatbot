from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..config import settings
from ..models import HRForm
from .form_hints import suggest_form
from .guardrails import (
    UserProfile,
    canned_reply,
    mentions_self,
    only_about_self,
    profile_context,
    profile_reply,
)
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
    # The fillable form this answer points at, if a cited policy names one. Never a
    # citation: forms are not part of the search corpus.
    form: HRForm | None = None
    # Raw backend score alongside the relevance figure in `confidence`. They differ on
    # Azure, where the backend score is RRF and says nothing about relevance — logging
    # both is what makes azure_min_score tunable from real traffic.
    raw_score: float = 0.0
    # True only when retrieval found nothing usable and the reply is NO_MATCH. Sent to
    # the client rather than inferred there: "no citations and an escalation offer" is
    # not the same thing, and inferring it turned a partial answer ("the documents do
    # not include a company overview beyond the leadership team") into a card headed
    # "No approved company policy matched this request".
    no_policy_match: bool = False


# A hit is only cited if it scores at least this fraction of the best hit's score.
# Tuned against the real corpus, where the two failure modes pull in opposite
# directions: 0.7 cut "can I carry over PTO and does parental leave affect accrual"
# down to one source when it genuinely needs the PTO policy too, while 0.5 alone let
# the whole tail through on "bereavement leave". 0.5 plus MAX_CITATIONS covers both —
# the ratio drops the clearly-unrelated, the cap drops the merely-ranked.
CITATION_SCORE_RATIO = 0.5

# Hard ceiling. The ratio handles the usual case; this stops a question whose hits are
# all equally mediocre from footnoting an answer with the entire corpus.
MAX_CITATIONS = 3

# The equivalent ratio for Azure's RRF scores, which sit in a much narrower band —
# measured, an unrelated document still scores ~0.5 of the best, so 0.5 would keep
# everything. At 0.8 the dental question cites one document and the PTO question drops
# the unrelated retirement guide it used to carry.
AZURE_CITATION_RATIO = 0.8


def _relevance(question: str, hit: dict) -> float:
    """Score a hit on the local scorer's scale, whichever backend produced it."""
    if settings.search_backend == "local":
        return float(hit.get("score") or 0.0)
    return relevance_score(question, hit)


def _supporting_hits(question: str, hits: list[dict]) -> list[dict]:
    """The hits worth citing: close to the best one, in the backend's own ranking.

    On Azure the ranking is Azure's, not ours. Re-scoring its results with the keyword
    scorer picked the wrong document outright — "I like dancing, how can the company
    support my hobby" was answered from the Wellness Program, which Azure ranked first,
    while the keyword scorer put the Bereavement policy top on 0.045 against Wellness's
    0.036 and cited that instead. At those values the keyword score is noise. Measured
    over seven questions Azure's own order picked the right document 6/7, the keyword
    re-score 4/7.

    The ratio is tighter here than for local search because RRF scores compress: an
    unrelated hit still lands around 0.5 of the best, where cosine would have collapsed.
    """
    if not hits:
        return []
    if settings.search_backend == "azure":
        best = float(hits[0].get("score") or 0.0)
        if best <= 0:
            return list(hits)
        return [h for h in hits if float(h.get("score") or 0.0) >= best * AZURE_CITATION_RATIO]

    scored = [(_relevance(question, hit), hit) for hit in hits]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    best = scored[0][0]
    floor = max(settings.local_min_score, best * CITATION_SCORE_RATIO)
    return [hit for score, hit in scored if score >= floor]


class RagService:
    def stream(self, db: Session, question: str, role: str, profile: UserProfile | None = None) -> RagStream:
        # Fixed answers from the employee record, used when there is no model to hand
        # the record to. With LLM_BACKEND=azure the same questions take the richer path
        # below instead: the model gets the record as context and answers in any
        # phrasing, including ones these patterns were never written for.
        if settings.llm_backend != "azure":
            mine = profile_reply(question, profile)
            if mine is not None:
                return RagStream(citations=[], confidence=1.0, should_escalate=False, chunks=iter([mine]))

        # Loose, keyword-level check. It only decides whether the model is told who is
        # asking, so over-matching is harmless — see mentions_self().
        #
        # profile_reply is consulted too because the loose check was not a superset of
        # the strict one: "who am i" fails mentions_self but profile_reply answers it,
        # so the record path never ran and the question went to policy search, which
        # replied that the documents do not cover it and cited two unrelated policies.
        about_self = profile is not None and (mentions_self(question) or profile_reply(question, profile) is not None)
        asker = profile_context(profile) if about_self else None

        # The strict patterns answer a narrower question: is this *only* about the
        # asker's record, with no policy component? If so, retrieval has nothing to
        # contribute — skipping it drops an embedding call and a search query, and,
        # more visibly, stops three unrelated policies being cited under "Your role is
        # HR Administrator." Mixed questions ("how much PTO do I get as a manager")
        # match the loose check but not this one, so they keep their citations.
        if asker is not None and (profile_reply(question, profile) is not None or only_about_self(question, profile)):
            return RagStream(
                citations=[],
                confidence=1.0,
                should_escalate=False,
                chunks=llm_service.answer_stream(question, [], asker),
            )

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
            # Score every hit, not just the first. Azure orders by RRF, which ranks hits
            # against each other and does not track how well any of them answers the
            # question — so the chunk that actually holds the answer routinely sits at
            # position 3 or 4 behind a vaguer one. Judging only hits[0] made the app
            # refuse questions the corpus answers ("where do I get my laptop" scored
            # 0.047 at the top and 0.137 further down). Local search already sorts by
            # this exact score, so there hits[0] is the best one anyway.
            relevance = (
                top_score
                if settings.search_backend == "local"
                else max(relevance_score(question, hit) for hit in hits)
            )
            # Two different questions, so two different signals. "Is there anything
            # here worth answering from" is the best hit above. "Was retrieval actually
            # confident" is the top-ranked hit, and when it is weak the answer deserves
            # a Send to HR button next to it even though we do answer.
            leading = top_score if settings.search_backend == "local" else relevance_score(question, hits[0])
            threshold = settings.local_min_score if settings.search_backend == "local" else settings.azure_min_score
            # A question about the asker's own record has no matching policy text by
            # definition, so the relevance floor would escalate every one of them to HR
            # for a fact the app already knows. The model can answer it from `asker`.
            weak = relevance < threshold
            low_confidence = weak and not about_self
            # Retrieval found nothing worth citing, but the record can still answer it.
            from_record_only = weak and about_self
        else:
            relevance = 0.0
            leading = 0.0
            low_confidence = True
            from_record_only = False
        if low_confidence:
            return RagStream(
                citations=[],
                confidence=relevance,
                should_escalate=True,
                no_policy_match=True,
                chunks=iter([NO_MATCH]),
                # No policy matched, but "how do I change my bank account" is still
                # plainly a request for a form. Nothing was cited, so this can only
                # come from the question itself.
                form=suggest_form(db, question, []),
                raw_score=top_score,
            )

        # No citations when the answer comes from the employee record: the retrieved
        # policies scored below the relevance floor, so citing them would footnote an
        # answer about someone's job title with the travel policy.
        #
        # Otherwise, cite what actually supports the answer rather than whatever
        # retrieval happened to return. Two rules:
        #
        #   * a hit has to be in the same league as the best one. Search always returns
        #     its top_k, so a question one policy answers cleanly still came back with
        #     three, and all three were cited — two of them for no reason.
        #   * one chip per document. The old key included section and page, so three
        #     chunks of the same PDF produced three identical-looking chips.
        cited_hits = [] if from_record_only else _supporting_hits(question, hits)
        citations: list[dict] = []
        seen = set()
        for hit in cited_hits:
            key = hit["document_id"]
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
            if len(citations) == MAX_CITATIONS:
                break

        return RagStream(
            citations=citations,
            # Only the hits that actually supported the answer are considered, so a form
            # named in a chunk that was retrieved but not cited is not offered.
            form=suggest_form(db, question, cited_hits),
            confidence=relevance,
            # Answered, but offer HR anyway when retrieval was not confident or nothing
            # was solid enough to cite. Previously this was always False, so a reply
            # that said "I can forward your question to HR" appeared with no button to
            # do it — the employee was told to take an action the screen did not offer.
            # ... except when the answer came from the employee's own record, which is
            # citation-free by design and is not something HR needs to look up.
            should_escalate=(leading < threshold or not citations) and not from_record_only,
            chunks=llm_service.answer_stream(question, hits, asker),
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
