from __future__ import annotations

import re
from typing import Any

from .classification import expected_type_for
from .config import PLACEHOLDER_MARKERS
from .fonts import font_assets_ready
from .rules_loader import get_template


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    return False


def _contains_placeholder(text: str) -> bool:
    lower = text.lower()
    for marker in PLACEHOLDER_MARKERS:
        if marker.lower() in lower:
            return True
    if re.search(r"^\s*contoh\s*:", text, flags=re.IGNORECASE | re.MULTILINE):
        return True
    return False


def validate_document(doc: dict[str, Any], *, for_final_export: bool = False) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    meta = doc.get("metadata") or {}
    doc_type = doc.get("type")
    purpose = doc.get("purpose")
    budget_impact = doc.get("budget_impact")
    template_version = doc.get("template_version") or "1.1.0"
    tmpl = get_template(doc_type, template_version) if doc_type else None

    # Metadata
    for field, label in (
        ("recipient", "Penerima/tujuan"),
        ("subject", "Perihal"),
        ("city_date", "Kota dan tanggal"),
        ("satker", "Satker/unit penyusun"),
    ):
        if _is_blank(meta.get(field)):
            findings.append(
                {
                    "id": "VAL-META-REQ",
                    "severity": "error",
                    "message": f"{label} wajib diisi.",
                    "section_key": "metadata",
                    "field": field,
                }
            )

    # Classification override
    if purpose and doc_type:
        expected = expected_type_for(purpose, budget_impact if purpose == "undangan" else None)
        if expected and expected != doc_type:
            findings.append(
                {
                    "id": "CLS-OVERRIDE",
                    "severity": "warning",
                    "message": f"Tipe terpilih ({doc_type}) berbeda dari hasil rule ({expected}).",
                    "section_key": "classification",
                }
            )

    # Sections
    sections = {s.get("key"): s for s in doc.get("sections") or []}
    if tmpl:
        for sec in tmpl["sections"]:
            key = sec["key"]
            raw = sections.get(key) or {}
            content = raw.get("content", "")
            not_needed = raw.get("not_needed", False)
            fields = raw.get("fields") or {}

            if sec.get("input_mode") == "structured_fields" and sec.get("required") and not not_needed:
                missing = [
                    f["label"]
                    for f in sec.get("fields") or []
                    if _is_blank(fields.get(f["key"]))
                ]
                if missing:
                    findings.append(
                        {
                            "id": "VAL-SEC-REQ",
                            "severity": "error",
                            "message": f"Bagian «{sec['title']}» belum lengkap: {', '.join(missing)}.",
                            "section_key": key,
                        }
                    )
                # skip blank content check for structured sections
                continue

            if sec.get("required") and not not_needed and _is_blank(content):
                # table-only sections
                table = raw.get("table")
                if sec.get("supports_table") and table and len(table.get("rows") or []) > 0:
                    pass
                else:
                    findings.append(
                        {
                            "id": "VAL-SEC-REQ",
                            "severity": "error",
                            "message": f"Bagian wajib belum diisi: {sec['title']}.",
                            "section_key": key,
                        }
                    )
            if content and _contains_placeholder(content):
                findings.append(
                    {
                        "id": "VAL-PLACEHOLDER",
                        "severity": "error",
                        "message": f"Placeholder masih ada di bagian «{sec['title']}».",
                        "section_key": key,
                    }
                )
            if not_needed and not sec.get("allow_not_needed"):
                findings.append(
                    {
                        "id": "VAL-SEC-NOT-ALLOWED",
                        "severity": "error",
                        "message": f"Bagian «{sec['title']}» tidak boleh ditandai tidak diperlukan.",
                        "section_key": key,
                    }
                )
            elif not_needed and sec.get("allow_not_needed"):
                reason = (sections.get(key) or {}).get("not_needed_reason", "")
                if _is_blank(reason):
                    findings.append(
                        {
                            "id": "VAL-SEC-REASON",
                            "severity": "warning",
                            "message": f"Berikan alasan mengapa «{sec['title']}» tidak diperlukan.",
                            "section_key": key,
                        }
                    )

    # Accountability
    if tmpl and tmpl.get("accountability", {}).get("mode") == "grid":
        roles = doc.get("accountability") or {}
        for label in tmpl["accountability"]["labels"]:
            role_key = label.lower().replace(" ", "_")
            # normalize keys
            mapping = {
                "dipersiapkan_oleh": "prepared_by",
                "diperiksa_oleh": "reviewed_by",
                "didukung_oleh": "supported_by",
                "disetujui_oleh": "approved_by",
                "diterima_oleh": "received_by",
            }
            field = mapping.get(role_key)
            person = (roles.get(field) or {}) if field else {}
            if _is_blank(person.get("name")) or _is_blank(person.get("title")):
                findings.append(
                    {
                        "id": "VAL-ACC-REQ",
                        "severity": "error",
                        "message": f"Blok akuntabilitas «{label}» belum lengkap (nama & jabatan).",
                        "section_key": "accountability",
                        "field": field,
                    }
                )
        # ensure correct final label present in template (acceptance)
        final_label = tmpl["accountability"].get("final_label")
        if doc_type == "M.02_PERSETUJUAN" and final_label != "Disetujui oleh":
            findings.append(
                {
                    "id": "VAL-ACC-LABEL",
                    "severity": "error",
                    "message": "Label akhir M.02 Persetujuan harus «Disetujui oleh».",
                    "section_key": "accountability",
                }
            )
        if doc_type == "M.02_PELAPORAN" and final_label != "Diterima oleh":
            findings.append(
                {
                    "id": "VAL-ACC-LABEL",
                    "severity": "error",
                    "message": "Label akhir M.02 Pelaporan harus «Diterima oleh».",
                    "section_key": "accountability",
                }
            )

    # Signatory for M.01
    if tmpl and tmpl.get("accountability", {}).get("mode") == "signatory_only":
        sig = doc.get("signatory") or {}
        if _is_blank(sig.get("name")) or _is_blank(sig.get("title")):
            findings.append(
                {
                    "id": "VAL-ACC-REQ",
                    "severity": "error",
                    "message": "Penandatangan (nama & jabatan) wajib diisi.",
                    "section_key": "signatory",
                }
            )

    # Document number placeholder
    number = meta.get("document_number") or ""
    if not number.strip() or "placeholder" in number.lower() or number.strip() == "-":
        findings.append(
            {
                "id": "VAL-NO-PLACEHOLDER",
                "severity": "warning",
                "message": "Nomor dokumen masih kosong/placeholder.",
                "section_key": "metadata",
                "field": "document_number",
            }
        )

    # Rahasia
    if meta.get("classification") == "Rahasia":
        findings.append(
            {
                "id": "VAL-RAHASIA",
                "severity": "warning",
                "message": "Dokumen bersifat Rahasia — pastikan akses dan penanganan sesuai ketentuan.",
                "section_key": "metadata",
            }
        )

    # Fonts for final export
    if for_final_export:
        ok, missing = font_assets_ready()
        if not ok:
            # Prototype policy: block only if FORCE_OFFICIAL_FONTS=1; otherwise warning + embed fallback notice
            findings.append(
                {
                    "id": "VAL-FONT",
                    "severity": "warning",
                    "message": (
                        "Font resmi Optima/Frutiger belum terpasang di assets/fonts. "
                        f"Missing: {', '.join(missing)}. Preview/export memakai font fallback bertanda needs_bi_verification."
                    ),
                    "section_key": "config",
                }
            )

    return findings


def can_final_export(findings: list[dict[str, Any]]) -> bool:
    return not any(f["severity"] == "error" for f in findings)
