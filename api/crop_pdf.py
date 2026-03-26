from __future__ import annotations

import base64
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from io import BytesIO
from typing import List, Optional, Tuple

import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

app = FastAPI(title="YKS Auto Crop API", version="2.0.0")

MAX_PDF_BYTES = 20 * 1024 * 1024
RENDER_ZOOM = 2.3
OCR_RENDER_ZOOM = 2.8
QNUM_RE = re.compile(r"^\s*(\d{1,3})\s*[\.\)]\s*")


@dataclass
class LineRow:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    col: int


@dataclass
class CropSegment:
    bbox: fitz.Rect
    text: str


def _clamp_sensitivity(v: float) -> float:
    return max(0.65, min(1.45, float(v or 1.0)))


def _is_question_start(text: str) -> bool:
    return bool(QNUM_RE.match(text or ""))


def _merge_words_to_lines(words: List[tuple], page_w: float) -> List[LineRow]:
    if not words:
        return []
    # words tuple: (x0,y0,x1,y1,"word", block_no, line_no, word_no)
    words_sorted = sorted(words, key=lambda w: (round(float(w[1]), 1), float(w[0])))
    rows: List[List[tuple]] = []
    y_tol = 3.8
    for w in words_sorted:
        if not rows:
            rows.append([w])
            continue
        last = rows[-1][-1]
        if abs(float(w[1]) - float(last[1])) <= y_tol:
            rows[-1].append(w)
        else:
            rows.append([w])

    merged: List[LineRow] = []
    centers = []
    for r in rows:
        r = sorted(r, key=lambda x: float(x[0]))
        x0 = min(float(x[0]) for x in r)
        y0 = min(float(x[1]) for x in r)
        x1 = max(float(x[2]) for x in r)
        y1 = max(float(x[3]) for x in r)
        txt = " ".join(str(x[4]) for x in r).strip()
        if not txt:
            continue
        centers.append((x0 + x1) * 0.5)
        merged.append(LineRow(text=txt, x0=x0, y0=y0, x1=x1, y1=y1, col=0))

    if not merged:
        return merged

    # lightweight dual-column detection
    med = sorted(centers)[len(centers) // 2]
    left_count = sum(1 for c in centers if c < med - page_w * 0.08)
    right_count = sum(1 for c in centers if c > med + page_w * 0.08)
    is_two_col = left_count > 6 and right_count > 6
    split_x = med
    if is_two_col:
        for row in merged:
            cx = (row.x0 + row.x1) * 0.5
            row.col = 0 if cx <= split_x else 1
    merged.sort(key=lambda r: (r.col, r.y0, r.x0))
    return merged


def _line_intersects(rect: fitz.Rect, line: LineRow) -> bool:
    l = fitz.Rect(line.x0, line.y0, line.x1, line.y1)
    return rect.intersects(l)


def _extract_images_on_page(page: fitz.Page) -> List[fitz.Rect]:
    out = []
    try:
        for img in page.get_images(full=True):
            xref = img[0]
            for r in page.get_image_rects(xref):
                out.append(fitz.Rect(r))
    except Exception:
        return []
    return out


def _segment_page_questions(page: fitz.Page, sensitivity: float) -> List[CropSegment]:
    words = page.get_text("words") or []
    page_rect = page.rect
    lines = _merge_words_to_lines(words, page_rect.width)
    if not lines:
        return []

    images = _extract_images_on_page(page)
    segments: List[CropSegment] = []
    pad_x = 10 + int(16 * (sensitivity - 1.0))
    pad_y = 8 + int(14 * (sensitivity - 1.0))

    for col in (0, 1):
        col_lines = [ln for ln in lines if ln.col == col]
        if not col_lines:
            continue
        starts = [i for i, ln in enumerate(col_lines) if _is_question_start(ln.text)]
        if not starts:
            continue
        starts.append(len(col_lines))
        for si in range(len(starts) - 1):
            a = starts[si]
            b = starts[si + 1]
            block = col_lines[a:b]
            if not block:
                continue
            x0 = min(ln.x0 for ln in block)
            y0 = min(ln.y0 for ln in block)
            x1 = max(ln.x1 for ln in block)
            y1 = max(ln.y1 for ln in block)

            # include images that overlap this question band
            band = fitz.Rect(0, y0, page_rect.width, y1)
            for ir in images:
                if band.intersects(ir):
                    x0 = min(x0, ir.x0)
                    y0 = min(y0, ir.y0)
                    x1 = max(x1, ir.x1)
                    y1 = max(y1, ir.y1)

            rect = fitz.Rect(
                max(page_rect.x0, x0 - pad_x),
                max(page_rect.y0, y0 - pad_y),
                min(page_rect.x1, x1 + pad_x),
                min(page_rect.y1, y1 + pad_y),
            )
            if rect.width < 20 or rect.height < 20:
                continue
            txt = "\n".join(ln.text for ln in block).strip()
            segments.append(CropSegment(bbox=rect, text=txt))

    # reading order: left column top->bottom, then right
    segments.sort(key=lambda s: (0 if s.bbox.x0 < page_rect.width * 0.5 else 1, s.bbox.y0))
    return segments


def _pixmap_to_data_url(pix: fitz.Pixmap) -> str:
    mode = "RGB"
    if pix.n == 4:
        mode = "RGBA"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    if img.mode != "RGB":
        img = img.convert("RGB")
    bio = BytesIO()
    img.save(bio, format="PNG", optimize=True)
    b64 = base64.b64encode(bio.getvalue()).decode("ascii")
    return "data:image/png;base64," + b64


def _ocr_fallback_if_needed(page: fitz.Page, seg: CropSegment) -> str:
    # If digital text exists, use it.
    if seg.text and len(seg.text) >= 18:
        return seg.text
    # OCR optional (server may not have tesseract binary)
    try:
        import pytesseract  # type: ignore
    except Exception:
        return seg.text or ""
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(OCR_RENDER_ZOOM, OCR_RENDER_ZOOM), clip=seg.bbox, alpha=False)
        mode = "RGB" if pix.n == 3 else "RGBA"
        img = Image.frombytes(mode, [pix.width, pix.height], pix.samples).convert("RGB")
        txt = (pytesseract.image_to_string(img, lang="tur+eng") or "").strip()
        if txt:
            return txt
    except Exception:
        pass
    return seg.text or ""


def _heuristic_tag(text: str) -> str:
    t = (text or "").lower()
    rules = [
        (["türev", "limit", "integral"], "Matematik > Türev-İntegral"),
        (["trigonometri", "sin", "cos", "tan"], "Matematik > Trigonometri"),
        (["paragraf", "anlatım", "sözcük"], "Türkçe > Paragraf"),
        (["elektrik", "manyetik", "devre"], "Fizik > Elektrik ve Manyetizma"),
        (["mol", "asit", "baz", "kimya"], "Kimya > Genel Kimya"),
        (["ekosistem", "hücre", "dna"], "Biyoloji > Canlıların Ortak Özellikleri"),
    ]
    for keys, tag in rules:
        if any(k in t for k in keys):
            return tag
    return "Genel > Belirsiz Konu"


def _ai_suggest_tag(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return "Genel > Belirsiz Konu"
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return _heuristic_tag(text)
    prompt = (
        "Sen YKS müfredat uzmanısın. Aşağıdaki soru metni için sadece tek satırda "
        "'Ders > Konu' formatında etiket üret. Ek açıklama yazma.\n\nSoru Metni:\n"
        + text[:2400]
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 60},
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-1.5-flash:generateContent?key="
        + api_key
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        cands = payload.get("candidates") or []
        if cands:
            parts = (((cands[0] or {}).get("content") or {}).get("parts") or [])
            if parts:
                txt = str((parts[0] or {}).get("text") or "").strip()
                if txt:
                    return txt.splitlines()[0][:100]
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        pass
    return _heuristic_tag(text)


@app.post("/")
@app.post("/api/crop_pdf")
async def crop_pdf(
    pdf: UploadFile = File(...),
    sensitivity: float = Form(1.0),
):
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnızca PDF dosyası kabul edilir.")
    content = await pdf.read()
    if not content:
        raise HTTPException(status_code=400, detail="Boş dosya.")
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF boyutu çok büyük.")
    sens = _clamp_sensitivity(sensitivity)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    out = []
    try:
        doc = fitz.open(tmp_path)
        try:
            for page_idx in range(doc.page_count):
                page = doc.load_page(page_idx)
                segments = _segment_page_questions(page, sens)
                for seg_idx, seg in enumerate(segments):
                    pix = page.get_pixmap(
                        matrix=fitz.Matrix(RENDER_ZOOM, RENDER_ZOOM),
                        clip=seg.bbox,
                        alpha=False,
                    )
                    data_url = _pixmap_to_data_url(pix)
                    text = _ocr_fallback_if_needed(page, seg)
                    ai_tag = _ai_suggest_tag(text)
                    out.append(
                        {
                            "page": page_idx + 1,
                            "index": seg_idx + 1,
                            "base64_image": data_url,
                            "ai_suggested_tag": ai_tag,
                        }
                    )
        finally:
            doc.close()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    return JSONResponse({"ok": True, "count": len(out), "questions": out})
