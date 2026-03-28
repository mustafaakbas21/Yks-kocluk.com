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

app = FastAPI(title="YKS Auto Crop API", version="2.1.0")

MAX_PDF_BYTES = 20 * 1024 * 1024
# Yüksek DPI: kesim önizlemesi ve kenar netliği (2.8–3.0 aralığı)
DEFAULT_RENDER_ZOOM = 2.9
OCR_RENDER_ZOOM = 3.0
# Mürekkep analizi için hafif düşük zoom (hız); kesim çıktısı DEFAULT_RENDER_ZOOM ile
INK_ANALYSIS_ZOOM = 2.2
# Soru numarası çapası: 1. 2) 3: 4- … ve Soru 1 / Soru 12
QNUM_RE = re.compile(r"^\s*(?:(\d{1,3})\s*[\.\):\-]\s+|Soru\s*(\d{1,3})\s*[\.\):\-]?\s*)", re.I)
# Soru seçenekleri (satır başı tek şık)
OPTION_LINE_RE = re.compile(r"^\s*([A-E])\)\s", re.I)
# Tek satırda birden fazla şık (örn. A) ... B) ... E))
OPTION_INLINE_RE = re.compile(r"\b([A-E])\)\s")
# Kırpma sonrası homojen beyaz boşluk (PDF point ≈ 15px ekran görünümü)
FINAL_PAD_PT = 15.0
GUTTER_PAD_PT = 2.5


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
    t = text or ""
    if QNUM_RE.match(t):
        return True
    # Bazı PDF'lerde numara satır dışında kısa başlık
    if re.match(r"^\s*Soru\s*\d{1,3}\s*$", t, re.I):
        return True
    return False


def _union_rect(a: fitz.Rect, b: fitz.Rect) -> fitz.Rect:
    return fitz.Rect(
        min(a.x0, b.x0),
        min(a.y0, b.y0),
        max(a.x1, b.x1),
        max(a.y1, b.y1),
    )


def _clamp_render_zoom(v: float) -> float:
    return max(2.0, min(3.25, float(v or DEFAULT_RENDER_ZOOM)))


def _refine_bbox_ink(page: fitz.Page, inner: fitz.Rect, sensitivity: float) -> Optional[fitz.Rect]:
    """
    Metin kutusunu mürekkep projeksiyonu ile sıkılaştırır; metin katmanı ile birleştirir.
    Açık arka planlı PDF'lerde koyu piksel eşiği ile daha temiz kesim.
    """
    page_rect = page.rect
    thr = max(205, min(250, int(246 - (sensitivity - 1.0) * 22)))
    z = float(INK_ANALYSIS_ZOOM)
    margin = 16 + int(12 * max(0, sensitivity - 0.75))
    search = fitz.Rect(
        max(page_rect.x0, inner.x0 - margin),
        max(page_rect.y0, inner.y0 - margin),
        min(page_rect.x1, inner.x1 + margin),
        min(page_rect.y1, inner.y1 + margin),
    )
    if search.width < 6 or search.height < 6:
        return None
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(z, z), clip=search, alpha=False)
    except Exception:
        return None
    mode = "RGB" if pix.n == 3 else "RGBA"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    gray = img.convert("L")
    bw = gray.point(lambda p: 255 if p <= thr else 0)
    bbox = bw.getbbox()
    if not bbox:
        return None
    x0p, y0p, x1p, y1p = bbox
    rx0 = search.x0 + x0p / z
    ry0 = search.y0 + y0p / z
    rx1 = search.x0 + x1p / z
    ry1 = search.y0 + y1p / z
    ink_rect = fitz.Rect(rx0, ry0, rx1, ry1)
    pad = 4.5 + 5.0 * max(0, sensitivity - 0.65)
    merged = _union_rect(inner, ink_rect)
    out = fitz.Rect(
        max(page_rect.x0, merged.x0 - pad),
        max(page_rect.y0, merged.y0 - pad),
        min(page_rect.x1, merged.x1 + pad),
        min(page_rect.y1, merged.y1 + pad),
    )
    if out.width < 18 or out.height < 18:
        return None
    return out


def _detect_gutter_and_mode(words: List[tuple], page_w: float) -> Tuple[float, bool]:
    """Ortadaki dikey boşluğu (gutter) bulur; tek sütunsa two_col=False."""
    if not words or page_w < 1:
        return page_w * 0.5, False
    bins = 56
    hist = [0] * bins
    for w in words:
        cx = (float(w[0]) + float(w[2])) * 0.5
        i = int(cx / page_w * bins)
        i = max(0, min(bins - 1, i))
        hist[i] += 1
    left = sum(hist[: bins // 2])
    right = sum(hist[bins // 2 :])
    total = left + right
    if total < 4:
        return page_w * 0.5, False
    if min(left, right) < total * 0.11:
        return page_w * 0.5, False
    lo = int(bins * 0.25)
    hi = int(bins * 0.75)
    best_i = (lo + hi) // 2
    best_v = 10**9
    for i in range(lo, hi):
        if hist[i] < best_v:
            best_v = hist[i]
            best_i = i
    gutter = (best_i + 0.5) / bins * page_w
    return gutter, True


def _merge_words_to_lines(words: List[tuple], page_w: float) -> Tuple[List[LineRow], float, bool]:
    if not words:
        return [], page_w * 0.5, False
    gutter_x, two_col = _detect_gutter_and_mode(words, page_w)
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
    for r in rows:
        r = sorted(r, key=lambda x: float(x[0]))
        x0 = min(float(x[0]) for x in r)
        y0 = min(float(x[1]) for x in r)
        x1 = max(float(x[2]) for x in r)
        y1 = max(float(x[3]) for x in r)
        txt = " ".join(str(x[4]) for x in r).strip()
        if not txt:
            continue
        cx = (x0 + x1) * 0.5
        col = 0
        if two_col:
            col = 0 if cx < gutter_x else 1
        merged.append(LineRow(text=txt, x0=x0, y0=y0, x1=x1, y1=y1, col=col))

    merged.sort(key=lambda r: (r.col, r.y0, r.x0))
    return merged, gutter_x, two_col


def _column_x_bounds(page_rect: fitz.Rect, col: int, gutter_x: float, two_col: bool) -> Tuple[float, float]:
    if not two_col:
        return page_rect.x0, page_rect.x1
    if col == 0:
        return page_rect.x0, min(page_rect.x1, gutter_x - GUTTER_PAD_PT)
    return max(page_rect.x0, gutter_x + GUTTER_PAD_PT), page_rect.x1


def _clip_rect_to_column(rect: fitz.Rect, page_rect: fitz.Rect, col: int, gutter_x: float, two_col: bool) -> fitz.Rect:
    x0, x1 = _column_x_bounds(page_rect, col, gutter_x, two_col)
    return fitz.Rect(
        max(rect.x0, x0),
        max(rect.y0, page_rect.y0),
        min(rect.x1, x1),
        min(rect.y1, page_rect.y1),
    )


def _last_option_line_index(lines: List[LineRow]) -> Optional[int]:
    idxs: List[int] = []
    for i, ln in enumerate(lines):
        t = (ln.text or "").strip()
        if OPTION_LINE_RE.match(t):
            idxs.append(i)
            continue
        if len(t) < 420:
            found = OPTION_INLINE_RE.findall(t)
            if len(found) >= 3:
                idxs.append(i)
    if not idxs:
        return None
    return max(idxs)


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
    lines, gutter_x, two_col = _merge_words_to_lines(words, page_rect.width)
    if not lines:
        return []

    images = _extract_images_on_page(page)
    segments: List[CropSegment] = []
    pad_x = 10 + int(16 * (sensitivity - 1.0))
    pad_y = 8 + int(14 * (sensitivity - 1.0))

    cols_to_scan = (0, 1) if two_col else (0,)

    for col in cols_to_scan:
        col_lines = [ln for ln in lines if ln.col == col]
        if not col_lines:
            continue
        x_min_c, x_max_c = _column_x_bounds(page_rect, col, gutter_x, two_col)
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
            opt_end = _last_option_line_index(block)
            if opt_end is not None:
                block = block[: opt_end + 1]
            # Sütun içi yatay sınırlar (komşu sütun metnini dışarıda bırak)
            x0 = max(x_min_c, min(ln.x0 for ln in block))
            y0 = min(ln.y0 for ln in block)
            x1 = min(x_max_c, max(ln.x1 for ln in block))
            y1 = max(ln.y1 for ln in block)

            band = fitz.Rect(x_min_c, y0, x_max_c, y1)
            for ir in images:
                if band.intersects(ir):
                    ix0 = max(x_min_c, ir.x0)
                    ix1 = min(x_max_c, ir.x1)
                    if ix1 <= ix0:
                        continue
                    x0 = min(x0, ix0)
                    y0 = min(y0, ir.y0)
                    x1 = max(x1, ix1)
                    y1 = max(y1, ir.y1)

            inner = fitz.Rect(x0, y0, x1, y1)
            refined = _refine_bbox_ink(page, inner, sensitivity)
            if refined is not None:
                rect = refined
            else:
                rect = fitz.Rect(
                    max(page_rect.x0, x0 - pad_x),
                    max(page_rect.y0, y0 - pad_y),
                    min(page_rect.x1, x1 + pad_x),
                    min(page_rect.y1, y1 + pad_y),
                )
            rect = _clip_rect_to_column(rect, page_rect, col, gutter_x, two_col)
            rect = _apply_final_padding(rect, page_rect)
            rect = fitz.Rect(
                max(rect.x0, page_rect.x0),
                max(rect.y0, page_rect.y0),
                min(rect.x1, page_rect.x1),
                min(rect.y1, page_rect.y1),
            )
            if rect.width < 20 or rect.height < 20:
                continue
            txt = "\n".join(ln.text for ln in block).strip()
            segments.append(CropSegment(bbox=rect, text=txt))

    segments.sort(
        key=lambda s: (
            0 if (s.bbox.x0 + s.bbox.x1) * 0.5 < page_rect.width * 0.5 else 1,
            s.bbox.y0,
        )
    )
    return segments


def _apply_final_padding(rect: fitz.Rect, page_rect: fitz.Rect) -> fitz.Rect:
    return fitz.Rect(
        max(page_rect.x0, rect.x0 - FINAL_PAD_PT),
        max(page_rect.y0, rect.y0 - FINAL_PAD_PT),
        min(page_rect.x1, rect.x1 + FINAL_PAD_PT),
        min(page_rect.y1, rect.y1 + FINAL_PAD_PT),
    )


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
        (["türev", "limit", "integral"], "AYT Matematik > Türev ve İntegral"),
        (["trigonometri", "sin", "cos", "tan"], "AYT Matematik > Trigonometri"),
        (["paragraf", "anlatım", "sözcük"], "TYT Türkçe > Paragrafta Anlam"),
        (["elektrik", "manyetik", "devre"], "TYT Fizik > Elektrik ve Elektronik"),
        (["mol", "asit", "baz"], "TYT Kimya > Mol Kavramı"),
        (["ekosistem", "hücre", "dna"], "TYT Biyoloji > Hücre"),
    ]
    for keys, tag in rules:
        if any(k in t for k in keys):
            return tag
    return "TYT Matematik > Genel"


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
    render_scale: float = Form(DEFAULT_RENDER_ZOOM),
):
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnızca PDF dosyası kabul edilir.")
    content = await pdf.read()
    if not content:
        raise HTTPException(status_code=400, detail="Boş dosya.")
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF boyutu çok büyük.")
    sens = _clamp_sensitivity(sensitivity)
    render_zoom = _clamp_render_zoom(render_scale)

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
                        matrix=fitz.Matrix(render_zoom, render_zoom),
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
