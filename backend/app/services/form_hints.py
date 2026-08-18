"""Point an answer at the form it tells the employee to fill in.

A form is never a citation — it lives in its own table, is never chunked and never
indexed, so a blank leave-request PDF cannot turn up as the source of a policy
answer. This module is the other half of that separation: the answer still needs a
way to say "and here is the form", without the form pretending to be a source.

Two ways a form gets attached, in order of trust:

  * grounded — a policy the answer actually cited names the form, by the form's own
    title ("submit the Leave Request Form") or by the code in its filename
    ("Use Form LND-301"). The suggestion then comes from the corpus rather than from
    guessing at the question.
  * intent — nothing cited a form, but the question is plainly asking for one. This
    compares the question against each form's name using embeddings, the same vectors
    search already uses.

Neither path holds a list of phrases. An earlier version did, and it matched 0 of 10
natural rephrasings: "my paycheck is going to the wrong account" shares no words with
"Direct Deposit Authorization Form", so any lexical scheme misses it and a curated
list only works for people who guess the phrasing it was written for. Embeddings put
those two a short distance apart without anyone writing the connection down, and a
form added later is covered the moment it is uploaded.
"""

from __future__ import annotations

import logging
import math
import re
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import HRForm
from .llm import llm_service
from .search import local_score

logger = logging.getLogger("decacore")

# Whether to offer a form at all is a question about the *shape* of the ask, not its
# topic. Measuring proved it: "how much vacation do I get" and "I want to book a
# holiday" are near-identical topically — cosine 0.345 vs 0.218 against the Leave
# Request Form, the wrong way round — so no similarity threshold separates them. What
# does separate them is whether the employee wants to DO something or to KNOW
# something. On 12 transactional and 11 informational questions this matched 12/12
# with no false alarms, where similarity alone could not be thresholded at all.
WANTS_TO_ACT = re.compile(
    r"\bhow\s+(do|can|would)\s+i\b|\bwhere\s+do\s+i\b|\bwhat\s+(form|paperwork)\b"
    r"|\bi\s+(want|need|would\s+like|have)\s+to\b|\bi\s+need\b|\bi'?d\s+like\b"
    r"|\bcan\s+i\s+(get|request|submit|change|update|add|book|take|claim|apply)\b"
    r"|\b(request|submit|apply\s+for|sign\s+up|enroll|claim|fill\s+(in|out))\b"
    r"|\bi\s+(moved|forgot|broke)\b"
    r"|\b(broke|is\s+going\s+to\s+the\s+wrong|went\s+to\s+the\s+wrong)\b",
    re.I,
)

# Once the shape gate has decided a form belongs, similarity only has to rank the
# forms against each other, so this floor is deliberately low — it exists to stop a
# transactional question about something with no form at all ("how do I appeal a
# performance review") from dragging in whichever form ranked least badly.
MIN_SIMILARITY = 0.15

_vectors: dict[str, list[float]] = {}
_vectors_key: tuple[str, ...] = ()
_lock = threading.Lock()


def describe(form: HRForm) -> str:
    """What the form is, as a sentence to embed. Title plus category is all the row
    holds, and it is enough: the title of a form is a description of its purpose."""
    return f"{form.title}. {form.category}" if form.category else form.title


def _title_variants(form: HRForm) -> list[str]:
    """Ways a policy might name this form.

    Derived from the row, never hand-listed. "Benefits Enrollment / Change Form"
    yields both "benefits enrollment form" and "benefits change form", because a
    policy writes one branch of the slash, not the slash itself.
    """
    title = form.title.lower().strip()
    variants = {title}
    if "/" in title:
        head, _, tail = title.partition("/")
        head, tail = head.strip(), tail.strip()
        # "benefits enrollment / change form" -> "benefits enrollment form"
        suffix = tail.split()[-1] if tail else ""
        if head and suffix:
            variants.add(f"{head} {suffix}")
        if tail:
            lead = head.split()[0] if head else ""
            variants.add(f"{lead} {tail}".strip())
    # The form code, when the filename carries one ("..._LND-301.pdf").
    code = re.search(r"[A-Z]{2,4}-\d{3}", form.filename or "")
    if code:
        variants.add(code.group(0).lower())
    return [v for v in variants if len(v) > 4]


def _form_vectors(forms: list[HRForm]) -> dict[str, list[float]]:
    """Embed every form name once per process, refreshed if the set changes."""
    global _vectors, _vectors_key
    key = tuple(sorted(f"{f.id}:{f.title}" for f in forms))
    if key == _vectors_key and _vectors:
        return _vectors
    with _lock:
        if key == _vectors_key and _vectors:
            return _vectors
        vectors = llm_service.embed([describe(f) for f in forms])
        _vectors = {f.id: v for f, v in zip(forms, vectors, strict=True)}
        _vectors_key = key
    return _vectors


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _by_intent(forms: list[HRForm], question: str, cited_hits: list[dict]) -> HRForm | None:
    """Which form the question is reaching for.

    Retrieval has already decided what the question is about, so the categories of the
    documents behind the answer narrow the field before similarity ranks it. "I want to
    book a holiday" cites the PTO policy, filed under Leave and Attendance, which is
    also the Leave Request Form's category — a hint no amount of embedding the phrase
    "book a holiday" against a three-word form title would supply.
    """
    cited_categories = {(hit.get("category") or "").lower() for hit in cited_hits}
    cited_categories.discard("")
    if cited_categories:
        narrowed = [f for f in forms if (f.category or "").lower() in cited_categories]
        # Only narrow when it leaves something; a question can cite a policy whose
        # category has no form at all.
        forms = narrowed or forms
    if settings.llm_backend == "azure":
        try:
            vectors = _form_vectors(forms)
            asked = llm_service.embed_query(question)
            scored = [(_cosine(asked, vectors[f.id]), f) for f in forms if f.id in vectors]
            if scored:
                score, form = max(scored, key=lambda pair: pair[0])
                return form if score >= MIN_SIMILARITY else None
            return None
        except Exception:
            # A form chip is a convenience; never fail an answer over one. Falls
            # through to the lexical path, which needs nothing but the question.
            logger.warning("form embedding lookup failed, falling back to lexical", exc_info=True)

    scored = [(local_score(question, describe(f)), f) for f in forms]
    if not scored:
        return None
    score, form = max(scored, key=lambda pair: pair[0])
    return form if score > 0 else None


def suggest_form(db: Session | None, question: str, cited_hits: list[dict]) -> HRForm | None:
    """The form this answer should offer, or None.

    `cited_hits` are the excerpts actually behind the answer, not everything retrieval
    returned — a form mentioned in a chunk that did not support the answer has no
    business being suggested.
    """
    # No session means no form table to read — callers that stub retrieval (and the
    # tests that exercise citation rules) legitimately pass none.
    if db is None:
        return None
    forms = list(db.scalars(select(HRForm)))
    # A form with no file behind it would send the employee to a dead download.
    forms = [f for f in forms if f.blob_path]
    if not forms:
        return None

    # Whether to offer a form is decided before which one. A policy names its form in
    # passing — the bereavement policy mentions the Leave Request Form — so without
    # this, "how many days off if my parent dies" arrives with a form attached to an
    # answer that is purely informational.
    if not WANTS_TO_ACT.search(question):
        return None

    cited_text = " ".join((hit.get("content") or "") for hit in cited_hits).lower()
    if cited_text:
        for form in forms:
            if any(variant in cited_text for variant in _title_variants(form)):
                return form

    # Nothing cited a form by name, so rank the forms against the question itself.
    return _by_intent(forms, question, cited_hits)


def form_payload(form: HRForm | None) -> dict | None:
    """The shape the chat stream sends. `mode` mirrors the client's FormRef union."""
    if form is None:
        return None
    return {
        "mode": "resources",
        "form_id": form.id,
        "title": form.title,
        "available": bool(form.blob_path),
    }
