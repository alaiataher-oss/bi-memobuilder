from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import DATA

REF_DIR = DATA / "reference"
CORPUS_DIR = REF_DIR / "corpus"
CATALOG_PATH = REF_DIR / "catalog.json"

PAGE_SPLIT = re.compile(r"^--- PAGE (\d+) ---\s*$", re.MULTILINE)
TOKEN_RE = re.compile(r"[a-zA-Z0-9áéíóúàèìòùäëïöü.]+", re.UNICODE)

STOPWORDS = {
    "yang", "dan", "atau", "dari", "untuk", "dengan", "pada", "dalam", "adalah",
    "ini", "itu", "ke", "di", "apa", "bagaimana", "apakah", "tolong", "jelaskan",
    "sebutkan", "the", "a", "an", "of", "to", "in", "is", "are", "how", "what",
    "cara", "mohon", "bisa", "kah", "nya", "juga", "oleh", "sebagai", "akan",
}

SYNONYMS: dict[str, list[str]] = {
    "penamaan": ["penamaan", "nama", "filename", "file", "naming", "satker", "psxx", "judul"],
    "nama": ["penamaan", "nama", "file", "filename"],
    "file": ["penamaan", "file", "soft", "copy", "filename"],
    "m.01": ["m.01", "m01", "koordinasi", "undangan"],
    "m.02": ["m.02", "m02", "persetujuan", "pelaporan", "keputusan"],
    "undangan": ["undangan", "rapat", "meeting", "request", "anggaran"],
    "persetujuan": ["persetujuan", "keputusan", "m.02", "risiko", "mitigasi"],
    "pelaporan": ["pelaporan", "laporan", "diterima"],
    "rahasia": ["rahasia", "sifat", "rhs", "klasifikasi"],
    "sifat": ["sifat", "rahasia", "biasa", "klasifikasi"],
    "font": ["font", "optima", "frutiger", "huruf"],
    "tembusan": ["tembusan", "salinan", "cc"],
    "nomor": ["nomor", "penomoran", "agendaris"],
    "akuntabilitas": ["akuntabilitas", "disetujui", "diterima", "paraf"],
}


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\t", " ")).strip()


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in TOKEN_RE.findall(text or "") if len(t) > 1]


def _query_terms(question: str) -> list[str]:
    base = [t for t in _tokens(question) if t not in STOPWORDS]
    expanded: list[str] = []
    for t in base:
        expanded.append(t)
        for key, syns in SYNONYMS.items():
            if t == key or t in syns:
                expanded.extend(syns)
    # unique preserve order
    seen: set[str] = set()
    out: list[str] = []
    for t in expanded:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out or base


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_pages() -> list[dict[str, Any]]:
    catalog = load_catalog()
    pages: list[dict[str, Any]] = []
    for doc in catalog.get("documents") or []:
        path = CORPUS_DIR / doc["file"]
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8", errors="ignore")
        parts = PAGE_SPLIT.split(raw)
        # parts: [preamble, page_num, content, page_num, content, ...]
        i = 1
        while i + 1 < len(parts):
            page_no = int(parts[i])
            content = _normalize(parts[i + 1])
            if content:
                pages.append(
                    {
                        "doc_id": doc["id"],
                        "title": doc["title"],
                        "short": doc.get("short") or doc["id"],
                        "source_label": doc.get("source_label") or doc["file"],
                        "file": doc["file"],
                        "pdf": doc.get("pdf"),
                        "page": page_no,
                        "text": content,
                        "text_l": content.lower(),
                    }
                )
            i += 2
    return pages


def list_reference_docs() -> list[dict[str, Any]]:
    pages = load_pages()
    by_doc: dict[str, int] = {}
    for p in pages:
        by_doc[p["doc_id"]] = by_doc.get(p["doc_id"], 0) + 1
    out = []
    for doc in load_catalog().get("documents") or []:
        out.append(
            {
                **doc,
                "pages_indexed": by_doc.get(doc["id"], 0),
                "has_pdf": bool(doc.get("pdf") and (CORPUS_DIR / doc["pdf"]).exists()),
            }
        )
    return out


def get_page(doc_id: str, page: int) -> dict[str, Any] | None:
    for p in load_pages():
        if p["doc_id"] == doc_id and p["page"] == page:
            return p
    return None


def search_pages(question: str, *, limit: int = 5) -> list[dict[str, Any]]:
    terms = _query_terms(question)
    if not terms:
        return []
    q_l = (question or "").lower()
    scored: list[tuple[float, dict[str, Any]]] = []
    for page in load_pages():
        text_l = page["text_l"]
        score = 0.0
        hits = 0
        for t in terms:
            count = text_l.count(t)
            if count:
                hits += 1
                score += min(count, 8) * (2.5 if len(t) > 4 else 1.2)
        if not hits:
            continue
        score *= 1 + 0.35 * hits

        # Phrase / canonical-rule boosts
        if "penamaan file" in text_l:
            score += 40
        if "standar penamaan" in text_l:
            score += 35
        if "contoh penamaan" in text_l:
            score += 25
        if "psxx" in text_l and "dd-mm-yyyy" in text_l.replace(" ", ""):
            score += 30
        if "satker" in text_l and "program strategis" in text_l and "jenis" in text_l:
            score += 20
        # Prefer the first canonical naming page when the question is about naming
        if any(k in q_l for k in ("penamaan", "nama file", "filename", "naming")):
            if page["doc_id"] == "Pedoman_2022" and page["page"] in (21, 22):
                score += 50
        # Slight preference for denser short pages
        score += max(0, 12 - len(page["text"]) / 400)

        scored.append((score, page))
    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for score, page in scored[:limit]:
        excerpt = _best_excerpt(page["text"], terms)
        results.append(
            {
                "doc_id": page["doc_id"],
                "title": page["title"],
                "short": page["short"],
                "source_label": page["source_label"],
                "file": page["file"],
                "page": page["page"],
                "score": round(score, 2),
                "excerpt": excerpt,
            }
        )
    return results


def _best_excerpt(text: str, terms: list[str], radius: int = 180) -> str:
    lower = text.lower()
    best_idx = -1
    for t in terms:
        idx = lower.find(t)
        if idx >= 0 and (best_idx < 0 or idx < best_idx):
            best_idx = idx
    if best_idx < 0:
        snippet = text[: radius * 2]
    else:
        start = max(0, best_idx - radius)
        end = min(len(text), best_idx + radius)
        snippet = text[start:end]
        if start > 0:
            snippet = "…" + snippet
        if end < len(text):
            snippet = snippet + "…"
    return _normalize(snippet)


def answer_question(question: str) -> dict[str, Any]:
    q = (question or "").strip()
    if not q:
        return {
            "answer": "Tanyakan ketentuan BI, misalnya: bagaimana penamaan file dokumen?",
            "citations": [],
            "mode": "empty",
        }

    hits = search_pages(q, limit=5)
    if not hits:
        return {
            "answer": (
                "Saya tidak menemukan cuplikan yang cocok di korpus peraturan yang diindeks. "
                "Coba kata kunci lain, misalnya “penamaan file”, “M.02 persetujuan”, atau “sifat rahasia”."
            ),
            "citations": [],
            "mode": "no_hit",
        }

    top = hits[0]
    # Build extractive answer
    lines = [
        f"Berdasarkan korpus peraturan internal yang diindeks, berikut ringkasan relevan untuk pertanyaan Anda:",
        "",
        f"**Temuan utama** — {top['short']}, halaman {top['page']}:",
        top["excerpt"],
        "",
    ]
    if len(hits) > 1:
        lines.append("Sumber terkait lainnya:")
        for h in hits[1:4]:
            lines.append(f"- {h['short']} · hlm. {h['page']}: {_normalize(h['excerpt'][:160])}…")
        lines.append("")

    lines.append("Sitasi (klik/lihat di panel Repository):")
    for h in hits[:4]:
        lines.append(f"- `{h['source_label']}` · halaman **{h['page']}** · berkas `{h['file']}`")

    return {
        "answer": "\n".join(lines),
        "citations": hits,
        "mode": "rag_local",
        "disclaimer": "Jawaban diekstrak dari teks peraturan yang diunggah (pencarian lokal). Verifikasi ke dokumen resmi bila dipakai untuk keputusan formal.",
    }
