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


# Running headers and footers repeated on every page. They look exactly like a
# heading to the scan below - short, capitalised, near the top - so without this
# every chunk in the corpus is labelled "BLUEPEAK TECHNOLOGIES" and citations
# point at the letterhead instead of the section the answer came from.
BOILERPLATE = re.compile(
    r"""^(
        BLUEPEAK\ TECHNOLOGIES(\s+.*)?      # letterhead, with or without a trailing title
      | Employee\ (Knowledge\ Base|Forms\ and\ Resources)
      | Internal\s*\|.*                     # "Internal | BPT-HR-PTO-001 | v3.0"
      | Page\ \d+(\ of\ \d+)?
      | Contents | Quick\ Answers
      | Document\ purpose\..*
      | .*\|\s*BPT-[A-Z-]+\d+.*             # footer carrying the document id
    )$""",
    re.IGNORECASE | re.VERBOSE,
)

# "5. Carryover and Maximum Balance", "13.1 How many days do I receive?"
NUMBERED_HEADING = re.compile(r"^\d+(?:\.\d+)*\.?\s+\S.{2,110}$")


def guess_heading(page_text: str, page_number: int) -> str:
    lines = [re.sub(r"\s+", " ", x).strip() for x in page_text.splitlines() if x.strip()]
    candidates = [x for x in lines[:12] if not BOILERPLATE.match(x)]
    # A numbered section heading is the real thing wherever one exists; prefer it
    # over a bare capitalised line, which is often just an emphasised sentence.
    for line in candidates:
        if NUMBERED_HEADING.match(line) and not line.endswith("."):
            return line
    for line in candidates[:8]:
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
