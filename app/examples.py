"""Reference examples (uploaded M.01 / M.02 DOCX) for side-by-side preview compare."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import ROOT

EXAMPLES_DIR = ROOT / "assets" / "examples"

# Role guidance for accountability — mirrors contoh M.02 persetujuan
ROLE_GUIDANCE: dict[str, dict[str, str]] = {
    "prepared_by": {
        "label": "Dipersiapkan oleh",
        "who": "Penyusun / analis yang menulis konsep (bukan pejabat penandatangan akhir).",
        "title_eg": "Analis Yunior",
        "rank_eg": "Asisten Manajer",
    },
    "reviewed_by": {
        "label": "Diperiksa oleh",
        "who": "Atasan langsung / reviewer substansi sebelum ke kepala grup.",
        "title_eg": "Analis Senior",
        "rank_eg": "Asisten Direktur",
    },
    "supported_by": {
        "label": "Didukung oleh",
        "who": "Biasanya Kepala Grup / pejabat setingkat yang mendukung usulan.",
        "title_eg": "Kepala Grup",
        "rank_eg": "Direktur",
    },
    "approved_by": {
        "label": "Disetujui oleh",
        "who": "Pejabat pemberi keputusan — biasanya Kepala Satker / Kepala Departemen.",
        "title_eg": "Kepala Departemen",
        "rank_eg": "Direktur Eksekutif",
    },
    "received_by": {
        "label": "Diterima oleh",
        "who": "Penerima laporan / pendapat — biasanya Kepala Satker tujuan.",
        "title_eg": "Kepala Departemen",
        "rank_eg": "Direktur Eksekutif",
    },
}


def list_examples() -> list[dict[str, Any]]:
    return [
        {
            "id": "m01_undangan",
            "doc_family": "M.01",
            "matches_types": ["M.01_UNDANGAN", "M.01_KOORDINASI"],
            "title": "Contoh M.01 Undangan Rapat",
            "short": "M.01 Undangan",
            "source_file": "M01_undangan_example.docx",
            "file_url": "/api/examples/m01_undangan/file",
            "notes": "Margin, logo kanan, badge M.01, tabel Kepada/Dari/Perihal, isi Frutiger 45 Light, tanda tangan Kepala Grup di kanan.",
        },
        {
            "id": "m02_persetujuan",
            "doc_family": "M.02",
            "matches_types": ["M.02_PERSETUJUAN", "M.02_PELAPORAN"],
            "title": "Contoh M.02 Persetujuan",
            "short": "M.02 Persetujuan",
            "source_file": "M02_persetujuan_example.docx",
            "file_url": "/api/examples/m02_persetujuan/file",
            "notes": "PERIHAL/Kepada/Melalui, judul bagian, grid akuntabilitas 2×2 + tanggal kanan, Disetujui oleh = Kepala Departemen.",
        },
    ]


def get_example(example_id: str) -> dict[str, Any] | None:
    for item in list_examples():
        if item["id"] == example_id:
            path = EXAMPLES_DIR / item["source_file"]
            return {**item, "path": path, "exists": path.exists()}
    return None


def example_for_doc_type(doc_type: str) -> dict[str, Any] | None:
    for item in list_examples():
        if doc_type in item["matches_types"]:
            return get_example(item["id"])
    return None


def example_path(example_id: str) -> Path | None:
    item = get_example(example_id)
    if not item or not item.get("exists"):
        return None
    return item["path"]
