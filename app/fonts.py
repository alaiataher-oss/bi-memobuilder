from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import ROOT
from .rules_loader import load_templates


def font_assets_ready(template_pack: dict[str, Any] | None = None) -> tuple[bool, list[str]]:
    pack = template_pack or load_templates()
    fonts = pack.get("styles", {}).get("fonts", {})
    missing: list[str] = []
    for key in ("optima_asset", "frutiger_asset"):
        rel = fonts.get(key)
        if not rel:
            missing.append(key)
            continue
        path = ROOT / rel
        if not path.exists():
            missing.append(str(rel))
    return (len(missing) == 0, missing)


def resolve_font_paths() -> dict[str, Path | None]:
    pack = load_templates()
    fonts = pack.get("styles", {}).get("fonts", {})
    optima = ROOT / fonts.get("optima_asset", "assets/fonts/Optima.ttf")
    frutiger = ROOT / fonts.get("frutiger_asset", "assets/fonts/Frutiger.ttf")
    return {
        "heading": optima if optima.exists() else None,
        "body": frutiger if frutiger.exists() else None,
    }
