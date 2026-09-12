"""Document attachment file storage (images / screenshots)."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from .config import ATTACHMENTS_DIR

ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def doc_attach_dir(doc_id: str) -> Path:
    path = ATTACHMENTS_DIR / doc_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def attachment_is_meaningful(item: dict[str, Any]) -> bool:
    if (item.get("title") or item.get("description") or "").strip():
        return True
    kind = item.get("type") or "note"
    if kind == "table":
        table = item.get("table") or {}
        return bool(table.get("rows"))
    if kind == "image":
        return bool((item.get("image") or {}).get("stored_name"))
    return False


def save_uploaded_image(doc_id: str, filename: str, content_type: str, data: bytes) -> dict[str, Any]:
    ext = ALLOWED_IMAGE_TYPES.get((content_type or "").lower())
    if not ext:
        # fallback from filename
        suffix = Path(filename or "").suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            ext = ".jpg" if suffix == ".jpeg" else suffix
            content_type = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".webp": "image/webp",
                ".gif": "image/gif",
            }[ext]
        else:
            raise ValueError("Format gambar tidak didukung. Gunakan PNG, JPG, WEBP, atau GIF.")
    if len(data) > 12 * 1024 * 1024:
        raise ValueError("Ukuran file maksimal 12 MB.")
    safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(filename or "screenshot").stem)[:60] or "screenshot"
    stored = f"{uuid.uuid4().hex}_{safe_stem}{ext}"
    path = doc_attach_dir(doc_id) / stored
    path.write_bytes(data)
    return {
        "original_name": filename or stored,
        "stored_name": stored,
        "content_type": content_type,
        "size": len(data),
    }


def resolve_attachment_path(doc_id: str, stored_name: str) -> Path:
    safe = Path(stored_name).name
    path = doc_attach_dir(doc_id) / safe
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(stored_name)
    return path


def delete_attachment_file(doc_id: str, stored_name: str | None) -> None:
    if not stored_name:
        return
    try:
        resolve_attachment_path(doc_id, stored_name).unlink(missing_ok=True)
    except FileNotFoundError:
        pass
