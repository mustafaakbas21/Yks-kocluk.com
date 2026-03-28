#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
yokatlas-py → ham JSON üretir (içeriği src/data/yks-data.json şemasına göre elle birleştirin).

Kurulum (ayrı ortam önerilir):
  pip install yokatlas-py

Örnek:
  python scripts/yokatlas_py_export_json.py --uni boğaziçi --program bilgisayar --length 50 --out data/yokatlas-raw.json

YÖK Atlas hız sınırı (418): --sleep 0.5 veya daha yüksek kullanın.

Kaynak: https://github.com/saidsurucu/yokatlas-py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


def _as_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    return {}


def _pick_str(d: Dict[str, Any], *keys: str) -> str:
    for k in keys:
        if k in d and d[k] is not None:
            s = str(d[k]).strip()
            if s:
                return s
    return ""


def normalize_row(raw: Any) -> Optional[Dict[str, Any]]:
    """
    auto-fetch-yokatlas.js recordFromJsonObject ile uyumlu alanlar.
    Türkçe / İngilizce anahtarlar (küçük harf, birleşik) tercih edilir.
    """
    d = _as_dict(raw)
    # yokatlas-py sürümüne göre alan adları değişebilir; olası tüm varyantlar
    uni = _pick_str(
        d,
        "universite",
        "uni_adi",
        "uniAdi",
        "universite_adi",
        "universiteAdi",
        "university",
        "university_name",
        "okul",
        "kurum",
    )
    prog = _pick_str(
        d,
        "program_adi",
        "programAdi",
        "program",
        "bolum",
        "bolum_adi",
        "bolumAdi",
        "department",
        "program_name",
        "fakulte",
    )
    if not uni or not prog:
        return None

    puan = _pick_str(
        d,
        "puan_turu",
        "puanTuru",
        "puan_tur",
        "score_type",
        "scoreType",
        "alan",
        "yks_alan",
    )

    def num(*keys: str) -> Optional[float]:
        for k in keys:
            if k not in d or d[k] is None or str(d[k]).strip() == "":
                continue
            try:
                return float(str(d[k]).replace(",", "."))
            except ValueError:
                continue
        return None

    row: Dict[str, Any] = {
        "universite": uni,
        "programAdi": prog,
    }
    if puan:
        row["puanTuru"] = puan
    tyt = num("targetTytNet", "hedef_tyt_net", "tyt_net", "tytnet")
    ayt = num("targetAytNet", "hedef_ayt_net", "ayt_net", "aytnet")
    if tyt is not None:
        row["targetTytNet"] = tyt
    if ayt is not None:
        row["targetAytNet"] = ayt
    return row


def run_search(uni: str, program: str, length: int, sleep_s: float) -> List[Dict[str, Any]]:
    try:
        from yokatlas_py import search_lisans_programs
    except ImportError:
        print(
            "yokatlas-py yüklü değil. Kurun: pip install yokatlas-py",
            file=sys.stderr,
        )
        sys.exit(1)

    params: Dict[str, Any] = {"length": max(1, min(length, 500))}
    if uni.strip():
        params["uni_adi"] = uni.strip()
    if program.strip():
        params["program_adi"] = program.strip()

    print("Arama parametreleri:", params, file=sys.stderr)
    results = search_lisans_programs(params)
    if not results:
        return []

    out: List[Dict[str, Any]] = []
    for i, raw in enumerate(results):
        if sleep_s > 0 and i > 0:
            time.sleep(sleep_s)
        norm = normalize_row(raw)
        if norm:
            out.append(norm)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="yokatlas-py → Appwrite auto-fetch JSON")
    ap.add_argument("--uni", default="", help="Üniversite (bulanık), örn. boğaziçi")
    ap.add_argument("--program", default="", help="Program (bulanık), örn. bilgisayar")
    ap.add_argument("--length", type=int, default=100, help="Maksimum program sayısı (öneri: küçük başla)")
    ap.add_argument(
        "--out",
        default="data/yokatlas-appwrite.json",
        help="Çıktı JSON yolu (proje köküne göre)",
    )
    ap.add_argument(
        "--sleep",
        type=float,
        default=0.0,
        help="Her satır sonrası bekleme (saniye); çoklu arama döngüsünde kullanın",
    )
    args = ap.parse_args()

    rows = run_search(args.uni, args.program, args.length, 0.0)
    # auto-fetch: kök dizi veya { data: [...] } — ikincisi daha güvenli büyük dosyalarda
    payload = {"data": rows, "_meta": {"source": "yokatlas-py", "count": len(rows)}}

    out_path = Path(args.out)
    if not out_path.is_absolute():
        root = Path(__file__).resolve().parent.parent
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Yazıldı: {out_path} ({len(rows)} satır)", file=sys.stderr)
    if not rows:
        print(
            "Uyarı: 0 satır. İlk sonucun anahtarlarını görmek için Python'da "
            "search_lisans_programs({'uni_adi':'boğaziçi','length':1}) çıktısını print edin; "
            "normalize_row() içine eksik alan adlarını ekleyin.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
