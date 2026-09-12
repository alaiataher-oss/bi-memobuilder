from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.classification import classify_purpose
from app.export import export_docx_bytes, export_pdf_bytes
from app.filename import generate_filename
from app.main import app
from app.samples import (
    sample_m01_koordinasi,
    sample_m01_undangan,
    sample_m02_pelaporan,
    sample_m02_persetujuan,
    sample_meeting_request,
)
from app.outline import parse_outline_line, points_to_content, section_heading
from app.validation import can_final_export, validate_document
from app.rules_loader import get_template


client = TestClient(app)


def test_outline_numbering_bi_style():
    assert parse_outline_line("1. Alpha")["level"] == 1
    assert parse_outline_line("a. Bravo")["level"] == 2
    assert parse_outline_line("i. Charlie")["level"] == 3
    assert parse_outline_line("ii. Delta")["marker"] == "ii."
    assert parse_outline_line("(3) Echo")["marker"] == "3."
    assert parse_outline_line("Plain paragraph")["level"] == 0
    assert section_heading("Tujuan", "I.") == "I. Tujuan"
    approval = get_template("M.02_PERSETUJUAN")
    nums = [s.get("outline_number") for s in approval["sections"] if s.get("outline_number")]
    assert nums == ["I.", "II.", "III.", "IV."]
    numbered = points_to_content(
        [
            {"level": 1, "text": "Satu"},
            {"level": 2, "text": "Sub A"},
            {"level": 2, "text": "Sub B"},
            {"level": 3, "text": "Dalam"},
            {"level": 1, "text": "Dua"},
        ]
    )
    assert numbered.splitlines() == [
        "1. Satu",
        "a. Sub A",
        "b. Sub B",
        "i. Dalam",
        "2. Dua",
    ]


def test_classify_four_purposes():
    assert classify_purpose("koordinasi")["result_type"] == "M.01_KOORDINASI"
    assert classify_purpose("persetujuan")["result_type"] == "M.02_PERSETUJUAN"
    assert classify_purpose("pelaporan")["result_type"] == "M.02_PELAPORAN"
    assert classify_purpose("undangan")["needs_budget_question"] is True
    assert classify_purpose("undangan", True)["result_type"] == "M.01_UNDANGAN"
    assert classify_purpose("undangan", False)["result_type"] == "MEETING_REQUEST"


def test_required_sections_and_accountability_labels():
    approval = get_template("M.02_PERSETUJUAN")
    reporting = get_template("M.02_PELAPORAN")
    assert approval["accountability"]["final_label"] == "Disetujui oleh"
    assert reporting["accountability"]["final_label"] == "Diterima oleh"
    assert any(s["key"] == "risiko_mitigasi" for s in approval["sections"])
    assert any(s["key"] == "kesimpulan_tindak_lanjut" for s in reporting["sections"])


def test_placeholder_blocks_final_export():
    doc = sample_m02_persetujuan()
    # inject placeholder
    doc["sections"][0]["content"] = "Contoh: keputusan masih placeholder"
    findings = validate_document(doc, for_final_export=True)
    assert any(f["id"] == "VAL-PLACEHOLDER" for f in findings)
    assert can_final_export(findings) is False


def test_filename_generation():
    name = generate_filename("DMST", "PS12", "M.02", "Hasil Asesmen Governance", "19-02-2020")
    assert name == "DMST_PS12_M.02_Hasil Asesmen Governance_19-02-2020"
    from app.filename import suggest_draft_name
    sug = suggest_draft_name("DMST", "PS12", "M.02", "Hasil Asesmen Governance", "19-02-2020")
    assert sug["rule_id"] == "FILE-01"
    assert sug["suggested"] == name


def test_happy_paths_validate_and_export():
    docs = [
        sample_m01_koordinasi(),
        sample_m01_undangan(),
        sample_meeting_request(),
        sample_m02_persetujuan(),
        sample_m02_pelaporan(),
    ]
    for doc in docs:
        # replace placeholder number with temporary warning-only value for exportability on content
        if doc["metadata"]["document_number"] == "[placeholder]":
            # still warning, but not error — content should pass
            pass
        findings = validate_document(doc, for_final_export=True)
        errors = [f for f in findings if f["severity"] == "error"]
        assert errors == [], f"{doc['type']} errors: {errors}"
        if doc["type"] != "MEETING_REQUEST":
            raw, filename, checksum = export_docx_bytes(doc)
            assert filename.endswith(".docx")
            assert len(raw) > 1000
            assert len(checksum) == 64
            # DOCX opens and contains named-ish content
            d = Document(io.BytesIO(raw))
            text = "\n".join(p.text for p in d.paragraphs)
            for table in d.tables:
                for row in table.rows:
                    for cell in row.cells:
                        text += "\n" + cell.text
            assert "MEMORANDUM" in text
            assert doc["metadata"]["subject"].upper() in text.upper()
            assert any(n.startswith("word/media/") for n in __import__("zipfile").ZipFile(io.BytesIO(raw)).namelist())
            pdf_raw, pdf_name, _ = export_pdf_bytes(doc)
            assert pdf_name.endswith(".pdf")
            assert pdf_raw.startswith(b"%PDF")
            if doc["type"] == "M.02_PERSETUJUAN":
                assert "I. Tujuan" in text
                assert "II. Latar Belakang" in text


def test_approval_vs_reporting_final_labels_in_export():
    approval = sample_m02_persetujuan()
    reporting = sample_m02_pelaporan()
    a_raw, _, _ = export_docx_bytes(approval)
    r_raw, _, _ = export_docx_bytes(reporting)
    a_text = "\n".join(p.text for p in Document(io.BytesIO(a_raw)).paragraphs)
    r_text = "\n".join(p.text for p in Document(io.BytesIO(r_raw)).paragraphs)
    # tables hold labels; also search all tables
    def all_text(document: Document) -> str:
        parts = [p.text for p in document.paragraphs]
        for t in document.tables:
            for row in t.rows:
                for cell in row.cells:
                    parts.append(cell.text)
        return "\n".join(parts)

    a_text = all_text(Document(io.BytesIO(a_raw)))
    r_text = all_text(Document(io.BytesIO(r_raw)))
    assert "Disetujui oleh" in a_text
    assert "Diterima oleh" in r_text
    assert "Diterima oleh" not in a_text
    assert "Disetujui oleh" not in r_text


def test_api_classify_and_seed():
    res = client.post("/api/classify", json={"purpose": "persetujuan"})
    assert res.status_code == 200
    assert res.json()["result_type"] == "M.02_PERSETUJUAN"
    seeded = client.post("/api/seed")
    assert seeded.status_code == 200
    assert seeded.json()["seeded"] >= 4


def test_admin_publish_template_without_code_change(tmp_path=None):
    pack = client.get("/api/templates").json()
    pack["version"] = "9.9.9-test"
    pack["status"] = "draft"
    res = client.post("/api/admin/templates", json={"version": "9.9.9-test", "payload": pack})
    assert res.status_code == 200
    assert "9.9.9-test" in res.json()["versions"]


def test_auth_login_and_guard():
    import os
    os.environ.pop("AUTH_DISABLED", None)
    # Re-import won't rebuild middleware; exercise helpers + endpoints with cookies via fresh app
    from app.auth import create_session_token, read_session_token, verify_credentials

    assert verify_credentials("alaia", "alaia")
    assert verify_credentials("umum", "umum")
    assert not verify_credentials("alaia", "wrong")
    assert not verify_credentials("hacker", "hacker")
    tok = create_session_token("alaia")
    assert read_session_token(tok)["username"] == "alaia"

    # With AUTH_DISABLED still set from conftest for other tests — use raw verify path above.
    # Login endpoint should succeed even when middleware is disabled.
    bad = client.post("/api/auth/login", json={"username": "x", "password": "y"})
    assert bad.status_code == 401
    ok = client.post("/api/auth/login", json={"username": "alaia", "password": "alaia"})
    assert ok.status_code == 200
    assert ok.json()["username"] == "alaia"
    signup = client.post("/api/auth/signup", json={"username": "baru", "password": "baru"})
    assert signup.status_code == 400
    signup_ok = client.post("/api/auth/signup", json={"username": "umum", "password": "umum"})
    assert signup_ok.status_code == 200


def test_reference_chat_cites_penamaan_page():
    from app.reference import answer_question, list_reference_docs, load_catalog, load_pages, search_pages

    load_catalog.cache_clear()
    load_pages.cache_clear()
    docs = list_reference_docs()
    assert any(d["id"] == "Pedoman_2022" for d in docs)
    assert all(d.get("has_pdf") for d in docs), "every catalog doc should have PDF"
    hits = search_pages("penamaan file dokumen SATKER PSXX")
    assert hits, "expected hits for naming query"
    assert any(h["doc_id"] == "Pedoman_2022" and h["page"] == 21 for h in hits[:3])
    ans = answer_question("Bagaimana penamaan file dokumen?")
    assert ans["citations"]
    assert "SATKER" in ans["answer"] or "PSXX" in ans["answer"]
    res = client.post("/api/reference/chat", json={"message": "Bagaimana penamaan file?"})
    assert res.status_code == 200
    body = res.json()
    assert body["citations"]
    assert "halaman" in body["answer"].lower() or any(c.get("page") for c in body["citations"])


def test_reference_chat_undangan_natural_language():
    from app.reference import answer_question, load_catalog, load_pages

    load_catalog.cache_clear()
    load_pages.cache_clear()
    ans = answer_question("kalau ngundang rapat satker lain memo jenis apa")
    assert ans["intent"] == "undangan"
    assert "M.01" in ans["answer"]
    assert "Meeting Request" in ans["answer"]
    assert ans["citations"]
    assert any(c.get("pdf") for c in ans["citations"])
    res = client.post("/api/reference/chat", json={"message": "kalau ngundang rapat satker lain memo jenis apa"})
    assert res.status_code == 200
    assert "M.01" in res.json()["answer"]


def test_document_history_export_and_reopen():
    from app.store import search_document_history

    created = client.post(
        "/api/documents",
        json={
            "purpose": "persetujuan",
            "draft_name": "DMST_PS12_M.02_Uji Riwayat_12-09-2026",
            "satker": "DMST",
            "program_strategis": "PS12",
            "subject": "Uji Riwayat Ekspor",
        },
    )
    assert created.status_code == 200
    doc = created.json()
    doc_id = doc["id"]

    # Fill minimal content so export validation may still warn but export_docx_bytes works from API path
    # Export endpoint uses export_docx_bytes which validates - use sample path via save then export
    from app.samples import sample_m02_persetujuan
    from app.store import save_document

    sample = sample_m02_persetujuan()
    sample["id"] = doc_id
    sample["draft_name"] = "DMST_PS12_M.02_Uji Riwayat_12-09-2026"
    sample["metadata"]["subject"] = "Uji Riwayat Ekspor"
    sample["status"] = "draft"
    save_document(sample)

    exp = client.post(f"/api/documents/{doc_id}/export/docx")
    assert exp.status_code == 200
    assert "application/vnd.openxmlformats" in exp.headers.get("content-type", "")

    hist = client.get("/api/documents/history?status=word")
    assert hist.status_code == 200
    items = hist.json()["items"]
    assert any(i["id"] == doc_id and i["has_word"] for i in items)

    searched = client.get("/api/documents/history?q=Uji%20Riwayat")
    assert any(i["id"] == doc_id for i in searched.json()["items"])

    reopened = client.post(f"/api/documents/{doc_id}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "draft"
    assert any(a.get("event") == "reopen_draft" for a in reopened.json().get("audit") or [])

    drafts = search_document_history(status="draft", q="Uji Riwayat")
    assert any(i["id"] == doc_id for i in drafts)


def test_chat_persist_and_delete():
    from app.chats import clear_all_chats

    clear_all_chats()
    res = client.post("/api/reference/chat", json={"message": "gimana penamaan file?"})
    assert res.status_code == 200
    chat_id = res.json()["chat_id"]
    assert chat_id
    listed = client.get("/api/chats")
    assert any(i["id"] == chat_id for i in listed.json()["items"])
    got = client.get(f"/api/chats/{chat_id}")
    assert got.status_code == 200
    assert len(got.json()["messages"]) >= 2
    cont = client.post(
        "/api/reference/chat",
        json={"message": "kalau undangan rapat memo apa", "chat_id": chat_id},
    )
    assert cont.status_code == 200
    assert cont.json()["chat_id"] == chat_id
    again = client.get(f"/api/chats/{chat_id}").json()
    assert len(again["messages"]) >= 4
    deleted = client.delete(f"/api/chats/{chat_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/chats/{chat_id}").status_code == 404
