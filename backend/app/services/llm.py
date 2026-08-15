from __future__ import annotations

import math
import re
import threading
from functools import lru_cache

from ..config import settings

CATEGORIES = ["Benefits", "Leave", "Payroll", "Travel", "Insurance", "Reimbursements"]
SYSTEM_PROMPT = """You are the HR assistant for BluePeak Technologies.
Answer only from the policy excerpts supplied in this request.
Use no outside knowledge. If the excerpts do not support an answer, say that the policy documents do not contain the answer and offer to forward the question to HR.
If excerpts conflict, surface the conflict. Prefer a clearly newer effective version when one exists; if precedence is unclear, state both and escalate to HR.
Keep the answer concise, usually two or three short paragraphs. Do not invent policy details.
For questions about a specific individual's pay, performance, medical circumstances, or other private HR record, direct the employee to HR.
"""


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _sentence_score(sentence: str, query_tokens: set[str]) -> float:
    tokens = tokenize(sentence)
    if not tokens:
        return 0.0
    overlap = sum(1 for t in tokens if t in query_tokens)
    return overlap / math.sqrt(len(tokens))


def normalize_query(text: str) -> str:
    """Collapse the differences that should not produce a different embedding."""
    return " ".join(text.split()).lower().rstrip("?.! ")


@lru_cache(maxsize=512)
def _embed_query_cached(normalized: str) -> tuple[float, ...]:
    # Returns a tuple, not a list: the value is handed to every future caller, and one
    # caller mutating a shared list would poison the cache for everyone after it.
    return tuple(llm_service.embed([normalized])[0])


class LLMService:
    def __init__(self):
        self._client_instance = None
        self._client_lock = threading.Lock()

    def _client(self):
        # Built once per process. Each OpenAI() carries its own connection pool, so
        # rebuilding it per call threw away every keep-alive connection and paid a
        # fresh TLS handshake on every chat; in the managed-identity path it also
        # re-ran DefaultAzureCredential discovery each time.
        if self._client_instance is None:
            with self._client_lock:
                if self._client_instance is None:
                    self._client_instance = self._build_client()
        return self._client_instance

    def reset_client(self) -> None:
        """Drop the cached client. For tests that switch backends mid-process."""
        with self._client_lock:
            self._client_instance = None

    def _build_client(self):
        from openai import OpenAI

        if not settings.azure_openai_endpoint or not settings.azure_openai_chat_deployment:
            raise RuntimeError("Azure OpenAI endpoint and chat deployment are required")
        if settings.azure_openai_api_key:
            return OpenAI(
                api_key=settings.azure_openai_api_key,
                base_url=f"{settings.azure_openai_endpoint.rstrip('/')}/openai/v1/",
            )
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider

        token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://ai.azure.com/.default")
        return OpenAI(
            api_key=token_provider,
            base_url=f"{settings.azure_openai_endpoint.rstrip('/')}/openai/v1/",
        )

    def embed(self, texts: list[str]) -> list[list[float]]:
        if settings.llm_backend != "azure":
            raise RuntimeError("Embeddings are only available when LLM_BACKEND=azure")
        if not settings.azure_openai_embedding_deployment:
            raise RuntimeError("AZURE_OPENAI_EMBEDDING_DEPLOYMENT is required")
        response = self._client().embeddings.create(
            model=settings.azure_openai_embedding_deployment,
            input=texts,
            dimensions=settings.azure_openai_embedding_dimensions,
        )
        return [x.embedding for x in response.data]

    def embed_query(self, text: str) -> list[float]:
        """Embed a single search query, reusing the vector for questions already asked.

        Only for queries. Indexing goes through `embed` directly: those texts are large
        and each is seen once, so caching them would evict the queries that do repeat.

        The normalized form is what gets embedded, not just what gets keyed on, so the
        vector for a given question is the same no matter which phrasing arrived first.
        """
        return list(_embed_query_cached(normalize_query(text)))

    def categorize(self, title: str, text: str) -> tuple[str, float]:
        if settings.llm_backend == "azure":
            client = self._client()
            prompt = (
                f"Choose exactly one category from: {', '.join(CATEGORIES)}. "
                "Return only the category name.\n\n"
                f"Title: {title}\n\n{text[:12000]}"
            )
            response = client.responses.create(model=settings.azure_openai_chat_deployment, input=prompt)
            value = (response.output_text or "").strip()
            if value in CATEGORIES:
                return value, 0.90
        hay = f"{title} {text[:5000]}".lower()
        rules = [
            ("Travel", ["travel", "airfare", "lodging", "trip"]),
            ("Reimbursements", ["reimbursement", "expense", "tuition", "learning"]),
            ("Insurance", ["insurance", "health", "dental", "vision", "benefit plan"]),
            ("Payroll", ["payroll", "compensation", "paycheck", "salary", "final pay"]),
            ("Leave", ["leave", "pto", "vacation", "sick", "parental", "bereavement"]),
        ]
        for category, words in rules:
            if any(word in hay for word in words):
                return category, 0.72
        return "Benefits", 0.55

    def answer(self, question: str, hits: list[dict]) -> str:
        if not hits:
            return "I couldn't find this in the approved policy documents. I can help you send the question to HR."
        if settings.llm_backend == "azure":
            excerpts = []
            for i, hit in enumerate(hits, 1):
                label = f"Source {i}: {hit['title']} - {hit.get('section_heading') or 'section'}, p.{hit.get('page_number') or '?'}"
                if hit.get("version"):
                    label += f" ({hit['version']}, effective {hit.get('effective_date') or 'unknown'})"
                excerpts.append(f"[{label}]\n{hit['content']}")
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Question: {question}\n\nContext:\n" + "\n\n".join(excerpts)},
            ]
            # No `temperature`, and `max_completion_tokens` rather than `max_tokens`.
            # The gpt-5 family rejects both of the older forms outright:
            #   max_tokens   -> 400 "Use 'max_completion_tokens' instead"
            #   temperature  -> 400 "Only the default (1) value is supported"
            # Grounding is enforced by SYSTEM_PROMPT and the supplied excerpts rather
            # than by a low temperature, so losing that knob costs little here.
            #
            # The budget is generous because gpt-5 is a reasoning model and
            # max_completion_tokens covers *reasoning plus* visible output. Reasoning
            # scales with how much context is supplied, and with five policy chunks it
            # alone exceeded 500 — the request then succeeds with finish_reason "length"
            # and an empty string, so the bot silently answers nothing.
            # reasoning_effort="minimal" takes a grounded answer from ~120s to a few
            # seconds. The task is extraction and citation from excerpts already
            # supplied, not open-ended problem solving, so the reasoning pass buys
            # nothing and costs the entire response time.
            # Note: this parameter is specific to reasoning models. A non-reasoning
            # deployment (gpt-4o and similar) rejects it.
            response = self._client().chat.completions.create(
                model=settings.azure_openai_chat_deployment,
                messages=messages,
                reasoning_effort="minimal",
                max_completion_tokens=4000,
            )
            return (response.choices[0].message.content or "").strip()

        # Offline fallback: extract the most query-relevant sentences from retrieved policy text.
        q = set(tokenize(question))
        candidates: list[tuple[float, str]] = []
        for hit in hits[:3]:
            for sentence in re.split(r"(?<=[.!?])\s+", hit["content"]):
                sentence = sentence.strip()
                if 25 <= len(sentence) <= 500:
                    candidates.append((_sentence_score(sentence, q), sentence))
        candidates.sort(key=lambda x: x[0], reverse=True)
        chosen: list[str] = []
        seen = set()
        for score, sentence in candidates:
            key = sentence.lower()
            if score <= 0 or key in seen:
                continue
            seen.add(key)
            chosen.append(sentence)
            if len(chosen) == 3:
                break
        if not chosen:
            return "I found related policy material, but not enough to give a reliable answer. I recommend sending this question to HR."
        return " ".join(chosen)


llm_service = LLMService()
