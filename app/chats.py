from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DATA
import os

_WRITABLE = Path("/tmp/bi-memobuilder") if os.environ.get("VERCEL") else DATA
CHATS_DIR = _WRITABLE / "chats"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(chat_id: str) -> Path:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    return CHATS_DIR / f"{chat_id}.json"


def list_chats() -> list[dict[str, Any]]:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(CHATS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        data = json.loads(path.read_text(encoding="utf-8"))
        msgs = data.get("messages") or []
        preview = ""
        for m in msgs:
            if m.get("role") == "user" and (m.get("text") or "").strip():
                preview = (m.get("text") or "").strip()
                break
        items.append(
            {
                "id": data["id"],
                "title": data.get("title") or preview[:60] or "Percakapan baru",
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
                "message_count": len(msgs),
                "preview": preview[:100],
            }
        )
    return items


def get_chat(chat_id: str) -> dict[str, Any]:
    path = _path(chat_id)
    if not path.exists():
        raise FileNotFoundError(chat_id)
    return json.loads(path.read_text(encoding="utf-8"))


def create_chat(*, title: str | None = None, messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    chat_id = str(uuid.uuid4())
    now = _now()
    msgs = messages or []
    title_final = (title or "").strip()
    if not title_final:
        for m in msgs:
            if m.get("role") == "user" and (m.get("text") or "").strip():
                title_final = (m.get("text") or "").strip()[:72]
                break
    if not title_final:
        title_final = "Percakapan baru"
    data = {
        "id": chat_id,
        "title": title_final,
        "messages": msgs,
        "created_at": now,
        "updated_at": now,
    }
    _path(chat_id).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def save_chat(chat_id: str, *, title: str | None = None, messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    data = get_chat(chat_id)
    if title is not None:
        data["title"] = (title or "").strip() or data.get("title") or "Percakapan baru"
    if messages is not None:
        data["messages"] = messages
        # refresh title from first user message if still default-ish
        if not title and (not data.get("title") or data["title"] == "Percakapan baru"):
            for m in messages:
                if m.get("role") == "user" and (m.get("text") or "").strip():
                    data["title"] = (m.get("text") or "").strip()[:72]
                    break
    data["updated_at"] = _now()
    _path(chat_id).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def delete_chat(chat_id: str) -> bool:
    path = _path(chat_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def clear_all_chats() -> int:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for path in CHATS_DIR.glob("*.json"):
        path.unlink(missing_ok=True)
        n += 1
    return n
