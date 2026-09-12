from __future__ import annotations

import re


AI_LABEL = "Saran AI—perlu verifikasi pengguna"


def polish_language(text: str) -> dict[str, str]:
    """Local assistive rewriter — no external AI calls."""
    cleaned = (text or "").strip()
    if not cleaned:
        return {"text": "", "label": AI_LABEL, "note": "Tidak ada teks untuk dirapikan."}

    # Light deterministic cleanup only; never invent facts/numbers/names.
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    # Capitalize sentence starts roughly
    parts = []
    for para in cleaned.split("\n"):
        para = para.strip()
        if para and para[0].islower():
            para = para[0].upper() + para[1:]
        parts.append(para)
    result = "\n".join(parts)
    if not result.endswith((".", "!", "?", "…")):
        result = result + "."
    return {
        "text": result,
        "label": AI_LABEL,
        "note": "Perapian lokal deterministik. Tidak mengarang data, nomor, atau pejabat.",
    }


def suggest_decision_wording(decision: str) -> dict[str, str]:
    base = (decision or "").strip()
    if not base:
        return {
            "text": "",
            "label": AI_LABEL,
            "note": "Isi keputusan yang diminta terlebih dahulu.",
        }
    text = base
    if not text.lower().startswith("memohon"):
        text = f"Memohon persetujuan atas {base[0].lower() + base[1:] if base else base}"
    if not text.endswith("."):
        text += "."
    return {"text": text, "label": AI_LABEL, "note": "Rumusan saran; verifikasi substansi oleh pengguna."}
