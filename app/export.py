from __future__ import annotations

import hashlib
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY

from .config import ROOT
from .attachments import attachment_is_meaningful, resolve_attachment_path
from .filename import generate_filename
from .fonts import resolve_font_paths
from .outline import (
    LEVEL_HANGING_CM,
    LEVEL_INDENT_CM,
    format_attachment_count,
    parse_outline_blocks,
    points_to_content,
    section_heading,
)
from .rules_loader import get_template, load_templates
from .validation import can_final_export, validate_document


def _set_cell_border(cell, **kwargs) -> None:
    """Set cell borders; kwargs keys: top/left/bottom/right -> {sz, color, val}."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in("w:tcBorders")
    if tcBorders is None:
        tcBorders = OxmlElement("w:tcBorders")
        tcPr.append(tcBorders)
    for edge in ("top", "left", "bottom", "right"):
        element = tcBorders.find(qn(f"w:{edge}"))
        if element is not None:
            tcBorders.remove(element)
        if edge in kwargs:
            element = OxmlElement(f"w:{edge}")
            element.set(qn("w:val"), kwargs[edge].get("val", "single"))
            element.set(qn("w:sz"), str(kwargs[edge].get("sz", 12)))
            element.set(qn("w:space"), "0")
            element.set(qn("w:color"), kwargs[edge].get("color", "000000"))
            tcBorders.append(element)


def _clear_cell(cell) -> None:
    for p in list(cell.paragraphs):
        p._element.getparent().remove(p._element)


def _add_centered_run(paragraph, text: str, *, bold=False, underline=False, size_pt=11, font="Frutiger 45 Light"):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(text)
    run.bold = bold
    run.underline = underline
    run.font.size = Pt(size_pt)
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)
    return run


def _fill_accountability_cell(cell, label: str, person: dict[str, str], *, header_inside: bool = False) -> None:
    """Template blank M.02: name bold, then jabatan, pangkat (headers are table row)."""
    _clear_cell(cell)
    border = {"sz": 12, "color": "000000", "val": "single"}
    _set_cell_border(cell, top=border, left=border, bottom=border, right=border)

    if header_inside:
        head = cell.add_paragraph()
        _add_centered_run(head, f"{label}:", bold=True)

    name_p = cell.add_paragraph()
    _add_centered_run(name_p, person.get("name") or "", bold=True)

    role = cell.add_paragraph()
    _add_centered_run(role, person.get("title") or "")

    rank_p = cell.add_paragraph()
    _add_centered_run(rank_p, person.get("rank") or "")

    for _ in range(2):
        sp = cell.add_paragraph()
        sp.paragraph_format.space_after = Pt(6)
        _add_centered_run(sp, "")


def _add_accountability_table(document: Document, labels: list[str], roles: dict[str, Any]) -> None:
    mapping = {
        "Dipersiapkan oleh": "prepared_by",
        "Diperiksa oleh": "reviewed_by",
        "Didukung oleh": "supported_by",
        "Disetujui oleh": "approved_by",
        "Diterima oleh": "received_by",
    }
    # Official blank template: one header row + one content row, N columns
    table = document.add_table(rows=2, cols=len(labels))
    table.autofit = True
    for i, label in enumerate(labels):
        head = table.cell(0, i)
        _clear_cell(head)
        border = {"sz": 12, "color": "000000", "val": "single"}
        _set_cell_border(head, top=border, left=border, bottom=border, right=border)
        p = head.paragraphs[0] if head.paragraphs else head.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(label)
        run.bold = True
        run.font.size = Pt(9)
        run.font.name = "Frutiger 45 Light"
        person = roles.get(mapping[label]) or {}
        _fill_accountability_cell(table.cell(1, i), label, person, header_inside=False)


def _accountability_pdf_table(labels: list[str], roles: dict[str, Any], body_font: str, size: float) -> Table:
    mapping = {
        "Dipersiapkan oleh": "prepared_by",
        "Diperiksa oleh": "reviewed_by",
        "Didukung oleh": "supported_by",
        "Disetujui oleh": "approved_by",
        "Diterima oleh": "received_by",
    }
    style = ParagraphStyle(
        "acc",
        fontName=body_font,
        fontSize=size,
        leading=size * 1.25,
        alignment=TA_CENTER,
    )

    def cell_html(label: str) -> Paragraph:
        person = roles.get(mapping[label]) or {}
        html = (
            f"<b>{label}:</b><br/><br/>"
            f"{person.get('title') or ''}<br/><br/><br/><br/>"
            f"<u>{person.get('name') or ''}</u><br/>"
            f"{person.get('rank') or ''}"
        )
        return Paragraph(html, style)

    rows = []
    for i in range(0, len(labels), 2):
        left = cell_html(labels[i])
        right = cell_html(labels[i + 1]) if i + 1 < len(labels) else Paragraph("", style)
        rows.append([left, right])
    t = Table(rows, colWidths=[85 * mm, 85 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.75, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.75, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("MINHEIGHT", (0, 0), (-1, -1), 90),
            ]
        )
    )
    return t


def _strip_placeholders(text: str) -> str:
    lines = []
    for line in (text or "").splitlines():
        if re.match(r"^\s*contoh\s*:", line, flags=re.IGNORECASE):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _add_outline_paragraphs(document: Document, text: str, style) -> None:
    """Write body text with BI outline markers 1. / a. / i. and hanging indent."""
    for block in parse_outline_blocks(text):
        if block.get("blank"):
            document.add_paragraph("", style=style)
            continue
        if block["level"] == 0:
            p = document.add_paragraph(block["text"], style=style)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            continue
        p = document.add_paragraph(style=style)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        level = block["level"]
        p.paragraph_format.left_indent = Cm(LEVEL_INDENT_CM[level])
        p.paragraph_format.first_line_indent = Cm(-LEVEL_HANGING_CM[level])
        run = p.add_run(f"{block['marker']} {block['text']}")
        run.font.name = "Frutiger 45 Light"


def _outline_pdf_paragraphs(text: str, body_style) -> list:
    elems = []
    for block in parse_outline_blocks(text):
        if block.get("blank"):
            elems.append(Spacer(1, 4))
            continue
        if block["level"] == 0:
            elems.append(Paragraph(block["text"].replace("&", "&amp;"), body_style))
            continue
        level = block["level"]
        left_mm = LEVEL_INDENT_CM[level] * 10
        hang_mm = LEVEL_HANGING_CM[level] * 10
        style = ParagraphStyle(
            f"outline{level}",
            parent=body_style,
            leftIndent=left_mm * mm,
            firstLineIndent=-hang_mm * mm,
            alignment=TA_JUSTIFY,
        )
        safe = f"{block['marker']} {block['text']}".replace("&", "&amp;").replace("<", "&lt;")
        elems.append(Paragraph(safe, style))
    return elems


def compose_structured_fields(sec_def: dict[str, Any], raw: dict[str, Any]) -> tuple[str, list[tuple[str, str]]]:
    """Return (legacy text, labeled rows) for structured field sections."""
    values = raw.get("fields") or {}
    rows: list[tuple[str, str]] = []
    for f in sec_def.get("fields") or []:
        val = (values.get(f["key"]) or "").strip()
        if val:
            rows.append((f["label"], val))
    text = "\n".join(f"{label}: {val}" for label, val in rows)
    return text, rows


def _margins_for(pack: dict[str, Any], doc_type_code: str) -> dict[str, float]:
    by_family = pack.get("styles", {}).get("margin_mm_by_family") or {}
    if doc_type_code in by_family:
        return by_family[doc_type_code]
    if doc_type_code.startswith("M.01") or doc_type_code == "M.01":
        return by_family.get("M.01") or pack["styles"]["margin_mm"]
    if doc_type_code.startswith("M.02") or doc_type_code == "M.02":
        return by_family.get("M.02") or pack["styles"]["margin_mm"]
    return by_family.get("MEETING_REQUEST") or pack["styles"]["margin_mm"]


def _logo_path(pack: dict[str, Any]) -> Path | None:
    rel = (pack.get("styles", {}).get("logo") or {}).get("asset")
    if not rel:
        return None
    path = ROOT / rel
    return path if path.exists() else None


def _content_model(doc: dict[str, Any]) -> dict[str, Any]:
    version = doc.get("template_version") or "1.1.0"
    tmpl = get_template(doc["type"], version)
    sections_map = {s["key"]: s for s in doc.get("sections") or []}
    rendered_sections = []
    for sec in tmpl["sections"]:
        raw = sections_map.get(sec["key"]) or {}
        if raw.get("not_needed"):
            continue
        field_rows: list[tuple[str, str]] = []
        if sec.get("input_mode") == "structured_fields":
            content, field_rows = compose_structured_fields(sec, raw)
        else:
            content = raw.get("content") or ""
            if raw.get("body_mode") != "prose" and raw.get("points"):
                numbered = points_to_content(raw["points"])
                if numbered:
                    content = numbered
            content = _strip_placeholders(content)
        table = raw.get("table")
        rendered_sections.append(
            {
                "key": sec["key"],
                "title": section_heading(sec["title"], sec.get("outline_number")),
                "outline_number": sec.get("outline_number"),
                "content": content,
                "table": table,
                "field_rows": field_rows,
                "input_mode": sec.get("input_mode"),
            }
        )
    attachments_list = [
        a for a in (doc.get("attachments_list") or [])
        if attachment_is_meaningful(a)
    ]
    meta = dict(doc.get("metadata") or {})
    if attachments_list and (not meta.get("attachments") or meta.get("attachments") in {"", "-"}):
        meta["attachments"] = format_attachment_count(len(attachments_list))
    return {
        "meta": meta,
        "type": doc["type"],
        "label": tmpl.get("label"),
        "doc_type_code": tmpl.get("doc_type_code"),
        "layout_variant": tmpl.get("layout_variant"),
        "metadata_rows": tmpl.get("metadata_rows") or [],
        "sections": rendered_sections,
        "attachments_list": attachments_list,
        "doc_id": doc.get("id"),
        "accountability": doc.get("accountability") or {},
        "signatory": doc.get("signatory") or {},
        "accountability_labels": tmpl.get("accountability", {}).get("labels") or [],
        "accountability_mode": tmpl.get("accountability", {}).get("mode"),
        "template_version": doc.get("template_version"),
        "rule_version": doc.get("rule_version"),
        "status": doc.get("status", "draft"),
    }


def build_email_body(doc: dict[str, Any]) -> str:
    model = _content_model(doc)
    parts = [f"Perihal: {model['meta'].get('subject', '')}", ""]
    for sec in model["sections"]:
        parts.append(sec["title"])
        if sec["content"]:
            parts.append(sec["content"])
        if sec.get("table") and sec["table"].get("rows"):
            cols = sec["table"].get("columns") or []
            parts.append(" | ".join(cols))
            for row in sec["table"]["rows"]:
                parts.append(" | ".join(str(row.get(c, "")) for c in cols))
        parts.append("")
    parts.append("Hormat kami,")
    parts.append((doc.get("signatory") or {}).get("name", ""))
    return "\n".join(parts).strip() + "\n"


def _add_logo(document: Document, pack: dict[str, Any]) -> None:
    logo = _logo_path(pack)
    if not logo:
        return
    width_mm = float((pack.get("styles", {}).get("logo") or {}).get("width_mm") or 59.1)
    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run()
    run.add_picture(str(logo), width=Mm(width_mm))


def export_docx_bytes(doc: dict[str, Any]) -> tuple[bytes, str, str]:
    findings = validate_document(doc, for_final_export=True)
    if not can_final_export(findings):
        raise ValueError("Export diblokir: masih ada error validasi.")

    model = _content_model(doc)
    pack = load_templates(doc.get("template_version") or "1.1.0")
    margins = _margins_for(pack, model["doc_type_code"])
    sizes = pack["styles"]["font_sizes_pt"]
    fonts = pack["styles"]["fonts"]

    document = Document()
    section = document.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Mm(margins["top"])
    section.bottom_margin = Mm(margins["bottom"])
    section.left_margin = Mm(margins["left"])
    section.right_margin = Mm(margins["right"])

    styles = document.styles

    def ensure_style(name: str, base: str, size_pt: float, font_name: str) -> None:
        try:
            style = styles[name]
        except KeyError:
            style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
            style.base_style = styles[base]
        style.font.size = Pt(size_pt)
        style.font.name = font_name
        style._element.rPr.rFonts.set(qn("w:eastAsia"), font_name)

    heading_font = "Optima"
    body_font = "Frutiger 45 Light"
    ensure_style("MemoTitle", "Normal", sizes["MemoTitle"], heading_font)
    ensure_style("Heading1BI", "Heading 1", sizes["Heading1"], body_font)
    ensure_style("BodyBI", "Normal", sizes["Body"], body_font)
    ensure_style("MetadataBI", "Normal", sizes["Metadata"], body_font)
    ensure_style("SignatureBlock", "Normal", sizes["SignatureBlock"], body_font)

    _add_logo(document, pack)

    # Type badge + No/Lamp (right-aligned block under badge, matching blank template)
    badge = document.add_paragraph(model["doc_type_code"])
    badge.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    badge.style = styles["MetadataBI"]
    for run in badge.runs:
        run.bold = True
        run.font.size = Pt(14)

    meta = model["meta"]
    no_p = document.add_paragraph(f"No.  : {meta.get('document_number') or '…………'}", style=styles["MetadataBI"])
    no_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    lamp_p = document.add_paragraph(f"Lamp. : {meta.get('attachments') or '-'}", style=styles["MetadataBI"])
    lamp_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    title = document.add_paragraph("MEMORANDUM" if model["doc_type_code"] != "MR" else "MEETING REQUEST")
    title.style = styles["MemoTitle"]
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in title.runs:
        run.bold = True

    # Metadata: Perihal / Kepada [/ Dari] then horizontal rule feel via blank + underline para
    if model["doc_type_code"] == "M.02" or model["layout_variant"] == "m02_satker":
        document.add_paragraph(f"Perihal : {meta.get('subject') or ''}", style=styles["BodyBI"])
        document.add_paragraph(f"Kepada : {meta.get('recipient') or ''}", style=styles["BodyBI"])
        if meta.get("via") or meta.get("melalui"):
            document.add_paragraph(
                f"Melalui : {meta.get('via') or meta.get('melalui')}",
                style=styles["BodyBI"],
            )
    elif model["doc_type_code"] == "M.01":
        document.add_paragraph(f"Perihal : {meta.get('subject') or ''}", style=styles["BodyBI"])
        document.add_paragraph(f"Kepada : {meta.get('recipient') or ''}", style=styles["BodyBI"])
        document.add_paragraph(
            f"Dari : {meta.get('dari') or meta.get('satker') or ''}",
            style=styles["BodyBI"],
        )
    else:
        document.add_paragraph(f"Hal: {meta.get('subject') or ''}", style=styles["BodyBI"])
        document.add_paragraph(f"Yth.: {meta.get('recipient') or ''}", style=styles["BodyBI"])

    rule = document.add_paragraph("─" * 48, style=styles["BodyBI"])
    rule.paragraph_format.space_after = Pt(8)

    for idx, sec in enumerate(model["sections"], start=1):
        show_heading = model.get("layout_variant") != "m01_correspondence" and model["doc_type_code"] != "M.01"
        if show_heading:
            h = document.add_paragraph(f"{idx}. {sec['title']}")
            h.style = styles["Heading1BI"]
            for run in h.runs:
                run.bold = True
        if sec.get("field_rows"):
            for label, val in sec["field_rows"]:
                document.add_paragraph(f"{label} : {val}", style=styles["BodyBI"])
        elif sec["content"]:
            _add_outline_paragraphs(document, sec["content"], styles["BodyBI"])
        table = sec.get("table")
        if table and table.get("rows"):
            cols = table.get("columns") or []
            t = document.add_table(rows=1, cols=len(cols))
            hdr_cells = t.rows[0].cells
            for i, c in enumerate(cols):
                hdr_cells[i].text = c
            for row in table["rows"]:
                cells = t.add_row().cells
                for i, c in enumerate(cols):
                    cells[i].text = str(row.get(c, ""))

    document.add_paragraph("")
    city = meta.get("city_date") or ""

    if model["accountability_mode"] == "grid":
        _add_accountability_table(
            document,
            model["accountability_labels"],
            model["accountability"],
        )

    if model["accountability_mode"] in ("grid", "signatory_only") or model["doc_type_code"] in ("M.01", "M.02"):
        sig = model.get("signatory") or {}
        unit = (meta.get("dari") or meta.get("satker") or "").strip()
        p = document.add_paragraph(city, style=styles["SignatureBlock"])
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        for line, underline, bold in (
            (sig.get("title", ""), False, False),
            (unit, False, False),
            ("", False, False),
            ("", False, False),
            (sig.get("name", ""), True, True),
            (sig.get("rank", ""), False, False),
        ):
            sp = document.add_paragraph(style=styles["SignatureBlock"])
            sp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            run = sp.add_run(line)
            run.underline = underline
            run.bold = bold
            run.font.name = "Frutiger 45 Light"
            run.font.size = Pt(sizes["SignatureBlock"])
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "Frutiger 45 Light")

    attachments_list = model.get("attachments_list") or []
    if attachments_list:
        document.add_paragraph("")
        h = document.add_paragraph("Lampiran", style=styles["Heading1BI"])
        for run in h.runs:
            run.bold = True
        doc_id = model.get("doc_id") or ""
        for i, item in enumerate(attachments_list, 1):
            title = (item.get("title") or "").strip() or f"Lampiran {i}"
            desc = (item.get("description") or "").strip()
            kind = item.get("type") or "note"
            line = f"{i}. {title}" + (f" — {desc}" if desc else "")
            document.add_paragraph(line, style=styles["BodyBI"])
            if kind == "table":
                table = item.get("table") or {}
                cols = table.get("columns") or []
                rows = table.get("rows") or []
                if cols and rows:
                    t = document.add_table(rows=1, cols=len(cols))
                    for ci, c in enumerate(cols):
                        t.rows[0].cells[ci].text = str(c)
                    for row in rows:
                        cells = t.add_row().cells
                        for ci, c in enumerate(cols):
                            cells[ci].text = str(row.get(c, ""))
            elif kind == "image":
                img = item.get("image") or {}
                stored = img.get("stored_name")
                if stored and doc_id:
                    try:
                        path = resolve_attachment_path(doc_id, stored)
                        document.add_picture(str(path), width=Cm(14))
                    except Exception:
                        document.add_paragraph(
                            f"[Gambar: {img.get('original_name') or stored}]",
                            style=styles["BodyBI"],
                        )

    tembusan = meta.get("tembusan") or []
    if tembusan:
        document.add_paragraph("")
        document.add_paragraph("Tembusan:", style=styles["BodyBI"])
        for i, item in enumerate(tembusan, 1):
            document.add_paragraph(f"{i}. {item}", style=styles["BodyBI"])

    buffer = io.BytesIO()
    document.save(buffer)
    raw = buffer.getvalue()
    checksum = hashlib.sha256(raw).hexdigest()
    filename = generate_filename(
        meta.get("satker", "SATKER"),
        meta.get("program_strategis", "PS00"),
        model["doc_type_code"],
        meta.get("subject", "Dokumen"),
        datetime.now(),
    ) + ".docx"
    return raw, filename, checksum


def export_pdf_bytes(doc: dict[str, Any]) -> tuple[bytes, str, str]:
    findings = validate_document(doc, for_final_export=True)
    if not can_final_export(findings):
        raise ValueError("Export diblokir: masih ada error validasi.")

    model = _content_model(doc)
    pack = load_templates(doc.get("template_version") or "1.1.0")
    margins = _margins_for(pack, model["doc_type_code"])
    sizes = pack["styles"]["font_sizes_pt"]
    font_paths = resolve_font_paths()

    heading_font = "Helvetica-Bold"
    body_font = "Helvetica"
    if font_paths["heading"]:
        pdfmetrics.registerFont(TTFont("BI-Heading", str(font_paths["heading"])))
        heading_font = "BI-Heading"
    if font_paths["body"]:
        pdfmetrics.registerFont(TTFont("BI-Body", str(font_paths["body"])))
        body_font = "BI-Body"

    buffer = io.BytesIO()
    pdf = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=margins["left"] * mm,
        rightMargin=margins["right"] * mm,
        topMargin=margins["top"] * mm,
        bottomMargin=margins["bottom"] * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "MemoTitle",
        parent=styles["Heading1"],
        fontName=heading_font,
        fontSize=sizes["MemoTitle"],
        alignment=1,
        spaceAfter=12,
    )
    h_style = ParagraphStyle(
        "Heading1BI",
        parent=styles["Heading2"],
        fontName=heading_font,
        fontSize=sizes["Heading1"],
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "BodyBI",
        parent=styles["Normal"],
        fontName=body_font,
        fontSize=sizes["Body"],
        leading=sizes["Body"] * pack["styles"]["line_spacing"],
        alignment=4,
    )

    story = []
    logo = _logo_path(pack)
    if logo:
        width = float((pack.get("styles", {}).get("logo") or {}).get("width_mm") or 59.1)
        img = RLImage(str(logo), width=width * mm, height=(width * 70 / 366) * mm)
        img.hAlign = "RIGHT"
        story.append(img)
        story.append(Spacer(1, 4))

    story.append(Paragraph(model["doc_type_code"], ParagraphStyle("badge", parent=body_style, alignment=2)))
    meta = model["meta"]
    story.append(Paragraph(f"No. {meta.get('document_number') or '[akan diisi]'}", body_style))
    story.append(Paragraph(f"Lamp.: {meta.get('attachments') or '-'}", body_style))
    story.append(Paragraph("MEMORANDUM" if model["doc_type_code"] != "MR" else "MEETING REQUEST", title_style))

    if model["layout_variant"] == "m02_satker":
        story.append(Paragraph(f"<b>PERIHAL :</b> {(meta.get('subject') or '').upper()}", body_style))
        story.append(Paragraph(f"Kepada : {meta.get('recipient') or ''}", body_style))
        if meta.get("via") or meta.get("melalui"):
            story.append(Paragraph(f"Melalui : {meta.get('via') or meta.get('melalui')}", body_style))
    else:
        data = [
            ["Kepada", ":", meta.get("recipient") or ""],
            ["Dari", ":", meta.get("dari") or meta.get("satker") or ""],
            ["Perihal", ":", meta.get("subject") or ""],
        ]
        t = Table(data, colWidths=[25 * mm, 5 * mm, 130 * mm])
        t.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), body_font), ("FONTSIZE", (0, 0), (-1, -1), sizes["Body"]), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(t)

    story.append(Spacer(1, 8))
    for sec in model["sections"]:
        if model.get("layout_variant") != "m01_correspondence":
            story.append(Paragraph(f"<b>{sec['title']}</b>", h_style))
        if sec.get("field_rows"):
            data = [[label, f": {val}"] for label, val in sec["field_rows"]]
            t = Table(data, colWidths=[35 * mm, 120 * mm], hAlign="LEFT")
            t.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, -1), body_font),
                        ("FONTSIZE", (0, 0), (-1, -1), sizes["Body"]),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("TOPPADDING", (0, 0), (-1, -1), 1),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                    ]
                )
            )
            story.append(t)
            story.append(Spacer(1, 6))
        elif sec["content"]:
            story.extend(_outline_pdf_paragraphs(sec["content"], body_style))
        table = sec.get("table")
        if table and table.get("rows"):
            cols = table.get("columns") or []
            data = [cols] + [[str(r.get(c, "")) for c in cols] for r in table["rows"]]
            t = Table(data, hAlign="LEFT")
            t.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, 0), heading_font),
                        ("FONTNAME", (0, 1), (-1, -1), body_font),
                        ("FONTSIZE", (0, 0), (-1, -1), sizes["Body"]),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.93, 0.93, 0.93)),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]
                )
            )
            story.append(t)

    story.append(Spacer(1, 12))
    story.append(Paragraph(meta.get("city_date") or "", body_style))

    if model["accountability_mode"] == "grid":
        story.append(
            _accountability_pdf_table(
                model["accountability_labels"],
                model["accountability"],
                body_font,
                sizes["Body"],
            )
        )
    elif model["accountability_mode"] == "signatory_only":
        sig = model["signatory"]
        right = ParagraphStyle("sig", parent=body_style, alignment=2)
        story.append(Paragraph(sig.get("title", ""), right))
        story.append(Spacer(1, 24))
        story.append(Paragraph(f"<u>{sig.get('name', '')}</u>", right))
        story.append(Paragraph(sig.get("rank", ""), right))

    attachments_list = model.get("attachments_list") or []
    if attachments_list:
        story.append(Spacer(1, 10))
        story.append(Paragraph("<b>Lampiran</b>", h_style))
        doc_id = model.get("doc_id") or ""
        for i, item in enumerate(attachments_list, 1):
            title = (item.get("title") or "").strip() or f"Lampiran {i}"
            desc = (item.get("description") or "").strip()
            kind = item.get("type") or "note"
            line = f"{i}. {title}" + (f" — {desc}" if desc else "")
            story.append(Paragraph(line.replace("&", "&amp;"), body_style))
            if kind == "table":
                table = item.get("table") or {}
                cols = table.get("columns") or []
                rows = table.get("rows") or []
                if cols and rows:
                    data = [cols] + [[str(r.get(c, "")) for c in cols] for r in rows]
                    t = Table(data, hAlign="LEFT")
                    t.setStyle(
                        TableStyle(
                            [
                                ("FONTNAME", (0, 0), (-1, 0), heading_font),
                                ("FONTNAME", (0, 1), (-1, -1), body_font),
                                ("FONTSIZE", (0, 0), (-1, -1), sizes["Body"]),
                                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.93, 0.93, 0.93)),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ]
                        )
                    )
                    story.append(t)
                    story.append(Spacer(1, 6))
            elif kind == "image":
                img = item.get("image") or {}
                stored = img.get("stored_name")
                if stored and doc_id:
                    try:
                        path = resolve_attachment_path(doc_id, stored)
                        img_flow = RLImage(str(path))
                        img_flow._restrictSize(140 * mm, 180 * mm)
                        story.append(img_flow)
                        story.append(Spacer(1, 6))
                    except Exception:
                        story.append(
                            Paragraph(
                                f"[Gambar: {(img.get('original_name') or stored)}]".replace("&", "&amp;"),
                                body_style,
                            )
                        )

    pdf.build(story)
    raw = buffer.getvalue()
    checksum = hashlib.sha256(raw).hexdigest()
    filename = generate_filename(
        meta.get("satker", "SATKER"),
        meta.get("program_strategis", "PS00"),
        model["doc_type_code"],
        meta.get("subject", "Dokumen"),
        datetime.now(),
    ) + ".pdf"
    return raw, filename, checksum
