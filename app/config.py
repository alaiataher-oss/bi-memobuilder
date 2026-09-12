from __future__ import annotations

import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RULES_DIR = DATA / "rules"
TEMPLATES_DIR = DATA / "templates"
FONTS_DIR = ROOT / "assets" / "fonts"

# Vercel serverless filesystem is read-only except /tmp
_WRITABLE = Path("/tmp/bi-memobuilder") if os.environ.get("VERCEL") else DATA
STORE_DIR = _WRITABLE / "store"
ATTACHMENTS_DIR = _WRITABLE / "attachments"
EXPORT_DIR = _WRITABLE / "exports"

ACTIVE_RULE_VERSION = "1.0.0"
ACTIVE_TEMPLATE_VERSION = "1.1.0"

PLACEHOLDER_MARKERS = (
    "Contoh:",
    "[placeholder]",
    "{{",
    "…isi",
    "TBD",
    "lorem ipsum",
)

PURPOSE_OPTIONS = [
    {
        "id": "koordinasi",
        "title": "Koordinasi / minta informasi",
        "description": "Koordinasi, kerja sama, penyampaian atau permintaan informasi kepada satker/unit lain.",
    },
    {
        "id": "undangan",
        "title": "Undangan rapat / kegiatan",
        "description": "Mengundang rapat atau kegiatan internal.",
    },
    {
        "id": "persetujuan",
        "title": "Minta persetujuan / keputusan",
        "description": "Meminta persetujuan dan/atau keputusan pimpinan.",
    },
    {
        "id": "pelaporan",
        "title": "Menyampaikan laporan / pendapat",
        "description": "Menyampaikan laporan, pendapat, atau masukan.",
    },
]
