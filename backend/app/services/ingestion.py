from __future__ import annotations

import io
import re
from dataclasses import dataclass

from pypdf import PdfReader


@dataclass
class Chunk:
    chunk_index: int
    content: str
    section_heading: str
    page_number: int


def extract_pdf_pages(data: bytes) -> list[str]:
    reader = PdfReader(io.BytesIO(data))
    return [(page.extract_text() or "").strip() for page in reader.pages]


def guess_heading(page_text: str, page_number: int) -> str:
    lines = [re.sub(r"\s+", " ", x).strip() for x in page_text.splitlines() if x.strip()]
    for line in lines[:8]:
        if 3 <= len(line) <= 120 and (line.isupper() or re.match(r"^(\d+(?:\.\d+)*)?\s*[A-Z][A-Za-z &/()-]{3,}$", line)):
            return line
    return f"Page {page_number}"


def chunk_pdf(data: bytes, words_per_chunk: int = 450, overlap_ratio: float = 0.15) -> list[Chunk]:
    chunks: list[Chunk] = []
    idx = 0
    overlap = max(1, int(words_per_chunk * overlap_ratio))
    step = max(1, words_per_chunk - overlap)
    for page_number, page_text in enumerate(extract_pdf_pages(data), start=1):
        words = page_text.split()
        if not words:
            continue
        heading = guess_heading(page_text, page_number)
        for start in range(0, len(words), step):
            piece = words[start : start + words_per_chunk]
            if not piece:
                break
            chunks.append(Chunk(idx, " ".join(piece), heading, page_number))
            idx += 1
            if start + words_per_chunk >= len(words):
                break
    return chunks
