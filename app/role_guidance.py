"""Hints for accountability roles in M.02 templates."""

from __future__ import annotations

from typing import Any

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


def role_guidance_payload() -> dict[str, Any]:
    return {"role_guidance": ROLE_GUIDANCE}
