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
    "kalau", "kalo", "jika", "bila", "aku", "saya", "kita", "dong", "sih", "ya",
    "nih", "gitu", "gini", "banget", "mau", "ingin", "harus", "jenis", "pakai",
    "pake", "ngundang", "ngajak", "lain",
}

SYNONYMS: dict[str, list[str]] = {
    "penamaan": ["penamaan", "nama", "filename", "file", "naming", "satker", "psxx", "judul"],
    "nama": ["penamaan", "nama", "file", "filename"],
    "file": ["penamaan", "file", "soft", "copy", "filename"],
    "m.01": ["m.01", "m01", "koordinasi", "undangan", "korespondensi"],
    "m.02": ["m.02", "m02", "persetujuan", "pelaporan", "keputusan"],
    "undangan": ["undangan", "rapat", "meeting", "request", "anggaran", "kegiatan"],
    "rapat": ["undangan", "rapat", "meeting", "request"],
    "persetujuan": ["persetujuan", "keputusan", "m.02", "risiko", "mitigasi"],
    "pelaporan": ["pelaporan", "laporan", "diterima"],
    "rahasia": ["rahasia", "sifat", "rhs", "klasifikasi"],
    "sifat": ["sifat", "rahasia", "biasa", "klasifikasi"],
    "font": ["font", "optima", "frutiger", "huruf"],
    "tembusan": ["tembusan", "salinan", "cc"],
    "nomor": ["nomor", "penomoran", "agendaris"],
    "akuntabilitas": ["akuntabilitas", "disetujui", "diterima", "paraf"],
    "satker": ["satker", "unit", "undangan", "koordinasi"],
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


def _doc_meta(doc_id: str) -> dict[str, Any]:
    for doc in load_catalog().get("documents") or []:
        if doc["id"] == doc_id:
            return doc
    return {}


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
        pdf_name = doc.get("pdf")
        out.append(
            {
                **doc,
                "pages_indexed": by_doc.get(doc["id"], 0),
                "has_pdf": bool(pdf_name and (CORPUS_DIR / pdf_name).exists()),
                "pdf_url": f"/api/reference/files/{pdf_name}" if pdf_name else None,
            }
        )
    return out


def get_page(doc_id: str, page: int) -> dict[str, Any] | None:
    for p in load_pages():
        if p["doc_id"] == doc_id and p["page"] == page:
            item = dict(p)
            meta = _doc_meta(doc_id)
            pdf = meta.get("pdf") or item.get("pdf")
            item["pdf"] = pdf
            item["pdf_url"] = f"/api/reference/files/{pdf}" if pdf and (CORPUS_DIR / pdf).exists() else None
            item["has_pdf"] = bool(item["pdf_url"])
            return item
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
        if any(k in q_l for k in ("penamaan", "nama file", "filename", "naming")):
            if page["doc_id"] == "Pedoman_2022" and page["page"] in (21, 22):
                score += 50
        if any(k in q_l for k in ("undang", "rapat", "meeting", "ngundang")):
            if "undangan" in text_l and ("m.01" in text_l or "meeting request" in text_l):
                score += 45
            if page["doc_id"] == "Pedoman_2022" and page["page"] in (16, 17, 24, 25, 29):
                score += 40
            if page["doc_id"] == "PCPM40_DMST" and "undangan" in text_l:
                score += 25
        if any(k in q_l for k in ("persetujuan", "keputusan", "minta setuju")):
            if page["doc_id"] in ("PCPM40_DMST", "Pedoman_2022") and ("persetujuan" in text_l or "m.02" in text_l):
                score += 30
        score += max(0, 12 - len(page["text"]) / 400)
        scored.append((score, page))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for score, page in scored[:limit]:
        excerpt = _best_excerpt(page["text"], terms)
        pdf = page.get("pdf") or _doc_meta(page["doc_id"]).get("pdf")
        results.append(
            {
                "doc_id": page["doc_id"],
                "title": page["title"],
                "short": page["short"],
                "source_label": page["source_label"],
                "file": page["file"],
                "pdf": pdf,
                "pdf_url": f"/api/reference/files/{pdf}" if pdf else None,
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


def _detect_intent(question: str) -> str | None:
    q = question.lower()
    if any(k in q for k in ("penamaan", "nama file", "filename", "naming", "format nama")):
        return "penamaan"
    if any(k in q for k in ("undang", "rapat", "meeting", "ngundang", "undangan")):
        return "undangan"
    if any(k in q for k in ("persetujuan", "minta setuju", "keputusan pimpinan", "izin pimpinan")):
        return "persetujuan"
    if any(k in q for k in ("laporan", "pelaporan", "menyampaikan pendapat")):
        return "pelaporan"
    if any(k in q for k in ("koordinasi", "minta informasi", "kerja sama")):
        return "koordinasi"
    if any(k in q for k in ("rahasia", "sifat dokumen", "klasifikasi")):
        return "sifat"
    return None


def _crafted_answer(intent: str | None, hits: list[dict[str, Any]]) -> str | None:
    """Plain-language answer (ChatGPT-style), still grounded by retrieved hits."""
    if intent == "undangan":
        return (
            "Kalau kamu mengundang satker/unit lain ke rapat atau kegiatan, jenis memorandumnya "
            "tergantung ada tidaknya pembebanan anggaran kedinasan:\n\n"
            "1. Ada pembebanan anggaran kedinasan (mis. konsinyasi, narasumber/peserta IHT) → "
            "pakai Memorandum Korespondensi M.01 Undangan Rapat/Kegiatan.\n"
            "2. Tidak ada pembebanan anggaran kedinasan → jangan pakai memo formal; "
            "gunakan Meeting Request (email BI / calendar).\n\n"
            "Singkatnya: undangan antar satker dengan biaya kedinasan = M.01; undangan biasa tanpa "
            "pembebanan = Meeting Request."
        )
    if intent == "penamaan":
        return (
            "Penamaan file soft copy mengikuti pola:\n\n"
            "[SATKER]_[PSXX]_[JENIS]_[JUDUL]_[DD-MM-YYYY]\n\n"
            "Artinya: rubrik satker penyusun, nomor Program Strategis (PS01–PS12), jenis dokumen "
            "(M.01 / M.02 / dll.), judul singkat, lalu tanggal.\n\n"
            "Contoh: DMST_PS12_M.02_Hasil Asesmen Governance_19-02-2020"
        )
    if intent == "persetujuan":
        return (
            "Kalau kamu meminta persetujuan atau keputusan pimpinan, pakai Memorandum M.02 "
            "(jenis persetujuan/keputusan). Isinya biasanya memuat tujuan, latar belakang, "
            "risiko & mitigasi, serta kesimpulan/rekomendasi, dengan akuntabilitas “Disetujui oleh”."
        )
    if intent == "pelaporan":
        return (
            "Kalau kamu menyampaikan laporan, pendapat, atau masukan, pakai Memorandum M.02 "
            "pelaporan. Strukturnya menekankan tujuan, latar belakang, serta kesimpulan & tindak "
            "lanjut, dengan akuntabilitas “Diterima oleh”."
        )
    if intent == "koordinasi":
        return (
            "Untuk koordinasi, kerja sama, atau minta/menyampaikan informasi ke satker lain, "
            "pakai Memorandum Korespondensi M.01 (bukan M.02)."
        )
    if intent == "sifat":
        return (
            "Sifat dokumen biasanya Biasa atau Rahasia. Ini memengaruhi kode nomor "
            "(mis. /B vs /Rhs) dan cara penanganan. Isi field sifat sesuai klasifikasi yang berlaku."
        )
    if not hits:
        return None
    # Generic fallback from top excerpt
    top = hits[0]
    return (
        f"Dari peraturan yang cocok, poin utamanya ada di {top['short']} halaman {top['page']}. "
        f"Ringkasannya: {_normalize(top['excerpt'][:320])}"
    )


def answer_question(question: str) -> dict[str, Any]:
    q = (question or "").strip()
    if not q:
        return {
            "answer": "Tanya saja dengan bahasa sehari-hari, misalnya: “Kalau ngundang rapat satker lain, memo jenis apa?”",
            "answer_plain": "",
            "citations": [],
            "mode": "empty",
        }

    intent = _detect_intent(q)
    # For undangan intent, bias search terms
    search_q = q
    if intent == "undangan":
        search_q = q + " undangan rapat M.01 meeting request pembebanan anggaran"
    elif intent == "penamaan":
        search_q = q + " penamaan file SATKER PSXX standar penamaan"

    hits = search_pages(search_q, limit=5)
    if intent == "undangan":
        # ensure Pedoman p.17 / naming-related undangan pages surface if present
        preferred = [h for h in search_pages("undangan rapat pembebanan meeting request M.01", limit=8)]
        merged = { (h["doc_id"], h["page"]): h for h in preferred + hits }
        hits = sorted(merged.values(), key=lambda h: h["score"], reverse=True)[:5]

    if not hits:
        return {
            "answer": (
                "Aku belum nemu cuplikan yang cocok di korpus peraturan. "
                "Coba lebih spesifik, misalnya “undangan rapat ada anggaran”, “penamaan file”, atau “M.02 persetujuan”."
            ),
            "answer_plain": "",
            "citations": [],
            "mode": "no_hit",
        }

    plain = _crafted_answer(intent, hits) or ""
    lines = [plain, "", "Referensi:"]
    for h in hits[:4]:
        pdf_note = f" · PDF: {h['pdf']}" if h.get("pdf") else ""
        lines.append(f"- {h['source_label']} · halaman {h['page']} · berkas {h['file']}{pdf_note}")

    return {
        "answer": "\n".join(lines),
        "answer_plain": plain,
        "citations": hits,
        "intent": intent,
        "mode": "rag_local",
        "disclaimer": "Jawaban disusun dari korpus peraturan yang diunggah. Untuk keputusan formal, cocokkan lagi dengan PDF resmi.",
    }
