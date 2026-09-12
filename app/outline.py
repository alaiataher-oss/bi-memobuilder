"""BI memorandum outline numbering — aligned with contoh M.02 DOCX.

Hierarchy (Word numbering abstracts in examples):
  Level 0 (bagian): I. II. III.   (upperRoman)
  Level 1 (angka):  1. 2. 3.     (decimal)
  Level 2 (huruf):  a. b. c.     (lowerLetter)
  Level 3 (romawi): i. ii. iii.  (lowerRoman)

Source: assets/examples/M02_persetujuan_example.docx numbering.xml;
PCPM 40 DMST struktur M.02.
"""

from __future__ import annotations

import re
from typing import Any

# Normalize common variants → canonical marker text (without trailing space)
_RE_L1 = re.compile(r"^\s*(?:\(?(\d+)\)?[.)])\s+(.*)$")
_RE_L3 = re.compile(
    r"^\s*(?:\(?((?:ix|iv|iii|ii|i|viii|vii|vi|v|xii|xi|x))\)?[.)])\s+(.*)$",
    re.IGNORECASE,
)
_RE_L2 = re.compile(r"^\s*(?:\(?([a-z])\)?[.)])\s+(.*)$", re.IGNORECASE)

# Indent roughly matching example hanging indents (pt for docx; mm for CSS elsewhere)
LEVEL_INDENT_CM = {
    1: 0.63,   # ~17.85–35 pt in example
    2: 1.25,
    3: 1.75,
}
LEVEL_HANGING_CM = {
    1: 0.5,
    2: 0.45,
    3: 0.5,
}


def roman_upper(n: int) -> str:
    vals = [
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    ]
    out = []
    for v, s in vals:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


def parse_outline_line(line: str) -> dict[str, Any]:
    """Parse one line into outline level 1–3 or plain body (level 0)."""
    raw = line.rstrip("\n")
    if not raw.strip():
        return {"level": 0, "marker": "", "text": "", "blank": True}

    # Prefer roman (i./ii./iii.) over single letter before letter match
    m3 = _RE_L3.match(raw)
    if m3:
        token = m3.group(1).lower()
        # Single letter that is also roman numeral glyph: treat as L3 (contoh BI)
        if token in {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"}:
            return {"level": 3, "marker": f"{token}.", "text": m3.group(2), "blank": False}

    m1 = _RE_L1.match(raw)
    if m1:
        return {"level": 1, "marker": f"{m1.group(1)}.", "text": m1.group(2), "blank": False}

    m2 = _RE_L2.match(raw)
    if m2:
        letter = m2.group(1).lower()
        return {"level": 2, "marker": f"{letter}.", "text": m2.group(2), "blank": False}

    return {"level": 0, "marker": "", "text": raw.strip(), "blank": False}


def parse_outline_blocks(text: str) -> list[dict[str, Any]]:
    return [parse_outline_line(line) for line in (text or "").split("\n")]


def roman_lower(n: int) -> str:
    return roman_upper(n).lower()


def letter_marker(n: int) -> str:
    if 1 <= n <= 26:
        return chr(ord("a") + n - 1)
    return str(n)


def assign_markers(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Auto-number points: 1. 2. 3. / a. b. c. / i. ii. iii. by level."""
    counters = {1: 0, 2: 0, 3: 0}
    out: list[dict[str, Any]] = []
    for raw in points or []:
        level = int(raw.get("level") or 1)
        level = 1 if level < 1 else 3 if level > 3 else level
        for deeper in (2, 3):
            if deeper > level:
                counters[deeper] = 0
        counters[level] += 1
        n = counters[level]
        if level == 1:
            marker = f"{n}."
        elif level == 2:
            marker = f"{letter_marker(n)}."
        else:
            marker = f"{roman_lower(n)}."
        item = dict(raw)
        item["level"] = level
        item["marker"] = marker
        out.append(item)
    return out


def points_to_content(points: list[dict[str, Any]], *, keep_empty: bool = False) -> str:
    lines = []
    for p in assign_markers(points):
        text = (p.get("text") or "").strip()
        if not text and not keep_empty:
            continue
        lines.append(f"{p['marker']} {text}".rstrip())
    return "\n".join(lines)


def content_to_points(text: str) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for block in parse_outline_blocks(text or ""):
        if block.get("blank"):
            continue
        if block["level"] == 0:
            points.append({"level": 1, "text": block["text"]})
        else:
            points.append({"level": block["level"], "text": block["text"]})
    return points


_ID_COUNT_WORDS = {
    1: "satu",
    2: "dua",
    3: "tiga",
    4: "empat",
    5: "lima",
    6: "enam",
    7: "tujuh",
    8: "delapan",
    9: "sembilan",
    10: "sepuluh",
}


def format_attachment_count(n: int, unit: str = "berkas") -> str:
    if n <= 0:
        return "-"
    word = _ID_COUNT_WORDS.get(n, str(n))
    return f"{n} ({word}) {unit}"


def section_heading(title: str, outline_number: str | None) -> str:
    if not outline_number:
        return title
    num = outline_number.strip()
    if not num.endswith("."):
        num = f"{num}."
    # Avoid double-prefix if title already starts with I. / II.
    if re.match(rf"^{re.escape(num)}\s", title.strip(), re.IGNORECASE):
        return title.strip()
    return f"{num} {title.strip()}"


def assign_outline_numbers(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ensure each section dict may carry outline_number; fill from explicit field or skip."""
    # Templates already set outline_number; this helper only normalizes.
    out = []
    for sec in sections:
        s = dict(sec)
        on = s.get("outline_number")
        if on:
            s["outline_number"] = on if str(on).endswith(".") else f"{on}."
        out.append(s)
    return out
