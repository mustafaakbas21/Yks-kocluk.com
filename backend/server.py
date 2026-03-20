"""
FastAPI: PDF sayfalarını görüntüye çevirip OpenCV ile dikey blok (soru) bölgelerini kestirir.
"""

from __future__ import annotations

import base64
import io
import uuid
from typing import Any

import cv2
import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# Yüksek çözünürlük için yakınlaştırma (2.0 ≈ ~144 DPI kaynak boyutuna göre değişir)
RENDER_ZOOM = 2.0

app = FastAPI(title="YKS Test PDF Soru Ayıklama API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _page_to_bgr(page: fitz.Page, zoom: float) -> np.ndarray:
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    h, w = pix.height, pix.width
    n = pix.n
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(h, w, n)
    if n == 4:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
    elif n == 3:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    elif n == 1:
        arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    return arr


def _preprocess_binary(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(
        blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    h, w = binary.shape
    # Satırları yatayda birleştir (kelimeleri aynı satırda tut)
    kh = max(24, min(w // 25, 120))
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kh, 1))
    merged = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, horiz_kernel, iterations=1)
    # Yakın satırları dikeyde birleştir (soru içi satır aralığı)
    kv = max(8, min(h // 80, 28))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kv))
    merged = cv2.dilate(merged, vert_kernel, iterations=1)
    return merged


def _row_bands_from_binary(binary: np.ndarray, min_row_fraction: float = 0.015) -> list[tuple[int, int]]:
    """Satır yoğunluğuna göre ardışık satır bantlarını bulur."""
    h, w = binary.shape
    row_density = np.sum(binary > 0, axis=1).astype(np.float32)
    thresh = max(8.0, w * min_row_fraction)
    mask = row_density > thresh
    bands: list[tuple[int, int]] = []
    i = 0
    while i < h:
        if not mask[i]:
            i += 1
            continue
        y0 = i
        while i < h and mask[i]:
            i += 1
        y1 = i - 1
        bands.append((y0, y1))
    return bands


def _merge_bands_into_blocks(
    bands: list[tuple[int, int]],
    page_h: int,
) -> list[tuple[int, int]]:
    """Geniş dikey boşluklarda bantları ayırarak soru blokları üretir."""
    if not bands:
        return []
    gaps: list[int] = []
    for i in range(len(bands) - 1):
        g = bands[i + 1][0] - bands[i][1] - 1
        gaps.append(max(0, g))
    if gaps:
        mg = float(np.median(gaps)) if gaps else 0.0
        split = max(18.0, mg * 1.8, page_h * 0.012)
    else:
        split = max(18.0, page_h * 0.012)

    blocks: list[tuple[int, int]] = []
    cur_start, cur_end = bands[0]
    for i in range(len(bands) - 1):
        gap = bands[i + 1][0] - bands[i][1] - 1
        if gap > split:
            blocks.append((cur_start, cur_end))
            cur_start, cur_end = bands[i + 1]
        else:
            cur_end = bands[i + 1][1]
    blocks.append((cur_start, cur_end))
    return blocks


def _x_extent_for_band(binary: np.ndarray, y0: int, y1: int) -> tuple[int, int]:
    roi = binary[y0 : y1 + 1, :]
    cols = np.any(roi > 0, axis=0)
    if not np.any(cols):
        return 0, binary.shape[1] - 1
    xs = np.where(cols)[0]
    return int(xs.min()), int(xs.max())


def _extract_question_boxes(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """(x, y, w, h) OpenCV crop formatında, yukarıdan aşağıya sıralı kutular."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    binary = _preprocess_binary(gray)
    h, w = binary.shape
    bands = _row_bands_from_binary(binary)
    blocks = _merge_bands_into_blocks(bands, h)

    pad_x = max(4, w // 200)
    pad_y = max(4, h // 200)
    min_h = max(20, h // 80)

    boxes: list[tuple[int, int, int, int]] = []
    for y0, y1 in blocks:
        bh = y1 - y0 + 1
        if bh < min_h:
            continue
        x0, x1 = _x_extent_for_band(binary, y0, y1)
        if x1 <= x0:
            continue
        x0 = max(0, x0 - pad_x)
        x1 = min(w - 1, x1 + pad_x)
        y0p = max(0, y0 - pad_y)
        y1p = min(h - 1, y1 + pad_y)
        cw = x1 - x0 + 1
        ch = y1p - y0p + 1
        if cw < 20 or ch < min_h:
            continue
        boxes.append((x0, y0p, cw, ch))

    boxes.sort(key=lambda b: b[1])
    return boxes


def _bgr_to_jpeg_data_url(img: np.ndarray, quality: int = 90) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("JPEG encode başarısız")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Sadece .pdf dosyası kabul edilir.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Boş dosya.")

    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"PDF açılamadı: {e!s}") from e

    questions: list[dict[str, Any]] = []
    try:
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            bgr = _page_to_bgr(page, RENDER_ZOOM)
            boxes = _extract_question_boxes(bgr)
            page_no = page_index + 1
            for x, y, w, h in boxes:
                crop = bgr[y : y + h, x : x + w]
                if crop.size == 0:
                    continue
                data_url = _bgr_to_jpeg_data_url(crop)
                questions.append(
                    {
                        "id": uuid.uuid4().hex[:12],
                        "image_base64": data_url,
                        "page": page_no,
                    }
                )
    finally:
        doc.close()

    return {"success": True, "questions": questions}


def create_app() -> FastAPI:
    return app
