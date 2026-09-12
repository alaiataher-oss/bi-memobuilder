from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .ai_assist import polish_language, suggest_decision_wording
from .attachments import (
    delete_attachment_file,
    resolve_attachment_path,
    save_uploaded_image,
)
from .auth import (
    AuthMiddleware,
    clear_session_cookie,
    current_user,
    set_session_cookie,
    verify_credentials,
)
from .classification import classify_purpose
from .config import PURPOSE_OPTIONS, ROOT
from .examples import ROLE_GUIDANCE, example_for_doc_type, example_path, get_example, list_examples
from .export import build_email_body, export_docx_bytes, export_pdf_bytes
from .filename import generate_filename, suggest_draft_name
from .fonts import font_assets_ready
from .rules_loader import (
    get_template,
    list_rule_versions,
    list_template_versions,
    load_rules,
    load_templates,
    publish_rules,
    publish_templates,
)
from .samples import seed_all
from .store import (
    append_audit,
    clear_all_documents,
    get_document,
    list_documents,
    new_document_shell,
    record_export,
    reopen_as_draft,
    resolve_export_path,
    save_document,
    search_document_history,
)
from .validation import can_final_export, validate_document
from .chats import create_chat, delete_chat, get_chat, list_chats, save_chat
from .reference import (
    CORPUS_DIR,
    answer_question,
    get_page,
    list_reference_docs,
    search_pages,
)

app = FastAPI(title="BI MemoBuilder", version="0.1.0")
app.add_middleware(AuthMiddleware)

STATIC_DIR = ROOT / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ClassifyRequest(BaseModel):
    purpose: str
    budget_impact: bool | None = None


class CreateDocumentRequest(BaseModel):
    purpose: str
    budget_impact: bool | None = None
    override_type: str | None = None
    draft_name: str | None = None
    satker: str | None = None
    program_strategis: str | None = None
    subject: str | None = None


class SuggestNameRequest(BaseModel):
    satker: str = "DMST"
    program_strategis: str = "PS12"
    doc_type: str = "M.02"
    title: str = "Judul"
    date: str | None = None


class PolishRequest(BaseModel):
    text: str


class PublishRequest(BaseModel):
    version: str
    payload: dict[str, Any]


class AuthRequest(BaseModel):
    username: str
    password: str


class ReferenceChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    limit: int = 5
    chat_id: str | None = None


class ChatSaveRequest(BaseModel):
    title: str | None = None
    messages: list[dict[str, Any]] | None = None


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> HTMLResponse:
    if current_user(request):
        return HTMLResponse('<meta http-equiv="refresh" content="0;url=/" />')
    html = (STATIC_DIR / "login.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/api/auth/me")
def api_auth_me(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if not user:
        return {"authenticated": False}
    return {"authenticated": True, "username": user["username"]}


@app.post("/api/auth/login")
def api_auth_login(body: AuthRequest) -> JSONResponse:
    if not verify_credentials(body.username, body.password):
        raise HTTPException(401, "Username atau password salah")
    username = body.username.strip().lower()
    resp = JSONResponse({"ok": True, "username": username})
    set_session_cookie(resp, username)
    return resp


@app.post("/api/auth/signup")
def api_auth_signup(body: AuthRequest) -> JSONResponse:
    """Prototype: hanya 2 akun tetap (alaia / umum)."""
    u = body.username.strip().lower()
    if u not in ("alaia", "umum"):
        raise HTTPException(400, "Pendaftaran ditolak. Hanya akun alaia atau umum yang tersedia.")
    if not verify_credentials(body.username, body.password):
        raise HTTPException(400, "Password tidak sesuai akun yang disediakan.")
    resp = JSONResponse({"ok": True, "username": u, "created": False, "message": "Akun sudah tersedia, Anda masuk."})
    set_session_cookie(resp, u)
    return resp


@app.post("/api/auth/logout")
def api_auth_logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    clear_session_cookie(resp)
    return resp


@app.get("/api/health")
def health() -> dict[str, Any]:
    fonts_ok, missing = font_assets_ready()
    return {
        "status": "ok",
        "fonts_ready": fonts_ok,
        "missing_fonts": missing,
        "rule_versions": list_rule_versions(),
        "template_versions": list_template_versions(),
        "reference_docs": len(list_reference_docs()),
    }


@app.get("/api/examples")
def api_examples(doc_type: str | None = None) -> dict[str, Any]:
    items = list_examples()
    if doc_type:
        matched = example_for_doc_type(doc_type)
        items = [i for i in items if matched and i["id"] == matched["id"]]
    return {"items": items, "role_guidance": ROLE_GUIDANCE}


@app.get("/api/examples/{example_id}")
def api_example_detail(example_id: str) -> dict[str, Any]:
    item = get_example(example_id)
    if not item:
        raise HTTPException(404, "Contoh tidak ditemukan")
    return {**{k: v for k, v in item.items() if k != "path"}, "role_guidance": ROLE_GUIDANCE}


@app.get("/api/examples/{example_id}/file")
def api_example_file(example_id: str) -> FileResponse:
    path = example_path(example_id)
    if not path:
        raise HTTPException(404, "Berkas contoh tidak ditemukan")
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content_disposition_type="attachment",
    )


@app.get("/api/reference/docs")
def api_reference_docs() -> dict[str, Any]:
    return {"documents": list_reference_docs()}


@app.get("/api/reference/docs/{doc_id}/pages/{page}")
def api_reference_page(doc_id: str, page: int) -> dict[str, Any]:
    item = get_page(doc_id, page)
    if not item:
        raise HTTPException(404, "Halaman tidak ditemukan di korpus")
    return {
        "doc_id": item["doc_id"],
        "title": item["title"],
        "short": item["short"],
        "source_label": item["source_label"],
        "file": item["file"],
        "pdf": item.get("pdf"),
        "pdf_url": item.get("pdf_url"),
        "has_pdf": item.get("has_pdf"),
        "page": item["page"],
        "text": item["text"],
    }


@app.get("/api/reference/search")
def api_reference_search(q: str, limit: int = 8) -> dict[str, Any]:
    return {"query": q, "hits": search_pages(q, limit=max(1, min(limit, 12)))}


@app.post("/api/reference/chat")
def api_reference_chat(body: ReferenceChatRequest) -> dict[str, Any]:
    result = answer_question(body.message)
    # Optionally persist into an existing/new chat thread
    chat_id = body.chat_id
    try:
        if chat_id:
            chat = get_chat(chat_id)
            msgs = list(chat.get("messages") or [])
        else:
            chat = create_chat(title=body.message[:72])
            chat_id = chat["id"]
            msgs = []
        msgs.append({"role": "user", "text": body.message})
        msgs.append(
            {
                "role": "assistant",
                "text": result.get("answer") or "",
                "citations": result.get("citations") or [],
            }
        )
        chat = save_chat(chat_id, messages=msgs)
        result["chat_id"] = chat["id"]
        result["chat_title"] = chat.get("title")
    except FileNotFoundError:
        chat = create_chat(
            title=body.message[:72],
            messages=[
                {"role": "user", "text": body.message},
                {
                    "role": "assistant",
                    "text": result.get("answer") or "",
                    "citations": result.get("citations") or [],
                },
            ],
        )
        result["chat_id"] = chat["id"]
        result["chat_title"] = chat.get("title")
    return result


@app.get("/api/chats")
def api_list_chats() -> dict[str, Any]:
    return {"items": list_chats()}


@app.post("/api/chats")
def api_create_chat(body: ChatSaveRequest | None = None) -> dict[str, Any]:
    body = body or ChatSaveRequest()
    return create_chat(title=body.title, messages=body.messages)


@app.get("/api/chats/{chat_id}")
def api_get_chat(chat_id: str) -> dict[str, Any]:
    try:
        return get_chat(chat_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Chat tidak ditemukan") from exc


@app.put("/api/chats/{chat_id}")
def api_save_chat(chat_id: str, body: ChatSaveRequest) -> dict[str, Any]:
    try:
        return save_chat(chat_id, title=body.title, messages=body.messages)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Chat tidak ditemukan") from exc


@app.delete("/api/chats/{chat_id}")
def api_delete_chat(chat_id: str) -> dict[str, Any]:
    ok = delete_chat(chat_id)
    if not ok:
        raise HTTPException(404, "Chat tidak ditemukan")
    return {"ok": True, "id": chat_id}


@app.get("/api/reference/files/{filename}")
def api_reference_file(filename: str, download: bool = False) -> FileResponse:
    # Only allow files inside corpus
    safe = Path(filename).name
    path = CORPUS_DIR / safe
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Berkas referensi tidak ditemukan")
    media = "application/pdf" if safe.lower().endswith(".pdf") else "application/octet-stream"
    # Preview: inline without filename so browsers don't force-download.
    # Download: attachment only when download=1 (after explicit user consent in UI).
    if download:
        return FileResponse(
            path,
            filename=safe,
            media_type=media,
            content_disposition_type="attachment",
            headers={"Cache-Control": "private, max-age=120"},
        )
    return FileResponse(
        path,
        media_type=media,
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "private, max-age=120",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/purposes")
def purposes() -> list[dict[str, str]]:
    return PURPOSE_OPTIONS


@app.post("/api/classify")
def api_classify(body: ClassifyRequest) -> dict[str, Any]:
    try:
        return classify_purpose(body.purpose, body.budget_impact)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/templates")
def api_templates(version: str | None = None) -> dict[str, Any]:
    pack = load_templates(version) if version else load_templates()
    return pack


@app.get("/api/templates/{doc_type}")
def api_template(doc_type: str, version: str | None = None) -> dict[str, Any]:
    try:
        return get_template(doc_type, version or "1.1.0")
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/rules")
def api_rules(version: str | None = None) -> dict[str, Any]:
    return load_rules(version) if version else load_rules()


@app.get("/api/documents")
def api_list_documents(q: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    if q or status:
        return search_document_history(q=q, status=status)
    return list_documents()


@app.get("/api/documents/history")
def api_document_history(q: str | None = None, status: str | None = None) -> dict[str, Any]:
    items = search_document_history(q=q, status=status)
    return {
        "items": items,
        "counts": {
            "all": len(list_documents()),
            "draft": len(search_document_history(status="draft")),
            "word": len(search_document_history(status="word")),
        },
    }


@app.post("/api/documents/{doc_id}/reopen")
def api_reopen_draft(doc_id: str) -> dict[str, Any]:
    try:
        return reopen_as_draft(doc_id, actor="user")
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc


@app.get("/api/documents/{doc_id}/exports/{stored_name}")
def api_download_stored_export(doc_id: str, stored_name: str) -> FileResponse:
    try:
        get_document(doc_id)
        path = resolve_export_path(doc_id, stored_name)
    except FileNotFoundError as exc:
        raise HTTPException(404, "File ekspor tidak ditemukan") from exc
    return FileResponse(
        path,
        filename=Path(stored_name).name.split("_", 1)[-1] if "_" in stored_name else stored_name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content_disposition_type="attachment",
    )


@app.delete("/api/documents")
def api_clear_documents() -> dict[str, Any]:
    cleared = clear_all_documents()
    return {"ok": True, "cleared": cleared}


@app.post("/api/documents")
def api_create_document(body: CreateDocumentRequest) -> dict[str, Any]:
    classification = classify_purpose(body.purpose, body.budget_impact)
    if classification.get("needs_budget_question"):
        raise HTTPException(400, "Undangan memerlukan jawaban pembebanan anggaran.")
    doc_type = body.override_type or classification["result_type"]
    doc = new_document_shell(doc_type, body.purpose, body.budget_impact)
    tmpl = get_template(doc_type)
    code = tmpl.get("doc_type_code") or "DOC"
    satker = (body.satker or "").strip() or "DMST"
    ps = (body.program_strategis or "").strip() or "PS12"
    subject = (body.subject or "").strip()
    suggested = suggest_draft_name(satker, ps, code, subject or classification.get("label") or "Draft")
    draft_name = (body.draft_name or "").strip() or suggested["suggested"]
    doc["draft_name"] = draft_name
    doc["metadata"]["draft_name"] = draft_name
    doc["metadata"]["satker"] = satker
    doc["metadata"]["program_strategis"] = ps
    if subject:
        doc["metadata"]["subject"] = subject
    if body.override_type and body.override_type != classification["result_type"]:
        doc.setdefault("audit", []).append(
            {
                "event": "classification_override",
                "from": classification["result_type"],
                "to": body.override_type,
            }
        )
    return save_document(doc)


@app.post("/api/suggest-name")
def api_suggest_name(body: SuggestNameRequest) -> dict[str, str]:
    return suggest_draft_name(
        body.satker,
        body.program_strategis,
        body.doc_type,
        body.title,
        body.date,
    )


@app.get("/api/documents/{doc_id}")
def api_get_document(doc_id: str) -> dict[str, Any]:
    try:
        return get_document(doc_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc


@app.put("/api/documents/{doc_id}")
def api_save_document(doc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    payload["id"] = doc_id
    doc = save_document(payload)
    return doc


@app.post("/api/documents/{doc_id}/validate")
def api_validate(doc_id: str, for_final_export: bool = False) -> dict[str, Any]:
    try:
        doc = get_document(doc_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc
    findings = validate_document(doc, for_final_export=for_final_export)
    return {"findings": findings, "can_export": can_final_export(findings)}


@app.post("/api/validate")
def api_validate_payload(payload: dict[str, Any], for_final_export: bool = False) -> dict[str, Any]:
    findings = validate_document(payload, for_final_export=for_final_export)
    return {"findings": findings, "can_export": can_final_export(findings)}


@app.post("/api/documents/{doc_id}/export/docx")
def api_export_docx(doc_id: str) -> Response:
    try:
        doc = get_document(doc_id)
        raw, filename, checksum = export_docx_bytes(doc)
        record_export(doc_id, kind="docx", filename=filename, raw=raw, checksum=checksum, actor="user")
        return Response(
            content=raw,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Checksum": checksum},
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/documents/{doc_id}/export/pdf")
def api_export_pdf(doc_id: str) -> Response:
    try:
        doc = get_document(doc_id)
        raw, filename, checksum = export_pdf_bytes(doc)
        record_export(doc_id, kind="pdf", filename=filename, raw=raw, checksum=checksum, actor="user")
        return Response(
            content=raw,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Checksum": checksum},
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/documents/{doc_id}/email-body")
def api_email_body(doc_id: str) -> dict[str, str]:
    try:
        doc = get_document(doc_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc
    if doc.get("type") != "MEETING_REQUEST":
        raise HTTPException(400, "Email body hanya untuk Meeting Request.")
    body = build_email_body(doc)
    append_audit(doc_id, "copy_email_body", actor="demo.user")
    return {"body": body}


@app.post("/api/ai/polish")
def api_polish(body: PolishRequest) -> dict[str, str]:
    # Never send to external providers in MVP
    return polish_language(body.text)


@app.post("/api/ai/suggest-decision")
def api_suggest_decision(body: PolishRequest) -> dict[str, str]:
    return suggest_decision_wording(body.text)


@app.post("/api/admin/rules")
def api_publish_rules(body: PublishRequest) -> dict[str, Any]:
    path = publish_rules(body.version, body.payload)
    return {"ok": True, "path": str(path), "versions": list_rule_versions()}


@app.post("/api/admin/templates")
def api_publish_templates(body: PublishRequest) -> dict[str, Any]:
    path = publish_templates(body.version, body.payload)
    return {"ok": True, "path": str(path), "versions": list_template_versions()}


@app.post("/api/documents/{doc_id}/attachments/upload")
async def api_upload_attachment(doc_id: str, file: UploadFile = File(...), index: int | None = None) -> dict[str, Any]:
    try:
        doc = get_document(doc_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Dokumen tidak ditemukan") from exc
    raw = await file.read()
    try:
        meta = save_uploaded_image(doc_id, file.filename or "screenshot.png", file.content_type or "", raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    items = doc.setdefault("attachments_list", [])
    if index is None or index < 0 or index >= len(items):
        items.append(
            {
                "id": meta["stored_name"],
                "type": "image",
                "title": Path(meta["original_name"]).stem,
                "description": "",
                "image": meta,
            }
        )
        index = len(items) - 1
    else:
        old = items[index].get("image") or {}
        delete_attachment_file(doc_id, old.get("stored_name"))
        items[index]["type"] = "image"
        items[index]["image"] = meta
        if not (items[index].get("title") or "").strip():
            items[index]["title"] = Path(meta["original_name"]).stem
    save_document(doc, actor="demo.user")
    append_audit(doc_id, "attachment_upload", filename=meta["original_name"], actor="demo.user")
    return {"ok": True, "index": index, "item": items[index], "document": doc}


@app.get("/api/documents/{doc_id}/attachments/{stored_name}")
def api_download_attachment(doc_id: str, stored_name: str) -> FileResponse:
    try:
        get_document(doc_id)
        path = resolve_attachment_path(doc_id, stored_name)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Lampiran tidak ditemukan") from exc
    # original name from doc if available
    download_name = stored_name
    try:
        doc = get_document(doc_id)
        for item in doc.get("attachments_list") or []:
            img = item.get("image") or {}
            if img.get("stored_name") == Path(stored_name).name:
                download_name = img.get("original_name") or stored_name
                break
    except FileNotFoundError:
        pass
    return FileResponse(path, filename=download_name)


@app.post("/api/seed")
def api_seed() -> dict[str, Any]:
    docs = seed_all()
    return {"seeded": len(docs), "ids": [d["id"] for d in docs]}


@app.get("/api/filename-preview")
def api_filename_preview(satker: str, ps: str, doc_type: str, title: str, date: str | None = None) -> dict[str, str]:
    return {"filename": generate_filename(satker, ps, doc_type, title, date)}
