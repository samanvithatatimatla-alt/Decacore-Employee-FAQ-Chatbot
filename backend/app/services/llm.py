from __future__ import annotations

import math
import re

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


class LLMService:
    def _client(self):
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
            response = self._client().chat.completions.create(
                model=settings.azure_openai_chat_deployment,
                messages=messages,
                max_completion_tokens=500,
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
