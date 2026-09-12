from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import ACTIVE_RULE_VERSION, ACTIVE_TEMPLATE_VERSION, RULES_DIR, TEMPLATES_DIR


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=16)
def load_rules(version: str = ACTIVE_RULE_VERSION) -> dict[str, Any]:
    return _read_json(RULES_DIR / version / "rules.json")


@lru_cache(maxsize=16)
def load_templates(version: str = ACTIVE_TEMPLATE_VERSION) -> dict[str, Any]:
    return _read_json(TEMPLATES_DIR / version / "templates.json")


def list_rule_versions() -> list[str]:
    return sorted(p.name for p in RULES_DIR.iterdir() if p.is_dir())


def list_template_versions() -> list[str]:
    return sorted(p.name for p in TEMPLATES_DIR.iterdir() if p.is_dir())


def get_template(doc_type: str, version: str = ACTIVE_TEMPLATE_VERSION) -> dict[str, Any]:
    pack = load_templates(version)
    try:
        return pack["templates"][doc_type]
    except KeyError as exc:
        raise KeyError(f"Unknown template type: {doc_type}") from exc


def publish_rules(version: str, payload: dict[str, Any]) -> Path:
    load_rules.cache_clear()
    target = RULES_DIR / version
    target.mkdir(parents=True, exist_ok=True)
    path = target / "rules.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def publish_templates(version: str, payload: dict[str, Any]) -> Path:
    load_templates.cache_clear()
    target = TEMPLATES_DIR / version
    target.mkdir(parents=True, exist_ok=True)
    path = target / "templates.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
