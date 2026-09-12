from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import ACTIVE_RULE_VERSION, ACTIVE_TEMPLATE_VERSION, ATTACHMENTS_DIR, EXPORT_DIR, STORE_DIR


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_path(doc_id: str) -> Path:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    return STORE_DIR / f"{doc_id}.json"


def list_documents(*, include_rahasia_for: str | None = "owner") -> list[dict[str, Any]]:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(STORE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        data = json.loads(path.read_text(encoding="utf-8"))
        classification = (data.get("metadata") or {}).get("classification")
        # Prototype ACL: hide Rahasia from anonymous listing unless flag says owner
        if classification == "Rahasia" and include_rahasia_for != "owner":
            continue
        exports = data.get("exports") or []
        last_export = exports[-1] if exports else None
        items.append(
            {
                "id": data["id"],
                "type": data.get("type"),
                "draft_name": data.get("draft_name")
                or (data.get("metadata") or {}).get("draft_name")
                or (data.get("metadata") or {}).get("subject")
                or "(Tanpa nama)",
                "subject": (data.get("metadata") or {}).get("subject"),
                "status": data.get("status"),
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
                "classification": classification,
                "satker": (data.get("metadata") or {}).get("satker"),
                "template_version": data.get("template_version"),
                "rule_version": data.get("rule_version"),
                "export_count": len(exports),
                "last_export": last_export,
                "has_word": any(e.get("kind") == "docx" for e in exports),
            }
        )
    return items


def search_document_history(
    *,
    q: str | None = None,
    status: str | None = None,
    include_rahasia_for: str | None = "owner",
) -> list[dict[str, Any]]:
    """status: all | draft | exported (has Word) | word"""
    items = list_documents(include_rahasia_for=include_rahasia_for)
    status_key = (status or "all").strip().lower()
    if status_key in ("draft",):
        items = [i for i in items if (i.get("status") or "draft") == "draft"]
    elif status_key in ("exported", "word", "docx"):
        items = [i for i in items if i.get("has_word") or (i.get("status") == "exported")]
    query = (q or "").strip().lower()
    if query:
        filtered = []
        for i in items:
            blob = " ".join(
                str(x or "")
                for x in (
                    i.get("draft_name"),
                    i.get("subject"),
                    i.get("type"),
                    i.get("status"),
                    i.get("satker"),
                    i.get("classification"),
                    (i.get("last_export") or {}).get("filename"),
                )
            ).lower()
            if query in blob:
                filtered.append(i)
        items = filtered
    return items


def record_export(
    doc_id: str,
    *,
    kind: str,
    filename: str,
    raw: bytes,
    checksum: str,
    actor: str = "user",
) -> dict[str, Any]:
    """Persist exported file and mark document history."""
    doc = get_document(doc_id)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    folder = EXPORT_DIR / doc_id
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_name = Path(filename).name.replace("/", "_")
    stored_name = f"{stamp}_{safe_name}"
    (folder / stored_name).write_bytes(raw)

    entry = {
        "at": _now(),
        "kind": kind,
        "filename": filename,
        "stored_name": stored_name,
        "checksum": checksum,
        "actor": actor,
        "bytes": len(raw),
    }
    doc.setdefault("exports", []).append(entry)
    if kind == "docx":
        doc["status"] = "exported"
    doc.setdefault("audit", []).append({"event": f"export_{kind}", "at": entry["at"], **entry})
    doc["updated_at"] = entry["at"]
    _doc_path(doc_id).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def reopen_as_draft(doc_id: str, *, actor: str = "user") -> dict[str, Any]:
    """Bring an exported/finished document back into editable draft for revision."""
    doc = get_document(doc_id)
    prev = doc.get("status") or "draft"
    doc["status"] = "draft"
    doc["updated_at"] = _now()
    doc.setdefault("audit", []).append(
        {
            "event": "reopen_draft",
            "at": doc["updated_at"],
            "actor": actor,
            "from_status": prev,
        }
    )
    doc.setdefault("versions", []).append(
        {
            "version": len(doc.get("versions", [])) + 1,
            "at": doc["updated_at"],
            "actor": actor,
            "note": "reopen_for_revision",
            "checksum": None,
        }
    )
    _doc_path(doc_id).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def resolve_export_path(doc_id: str, stored_name: str) -> Path:
    safe = Path(stored_name).name
    path = EXPORT_DIR / doc_id / safe
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(stored_name)
    return path


def clear_all_documents() -> int:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in STORE_DIR.glob("*.json"):
        path.unlink(missing_ok=True)
        count += 1
    if ATTACHMENTS_DIR.exists():
        for child in ATTACHMENTS_DIR.iterdir():
            if child.is_dir():
                for f in child.rglob("*"):
                    if f.is_file():
                        f.unlink(missing_ok=True)
                try:
                    child.rmdir()
                except OSError:
                    pass
            elif child.is_file():
                child.unlink(missing_ok=True)
    if EXPORT_DIR.exists():
        for child in EXPORT_DIR.iterdir():
            if child.is_dir():
                for f in child.rglob("*"):
                    if f.is_file():
                        f.unlink(missing_ok=True)
                try:
                    child.rmdir()
                except OSError:
                    pass
            elif child.is_file():
                child.unlink(missing_ok=True)
    return count


def get_document(doc_id: str) -> dict[str, Any]:
    path = _doc_path(doc_id)
    if not path.exists():
        raise FileNotFoundError(doc_id)
    return json.loads(path.read_text(encoding="utf-8"))


def save_document(doc: dict[str, Any], *, actor: str = "user") -> dict[str, Any]:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    if not doc.get("id"):
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = _now()
        doc.setdefault("template_version", ACTIVE_TEMPLATE_VERSION)
        doc.setdefault("rule_version", ACTIVE_RULE_VERSION)
        doc.setdefault("versions", [])
        doc.setdefault("audit", [])
    doc["updated_at"] = _now()
    doc.setdefault("status", "draft")
    snapshot = {
        "at": doc["updated_at"],
        "actor": actor,
        "subject": (doc.get("metadata") or {}).get("subject"),
        "type": doc.get("type"),
    }
    doc.setdefault("versions", []).append(
        {
            "version": len(doc.get("versions", [])) + 1,
            "at": doc["updated_at"],
            "actor": actor,
            "checksum": None,
        }
    )
    doc.setdefault("audit", []).append({"event": "save", **snapshot})
    _doc_path(doc["id"]).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def append_audit(doc_id: str, event: str, **extra: Any) -> dict[str, Any]:
    doc = get_document(doc_id)
    doc.setdefault("audit", []).append({"event": event, "at": _now(), **extra})
    _doc_path(doc_id).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def new_document_shell(doc_type: str, purpose: str, budget_impact: bool | None = None) -> dict[str, Any]:
    from .rules_loader import get_template

    tmpl = get_template(doc_type)
    sections = []
    for sec in tmpl["sections"]:
        item = {
            "key": sec["key"],
            "content": "",
            "points": [],
            "body_mode": "prose",
            "table": None,
            "not_needed": False,
            "not_needed_reason": "",
            "ai_suggested": False,
        }
        if sec.get("supports_table") and sec.get("table_columns"):
            item["table"] = {"columns": list(sec["table_columns"]), "rows": []}
        if sec.get("input_mode") == "structured_fields":
            item["fields"] = {f["key"]: "" for f in sec.get("fields") or []}
        sections.append(item)
    accountability = {}
    if tmpl.get("accountability", {}).get("mode") == "grid":
        accountability = {
            "prepared_by": {"name": "", "title": "", "rank": ""},
            "reviewed_by": {"name": "", "title": "", "rank": ""},
            "supported_by": {"name": "", "title": "", "rank": ""},
        }
        if "Disetujui oleh" in tmpl["accountability"]["labels"]:
            accountability["approved_by"] = {"name": "", "title": "", "rank": ""}
        if "Diterima oleh" in tmpl["accountability"]["labels"]:
            accountability["received_by"] = {"name": "", "title": "", "rank": ""}

    return {
        "id": str(uuid.uuid4()),
        "type": doc_type,
        "purpose": purpose,
        "budget_impact": budget_impact,
        "classification": "Biasa",
        "status": "draft",
        "owner": "demo.user",
        "draft_name": "",
        "metadata": {
            "classification": "Biasa",
            "satker": "",
            "dari": "",
            "recipient": "",
            "via": "",
            "subject": "",
            "city_date": "",
            "document_number": "[placeholder]",
            "program_strategis": "PS12",
            "attachments": "-",
            "tembusan": [],
            "pic": "",
            "deadline": "",
            "draft_name": "",
        },
        "attachments_list": [],
        "sections": sections,
        "accountability": accountability,
        "signatory": {"name": "", "title": "", "rank": ""},
        "template_version": ACTIVE_TEMPLATE_VERSION,
        "rule_version": ACTIVE_RULE_VERSION,
        "created_at": _now(),
        "updated_at": _now(),
        "versions": [],
        "audit": [{"event": "create", "at": _now(), "actor": "demo.user"}],
    }
