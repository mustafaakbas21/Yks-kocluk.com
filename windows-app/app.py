"""
Mustafa Akbaş Otonom Kırpma Portalı — Windows masaüstü (CustomTkinter).
İnternet gerektirmez. Kesilen sorular SoruHavuzu/ altına PNG olarak kaydedilir.
"""

from __future__ import annotations

import json
import os
import sys
import tkinter as tk
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from tkinter import filedialog, messagebox
from typing import Any, Callable, Optional

import cv2
import customtkinter as ctk
import fitz
import numpy as np
from PIL import Image, ImageTk

try:
    import windnd

    _HAS_WINDND = True
except ImportError:
    _HAS_WINDND = False

# --- OpenCV: otonom soru blokları (backend/server.py ile uyumlu) -----------------

RENDER_ZOOM = 2.0


def _preprocess_binary(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = binary.shape
    kh = max(24, min(w // 25, 120))
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kh, 1))
    merged = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, horiz_kernel, iterations=1)
    kv = max(8, min(h // 80, 28))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kv))
    merged = cv2.dilate(merged, vert_kernel, iterations=1)
    return merged


def _row_bands_from_binary(binary: np.ndarray, min_row_fraction: float = 0.015) -> list[tuple[int, int]]:
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


def _merge_bands_into_blocks(bands: list[tuple[int, int]], page_h: int) -> list[tuple[int, int]]:
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


def _x_extent_vertical_projection_trim(binary: np.ndarray, y0: int, y1: int, x0: int, x1: int) -> tuple[int, int]:
    """Dikey projeksiyonla sol/sağdaki düşük yoğunluklu sütunları budar (gürültü ayırma)."""
    hh, ww = binary.shape
    y0 = max(0, y0)
    y1 = min(hh - 1, y1)
    x0 = max(0, x0)
    x1 = min(ww - 1, x1)
    roi = binary[y0 : y1 + 1, x0 : x1 + 1]
    if roi.size == 0:
        return x0, x1
    col_sum = np.sum(roi > 0, axis=0).astype(np.float32)
    peak = float(np.max(col_sum)) if col_sum.size else 0.0
    thresh = max(2.0, peak * 0.07)
    idx = np.where(col_sum >= thresh)[0]
    if idx.size == 0:
        return x0, x1
    return x0 + int(idx[0]), x0 + int(idx[-1])


def _strip_fullwidth_rule_rows(binary: np.ndarray, frac: float = 0.88) -> np.ndarray:
    """Neredeyse tüm satırı kaplayan yatay çizgileri (ayraç) maskeleyerek blokları ayırır."""
    out = binary.copy()
    hh, ww = out.shape
    if ww < 20:
        return out
    row_s = np.sum(out > 0, axis=1)
    for y in range(hh):
        if row_s[y] > frac * ww:
            out[y, :] = 0
    return out


def _filter_question_boxes(
    boxes: list[tuple[int, int, int, int]],
    pw: int,
    ph: int,
) -> list[tuple[int, int, int, int]]:
    """Sayfa numarası / dipnot (çok küçük) ve tam sayfa (çok büyük) kutularını ele."""
    page_area = max(1, pw * ph)
    out: list[tuple[int, int, int, int]] = []
    for x, y, bw, bh in boxes:
        area = bw * bh
        if area < max(600, page_area * 0.00035):
            continue
        if area > page_area * 0.9:
            continue
        if bw > int(pw * 0.96) and bh > int(ph * 0.88):
            continue
        if bh < max(24, int(ph * 0.016)):
            continue
        if bw < int(pw * 0.05) and bh < int(ph * 0.04):
            continue
        if bw < int(pw * 0.07) and bh < int(ph * 0.06) and area < page_area * 0.012:
            continue
        out.append((x, y, bw, bh))
    return out


def extract_question_boxes(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    binary = _preprocess_binary(gray)
    binary = _strip_fullwidth_rule_rows(binary)
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
        x0, x1 = _x_extent_vertical_projection_trim(binary, y0, y1, x0, x1)
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
    boxes = _filter_question_boxes(boxes, w, h)
    boxes.sort(key=lambda b: b[1])
    return boxes


def _gaussian_smooth_1d(arr: np.ndarray, sigma: float) -> np.ndarray:
    if arr.size < 3:
        return arr.astype(np.float64)
    sigma = max(0.5, float(sigma))
    k = int(max(3, round(6 * sigma)) | 1)
    x = np.arange(k, dtype=np.float64) - (k // 2)
    kernel = np.exp(-(x**2) / (2 * sigma * sigma))
    kernel /= np.sum(kernel)
    return np.convolve(arr.astype(np.float64), kernel, mode="same")


def _preprocess_binary_v2(gray: np.ndarray) -> np.ndarray:
    """v2: satırları birbirine yapıştırmak için daha hafif dikey genişleme (soru blokları ayrı kalır)."""
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = binary.shape
    kh = max(18, min(w // 28, 96))
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kh, 1))
    merged = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, horiz_kernel, iterations=1)
    kv = max(3, min(h // 140, 10))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kv))
    merged = cv2.dilate(merged, vert_kernel, iterations=1)
    return merged


def _content_y_bounds(row_density: np.ndarray, h: int) -> tuple[int, int]:
    peak = float(np.max(row_density)) if row_density.size else 1.0
    t = max(6.0, 0.035 * peak)
    rows = np.where(row_density > t)[0]
    if rows.size == 0:
        return 0, h - 1
    return int(rows[0]), int(rows[-1])


def _vertical_gap_split_y(
    prof: np.ndarray,
    y0: int,
    y1: int,
    page_h: int,
    min_gap_override: Optional[int] = None,
) -> list[int]:
    """Beyaz bantların bittiği satır (bir sonraki sorunun başlangıcı) = ayırıcı y."""
    sub = prof[y0 : y1 + 1].copy()
    if sub.size < 8:
        return []
    peak = float(np.max(sub))
    if peak < 1e-6:
        return []
    split_thresh = max(0.08 * peak, 0.12 * float(np.median(sub[sub > 0]) or peak * 0.1))
    min_gap = min_gap_override if min_gap_override is not None else max(10, page_h // 55)
    is_low = sub < split_thresh
    split_starts: list[int] = []
    i = 0
    while i < len(is_low):
        if not is_low[i]:
            i += 1
            continue
        j = i
        while j < len(is_low) and is_low[j]:
            j += 1
        run = j - i
        if run >= min_gap:
            split_starts.append(y0 + j)
        i = j
    return split_starts


def _merge_close_splits(splits: list[int], min_dist: int) -> list[int]:
    if not splits:
        return []
    splits = sorted(splits)
    out = [splits[0]]
    for s in splits[1:]:
        if s - out[-1] >= min_dist:
            out.append(s)
        else:
            out[-1] = (out[-1] + s) // 2
    return out


def _y_boundaries_from_splits(y0: int, y1: int, split_starts: list[int]) -> list[tuple[int, int]]:
    """split_starts: her beyaz banttan sonraki ilk mürekkep satırı (mutlak y)."""
    if not split_starts:
        return [(y0, y1)]
    b = [y0] + sorted(s for s in split_starts if y0 < s <= y1) + [y1 + 1]
    segs: list[tuple[int, int]] = []
    for k in range(len(b) - 1):
        a0, a1 = b[k], b[k + 1] - 1
        if a1 >= a0:
            segs.append((a0, a1))
    return segs if segs else [(y0, y1)]


def _equal_y_splits(y0: int, y1: int, n: int) -> list[tuple[int, int]]:
    if n <= 1:
        return [(y0, y1)]
    h = y1 - y0 + 1
    step = h / n
    segs: list[tuple[int, int]] = []
    for i in range(n):
        sy0 = y0 + int(round(i * step))
        sy1 = y0 + int(round((i + 1) * step)) - 1
        sy1 = min(y1, max(sy0, sy1))
        if sy1 - sy0 >= 6:
            segs.append((sy0, sy1))
    return segs if segs else [(y0, y1)]


def _infer_target_question_count(ch: int, page_h: int, prof_slice: np.ndarray) -> int:
    """Bölge yüksekliği + yumuşak profil çukurlarından tahmini soru sayısı (1..15)."""
    est_h = max(page_h * 0.085, 48.0)
    n_from_h = int(round(max(1, ch) / est_h))
    n_from_h = max(1, min(15, n_from_h))
    sub = prof_slice
    peak = float(np.max(sub)) if sub.size else 1.0
    deep = 0
    win = max(5, ch // 40)
    for y in range(win, len(sub) - win):
        local = sub[y - win : y + win + 1]
        if sub[y] <= np.min(local) + 1e-6 and sub[y] < 0.35 * peak:
            deep += 1
    n_from_valleys = max(1, min(15, deep // 2 + 1))
    return max(n_from_h, n_from_valleys)


def _column_split_x(binary: np.ndarray, y0: int, y1: int) -> Optional[int]:
    """Orta bölgede belirgin dikey boşluk varsa iki sütun kabul et."""
    h, w = binary.shape
    if w < 280 or y1 <= y0 + 20:
        return None
    roi = binary[y0 : y1 + 1, :]
    col_s = np.sum(roi > 0, axis=0).astype(np.float64)
    mx = float(np.max(col_s)) if col_s.size else 1.0
    if mx < 10:
        return None
    lo, hi = int(w * 0.33), int(w * 0.67)
    seg = col_s[lo:hi]
    if seg.size < 5:
        return None
    rel = int(lo + np.argmin(seg))
    if col_s[rel] < 0.22 * mx and col_s[rel] < 0.38 * float(np.percentile(col_s, 92)):
        return rel
    return None


def _deep_split_segments(
    prof: np.ndarray,
    y0c: int,
    segs: list[tuple[int, int]],
    page_h: int,
    min_h: int,
) -> list[tuple[int, int]]:
    """Çok yüksek tek parçaları profildeki en derin çukurdan bir kez böler."""
    out: list[tuple[int, int]] = []
    for ys, ye in segs:
        rel0, rel1 = ys - y0c, ye - y0c
        if rel1 < rel0 or rel0 < 0 or rel1 >= len(prof):
            out.append((ys, ye))
            continue
        sub = prof[rel0 : rel1 + 1]
        seg_h = ye - ys + 1
        if seg_h < max(min_h * 3, int(page_h * 0.36)):
            out.append((ys, ye))
            continue
        idx = int(np.argmin(sub))
        gmin = float(sub[idx])
        m = float(np.mean(sub)) + 1e-6
        if gmin > 0.52 * m or gmin > 0.33 * float(np.max(prof) + 1e-6):
            out.append((ys, ye))
            continue
        mid = ys + idx
        if mid - ys >= min_h and ye - mid >= min_h:
            out.append((ys, mid - 1))
            out.append((mid, ye))
        else:
            out.append((ys, ye))
    return out


def _boxes_for_x_range(
    binary: np.ndarray,
    x0: int,
    x1: int,
    y0c: int,
    y1c: int,
    w: int,
    h: int,
    pad_x: int,
    pad_y: int,
    min_h: int,
    *,
    sensitivity: float = 1.0,
    expected_questions: int = 0,
    use_deep_split: bool = False,
    legacy_v2: bool = True,
) -> list[tuple[int, int, int, int]]:
    boxes: list[tuple[int, int, int, int]] = []
    row_density = np.sum(binary[y0c : y1c + 1, x0 : x1 + 1] > 0, axis=1)
    prof = _gaussian_smooth_1d(row_density.astype(np.float64), sigma=max(4.0, (y1c - y0c) / 250.0))
    roi_h = len(row_density)
    if legacy_v2:
        split_starts = _vertical_gap_split_y(prof, 0, roi_h - 1, h)
        min_sep = max(18, h // 50)
    else:
        base_gap = max(8, int(h / (48 * max(0.55, float(sensitivity)))))
        split_starts = _vertical_gap_split_y(prof, 0, roi_h - 1, h, min_gap_override=base_gap)
        min_sep = max(16, int(h / (48 * max(0.55, float(sensitivity)))))
    split_starts = _merge_close_splits(split_starts, min_sep)
    split_starts = [y0c + s for s in split_starts]
    split_starts = [s for s in split_starts if y0c < s <= y1c]
    segs = _y_boundaries_from_splits(y0c, y1c, split_starts)
    ch = y1c - y0c + 1
    if expected_questions >= 1:
        segs = _equal_y_splits(y0c, y1c, min(20, expected_questions))
    elif len(segs) == 1 and ch > h * 0.22:
        n = _infer_target_question_count(ch, h, prof)
        if n > 1:
            segs = _equal_y_splits(y0c, y1c, n)
    if use_deep_split and expected_questions < 1 and not legacy_v2:
        segs = _deep_split_segments(prof, y0c, segs, h, min_h)
    for ys, ye in segs:
        bh = ye - ys + 1
        if bh < min_h:
            continue
        xa, xb = _x_extent_for_band(binary, ys, ye)
        if xb <= xa:
            continue
        xa, xb = _x_extent_vertical_projection_trim(binary, ys, ye, xa, xb)
        if xb <= xa:
            continue
        xa = max(x0, xa - pad_x)
        xb = min(x1, xb + pad_x)
        ys2 = max(0, ys - pad_y)
        ye2 = min(h - 1, ye + pad_y)
        cw = xb - xa + 1
        ch = ye2 - ys2 + 1
        if cw < 16 or ch < min_h:
            continue
        boxes.append((xa, ys2, cw, ch))
    return boxes


def extract_question_boxes_v2(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """
    Otonom kesim v2: dikey projeksiyonda sorular arası boşlukları ayırıcı sayar;
    tek blokta kalırsa sayfa yüksekliğinden tahmini soru sayısı ile eşit böler.
    İki sütunlu sayfada ortadaki dikey boşluğu tespit edip sütun başına ayrı böler.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    binary = _preprocess_binary_v2(gray)
    binary = _strip_fullwidth_rule_rows(binary)
    h, w = binary.shape
    row_density = np.sum(binary > 0, axis=1).astype(np.float64)
    prof = _gaussian_smooth_1d(row_density, sigma=max(5.0, h / 350.0))
    y0c, y1c = _content_y_bounds(row_density, h)
    pad_x = max(4, w // 200)
    pad_y = max(4, h // 200)
    min_h = max(22, h // 70)

    boxes: list[tuple[int, int, int, int]] = []
    cx = _column_split_x(binary, y0c, y1c)
    x_ranges: list[tuple[int, int]]
    if cx is not None:
        gap = max(4, w // 200)
        left = (0, max(0, cx - gap))
        right = (min(w - 1, cx + gap), w - 1)
        if left[1] - left[0] > w * 0.18:
            x_ranges = [left]
        else:
            x_ranges = []
        if right[1] - right[0] > w * 0.18:
            x_ranges.append(right)
        if len(x_ranges) < 2:
            x_ranges = [(0, w - 1)]
    else:
        x_ranges = [(0, w - 1)]

    for x0, x1 in x_ranges:
        boxes.extend(
            _boxes_for_x_range(binary, x0, x1, y0c, y1c, w, h, pad_x, pad_y, min_h)
        )

    if not boxes:
        return extract_question_boxes(bgr)

    boxes = _filter_question_boxes(boxes, w, h)
    boxes.sort(key=lambda b: (b[0], b[1]))
    return boxes


def _preprocess_binary_v3(gray: np.ndarray) -> np.ndarray:
    """Düşük kontrastlı taramalar için CLAHE + hafif morfoloji."""
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    g = clahe.apply(gray)
    return _preprocess_binary_v2(g)


def _tighten_box_xywh(bgr: np.ndarray, x: int, y: int, w_box: int, h_box: int) -> tuple[int, int, int, int]:
    """Otsu maskesine göre kutuyu mürekkep sınırına sıkıştırır."""
    hh, ww = bgr.shape[:2]
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(ww, x + w_box)
    y1 = min(hh, y + h_box)
    if x1 <= x0 + 2 or y1 <= y0 + 2:
        return x, y, w_box, h_box
    crop = bgr[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(bw)
    if coords is None:
        return x, y, w_box, h_box
    rx, ry, rw, rh = cv2.boundingRect(coords)
    pad = 3
    gx0 = max(0, x0 + rx - pad)
    gy0 = max(0, y0 + ry - pad)
    gx1 = min(ww, x0 + rx + rw + pad)
    gy1 = min(hh, y0 + ry + rh + pad)
    return gx0, gy0, gx1 - gx0, gy1 - gy0


def _filter_question_boxes_v3(
    boxes: list[tuple[int, int, int, int]],
    pw: int,
    ph: int,
) -> list[tuple[int, int, int, int]]:
    """v3: sıkı kutu sonrası biraz daha toleranslı alt eşik."""
    page_area = max(1, pw * ph)
    out: list[tuple[int, int, int, int]] = []
    for x, y, bw, bh in boxes:
        area = bw * bh
        if area < max(480, page_area * 0.00028):
            continue
        if area > page_area * 0.92:
            continue
        if bw > int(pw * 0.97) and bh > int(ph * 0.9):
            continue
        if bh < max(20, int(ph * 0.014)):
            continue
        if bw < int(pw * 0.045) and bh < int(ph * 0.035):
            continue
        out.append((x, y, bw, bh))
    return out


def _column_split_x_v3(binary: np.ndarray, y0: int, y1: int) -> Optional[int]:
    """Yumuşatılmış dikey projeksiyonla orta sütun boşluğu."""
    h, w = binary.shape
    if w < 280 or y1 <= y0 + 20:
        return None
    roi = binary[y0 : y1 + 1, :]
    col_s = np.sum(roi > 0, axis=0).astype(np.float64)
    col_s = _gaussian_smooth_1d(col_s, sigma=max(3.0, w / 220.0))
    mx = float(np.max(col_s))
    if mx < 10:
        return None
    lo, hi = int(w * 0.28), int(w * 0.72)
    seg = col_s[lo:hi]
    if seg.size < 8:
        return None
    rel = int(lo + np.argmin(seg))
    mvals = col_s[col_s > 1e-6]
    med = float(np.median(mvals)) if mvals.size else mx * 0.5
    if col_s[rel] < 0.23 * mx and col_s[rel] < 0.44 * med:
        return rel
    return None


def extract_question_boxes_v3(
    bgr: np.ndarray,
    *,
    expected_questions: int = 0,
    sensitivity: float = 1.0,
) -> list[tuple[int, int, int, int]]:
    """
    v3: CLAHE ön işleme, adaptif boşluk (hassasiyet), derin çukur bölme,
    gelişmiş sütun tespiti, Otsu ile sıkı kutu.
    expected_questions: 0 = tam otomatik; 1–20 = bu sütunda o kadar eşit şerit.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    binary = _preprocess_binary_v3(gray)
    binary = _strip_fullwidth_rule_rows(binary)
    h, w = binary.shape
    row_density = np.sum(binary > 0, axis=1).astype(np.float64)
    prof = _gaussian_smooth_1d(row_density, sigma=max(5.0, h / 350.0))
    y0c, y1c = _content_y_bounds(row_density, h)
    pad_x = max(4, w // 200)
    pad_y = max(4, h // 200)
    min_h = max(22, h // 70)

    boxes: list[tuple[int, int, int, int]] = []
    cx = _column_split_x_v3(binary, y0c, y1c)
    exp_left = exp_right = 0
    if expected_questions > 0 and cx is not None:
        exp_left = (expected_questions + 1) // 2
        exp_right = expected_questions // 2
    elif expected_questions > 0:
        exp_left = expected_questions

    if cx is not None:
        gap = max(4, w // 200)
        left = (0, max(0, cx - gap))
        right = (min(w - 1, cx + gap), w - 1)
        x_ranges: list[tuple[int, int]] = []
        if left[1] - left[0] > w * 0.18:
            x_ranges.append(left)
        if right[1] - right[0] > w * 0.18:
            x_ranges.append(right)
        if len(x_ranges) < 2:
            x_ranges = [(0, w - 1)]
            exp_use = expected_questions if expected_questions > 0 else 0
            boxes.extend(
                _boxes_for_x_range(
                    binary,
                    0,
                    w - 1,
                    y0c,
                    y1c,
                    w,
                    h,
                    pad_x,
                    pad_y,
                    min_h,
                    sensitivity=sensitivity,
                    expected_questions=exp_use,
                    use_deep_split=True,
                    legacy_v2=False,
                )
            )
        else:
            for i, (xa, xb) in enumerate(x_ranges):
                exp_here = exp_left if i == 0 else exp_right
                boxes.extend(
                    _boxes_for_x_range(
                        binary,
                        xa,
                        xb,
                        y0c,
                        y1c,
                        w,
                        h,
                        pad_x,
                        pad_y,
                        min_h,
                        sensitivity=sensitivity,
                        expected_questions=exp_here,
                        use_deep_split=True,
                        legacy_v2=False,
                    )
                )
    else:
        boxes.extend(
            _boxes_for_x_range(
                binary,
                0,
                w - 1,
                y0c,
                y1c,
                w,
                h,
                pad_x,
                pad_y,
                min_h,
                sensitivity=sensitivity,
                expected_questions=exp_left,
                use_deep_split=True,
                legacy_v2=False,
            )
        )

    if not boxes:
        return extract_question_boxes_v2(bgr)

    tightened: list[tuple[int, int, int, int]] = []
    for bx, by, bw, bh in boxes:
        tightened.append(_tighten_box_xywh(bgr, bx, by, bw, bh))

    boxes = _filter_question_boxes_v3(tightened, w, h)
    boxes.sort(key=lambda b: (b[0], b[1]))
    return boxes


AUTONOM_PADDING_PX = 12


def pil_add_white_padding(pil: Image.Image, pad: int) -> Image.Image:
    if pad <= 0:
        return pil
    w, h = pil.size
    out = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (255, 255, 255))
    out.paste(pil, (pad, pad))
    return out


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


def bgr_to_pil_rgb(bgr: np.ndarray) -> Image.Image:
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


# --- YKS ders/konu (özet) -------------------------------------------------------

CURRICULUM: dict[str, dict[str, list[str]]] = {
    "TYT": {
        "Matematik": ["Sayı Problemleri", "Polinomlar", "Olasılık"],
        "Türkçe": ["Paragraf", "Dil Bilgisi"],
        "Fizik": ["Hareket", "Elektrik"],
    },
    "AYT": {
        "Matematik": ["Türev", "İntegral"],
        "Fizik": ["Manyetizma", "Optik"],
    },
}


def app_base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def soru_havuzu_dir() -> str:
    p = os.path.join(app_base_dir(), "SoruHavuzu")
    os.makedirs(p, exist_ok=True)
    return p


def index_path() -> str:
    return os.path.join(soru_havuzu_dir(), "soru_index.json")


@dataclass
class SoruItem:
    id: str
    filename: str
    sinav: str
    ders: str
    konu: str
    zorluk: str
    page: int
    kaynak: str
    created: str


def load_index() -> list[dict[str, Any]]:
    path = index_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("items", [])
    except (OSError, json.JSONDecodeError):
        return []


def save_index(items: list[dict[str, Any]]) -> None:
    path = index_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, indent=2)


# --- GUI -----------------------------------------------------------------------

ctk.set_appearance_mode("light")
ctk.set_default_color_theme("blue")


class PortalApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Mustafa Akbaş Otonom Kırpma Portalı")
        self.geometry("1280x820")
        self.minsize(1024, 680)

        self._kurum = ctk.StringVar(value="Kurum Adı")
        self._date_str = datetime.now().strftime("%d %B %Y")
        self._current_view = "dashboard"

        self._pdf_doc: Optional[fitz.Document] = None
        self._pdf_path: Optional[str] = None
        self._page_images: list[Image.Image] = []
        self._page_bgr: list[np.ndarray] = []
        self._current_page = 0
        self._single_image_path: Optional[str] = None
        self._canvas_orig_size = (0, 0)
        self._manual_rect_canvas: Optional[tuple[int, int, int, int]] = None

        self._canvas_scale = 1.0
        self._img_offset = (0, 0)
        self._img_disp_size = (0, 0)
        self._tk_photo: Optional[ImageTk.PhotoImage] = None
        self._rubber = {"active": False, "x0": 0, "y0": 0, "rect": None}
        self._user_zoom = 1.0
        self._pan = [0, 0]
        self._panning = False
        self._pan_drag_start: tuple[int, int, int, int] = (0, 0, 0, 0)
        self._zoom_min = 0.35
        self._zoom_max = 6.0

        self._sinav_var = ctk.StringVar(value="TYT")
        self._ders_var = ctk.StringVar(value="Matematik")
        self._konu_var = ctk.StringVar(value="")
        self._zorluk_var = ctk.StringVar(value="Orta")

        self._archive_sinav = ctk.StringVar(value="")
        self._archive_ders = ctk.StringVar(value="")
        self._archive_konu = ctk.StringVar(value="")

        self._v3_expected = ctk.StringVar(value="0")
        self._v3_sensitivity = ctk.DoubleVar(value=1.0)

        self._build_ui()
        self._show_view("dashboard")

    def _build_ui(self) -> None:
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.sidebar = ctk.CTkFrame(self, width=260, corner_radius=0, fg_color=("#1e1b4b", "#0f172a"))
        self.sidebar.grid(row=0, column=0, sticky="nsew")
        self.sidebar.grid_propagate(False)

        title = ctk.CTkLabel(
            self.sidebar,
            text="Mustafa Akbaş\nOtonom Kırpma Portalı",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#e0e7ff",
            justify="center",
        )
        title.pack(pady=(28, 20), padx=16)

        self.btn_dash = ctk.CTkButton(
            self.sidebar,
            text="  Dashboard",
            anchor="w",
            height=40,
            fg_color="transparent",
            text_color=("gray90", "gray90"),
            hover_color=("#312e81", "#1e1b4b"),
            font=ctk.CTkFont(size=14),
            command=lambda: self._show_view("dashboard"),
        )
        self.btn_dash.pack(fill="x", padx=12, pady=4)

        self.btn_crop = ctk.CTkButton(
            self.sidebar,
            text="  🤖 Kırpıcı (v3)",
            anchor="w",
            height=40,
            fg_color="transparent",
            text_color=("gray90", "gray90"),
            hover_color=("#312e81", "#1e1b4b"),
            font=ctk.CTkFont(size=14),
            command=lambda: self._show_view("cropper"),
        )
        self.btn_crop.pack(fill="x", padx=12, pady=4)

        sub = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        sub.pack(fill="x", padx=8, pady=(0, 8))
        self.btn_arch = ctk.CTkButton(
            sub,
            text="     📚 Soru Arşivi",
            anchor="w",
            height=36,
            fg_color="transparent",
            text_color=("#a5b4fc", "#a5b4fc"),
            hover_color=("#312e81", "#1e1b4b"),
            font=ctk.CTkFont(size=13),
            command=lambda: self._show_view("archive"),
        )
        self.btn_arch.pack(fill="x", padx=20)

        self.main = ctk.CTkFrame(self, corner_radius=0, fg_color=("#f8fafc", "#0f172a"))
        self.main.grid(row=0, column=1, sticky="nsew")
        self.main.grid_columnconfigure(0, weight=1)
        self.main.grid_rowconfigure(0, weight=1)

        self.frame_dashboard = self._build_dashboard(self.main)
        self.frame_cropper = self._build_cropper(self.main)
        self.frame_archive = self._build_archive(self.main)

    def _build_dashboard(self, parent: ctk.CTkFrame) -> ctk.CTkFrame:
        f = ctk.CTkFrame(parent, fg_color="transparent")
        inner = ctk.CTkFrame(f, fg_color=("#ffffff", "#1e293b"), corner_radius=16)
        inner.pack(expand=True, fill="both", padx=40, pady=40)
        ctk.CTkLabel(
            inner,
            text="Hoş geldiniz, Ayşe Hoca",
            font=ctk.CTkFont(size=26, weight="bold"),
            text_color=("#0f172a", "#f1f5f9"),
        ).pack(pady=(32, 8))
        ctk.CTkLabel(
            inner,
            text="PDF yükleyin; otonom veya manuel kırpma ile soruları PNG olarak kaydedin.\n"
            "Arşiv ekranından SoruHavuzu klasörünü filtreleyebilirsiniz.",
            font=ctk.CTkFont(size=14),
            text_color=("#64748b", "#94a3b8"),
            justify="center",
        ).pack(pady=8)
        self.lbl_dash_stats = ctk.CTkLabel(
            inner,
            text="",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color=("#059669", "#34d399"),
        )
        self.lbl_dash_stats.pack(pady=24)
        ctk.CTkButton(
            inner,
            text="Kırpıcıya git →",
            height=44,
            fg_color="#059669",
            hover_color="#047857",
            font=ctk.CTkFont(size=15, weight="bold"),
            command=lambda: self._show_view("cropper"),
        ).pack(pady=12)
        return f

    def _build_cropper(self, parent: ctk.CTkFrame) -> ctk.CTkFrame:
        f = ctk.CTkFrame(parent, fg_color="transparent")
        f.grid_columnconfigure(0, weight=1)
        f.grid_rowconfigure(1, weight=1)

        top = ctk.CTkFrame(f, fg_color=("#ffffff", "#1e293b"), corner_radius=16)
        top.grid(row=0, column=0, sticky="ew", padx=24, pady=(20, 8))
        top.grid_columnconfigure(1, weight=1)
        self.entry_kurum = ctk.CTkEntry(top, textvariable=self._kurum, width=280, height=36, font=ctk.CTkFont(size=14))
        self.entry_kurum.grid(row=0, column=0, padx=20, pady=16, sticky="w")
        self.lbl_top_date = ctk.CTkLabel(
            top,
            text=self._date_str,
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=("#64748b", "#94a3b8"),
        )
        self.lbl_top_date.grid(row=0, column=1, padx=20, pady=16, sticky="e")

        body = ctk.CTkFrame(f, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=24, pady=(0, 20))
        body.grid_columnconfigure(0, weight=2)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(0, weight=1)

        left = ctk.CTkFrame(body, fg_color=("#ffffff", "#1e293b"), corner_radius=16)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        left.grid_rowconfigure(2, weight=1)
        left.grid_columnconfigure(0, weight=1)

        drop = ctk.CTkFrame(
            left,
            fg_color=("#f1f5f9", "#334155"),
            border_width=2,
            border_color=("#7c3aed", "#6366f1"),
            corner_radius=12,
        )
        drop.grid(row=0, column=0, sticky="ew", padx=16, pady=(16, 8))
        self.drop_zone = ctk.CTkFrame(drop, fg_color="transparent", height=120)
        self.drop_zone.pack(fill="both", expand=True, padx=12, pady=20)
        ctk.CTkLabel(
            self.drop_zone,
            text="☁️\nPDF veya Görsel Sürükle",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=("#475569", "#cbd5e1"),
        ).pack(pady=(8, 4))
        ctk.CTkButton(
            self.drop_zone,
            text="🎯 İÇE AKTAR",
            height=40,
            fg_color="#059669",
            hover_color="#047857",
            font=ctk.CTkFont(size=15, weight="bold"),
            command=self._import_file_dialog,
        ).pack(pady=8)
        if _HAS_WINDND:
            self.after(300, self._hook_drop)

        src = ctk.CTkFrame(left, fg_color="transparent")
        src.grid(row=1, column=0, sticky="ew", padx=16, pady=4)
        ctk.CTkLabel(src, text="Kaynak & kırpma", font=ctk.CTkFont(size=13, weight="bold")).pack(anchor="w")
        self.lbl_pdf_name = ctk.CTkLabel(src, text="Henüz dosya yok", font=ctk.CTkFont(size=12), text_color="#64748b")
        self.lbl_pdf_name.pack(anchor="w")
        nav = ctk.CTkFrame(src, fg_color="transparent")
        nav.pack(fill="x", pady=4)
        ctk.CTkButton(nav, text="◀", width=40, command=self._prev_page).pack(side="left", padx=2)
        self.page_label = ctk.CTkLabel(nav, text="Sayfa — / —", font=ctk.CTkFont(size=13, weight="bold"))
        self.page_label.pack(side="left", padx=12)
        ctk.CTkButton(nav, text="▶", width=40, command=self._next_page).pack(side="left", padx=2)

        canvas_wrap = ctk.CTkFrame(left, fg_color=("#e2e8f0", "#0f172a"))
        canvas_wrap.grid(row=2, column=0, sticky="nsew", padx=16, pady=(8, 16))
        self._tk_canvas = tk.Canvas(
            canvas_wrap,
            highlightthickness=0,
            bg="#e2e8f0",
            width=640,
            height=420,
        )
        self._tk_canvas.pack(fill="both", expand=True)
        self._tk_canvas.bind("<Enter>", lambda _e: self._tk_canvas.focus_set())
        self._tk_canvas.bind("<ButtonPress-1>", self._on_canvas_down)
        self._tk_canvas.bind("<B1-Motion>", self._on_canvas_move)
        self._tk_canvas.bind("<ButtonRelease-1>", self._on_canvas_up)
        self._tk_canvas.bind("<ButtonPress-3>", self._on_canvas_pan_down)
        self._tk_canvas.bind("<B3-Motion>", self._on_canvas_pan_move)
        self._tk_canvas.bind("<ButtonRelease-3>", self._on_canvas_pan_up)
        self._tk_canvas.bind("<MouseWheel>", self._on_canvas_wheel)
        self._tk_canvas.bind("<Button-4>", self._on_canvas_wheel_linux_up)
        self._tk_canvas.bind("<Button-5>", self._on_canvas_wheel_linux_down)

        ctk.CTkLabel(
            left,
            text="Sol tık: seçim · Sağ sürükle: kaydır · Tekerlek: zoom",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
        ).grid(row=3, column=0, padx=16, pady=(4, 4))

        v3_card = ctk.CTkFrame(
            left,
            fg_color=("#f8fafc", "#334155"),
            corner_radius=12,
            border_width=1,
            border_color=("#e2e8f0", "#475569"),
        )
        v3_card.grid(row=4, column=0, sticky="ew", padx=16, pady=(0, 8))
        ctk.CTkLabel(
            v3_card,
            text="Otonom kesim · v3",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color=("#0f172a", "#f1f5f9"),
        ).pack(anchor="w", padx=14, pady=(12, 4))
        ctk.CTkLabel(
            v3_card,
            text="CLAHE + adaptif boşluk + derin çukur bölme + sıkı kutu. İki sütunda toplam soru sayısı sütunlara bölünür.",
            font=ctk.CTkFont(size=11),
            text_color=("#64748b", "#94a3b8"),
            wraplength=560,
            justify="left",
        ).pack(anchor="w", padx=14, pady=(0, 8))
        row_s = ctk.CTkFrame(v3_card, fg_color="transparent")
        row_s.pack(fill="x", padx=14, pady=(0, 4))
        ctk.CTkLabel(row_s, text="Hassasiyet", font=ctk.CTkFont(size=12), width=100, anchor="w").pack(side="left")
        self._slider_v3_sens = ctk.CTkSlider(
            row_s,
            from_=0.65,
            to=1.45,
            variable=self._v3_sensitivity,
            number_of_steps=16,
            width=220,
        )
        self._slider_v3_sens.pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._lbl_v3_sens = ctk.CTkLabel(row_s, text="1.00", width=44, font=ctk.CTkFont(size=12))
        self._lbl_v3_sens.pack(side="left")
        self._slider_v3_sens.configure(command=lambda _v: self._lbl_v3_sens.configure(text=f"{self._v3_sensitivity.get():.2f}"))

        row_n = ctk.CTkFrame(v3_card, fg_color="transparent")
        row_n.pack(fill="x", padx=14, pady=(4, 12))
        ctk.CTkLabel(row_n, text="Soru sayısı (0 = otomatik)", font=ctk.CTkFont(size=12)).pack(side="left")
        self._entry_v3_n = ctk.CTkEntry(
            row_n,
            textvariable=self._v3_expected,
            width=72,
            height=32,
            font=ctk.CTkFont(size=13),
            placeholder_text="0",
        )
        self._entry_v3_n.pack(side="left", padx=(12, 0))
        self._lbl_v3_sens.configure(text=f"{self._v3_sensitivity.get():.2f}")

        actions = ctk.CTkFrame(left, fg_color="transparent")
        actions.grid(row=5, column=0, sticky="ew", padx=16, pady=(0, 12))
        ctk.CTkButton(
            actions,
            text="Otonom kes (v3)",
            width=168,
            height=42,
            fg_color="#7c3aed",
            hover_color="#6d28d9",
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._autonomous_crop,
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            actions,
            text="Manuel → PNG",
            width=160,
            height=42,
            fg_color="#059669",
            hover_color="#047857",
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._save_manual_selection,
        ).pack(side="left", padx=4)

        right = ctk.CTkFrame(body, fg_color=("#ffffff", "#1e293b"), corner_radius=16)
        right.grid(row=0, column=1, sticky="nsew")
        ctk.CTkLabel(
            right,
            text="Kayıt etiketleri",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color=("#0f172a", "#f1f5f9"),
        ).pack(anchor="w", padx=16, pady=(18, 2))
        ctk.CTkLabel(
            right,
            text="Otonom / manuel kesimde dosya adı ve arşiv için kullanılır.",
            font=ctk.CTkFont(size=11),
            text_color=("#64748b", "#94a3b8"),
            wraplength=260,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(0, 10))
        ctk.CTkLabel(right, text="Sınav").pack(anchor="w", padx=16)
        self.cb_sinav = ctk.CTkComboBox(
            right,
            values=["TYT", "AYT"],
            variable=self._sinav_var,
            command=self._on_sinav_change,
            width=220,
        )
        self.cb_sinav.pack(padx=16, pady=4)
        ctk.CTkLabel(right, text="Ders").pack(anchor="w", padx=16)
        self.cb_ders = ctk.CTkComboBox(right, values=[], variable=self._ders_var, command=self._on_ders_change, width=220)
        self.cb_ders.pack(padx=16, pady=4)
        ctk.CTkLabel(right, text="Konu").pack(anchor="w", padx=16)
        self.cb_konu = ctk.CTkComboBox(right, values=[], variable=self._konu_var, width=220)
        self.cb_konu.pack(padx=16, pady=4)
        ctk.CTkLabel(right, text="Zorluk").pack(anchor="w", padx=16)
        self.cb_zorluk = ctk.CTkComboBox(
            right,
            values=["Kolay", "Orta", "Zor", "Karma", "YKS tipi"],
            variable=self._zorluk_var,
            width=220,
        )
        self.cb_zorluk.pack(padx=16, pady=4)

        self._fill_ders_konu()
        return f

    def _build_archive(self, parent: ctk.CTkFrame) -> ctk.CTkFrame:
        f = ctk.CTkFrame(parent, fg_color="transparent")
        f.grid_columnconfigure(0, weight=1)
        f.grid_rowconfigure(1, weight=1)

        filt = ctk.CTkFrame(f, fg_color=("#ffffff", "#1e293b"), corner_radius=16)
        filt.grid(row=0, column=0, sticky="ew", padx=24, pady=(20, 8))
        row = ctk.CTkFrame(filt, fg_color="transparent")
        row.pack(fill="x", padx=12, pady=12)
        ctk.CTkLabel(row, text="Sınav", font=ctk.CTkFont(size=12, weight="bold")).pack(side="left", padx=(0, 6))
        ctk.CTkComboBox(
            row,
            values=["", "TYT", "AYT"],
            variable=self._archive_sinav,
            width=110,
            command=lambda _: self._refresh_archive_preview(),
        ).pack(side="left", padx=4)
        ctk.CTkLabel(row, text="Ders", font=ctk.CTkFont(size=12, weight="bold")).pack(side="left", padx=(16, 6))
        self.cb_arch_ders = ctk.CTkComboBox(
            row,
            values=[""],
            variable=self._archive_ders,
            width=150,
            command=lambda _: self._refresh_archive_preview(),
        )
        self.cb_arch_ders.pack(side="left", padx=4)
        ctk.CTkLabel(row, text="Konu", font=ctk.CTkFont(size=12, weight="bold")).pack(side="left", padx=(16, 6))
        self.cb_arch_konu = ctk.CTkComboBox(
            row,
            values=[""],
            variable=self._archive_konu,
            width=150,
            command=lambda _: self._refresh_archive_preview(),
        )
        self.cb_arch_konu.pack(side="left", padx=4)
        ctk.CTkButton(
            row,
            text="Soru Ara 🔍",
            fg_color="#059669",
            hover_color="#047857",
            width=140,
            command=self._refresh_archive_preview,
        ).pack(side="left", padx=(20, 0))

        self.scroll_arch = ctk.CTkScrollableFrame(f, fg_color="transparent")
        self.scroll_arch.grid(row=1, column=0, sticky="nsew", padx=24, pady=(0, 20))
        return f

    def _fill_ders_konu(self) -> None:
        ex = self._sinav_var.get()
        bag = CURRICULUM.get(ex, {})
        ders = sorted(bag.keys())
        if not ders:
            ders = ["Genel"]
        self.cb_ders.configure(values=ders)
        self._ders_var.set(ders[0])
        konu = bag.get(self._ders_var.get(), ["Genel"])
        self.cb_konu.configure(values=konu)
        self._konu_var.set(konu[0])

    def _on_sinav_change(self, _v: str) -> None:
        self._fill_ders_konu()

    def _on_ders_change(self, _v: str) -> None:
        ex = self._sinav_var.get()
        bag = CURRICULUM.get(ex, {})
        konu = bag.get(self._ders_var.get(), ["Genel"])
        self.cb_konu.configure(values=konu)
        self._konu_var.set(konu[0])

    def _show_view(self, name: str) -> None:
        self._current_view = name
        self.frame_dashboard.grid_remove()
        self.frame_cropper.grid_remove()
        self.frame_archive.grid_remove()
        if name == "dashboard":
            self.frame_dashboard.grid(row=0, column=0, sticky="nsew")
            self._update_dashboard_stats()
        elif name == "cropper":
            self.frame_cropper.grid(row=0, column=0, sticky="nsew")
        else:
            self.frame_archive.grid(row=0, column=0, sticky="nsew")
            self._populate_archive_filters()
            self._refresh_archive_preview()

    def _update_dashboard_stats(self) -> None:
        n = len(load_index())
        self.lbl_dash_stats.configure(text=f"Kayıtlı soru: {n} PNG · Klasör: {soru_havuzu_dir()}")

    def _hook_drop(self) -> None:
        if not _HAS_WINDND:
            return
        try:
            windnd.hook_dropfiles(self, lambda fs: self.after(0, lambda: self._on_drop_files(fs)))
        except Exception:
            pass

    def _decode_path(self, raw: bytes) -> str:
        for enc in ("utf-8", "mbcs", "cp1254"):
            try:
                return raw.decode(enc)
            except Exception:
                continue
        return raw.decode("utf-8", errors="replace")

    def _on_drop_files(self, paths: list) -> None:
        if not paths:
            return
        p = self._decode_path(paths[0])
        self._load_path(p)

    def _import_file_dialog(self) -> None:
        p = filedialog.askopenfilename(
            title="PDF veya görsel seçin",
            filetypes=[("PDF", "*.pdf"), ("Görsel", "*.png;*.jpg;*.jpeg"), ("Tümü", "*.*")],
        )
        if p:
            self._load_path(p)

    def _load_path(self, path: str) -> None:
        path = os.path.normpath(path)
        ext = os.path.splitext(path)[1].lower()
        self._close_pdf()
        if ext == ".pdf":
            try:
                self._pdf_doc = fitz.open(path)
                self._pdf_path = path
                self._page_images = []
                self._page_bgr = []
                for i in range(self._pdf_doc.page_count):
                    pg = self._pdf_doc.load_page(i)
                    bgr = _page_to_bgr(pg, RENDER_ZOOM)
                    self._page_bgr.append(bgr)
                    self._page_images.append(bgr_to_pil_rgb(bgr))
                self._current_page = 0
                self.lbl_pdf_name.configure(text=os.path.basename(path))
                self._update_page_label()
                self._reset_canvas_view()
                self.after(80, self._refresh_canvas)
            except Exception as e:
                messagebox.showerror("Hata", f"PDF açılamadı:\n{e}")
            return
        if ext in (".png", ".jpg", ".jpeg", ".bmp"):
            try:
                im = Image.open(path).convert("RGB")
                arr = np.array(im)
                bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
                self._single_image_path = path
                self._page_bgr = [bgr]
                self._page_images = [im]
                self._current_page = 0
                self.lbl_pdf_name.configure(text=os.path.basename(path))
                self._update_page_label()
                self._reset_canvas_view()
                self.after(80, self._refresh_canvas)
            except Exception as e:
                messagebox.showerror("Hata", f"Görsel yüklenemedi:\n{e}")
        else:
            messagebox.showwarning("Uyarı", "Desteklenen format: PDF, PNG, JPG")

    def _close_pdf(self) -> None:
        if self._pdf_doc:
            try:
                self._pdf_doc.close()
            except Exception:
                pass
        self._pdf_doc = None
        self._pdf_path = None
        self._page_images = []
        self._page_bgr = []
        self._single_image_path = None

    def _update_page_label(self) -> None:
        t = len(self._page_bgr)
        self.page_label.configure(text=f"Sayfa {self._current_page + 1} / {max(t,1)}")

    def _prev_page(self) -> None:
        if self._current_page > 0:
            self._current_page -= 1
            self._update_page_label()
            self._reset_canvas_view()
            self.after(40, self._refresh_canvas)

    def _next_page(self) -> None:
        if self._current_page < len(self._page_bgr) - 1:
            self._current_page += 1
            self._update_page_label()
            self._reset_canvas_view()
            self.after(40, self._refresh_canvas)

    def _reset_canvas_view(self) -> None:
        self._user_zoom = 1.0
        self._pan[0] = 0
        self._pan[1] = 0
        self._manual_rect_canvas = None

    def _refresh_canvas(self) -> None:
        self._tk_canvas.delete("all")
        if not self._page_images:
            return
        pil = self._page_images[self._current_page]
        cw = max(1, self._tk_canvas.winfo_width() or 640)
        ch = max(1, self._tk_canvas.winfo_height() or 420)
        iw, ih = pil.size
        fit = min(cw / max(iw, 1), ch / max(ih, 1), 1.0)
        s = fit * self._user_zoom
        nw = max(1, int(round(iw * s)))
        nh = max(1, int(round(ih * s)))
        disp = pil.resize((nw, nh), Image.Resampling.LANCZOS)
        self._tk_photo = ImageTk.PhotoImage(disp)
        ox0 = (cw - nw) // 2
        oy0 = (ch - nh) // 2
        ox = ox0 + self._pan[0]
        oy = oy0 + self._pan[1]
        self._img_offset = (ox, oy)
        self._img_disp_size = (nw, nh)
        self._canvas_scale = s
        self._tk_canvas.create_image(ox, oy, anchor="nw", image=self._tk_photo)
        self._canvas_orig_size = (iw, ih)
        if self._manual_rect_canvas and not self._rubber["active"]:
            x1, y1, x2, y2 = self._manual_rect_canvas
            self._rubber["rect"] = self._tk_canvas.create_rectangle(
                x1, y1, x2, y2, outline="#7c3aed", width=2, dash=(4, 2)
            )

    def _zoom_at_canvas(self, mx: int, my: int, factor: float) -> None:
        if not self._page_images or factor <= 0:
            return
        pil = self._page_images[self._current_page]
        cw = max(1, self._tk_canvas.winfo_width() or 640)
        ch = max(1, self._tk_canvas.winfo_height() or 420)
        iw, ih = pil.size
        fit = min(cw / max(iw, 1), ch / max(ih, 1), 1.0)
        s_old = fit * self._user_zoom
        if s_old <= 1e-9:
            return
        nw_old = max(1, int(round(iw * s_old)))
        nh_old = max(1, int(round(ih * s_old)))
        ox0_old = (cw - nw_old) // 2
        oy0_old = (ch - nh_old) // 2
        ox_old = ox0_old + self._pan[0]
        oy_old = oy0_old + self._pan[1]
        px = (mx - ox_old) / s_old
        py = (my - oy_old) / s_old
        z_new = self._user_zoom * factor
        z_new = max(self._zoom_min, min(self._zoom_max, z_new))
        if abs(z_new - self._user_zoom) < 1e-9:
            return
        self._user_zoom = z_new
        s_new = fit * self._user_zoom
        nw_new = max(1, int(round(iw * s_new)))
        nh_new = max(1, int(round(ih * s_new)))
        ox0_new = (cw - nw_new) // 2
        oy0_new = (ch - nh_new) // 2
        ox_new = mx - px * s_new
        oy_new = my - py * s_new
        self._pan[0] = int(round(ox_new - ox0_new))
        self._pan[1] = int(round(oy_new - oy0_new))
        self._refresh_canvas()

    def _on_canvas_wheel(self, e: tk.Event) -> None:
        if not self._page_images:
            return
        d = getattr(e, "delta", 0)
        if d > 0:
            self._zoom_at_canvas(e.x, e.y, 1.12)
        elif d < 0:
            self._zoom_at_canvas(e.x, e.y, 1.0 / 1.12)

    def _on_canvas_wheel_linux_up(self, e: tk.Event) -> None:
        if self._page_images:
            self._zoom_at_canvas(e.x, e.y, 1.12)

    def _on_canvas_wheel_linux_down(self, e: tk.Event) -> None:
        if self._page_images:
            self._zoom_at_canvas(e.x, e.y, 1.0 / 1.12)

    def _on_canvas_pan_down(self, e: tk.Event) -> None:
        if not self._page_images:
            return
        self._panning = True
        self._pan_drag_start = (e.x, e.y, self._pan[0], self._pan[1])

    def _on_canvas_pan_move(self, e: tk.Event) -> None:
        if not self._panning or not self._page_images:
            return
        x0, y0, px0, py0 = self._pan_drag_start
        self._pan[0] = px0 + (e.x - x0)
        self._pan[1] = py0 + (e.y - y0)
        self._refresh_canvas()

    def _on_canvas_pan_up(self, _e: tk.Event) -> None:
        self._panning = False

    def _canvas_to_image_rect(self, x1: int, y1: int, x2: int, y2: int) -> Optional[tuple[int, int, int, int]]:
        if not self._page_images or self._canvas_orig_size[0] < 2:
            return None
        ox, oy = self._img_offset
        iw, ih = self._canvas_orig_size
        scale = self._canvas_scale
        if scale <= 1e-9:
            return None
        rx1 = int((min(x1, x2) - ox) / scale)
        ry1 = int((min(y1, y2) - oy) / scale)
        rx2 = int((max(x1, x2) - ox) / scale)
        ry2 = int((max(y1, y2) - oy) / scale)
        rx1 = max(0, min(iw - 1, rx1))
        rx2 = max(0, min(iw - 1, rx2))
        ry1 = max(0, min(ih - 1, ry1))
        ry2 = max(0, min(ih - 1, ry2))
        if rx2 - rx1 < 8 or ry2 - ry1 < 8:
            return None
        return rx1, ry1, rx2, ry2

    def _on_canvas_down(self, e) -> None:
        self._rubber["active"] = True
        self._rubber["x0"] = e.x
        self._rubber["y0"] = e.y
        if self._rubber["rect"]:
            self._tk_canvas.delete(self._rubber["rect"])
        self._rubber["rect"] = self._tk_canvas.create_rectangle(
            e.x, e.y, e.x, e.y, outline="#7c3aed", width=2, dash=(4, 2)
        )

    def _on_canvas_move(self, e) -> None:
        if not self._rubber["active"] or not self._rubber["rect"]:
            return
        self._tk_canvas.coords(self._rubber["rect"], self._rubber["x0"], self._rubber["y0"], e.x, e.y)

    def _on_canvas_up(self, e) -> None:
        self._rubber["active"] = False
        self._manual_rect_canvas = (self._rubber["x0"], self._rubber["y0"], e.x, e.y)

    def _save_manual_selection(self) -> None:
        if not self._page_images or not self._manual_rect_canvas:
            messagebox.showinfo("Bilgi", "Önce fareyle bir alan seçin.")
            return
        x1, y1, x2, y2 = self._manual_rect_canvas
        r = self._canvas_to_image_rect(x1, y1, x2, y2)
        if not r:
            messagebox.showwarning("Uyarı", "Seçim çok küçük.")
            return
        rx1, ry1, rx2, ry2 = r
        pil = self._page_images[self._current_page].crop((rx1, ry1, rx2 + 1, ry2 + 1))
        self._save_pil_item(pil, self._current_page + 1, "manuel")

    def _autonomous_crop(self) -> None:
        if not self._page_bgr:
            messagebox.showinfo("Bilgi", "Önce PDF veya görsel yükleyin.")
            return
        bgr = self._page_bgr[self._current_page]
        raw = (self._v3_expected.get() or "").strip()
        try:
            exp_n = int(raw) if raw else 0
        except ValueError:
            messagebox.showwarning("Uyarı", "Soru sayısı alanına sadece sayı girin (veya 0).")
            return
        exp_n = max(0, min(20, exp_n))
        sens = float(self._v3_sensitivity.get())
        sens = max(0.65, min(1.45, sens))
        boxes = extract_question_boxes_v3(bgr, expected_questions=exp_n, sensitivity=sens)
        if not boxes:
            messagebox.showwarning("Uyarı", "Otonom blok bulunamadı.")
            return
        cnt = 0
        for i, (x, y, w, h) in enumerate(boxes):
            crop_bgr = bgr[y : y + h, x : x + w]
            pil = bgr_to_pil_rgb(crop_bgr)
            self._save_pil_item(pil, self._current_page + 1, "otonom", idx=i + 1)
            cnt += 1
        messagebox.showinfo("Tamam", f"{cnt} soru (v3) PNG olarak kaydedildi.")

    def _save_pil_item(
        self,
        pil: Image.Image,
        page: int,
        kaynak: str,
        idx: int = 0,
    ) -> None:
        soru_havuzu_dir()
        uid = uuid.uuid4().hex[:12]
        fname = f"q_{uid}_{kaynak}_p{page}"
        if idx:
            fname += f"_{idx}"
        fname += ".png"
        fpath = os.path.join(soru_havuzu_dir(), fname)
        to_save = pil_add_white_padding(pil.convert("RGB"), AUTONOM_PADDING_PX)
        to_save.save(fpath, "PNG", optimize=True)
        item = SoruItem(
            id=uid,
            filename=fname,
            sinav=self._sinav_var.get(),
            ders=self._ders_var.get(),
            konu=self._konu_var.get(),
            zorluk=self._zorluk_var.get(),
            page=page,
            kaynak=kaynak,
            created=datetime.now().isoformat(timespec="seconds"),
        )
        items = load_index()
        items.append(asdict(item))
        save_index(items)
        self._update_dashboard_stats()

    def _populate_archive_filters(self) -> None:
        items = load_index()
        ders = sorted({str(x.get("ders", "")) for x in items if x.get("ders")})
        konu = sorted({str(x.get("konu", "")) for x in items if x.get("konu")})
        self.cb_arch_ders.configure(values=[""] + ders)
        self.cb_arch_konu.configure(values=[""] + konu)

    def _refresh_archive_preview(self) -> None:
        for w in self.scroll_arch.winfo_children():
            w.destroy()
        items = load_index()
        fs = self._archive_sinav.get()
        fd = self._archive_ders.get()
        fk = self._archive_konu.get()
        filtered: list[dict[str, Any]] = []
        for it in items:
            if fs and it.get("sinav") != fs:
                continue
            if fd and it.get("ders") != fd:
                continue
            if fk and it.get("konu") != fk:
                continue
            filtered.append(it)
        if not filtered:
            ctk.CTkLabel(self.scroll_arch, text="Kayıt yok veya filtreler eşleşmedi.", text_color="#64748b").pack(pady=24)
            return
        grid = ctk.CTkFrame(self.scroll_arch, fg_color="transparent")
        grid.pack(fill="both", expand=True)
        cols = 3
        for col in range(cols):
            grid.grid_columnconfigure(col, weight=1)
        for i, it in enumerate(filtered):
            r, col = divmod(i, cols)
            card = self._archive_card(grid, it)
            card.grid(row=r, column=col, padx=16, pady=16, sticky="n")

    def _archive_card(self, parent: ctk.CTkFrame, it: dict[str, Any]) -> ctk.CTkFrame:
        f = ctk.CTkFrame(parent, fg_color=("#ffffff", "#1e293b"), corner_radius=14, border_width=1, border_color="#e2e8f0")
        f.configure(width=280)
        fp = os.path.join(soru_havuzu_dir(), it.get("filename", ""))
        if os.path.isfile(fp):
            try:
                im = Image.open(fp).convert("RGB")
                im.thumbnail((240, 200), Image.Resampling.LANCZOS)
                ph = ImageTk.PhotoImage(im)
                lb = ctk.CTkLabel(f, image=ph, text="")
                lb.image = ph
                lb.pack(padx=12, pady=(12, 8))
            except Exception:
                ctk.CTkLabel(f, text="(önizleme yok)", text_color="#94a3b8").pack(pady=20)
        ctk.CTkLabel(
            f,
            text=f"{it.get('ders','—')} · {it.get('konu','—')}",
            font=ctk.CTkFont(size=12, weight="bold"),
            wraplength=240,
        ).pack(padx=8)
        ctk.CTkLabel(f, text=f"ID: {it.get('id','')}", font=ctk.CTkFont(size=11), text_color="#64748b").pack()
        bt = ctk.CTkFrame(f, fg_color="transparent")
        bt.pack(fill="x", padx=10, pady=12)
        ctk.CTkButton(
            bt,
            text="✅",
            width=48,
            height=34,
            fg_color="#059669",
            hover_color="#047857",
            font=ctk.CTkFont(size=18),
            command=lambda: messagebox.showinfo("Bilgi", "Kayıt zaten SoruHavuzu klasöründe."),
        ).pack(side="left", padx=4)
        ctk.CTkButton(
            bt,
            text="✂️",
            width=48,
            height=34,
            fg_color="#2563eb",
            hover_color="#1d4ed8",
            font=ctk.CTkFont(size=18),
            command=lambda: self._open_file_external(fp),
        ).pack(side="left", padx=4)
        ctk.CTkButton(
            bt,
            text="🗑️",
            width=48,
            height=34,
            fg_color="#dc2626",
            hover_color="#b91c1c",
            font=ctk.CTkFont(size=18),
            command=lambda: self._delete_archive_item(it),
        ).pack(side="left", padx=4)
        return f

    def _open_file_external(self, path: str) -> None:
        if os.path.isfile(path):
            os.startfile(path)

    def _delete_archive_item(self, it: dict[str, Any]) -> None:
        if not messagebox.askyesno("Sil", "Bu soru kaydı silinsin mi?"):
            return
        fp = os.path.join(soru_havuzu_dir(), it.get("filename", ""))
        if os.path.isfile(fp):
            try:
                os.remove(fp)
            except OSError as e:
                messagebox.showerror("Hata", str(e))
                return
        nid = it.get("id")
        items = [x for x in load_index() if x.get("id") != nid]
        save_index(items)
        self._update_dashboard_stats()
        self._refresh_archive_preview()


def main() -> None:
    app = PortalApp()
    app.mainloop()


if __name__ == "__main__":
    main()
