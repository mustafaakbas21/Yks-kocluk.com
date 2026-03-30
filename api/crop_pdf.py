from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import statistics
import tempfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional, Set, Tuple

import aiohttp
import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw

app = FastAPI(title="YKS Auto Crop API", version="3.0.0")

MAX_PDF_BYTES = 20 * 1024 * 1024
FALLBACK_DERS = "Tespit Edilemedi"
FALLBACK_KONU = "İnceleme Gerekiyor"
DEFAULT_AI_BATCH_SIZE = 8
DEFAULT_MAX_CONCURRENT_BATCHES = 4
GEMINI_TIMEOUT_SEC = 120
_MUFR_PATH = Path(__file__).resolve().parent / "yks2026_mufredat.json"
_MUFR_CACHE: Optional[Dict[str, Dict[str, List[str]]]] = None
# Yüksek DPI: kesim önizlemesi ve kenar netliği (2.8–3.0 aralığı)
DEFAULT_RENDER_ZOOM = 2.9
OCR_RENDER_ZOOM = 3.0
# Mürekkep analizi için hafif düşük zoom (hız); kesim çıktısı DEFAULT_RENDER_ZOOM ile
INK_ANALYSIS_ZOOM = 2.2
# Soru numarası çapası: 1. 2) 3: 4- … ve Soru 1 / Soru 12 (Unicode tireler dahil)
_NUM_DELIM = r"[\.\):;\-–—]"
QNUM_RE = re.compile(
    rf"^\s*(?:(\d{{1,3}})\s*{_NUM_DELIM}\s*|Soru\s*(\d{{1,3}})\s*{_NUM_DELIM}?\s*)",
    re.I,
)
# Satır başında numara + ayraç + aynı satırda metin (PDF bazen boşluksuz birleştirir)
QNUM_SAMELINE_RE = re.compile(rf"^\s*(\d{{1,3}})\s*{_NUM_DELIM}\s*\S", re.I)
# Parantezli numara: (1) veya [2]
QNUM_PAREN_RE = re.compile(r"^\s*[\(\[]\s*(\d{1,3})\s*[\)\]]\s*" + rf"{_NUM_DELIM}?\s*\S", re.I)
# Soru seçenekleri (satır başı tek şık): A) veya A.
OPTION_LINE_RE = re.compile(r"^\s*([A-E])[\.\)]\s", re.I)
# Tek satırda birden fazla şık (örn. A) ... B) ... E))
OPTION_INLINE_RE = re.compile(r"\b([A-E])[\.\)]\s")
# Büyük dikey boşluk ≈ yeni soru ipucu (satır yüksekliği çarpanı; düşük = daha çok ara sınır)
GAP_QUESTION_MULT = 1.48
# Yakın kesim kutularını birleştir (PDF point; düşük = yalnızca bitişik kutular birleşir, ~5px hissi)
MERGE_SEGMENTS_GAP_PT = 5.0
MERGE_SEGMENTS_X_OVERLAP_FRAC = 0.44
# İki sütun: daha agresif tespit (sağ sütun kaybını azalt)
TWO_COL_MIN_RATIO = 0.048
# Kırpma sonrası ek pay (PDF point; ~10px/kenar hissi — şıklar/çizim taşmasın)
FINAL_PAD_PT = 25.0
GUTTER_PAD_PT = 2.5
# Dar boşlukları soru arası saymak için satır birleştirme toleransı (düşük = daha çok satır)
BASE_LINE_Y_TOL = 2.35
# Rekürsif bölme: alan yüksekliği / sayfa yüksekliği üst sınırı (düşük = daha sık vadiden böl)
OVERSIZE_HEIGHT_FRAC = 0.30
# Aynı sütunda diğer soru kutularına göre “çok uzun” sayılma oranı (2× medyan)
TALL_VS_MEDIAN_MULT = 2.05
# İki soru arası şerit bu kadar “beyaz” ise birleştirme (0–1)
MERGE_GAP_MIN_WHITESPACE = 0.76


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
    t = (text or "").strip()
    if not t:
        return False
    if QNUM_RE.match(t):
        return True
    if QNUM_SAMELINE_RE.match(t):
        return True
    if QNUM_PAREN_RE.match(t):
        return True
    if re.match(r"^\s*Soru\s*\d{1,3}\s*$", t, re.I):
        return True
    # Tam genişlik rakam (bazı yayınevleri)
    if re.match(r"^\s*[０-９]{1,2}\s*[\.\)]\s*\S", t):
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
    thr = max(198, min(250, int(246 - (sensitivity - 1.0) * 20)))
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
    pad = 10.5 + 5.0 * max(0, sensitivity - 0.65)
    merged = _union_rect(inner, ink_rect)
    out = fitz.Rect(
        max(page_rect.x0, merged.x0 - pad),
        max(page_rect.y0, merged.y0 - pad),
        min(page_rect.x1, merged.x1 + pad),
        min(page_rect.y1, merged.y1 + pad),
    )
    if out.width < 12 or out.height < 12:
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
    if min(left, right) < total * TWO_COL_MIN_RATIO:
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


def _merge_words_to_lines(
    words: List[tuple], page_w: float, gap_strictness: float
) -> Tuple[List[LineRow], float, bool]:
    if not words:
        return [], page_w * 0.5, False
    gutter_x, two_col = _detect_gutter_and_mode(words, page_w)
    # words tuple: (x0,y0,x1,y1,"word", block_no, line_no, word_no)
    words_sorted = sorted(words, key=lambda w: (round(float(w[1]), 1), float(w[0])))
    rows: List[List[tuple]] = []
    gs = max(0.55, min(1.65, float(gap_strictness or 1.0)))
    # Düşük gap_strictness → daha sıkı y_tol → daha fazla satır (dar boşlukları kaçırmaz)
    y_tol = max(1.45, BASE_LINE_Y_TOL - (gs - 1.0) * 0.95)
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
            if len(found) >= 2:
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


def _split_block_on_question_headers(block: List[LineRow]) -> List[List[LineRow]]:
    """
    PDF metin katmanında aynı 'soru bloğu'nda birden fazla soru başlığı (3., 4.) varsa
    satırlara göre ayırır — birleşik kırpımları önler.
    """
    if not block:
        return []
    h = [i for i, ln in enumerate(block) if _is_question_start((ln.text or "").strip())]
    if len(h) < 2:
        return [block]
    parts: List[List[LineRow]] = []
    parts.append(block[0 : h[1]])
    for j in range(1, len(h)):
        st = h[j]
        en = h[j + 1] if j + 1 < len(h) else len(block)
        parts.append(block[st:en])
    return [p for p in parts if p]


def _count_question_header_lines(text: str) -> int:
    n = 0
    for line in (text or "").splitlines():
        if _is_question_start(line.strip()):
            n += 1
    return n


def _merged_preview_has_two_question_headers(prev_text: str, next_text: str) -> bool:
    a = (prev_text or "").rstrip()
    b = (next_text or "").lstrip()
    return _count_question_header_lines(a + "\n" + b) >= 2


def _horizontal_gap_whitespace_ratio(
    page: fitz.Page, gap_rect: fitz.Rect, sensitivity: float
) -> float:
    """İki kutu arası şeritte açık renk oranı; yüksek → arada belirgin beyaz boşluk var."""
    page_rect = page.rect
    r = fitz.Rect(
        max(page_rect.x0, gap_rect.x0),
        max(page_rect.y0, gap_rect.y0),
        min(page_rect.x1, gap_rect.x1),
        min(page_rect.y1, gap_rect.y1),
    )
    if r.width < 2 or r.height < 0.35:
        return 0.0
    thr = max(198, min(250, int(246 - (sensitivity - 1.0) * 20)))
    z = min(2.35, max(1.65, INK_ANALYSIS_ZOOM))
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(z, z), clip=r, alpha=False)
    except Exception:
        return 0.0
    mode = "RGB" if pix.n == 3 else "RGBA"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples).convert("L")
    samples = img.getdata()
    n = len(samples)
    if n <= 0:
        return 0.0
    light = sum(1 for p in samples if int(p) >= thr)
    return light / n


def _extract_first_question_number(text: str) -> Optional[int]:
    for line in (text or "").splitlines():
        t = line.strip()
        got = None
        for cre in (QNUM_RE, QNUM_SAMELINE_RE, QNUM_PAREN_RE):
            m = cre.match(t)
            if not m:
                continue
            for g in m.groups():
                if g:
                    try:
                        got = int(g)
                        break
                    except ValueError:
                        pass
            if got is not None:
                return got
        m2 = re.match(r"^\s*Soru\s*(\d{1,3})\s*$", t, re.I)
        if m2:
            try:
                return int(m2.group(1))
            except ValueError:
                continue
    return None


def _median_line_height(col_lines: List[LineRow]) -> float:
    if not col_lines:
        return 11.0
    hs = []
    for ln in col_lines:
        h = float(ln.y1) - float(ln.y0)
        if h > 0.4:
            hs.append(h)
    if not hs:
        return 11.0
    hs.sort()
    return hs[len(hs) // 2]


def _vertical_gap_between_lines(prev: LineRow, cur: LineRow) -> float:
    return float(cur.y0) - float(prev.y1)


def _build_question_starts_for_column(
    col_lines: List[LineRow],
) -> Tuple[List[int], Set[int], Set[int]]:
    """Regex + büyük dikey boşluk ile eksik soru başları. Dönüş: (sıralı başlangıç indeksleri, regex, yalnızca boşluk)."""
    n = len(col_lines)
    if n == 0:
        return [], set(), set()
    regex_starts: Set[int] = {i for i, ln in enumerate(col_lines) if _is_question_start(ln.text)}
    if not regex_starts:
        regex_starts.add(0)
    mh = _median_line_height(col_lines)
    gap_thr = max(5.2, GAP_QUESTION_MULT * mh)
    very_large = max(gap_thr, 2.38 * mh)
    gap_supp: Set[int] = set()
    for i in range(1, n):
        g = _vertical_gap_between_lines(col_lines[i - 1], col_lines[i])
        if g <= gap_thr:
            continue
        t = (col_lines[i].text or "").strip()
        if not t or len(t) < 2:
            continue
        if OPTION_LINE_RE.match(t) and len(t) < 72:
            continue
        numbered = bool(re.match(r"^\s*\d{1,3}\b", t))
        if g < very_large and not numbered:
            continue
        if i not in regex_starts:
            gap_supp.add(i)
    combined: Set[int] = set(regex_starts) | gap_supp
    return sorted(combined), regex_starts, gap_supp


def _merge_crop_segments_reading_order(
    segments: List[CropSegment], page_rect: fitz.Rect, page: fitz.Page, sensitivity: float
) -> List[CropSegment]:
    """Dikeyde bitişik ve yatayda örtüşen kutuları tek soru bloğunda birleştir (ikinci blok soru numarası ile başlamıyorsa)."""
    if len(segments) < 2:
        return segments

    def sort_key(s: CropSegment):
        cx = (s.bbox.x0 + s.bbox.x1) * 0.5
        col = 0 if cx < page_rect.width * 0.5 else 1
        return (col, s.bbox.y0, s.bbox.x0)

    ordered = sorted(segments, key=sort_key)
    out: List[CropSegment] = [ordered[0]]
    for s in ordered[1:]:
        prev = out[-1]
        pb, sb = prev.bbox, s.bbox
        dy = sb.y0 - pb.y1
        if dy > MERGE_SEGMENTS_GAP_PT:
            out.append(s)
            continue
        ow, sw = pb.width, sb.width
        xmin, xmax = max(pb.x0, sb.x0), min(pb.x1, sb.x1)
        overlap = max(0.0, xmax - xmin)
        minw = max(18.0, min(ow, sw) * MERGE_SEGMENTS_X_OVERLAP_FRAC)
        if overlap < minw:
            out.append(s)
            continue
        first_ln = (s.text or "").split("\n", 1)[0].strip()
        if _is_question_start(first_ln):
            out.append(s)
            continue
        merged_txt_preview = (prev.text or "").rstrip() + "\n" + (s.text or "").lstrip()
        if _merged_preview_has_two_question_headers(prev.text or "", s.text or ""):
            out.append(s)
            continue
        if dy > 0.4:
            gap_r = fitz.Rect(xmin, pb.y1, xmax, sb.y0)
            if gap_r.height >= 0.55:
                ws = _horizontal_gap_whitespace_ratio(page, gap_r, sensitivity)
                if ws >= MERGE_GAP_MIN_WHITESPACE:
                    out.append(s)
                    continue
        merged = _union_rect(pb, sb)
        out[-1] = CropSegment(bbox=merged, text=merged_txt_preview)
    return out


def _render_debug_overlay(
    page: fitz.Page,
    page_rect: fitz.Rect,
    lines: List[LineRow],
    gutter_x: float,
    two_col: bool,
    per_line_flags: List[Tuple[bool, bool]],
    segments: List[CropSegment],
) -> str:
    """PIL ile hata ayıklama: satırlar mavi, regex başlangıç yeşil, gap tamamlama turkuaz, kabul kutuları yeşil dolu, gutter mor."""
    z = 1.45
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
    except Exception:
        return ""
    mode = "RGB" if pix.n == 3 else "RGBA"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples).convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")

    def tx(rect: fitz.Rect) -> Tuple[float, float, float, float]:
        return (
            max(0, (rect.x0 - page_rect.x0) * z),
            max(0, (rect.y0 - page_rect.y0) * z),
            max(0, (rect.x1 - page_rect.x0) * z),
            max(0, (rect.y1 - page_rect.y0) * z),
        )

    gx0 = (gutter_x - page_rect.x0) * z
    if two_col and 0 < gx0 < pix.width:
        draw.line([(gx0, 0), (gx0, pix.height)], fill=(200, 100, 255, 220), width=2)

    for i, ln in enumerate(lines):
        rx = fitz.Rect(ln.x0, ln.y0, ln.x1, ln.y1)
        box = tx(rx)
        reg, gap = per_line_flags[i] if i < len(per_line_flags) else (False, False)
        if reg:
            draw.rectangle(box, outline=(0, 200, 80, 255), width=3)
        elif gap:
            draw.rectangle(box, outline=(0, 180, 200, 255), width=2)
        else:
            draw.rectangle(box, outline=(80, 80, 255, 160), width=1)
        # Kırpılmaya girmeyen uzun satırlar (olmaması gereken 'yetim' metin) — kırmızı ince
        if not reg and not gap and len((ln.text or "").strip()) >= 10:
            cx = (ln.x0 + ln.x1) * 0.5
            cy = (ln.y0 + ln.y1) * 0.5
            in_seg = any(seg.bbox.contains(fitz.Point(cx, cy)) for seg in segments)
            if not in_seg:
                draw.rectangle(box, outline=(220, 50, 50, 230), width=2)

    for seg in segments:
        box = tx(seg.bbox)
        draw.rectangle(box, outline=(0, 160, 0, 255), width=4)
        draw.rectangle(
            (box[0] + 2, box[1] + 2, box[2] - 2, box[3] - 2),
            fill=(0, 220, 100, 38),
        )

    bio = BytesIO()
    img.save(bio, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(bio.getvalue()).decode("ascii")


def _split_rect_by_horizontal_valley(
    page: fitz.Page, rect: fitz.Rect, sensitivity: float, gap_strictness: float
) -> Optional[Tuple[fitz.Rect, fitz.Rect]]:
    """Bitişik iki soru için yatay mürekkep projeksiyonu ile bölme."""
    page_rect = page.rect
    if rect.height < page_rect.height * 0.14:
        return None
    z = 2.05
    thr = max(200, min(250, int(242 - (sensitivity - 1.0) * 22)))
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(z, z), clip=rect, alpha=False)
    except Exception:
        return None
    mode = "RGB" if pix.n == 3 else "RGBA"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    gray = img.convert("L")
    bw = gray.point(lambda p: 0 if p <= thr else 255)
    w, h = bw.size
    if h < 16 or w < 16:
        return None
    row_ink: List[float] = []
    for y in range(h):
        row = bw.crop((0, y, w, y + 1))
        vals = row.getdata()
        ink = sum(1 for v in vals if v == 0)
        row_ink.append(ink / max(1, w))
    gs = max(0.55, min(1.65, float(gap_strictness or 1.0)))
    lo = int(h * (0.2 + 0.06 * (1.15 - gs)))
    hi = int(h * (0.8 - 0.06 * (1.15 - gs)))
    lo = max(2, min(lo, h - 4))
    hi = max(lo + 3, min(hi, h - 2))
    sub = row_ink[lo:hi]
    if not sub:
        return None
    j_rel = sub.index(min(sub))
    j = lo + j_rel
    gap_score = row_ink[j]
    # Daha agresif: daha yüksek mürekkep yoğunluğu dahi “vadide böl” kabul edilir
    if gap_score > 0.074 + 0.026 * max(0.0, gs - 0.85):
        return None
    y_doc = rect.y0 + j / z
    if y_doc - rect.y0 < 12 or rect.y1 - y_doc < 12:
        return None
    r1 = fitz.Rect(rect.x0, rect.y0, rect.x1, y_doc)
    r2 = fitz.Rect(rect.x0, y_doc, rect.x1, rect.y1)
    return (r1, r2)


def _segment_page_questions(
    page: fitz.Page,
    sensitivity: float,
    gap_strictness: float,
    recursive_split: bool,
    debug: bool = False,
) -> Tuple[List[CropSegment], Optional[str]]:
    words = page.get_text("words") or []
    page_rect = page.rect
    lines, gutter_x, two_col = _merge_words_to_lines(words, page_rect.width, gap_strictness)
    if not lines:
        return [], None

    line_regex = [False] * len(lines)
    line_gap = [False] * len(lines)

    images = _extract_images_on_page(page)
    segments: List[CropSegment] = []
    pad_x = 18 + int(16 * (sensitivity - 1.0))
    pad_y = 16 + int(14 * (sensitivity - 1.0))
    col_heights: Dict[int, List[float]] = {0: [], 1: []}

    cols_to_scan: Tuple[int, ...] = (0, 1) if two_col else (0,)

    for col in cols_to_scan:
        col_pairs = [(gi, ln) for gi, ln in enumerate(lines) if ln.col == col]
        if not col_pairs:
            continue
        gidx = [p[0] for p in col_pairs]
        col_lines = [p[1] for p in col_pairs]
        x_min_c, x_max_c = _column_x_bounds(page_rect, col, gutter_x, two_col)
        starts, regex_loc, gap_loc = _build_question_starts_for_column(col_lines)
        for li in regex_loc:
            if li < len(gidx):
                line_regex[gidx[li]] = True
        for li in gap_loc:
            if li < len(gidx):
                line_gap[gidx[li]] = True
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
            block_fragments = _split_block_on_question_headers(block)
            for block in block_fragments:
                if not block:
                    continue
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
                emit_blocks: List[List[LineRow]] = [block]
                ch = col_heights[col]
                med_col = statistics.median(ch) if len(ch) >= 2 else None
                tall_vs_page = inner.height > page_rect.height * OVERSIZE_HEIGHT_FRAC
                tall_vs_others = (
                    med_col is not None and inner.height > TALL_VS_MEDIAN_MULT * med_col
                )
                if (
                    recursive_split
                    and inner.height > page_rect.height * 0.10
                    and (tall_vs_page or tall_vs_others)
                ):
                    sp = _split_rect_by_horizontal_valley(page, inner, sensitivity, gap_strictness)
                    if sp is not None:
                        r1, r2 = sp
                        sy = (r1.y1 + r2.y0) * 0.5
                        part_a = [ln for ln in block if (ln.y0 + ln.y1) * 0.5 < sy]
                        part_b = [ln for ln in block if (ln.y0 + ln.y1) * 0.5 >= sy]
                        if len(part_a) >= 1 and len(part_b) >= 1:
                            emit_blocks = [part_a, part_b]

                for sub_block in emit_blocks:
                    sx0 = max(x_min_c, min(ln.x0 for ln in sub_block))
                    sy0 = min(ln.y0 for ln in sub_block)
                    sx1 = min(x_max_c, max(ln.x1 for ln in sub_block))
                    sy1 = max(ln.y1 for ln in sub_block)
                    s_band = fitz.Rect(x_min_c, sy0, x_max_c, sy1)
                    for ir in images:
                        if s_band.intersects(ir):
                            ix0 = max(x_min_c, ir.x0)
                            ix1 = min(x_max_c, ir.x1)
                            if ix1 <= ix0:
                                continue
                            sx0 = min(sx0, ix0)
                            sy0 = min(sy0, ir.y0)
                            sx1 = max(sx1, ix1)
                            sy1 = max(sy1, ir.y1)
                    sinner = fitz.Rect(sx0, sy0, sx1, sy1)
                    refined = _refine_bbox_ink(page, sinner, sensitivity)
                    if refined is not None:
                        rect = refined
                    else:
                        rect = fitz.Rect(
                            max(page_rect.x0, sx0 - pad_x),
                            max(page_rect.y0, sy0 - pad_y),
                            min(page_rect.x1, sx1 + pad_x),
                            min(page_rect.y1, sy1 + pad_y),
                        )
                    rect = _clip_rect_to_column(rect, page_rect, col, gutter_x, two_col)
                    rect = _apply_final_padding(rect, page_rect)
                    rect = fitz.Rect(
                        max(rect.x0, page_rect.x0),
                        max(rect.y0, page_rect.y0),
                        min(rect.x1, page_rect.x1),
                        min(rect.y1, page_rect.y1),
                    )
                    if rect.width < 14 or rect.height < 14:
                        continue
                    txt = "\n".join(ln.text for ln in sub_block).strip()
                    segments.append(CropSegment(bbox=rect, text=txt))
                    col_heights[col].append(float(rect.height))

    segments.sort(
        key=lambda s: (
            0 if (s.bbox.x0 + s.bbox.x1) * 0.5 < page_rect.width * 0.5 else 1,
            s.bbox.y0,
        )
    )
    segments = _merge_crop_segments_reading_order(segments, page_rect, page, sensitivity)

    dbg_img: Optional[str] = None
    if debug:
        flags = [(line_regex[i], line_gap[i]) for i in range(len(lines))]
        dbg_img = _render_debug_overlay(page, page_rect, lines, gutter_x, two_col, flags, segments)

    return segments, dbg_img


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


def _load_yks_mufredat() -> Dict[str, Dict[str, List[str]]]:
    global _MUFR_CACHE
    if _MUFR_CACHE is not None:
        return _MUFR_CACHE
    if not _MUFR_PATH.is_file():
        _MUFR_CACHE = {"TYT": {}, "AYT": {}, "YDT": {}}
        return _MUFR_CACHE
    with _MUFR_PATH.open(encoding="utf-8") as f:
        _MUFR_CACHE = json.load(f)
    return _MUFR_CACHE


def _normalize_exam_key(raw: str) -> str:
    e = (raw or "").strip().upper()
    if e in ("LGS", "TYT"):
        return "TYT"
    if e in ("SAY", "SÖZ", "SOZ", "EA", "EŞİT", "ESIT"):
        return "AYT"
    if e in ("DİL", "DIL"):
        return "YDT"
    if e not in ("TYT", "AYT", "YDT"):
        return "TYT"
    return e


def _gemini_batch_response_schema(batch_len: int) -> Dict[str, Any]:
    return {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "slot": {
                    "type": "INTEGER",
                    "description": f"1 ile {batch_len} arası; görsel sırasıyla aynı.",
                },
                "ders": {"type": "STRING"},
                "konu": {"type": "STRING"},
                "confidence": {"type": "NUMBER"},
                "readable": {"type": "BOOLEAN"},
            },
            "required": ["slot", "ders", "konu", "confidence", "readable"],
        },
    }


def _validate_ders_konu(
    exam: str,
    ders: str,
    konu: str,
    confidence: Any,
    readable: bool,
    mufredat: Dict[str, Dict[str, List[str]]],
) -> Tuple[str, str]:
    bag = mufredat.get(exam) or {}
    try:
        conf = float(confidence)
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    if not readable or conf < 0.42:
        return FALLBACK_DERS, FALLBACK_KONU
    d = (ders or "").strip()
    k = (konu or "").strip()
    if d == FALLBACK_DERS or k == FALLBACK_KONU:
        return FALLBACK_DERS, FALLBACK_KONU
    if d not in bag:
        return FALLBACK_DERS, FALLBACK_KONU
    topics = bag[d]
    if k not in topics:
        return FALLBACK_DERS, FALLBACK_KONU
    return d, k


def parse_answer_key_from_text(raw: str) -> Dict[int, str]:
    """1-A, 2.B, 3C, 12: D vb. → soru_no → A..E."""
    if not raw or not str(raw).strip():
        return {}
    text = str(raw).replace("\r\n", "\n")
    out: Dict[int, str] = {}
    patterns = [
        re.compile(r"(?:^|[\s;,|])(\d{1,3})\s*[\.\-–—:]\s*([A-Ea-e])(?=\s|$|[\s;,|])"),
        re.compile(r"(?:^|[\s;,|])(\d{1,3})\s{0,2}([A-Ea-e])(?=\s|$|[\s;,|]|$)"),
    ]
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        for pat in patterns:
            for m in pat.finditer(line):
                try:
                    n = int(m.group(1))
                    letter = m.group(2).upper()
                except (ValueError, IndexError):
                    continue
                if 1 <= n <= 200 and letter in "ABCDE":
                    out[n] = letter
    return out


def extract_text_from_pdf_bytes(content: bytes) -> str:
    if not content:
        return ""
    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception:
        return ""
    try:
        parts: List[str] = []
        for i in range(doc.page_count):
            try:
                page = doc.load_page(i)
                t = (page.get_text("text") or "").strip()
                if t:
                    parts.append(t)
            except Exception:
                continue
        return "\n".join(parts)
    finally:
        try:
            doc.close()
        except Exception:
            pass


def merge_answer_key_into_questions(questions: List[dict], key_map: Dict[int, str]) -> None:
    if not key_map:
        return
    for q in questions:
        qn = q.get("detected_qnum")
        idx = q.get("index")
        ans = None
        if isinstance(qn, int) and qn in key_map:
            ans = key_map[qn]
        elif isinstance(idx, int) and idx in key_map:
            ans = key_map[idx]
        if ans is not None:
            q["correct_answer"] = ans


def _strip_data_url(b64_or_data_url: str) -> str:
    s = (b64_or_data_url or "").strip()
    if s.startswith("data:") and "base64," in s:
        return s.split("base64,", 1)[-1].strip()
    return s


def _build_system_instruction(exam: str, mufredat_subset: Dict[str, Any]) -> str:
    payload = json.dumps(mufredat_subset, ensure_ascii=False, indent=2)
    return (
        "Sen uzman bir YKS öğretmenisin. Sana verilen soru görsellerini ve isteğe bağlı PDF metin "
        "parçalarını analiz et.\n"
        f"Sınav bağlamı: {exam}.\n\n"
        "KURALLAR:\n"
        "1) DERS ve KONU alanlarında SADECE VE SADECE aşağıdaki JSON müfredatındaki birebir "
        "ders adları ve o derse ait konu adlarını kullan.\n"
        "2) Listede olmayan hiçbir ders veya konu adı uydurma; kısaltma / eşanlamlı kullanma.\n"
        "3) Görsel veya metin okunamıyorsa veya emin değilsen: ders için tam olarak "
        f'"{FALLBACK_DERS}", konu için tam olarak "{FALLBACK_KONU}" yaz.\n'
        "4) readable=false ise bu iki yedek dizeyi kullan.\n"
        "5) confidence: 0 ile 1 arası tahmin güvenin.\n"
        "6) Yanıtın yalnızca şema ile uyumlu JSON olmalı; açıklama veya markdown yok.\n\n"
        "MÜFREDAT (JSON):\n"
        f"{payload}"
    )


async def _gemini_post(session: aiohttp.ClientSession, url: str, body: Dict[str, Any]) -> Optional[str]:
    try:
        async with session.post(
            url,
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=aiohttp.ClientTimeout(total=GEMINI_TIMEOUT_SEC),
        ) as resp:
            txt = await resp.text()
            if resp.status != 200:
                return None
            payload = json.loads(txt)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
        return None
    cands = payload.get("candidates") or []
    if not cands:
        return None
    prts = (((cands[0] or {}).get("content") or {}).get("parts") or [])
    if not prts:
        return None
    return str((prts[0] or {}).get("text") or "").strip()


async def _gemini_classify_batch(
    session: aiohttp.ClientSession,
    api_key: str,
    model: str,
    exam: str,
    mufredat_subset: Dict[str, Any],
    batch: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    n = len(batch)
    if n == 0:
        return []
    sys_txt = _build_system_instruction(exam, mufredat_subset)
    parts: List[Dict[str, Any]] = [
        {
            "text": (
                f"Bu istekte {n} soru var. Görsellerin sırasıyla aynı sırada tek bir JSON dizisi döndür.\n"
                f"Her öğe: slot (1..{n}, sıraya uygun), ders, konu, confidence, readable.\n"
            )
        }
    ]
    for i, it in enumerate(batch):
        parts.append({"text": f"--- Soru {i + 1}/{n} (batch slot {i + 1}) ---"})
        dqn = it.get("detected_qnum")
        if dqn is not None:
            parts.append({"text": f"PDF metin katmanından soru numarası ipucu: {dqn}"})
        b64 = _strip_data_url(str(it.get("png_b64") or ""))
        if b64:
            parts.append({"inlineData": {"mimeType": "image/png", "data": b64}})
        te = (it.get("text") or "").strip()
        if te:
            parts.append({"text": "PDF metin (yedek, kısaltılmış):\n" + te[:1800]})
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    body: Dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": sys_txt}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.05,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
            "responseSchema": _gemini_batch_response_schema(n),
        },
    }
    out_txt = await _gemini_post(session, url, body)
    parsed: Optional[List[Any]] = None
    if out_txt:
        try:
            parsed = json.loads(out_txt)
        except ValueError:
            parsed = None
    if not isinstance(parsed, list) or len(parsed) != n:
        gen = dict(body.get("generationConfig") or {})
        gen.pop("responseSchema", None)
        body_retry = {**body, "generationConfig": gen}
        out_txt2 = await _gemini_post(session, url, body_retry)
        if out_txt2:
            try:
                parsed = json.loads(out_txt2)
            except ValueError:
                parsed = None
    if not isinstance(parsed, list):
        return [
            {
                "slot": i + 1,
                "ders": FALLBACK_DERS,
                "konu": FALLBACK_KONU,
                "confidence": 0.0,
                "readable": False,
            }
            for i in range(n)
        ]
    by_slot: Dict[int, Dict[str, Any]] = {}
    for row in parsed:
        if not isinstance(row, dict):
            continue
        try:
            sl = int(row.get("slot"))
        except (TypeError, ValueError):
            continue
        by_slot[sl] = row
    rows: List[Dict[str, Any]] = []
    for i in range(n):
        r = by_slot.get(i + 1) or {}
        try:
            conf = float(r.get("confidence", 0.0))
        except (TypeError, ValueError):
            conf = 0.0
        rows.append(
            {
                "slot": i + 1,
                "ders": r.get("ders"),
                "konu": r.get("konu"),
                "confidence": conf,
                "readable": bool(r.get("readable", False)),
            }
        )
    return rows


async def _classify_questions_gemini_batched(
    exam: str,
    work_items: List[Dict[str, Any]],
    batch_size: int,
    max_concurrent_batches: int,
) -> List[Dict[str, Any]]:
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    model = (os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash").strip()
    mufredat = _load_yks_mufredat()
    exam_k = _normalize_exam_key(exam)
    subset: Dict[str, Any] = {exam_k: mufredat.get(exam_k) or {}}
    if not api_key:
        return [
            {
                "ders": FALLBACK_DERS,
                "konu": FALLBACK_KONU,
                "confidence": 0.0,
                "readable": False,
            }
            for _ in work_items
        ]
    bs = max(1, min(16, int(batch_size or DEFAULT_AI_BATCH_SIZE)))
    concurrent = max(1, min(12, int(max_concurrent_batches or DEFAULT_MAX_CONCURRENT_BATCHES)))
    batches: List[List[Dict[str, Any]]] = []
    for i in range(0, len(work_items), bs):
        batches.append(work_items[i : i + bs])

    sess_timeout = aiohttp.ClientTimeout(total=GEMINI_TIMEOUT_SEC + 60)
    async with aiohttp.ClientSession(timeout=sess_timeout) as session:
        sem = asyncio.Semaphore(concurrent)

        async def guarded(b: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            async with sem:
                return await _gemini_classify_batch(session, api_key, model, exam_k, subset, b)

        chunk_results = await asyncio.gather(*(guarded(b) for b in batches))
    flat_ai: List[Dict[str, Any]] = []
    for chunk in chunk_results:
        flat_ai.extend(chunk)
    while len(flat_ai) < len(work_items):
        flat_ai.append(
            {"ders": FALLBACK_DERS, "konu": FALLBACK_KONU, "confidence": 0.0, "readable": False}
        )
    return flat_ai[: len(work_items)]


@app.post("/")
@app.post("/api/crop_pdf")
async def crop_pdf(
    pdf: UploadFile = File(...),
    sensitivity: float = Form(1.0),
    render_scale: float = Form(DEFAULT_RENDER_ZOOM),
    gap_strictness: float = Form(1.0),
    recursive_split: str = Form("1"),
    debug: str = Form("0"),
    exam_type: str = Form("TYT"),
    ai_batch_size: int = Form(DEFAULT_AI_BATCH_SIZE),
    ai_max_concurrent_batches: int = Form(DEFAULT_MAX_CONCURRENT_BATCHES),
    answer_key_text: str = Form(""),
    answer_key_pdf: Annotated[Optional[UploadFile], File()] = None,
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
    gap_gs = max(0.55, min(1.65, float(gap_strictness or 1.0)))
    recursive_on = str(recursive_split or "1").strip().lower() not in ("0", "false", "off", "")
    debug_on = str(debug or "0").strip().lower() in ("1", "true", "yes", "on")
    exam_k = _normalize_exam_key(exam_type)
    mufredat = _load_yks_mufredat()

    key_map: Dict[int, str] = {}
    if (answer_key_text or "").strip():
        key_map.update(parse_answer_key_from_text(answer_key_text))
    if answer_key_pdf is not None and (answer_key_pdf.filename or "").strip():
        ak_name = (answer_key_pdf.filename or "").lower()
        ak_bytes = await answer_key_pdf.read()
        if ak_name.endswith(".pdf") and ak_bytes:
            if len(ak_bytes) > MAX_PDF_BYTES:
                raise HTTPException(status_code=413, detail="Cevap anahtarı PDF çok büyük.")
            key_map.update(parse_answer_key_from_text(extract_text_from_pdf_bytes(ak_bytes)))

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    out: List[dict] = []
    work_for_ai: List[Dict[str, Any]] = []
    debug_pages: List[dict] = []
    try:
        doc = fitz.open(tmp_path)
        try:
            for page_idx in range(doc.page_count):
                page = doc.load_page(page_idx)
                segments, dbg_png = _segment_page_questions(
                    page, sens, gap_gs, recursive_on, debug_on
                )
                if debug_on and dbg_png:
                    debug_pages.append({"page": page_idx + 1, "overlay_base64": dbg_png})
                await asyncio.sleep(0)
                for seg_idx, seg in enumerate(segments):
                    pix = page.get_pixmap(
                        matrix=fitz.Matrix(render_zoom, render_zoom),
                        clip=seg.bbox,
                        alpha=False,
                    )
                    data_url = _pixmap_to_data_url(pix)
                    text = _ocr_fallback_if_needed(page, seg)
                    qn = _extract_first_question_number(text)
                    raw_png = _strip_data_url(data_url)
                    work_for_ai.append(
                        {
                            "png_b64": raw_png,
                            "text": text,
                            "detected_qnum": qn,
                        }
                    )
                    out.append(
                        {
                            "page": page_idx + 1,
                            "index": len(out) + 1,
                            "segment_on_page": seg_idx + 1,
                            "base64_image": data_url,
                            "detected_qnum": qn,
                            "question_text_excerpt": (text or "")[:800],
                        }
                    )
        finally:
            doc.close()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    ai_rows = await _classify_questions_gemini_batched(
        exam_k, work_for_ai, ai_batch_size, ai_max_concurrent_batches
    )
    for q, ai in zip(out, ai_rows):
        ders, konu = _validate_ders_konu(
            exam_k,
            str(ai.get("ders") or ""),
            str(ai.get("konu") or ""),
            ai.get("confidence"),
            bool(ai.get("readable")),
            mufredat,
        )
        q["ders"] = ders
        q["konu"] = konu
        q["ai_confidence"] = float(ai.get("confidence") or 0.0)
        q["ai_readable"] = bool(ai.get("readable"))
        q["ai_suggested_tag"] = f"{ders} > {konu}"

    merge_answer_key_into_questions(out, key_map)

    payload: dict = {
        "ok": True,
        "count": len(out),
        "exam_type": exam_k,
        "questions": out,
        "answer_key_parsed_count": len(key_map),
    }
    if debug_on:
        payload["debug_pages"] = debug_pages
    return JSONResponse(payload)
