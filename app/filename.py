from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def _slug_title(title: str) -> str:
    cleaned = re.sub(r"[^\w\s\-]", "", title, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "Tanpa Judul"


def generate_filename(
    satker: str,
    ps: str,
    doc_type_code: str,
    title: str,
    date_value: str | datetime | None = None,
) -> str:
    """Pattern: [SATKER]_[PSXX]_[JENIS]_[JUDUL]_[DD-MM-YYYY] (Pedoman 2022 / FILE-01)."""
    if isinstance(date_value, datetime):
        date_str = date_value.strftime("%d-%m-%Y")
    elif date_value:
        date_str = str(date_value)
    else:
        date_str = datetime.now().strftime("%d-%m-%Y")

    satker_part = (satker or "SATKER").strip().upper().replace(" ", "")
    ps_part = (ps or "PS00").strip().upper().replace(" ", "")
    if not ps_part.startswith("PS"):
        ps_part = f"PS{ps_part}"
    type_part = (doc_type_code or "DOC").strip()
    title_part = _slug_title(title)
    return f"{satker_part}_{ps_part}_{type_part}_{title_part}_{date_str}"


def suggest_draft_name(
    satker: str,
    ps: str,
    doc_type_code: str,
    title: str,
    date_value: str | datetime | None = None,
) -> dict[str, str]:
    """Suggested working name for drafts, aligned with FILE-01 filename rule."""
    suggested = generate_filename(satker, ps, doc_type_code, title, date_value)
    return {
        "suggested": suggested,
        "pattern": "[SATKER]_[PSXX]_[JENIS]_[JUDUL]_[DD-MM-YYYY]",
        "rule_id": "FILE-01",
        "source": "Pedoman Dokumen Elektronik 2022",
        "example": "DMST_PS12_M.02_Hasil Asesmen Governance_19-02-2020",
    }


def meeting_request_subject(meta: dict[str, Any], date_str: str) -> str:
    return generate_filename(
        meta.get("satker", "SATKER"),
        meta.get("program_strategis", "PS00"),
        "MR",
        meta.get("subject", "Undangan"),
        date_str,
    )
