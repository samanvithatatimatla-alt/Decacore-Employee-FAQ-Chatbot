from __future__ import annotations

import io
from datetime import UTC, datetime

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas


def _overlay(width: float, height: float, text: str) -> bytes:
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(width, height))
    c.saveState()
    c.setFillAlpha(0.14)
    c.setFont("Helvetica", 10)
    c.translate(width / 2, height / 2)
    c.rotate(32)
    # Repeat enough times to remain visible even when the page is zoomed/cropped.
    for y in range(-int(height), int(height) + 1, 90):
        c.drawCentredString(0, y, text)
    c.restoreState()
    c.save()
    return stream.getvalue()


def watermark_pdf(data: bytes, viewer_identity: str) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    label = f"BluePeak Confidential | {viewer_identity} | {stamp}"
    for page in reader.pages:
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        overlay_reader = PdfReader(io.BytesIO(_overlay(width, height, label)))
        page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
