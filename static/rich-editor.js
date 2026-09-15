/**
 * Word-like rich editor for the A4 memo canvas (TinyMCE inline).
 * Manual edits persist in doc.canvas_html; form patches fields surgically.
 */
const TINYMCE_CDN = "https://cdn.jsdelivr.net/npm/tinymce@7.5.1/tinymce.min.js";

let loadPromise = null;
let mounting = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.referrerPolicy = "origin";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat editor TinyMCE"));
    document.head.appendChild(s);
  });
}

export function ensureTinyMce() {
  if (window.tinymce) return Promise.resolve();
  if (!loadPromise) loadPromise = loadScript(TINYMCE_CDN);
  return loadPromise;
}

export function getMemoEditor() {
  const el = document.getElementById("a4-preview");
  if (!el || !window.tinymce) return null;
  return window.tinymce.get(el.id) || null;
}

export function getCanvasHtml() {
  const ed = getMemoEditor();
  if (ed) return ed.getContent({ format: "html" });
  const el = document.getElementById("a4-preview");
  return el ? el.innerHTML : "";
}

export function setCanvasHtml(html) {
  const ed = getMemoEditor();
  if (ed) {
    ed.setContent(html || "", { format: "html" });
    return;
  }
  const el = document.getElementById("a4-preview");
  if (el) el.innerHTML = html || "";
}

/** Strip nested contenteditable so TinyMCE owns editing. */
export function prepareCanvasForRichEdit(root) {
  if (!root) return;
  root.querySelectorAll("[contenteditable]").forEach((n) => {
    n.removeAttribute("contenteditable");
  });
  root.querySelectorAll("[draggable]").forEach((n) => {
    n.removeAttribute("draggable");
  });
}

/** Update a single marked field inside the live canvas without full re-render. */
export function patchCanvasField(attr, value, { asHtml = false } = {}) {
  const root = document.getElementById("a4-preview");
  if (!root) return false;
  const nodes = root.querySelectorAll(`[${attr}]`);
  if (!nodes.length) return false;
  nodes.forEach((node) => {
    if (asHtml) node.innerHTML = value;
    else node.textContent = value ?? "";
  });
  return true;
}

export function patchCanvasMeta(key, value) {
  const root = document.getElementById("a4-preview");
  if (!root) return false;
  let ok = false;
  root.querySelectorAll(`[data-live-meta="${key}"]`).forEach((node) => {
    const v = key === "subject" && node.classList.contains("perihal-val")
      ? String(value || "").toUpperCase()
      : String(value ?? "");
    node.textContent = v;
    ok = true;
  });
  return ok;
}

export function patchCanvasSection(secKey, htmlOrText, { asHtml = false } = {}) {
  const root = document.getElementById("a4-preview");
  if (!root) return false;
  const nodes = root.querySelectorAll(`[data-live-section="${secKey}"]`);
  if (!nodes.length) return false;
  nodes.forEach((node) => {
    if (asHtml) node.innerHTML = htmlOrText;
    else {
      const lines = String(htmlOrText ?? "").split("\n");
      node.innerHTML = lines.map((line) => {
        const t = line.trim();
        if (!t) return `<div class="outline-line blank"><br/></div>`;
        return `<div class="outline-line plain">${escapeHtml(line)}</div>`;
      }).join("");
    }
  });
  return true;
}

export function patchCanvasTableCell(secKey, row, col, value) {
  const root = document.getElementById("a4-preview");
  if (!root) return false;
  const sel =
    `[data-live-table-sec="${secKey}"][data-live-table-row="${row}"][data-live-table-col="${CSS.escape(String(col))}"]`;
  const nodes = root.querySelectorAll(sel);
  if (!nodes.length) return false;
  nodes.forEach((n) => {
    n.textContent = value ?? "";
  });
  return true;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function destroyMemoEditor() {
  const ed = getMemoEditor();
  if (ed) ed.remove();
}

/**
 * Mount TinyMCE inline on #a4-preview.
 * @param {{ onChange: (html: string) => void, contentCss?: string }} opts
 */
export async function mountMemoEditor(opts = {}) {
  if (mounting) return getMemoEditor();
  mounting = true;
  try {
    await ensureTinyMce();
    const el = document.getElementById("a4-preview");
    if (!el) return null;
    await destroyMemoEditor();
    prepareCanvasForRichEdit(el);

    const toolbarHost = document.getElementById("memo-toolbar");
    const editors = await window.tinymce.init({
      target: el,
      inline: true,
      license_key: "gpl",
      base_url: "https://cdn.jsdelivr.net/npm/tinymce@7.5.1",
      suffix: ".min",
      menubar: false,
      branding: false,
      promotion: false,
      statusbar: false,
      fixed_toolbar_container: toolbarHost ? "#memo-toolbar" : undefined,
      toolbar_persist: true,
      plugins: [
        "advlist", "autolink", "lists", "link", "image", "table",
        "pagebreak", "quickbars", "searchreplace", "visualblocks",
        "wordcount",
      ].join(" "),
      toolbar: [
        "undo redo | copy cut paste |",
        "fontfamily fontsize | bold italic underline | forecolor backcolor |",
        "alignleft aligncenter alignright alignjustify |",
        "bullist numlist | outdent indent | lineheight paragraphsacing |",
        "table image pagebreak pagesetup |",
        "removeformat",
      ].join(" "),
      font_family_formats:
        "Frutiger 45 Light=Frutiger 45 Light,Source Sans 3,sans-serif;" +
        "Source Sans 3=Source Sans 3,sans-serif;" +
        "Optima=Optima,serif;" +
        "Times New Roman=Times New Roman,Times,serif;" +
        "Arial=Arial,Helvetica,sans-serif;" +
        "Georgia=Georgia,serif",
      font_size_formats: "8pt 9pt 10pt 11pt 12pt 14pt 16pt 18pt 24pt",
      line_height_formats: "1 1.15 1.5 1.75 2 2.5 3",
      table_toolbar:
        "tableprops tabledelete | " +
        "tableinsertrowbefore tableinsertrowafter tabledeleterow | " +
        "tableinsertcolbefore tableinsertcolafter tabledeletecol | " +
        "tablecellprops tablerowprops | " +
        "tablemergecells tablesplitcells | " +
        "tablecellalignleft tablecellaligncenter tablecellalignright | " +
        "tablecellvaligntop tablecellvalignmiddle tablecellvalignbottom | " +
        "tableborderstyle tablebgcolor | " +
        "tabledistributecols tabledistributerows | " +
        "tableautofitcontent tableautofitpage | " +
        "tableheaderrepeat tablecaption | " +
        "tablemoveup tablemovedown",
      table_appearance_options: true,
      table_grid: true,
      table_resize_bars: true,
      table_advtab: true,
      table_cell_advtab: true,
      table_row_advtab: true,
      table_style_by_css: true,
      table_header_type: "sectionCells",
      image_advtab: true,
      image_title: true,
      image_class_list: [
        { title: "Inline", value: "" },
        { title: "Float kiri", value: "img-float-left" },
        { title: "Float kanan", value: "img-float-right" },
        { title: "Tengah (block)", value: "img-block-center" },
      ],
      automatic_uploads: false,
      file_picker_types: "image",
      file_picker_callback: (cb) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => cb(String(reader.result), { title: file.name });
          reader.readAsDataURL(file);
        };
        input.click();
      },
      pagebreak_separator: '<div class="mce-pagebreak" style="page-break-before:always;" data-mce-pagebreak="1"><!-- pagebreak --></div>',
      quickbars_selection_toolbar: "bold italic underline | forecolor | alignleft aligncenter alignright",
      quickbars_insert_toolbar: false,
      contextmenu: "link image table lists",
      content_css: false,
      content_style: opts.contentCss || defaultContentCss(),
      setup: (editor) => {
        registerExtraButtons(editor);
        editor.on("init", () => {
          editor.getBody()?.setAttribute("spellcheck", "true");
        });
        let t = null;
        const emit = () => {
          clearTimeout(t);
          t = setTimeout(() => {
            opts.onChange?.(editor.getContent({ format: "html" }));
          }, 250);
        };
        editor.on("input change undo redo SetContent ExecCommand TableModified ObjectResized", emit);
      },
    });
    return editors?.[0] || getMemoEditor();
  } finally {
    mounting = false;
  }
}

function defaultContentCss() {
  return `
    .img-float-left { float: left; margin: 0 10pt 6pt 0; max-width: 45%; }
    .img-float-right { float: right; margin: 0 0 6pt 10pt; max-width: 45%; }
    .img-block-center { display: block; margin: 8pt auto; max-width: 80%; }
    .mce-pagebreak {
      border-top: 1px dashed #9aa8b8;
      margin: 12pt 0;
      height: 0;
      page-break-before: always;
    }
    table caption {
      caption-side: top;
      text-align: left;
      font-size: 10pt;
      margin-bottom: 4pt;
      font-style: italic;
    }
  `;
}

function registerExtraButtons(editor) {
  editor.ui.registry.addButton("paragraphspacing", {
    text: "¶±",
    tooltip: "Spasi antar paragraf",
    onAction: () => {
      editor.windowManager.open({
        title: "Spasi paragraf",
        body: {
          type: "panel",
          items: [
            { type: "input", name: "before", label: "Margin atas (pt)", placeholder: "0" },
            { type: "input", name: "after", label: "Margin bawah (pt)", placeholder: "6" },
          ],
        },
        buttons: [
          { type: "cancel", text: "Batal" },
          { type: "submit", text: "Terapkan", primary: true },
        ],
        onSubmit: (api) => {
          const d = api.getData();
          const before = Number(d.before) || 0;
          const after = Number(d.after) || 6;
          editor.formatter.apply("paragraphspacing", {
            value: `${before}pt 0 ${after}pt`,
          });
          // apply via style on selected blocks
          const blocks = editor.selection.getSelectedBlocks();
          blocks.forEach((b) => {
            editor.dom.setStyle(b, "margin", `${before}pt 0 ${after}pt`);
          });
          api.close();
          editor.nodeChanged();
        },
      });
    },
  });

  editor.ui.registry.addButton("pagesetup", {
    text: "Page",
    tooltip: "Margin & orientasi halaman",
    onAction: () => {
      const a4 = document.getElementById("a4-preview");
      const cur = a4?.dataset.pageOrient || "portrait";
      const mTop = a4?.dataset.marginTop || "20";
      const mRight = a4?.dataset.marginRight || "20";
      const mBottom = a4?.dataset.marginBottom || "20";
      const mLeft = a4?.dataset.marginLeft || "25";
      editor.windowManager.open({
        title: "Pengaturan halaman",
        body: {
          type: "panel",
          items: [
            {
              type: "selectbox",
              name: "orient",
              label: "Orientasi",
              items: [
                { text: "Portrait (tegak)", value: "portrait" },
                { text: "Landscape (lebar)", value: "landscape" },
              ],
            },
            { type: "input", name: "mt", label: "Margin atas (mm)" },
            { type: "input", name: "mr", label: "Margin kanan (mm)" },
            { type: "input", name: "mb", label: "Margin bawah (mm)" },
            { type: "input", name: "ml", label: "Margin kiri (mm)" },
          ],
        },
        initialData: {
          orient: cur,
          mt: mTop,
          mr: mRight,
          mb: mBottom,
          ml: mLeft,
        },
        buttons: [
          { type: "cancel", text: "Batal" },
          { type: "submit", text: "Terapkan", primary: true },
        ],
        onSubmit: (api) => {
          const d = api.getData();
          applyPageSetup(a4, d);
          api.close();
          editor.fire("change");
        },
      });
    },
  });

  const cellAlign = (h, v) => {
    const cell = editor.dom.getParent(editor.selection.getNode(), "td,th");
    if (!cell) return;
    if (h) editor.dom.setStyle(cell, "text-align", h);
    if (v) editor.dom.setStyle(cell, "vertical-align", v);
    editor.nodeChanged();
  };

  editor.ui.registry.addButton("tablecellalignleft", {
    text: "⬅︎",
    tooltip: "Cell align kiri",
    onAction: () => cellAlign("left", null),
  });
  editor.ui.registry.addButton("tablecellaligncenter", {
    text: "⟷",
    tooltip: "Cell align tengah",
    onAction: () => cellAlign("center", null),
  });
  editor.ui.registry.addButton("tablecellalignright", {
    text: "➡︎",
    tooltip: "Cell align kanan",
    onAction: () => cellAlign("right", null),
  });
  editor.ui.registry.addButton("tablecellvaligntop", {
    text: "⤒",
    tooltip: "Vertical atas",
    onAction: () => cellAlign(null, "top"),
  });
  editor.ui.registry.addButton("tablecellvalignmiddle", {
    text: "↕",
    tooltip: "Vertical tengah",
    onAction: () => cellAlign(null, "middle"),
  });
  editor.ui.registry.addButton("tablecellvalignbottom", {
    text: "⤓",
    tooltip: "Vertical bawah",
    onAction: () => cellAlign(null, "bottom"),
  });

  editor.ui.registry.addButton("tabledistributecols", {
    text: "≡ Col",
    tooltip: "Samakan lebar kolom",
    onAction: () => distributeColumns(editor),
  });
  editor.ui.registry.addButton("tabledistributerows", {
    text: "≡ Row",
    tooltip: "Samakan tinggi baris",
    onAction: () => distributeRows(editor),
  });
  editor.ui.registry.addButton("tableautofitcontent", {
    text: "Fit isi",
    tooltip: "Autofit ke konten",
    onAction: () => {
      const table = editor.dom.getParent(editor.selection.getNode(), "table");
      if (!table) return;
      editor.dom.setStyle(table, "width", "auto");
      editor.dom.setStyle(table, "table-layout", "auto");
      table.querySelectorAll("td,th,col").forEach((c) => {
        editor.dom.setStyle(c, "width", "");
      });
      editor.nodeChanged();
    },
  });
  editor.ui.registry.addButton("tableautofitpage", {
    text: "Fit page",
    tooltip: "Autofit ke lebar halaman",
    onAction: () => {
      const table = editor.dom.getParent(editor.selection.getNode(), "table");
      if (!table) return;
      editor.dom.setStyle(table, "width", "100%");
      editor.dom.setStyle(table, "table-layout", "fixed");
      distributeColumns(editor);
    },
  });
  editor.ui.registry.addButton("tableheaderrepeat", {
    text: "Hdr↻",
    tooltip: "Ulangi baris header di setiap halaman",
    onAction: () => {
      const table = editor.dom.getParent(editor.selection.getNode(), "table");
      if (!table) return;
      const first = table.querySelector("tr");
      if (!first) return;
      first.querySelectorAll("td,th").forEach((cell) => {
        const tag = cell.tagName.toLowerCase() === "th" ? cell : null;
        if (!tag && cell.tagName.toLowerCase() === "td") {
          // mark row as header via thead if possible
        }
      });
      let thead = table.querySelector("thead");
      if (thead) {
        // toggle off: move rows back to tbody
        const tbody = table.querySelector("tbody") || table.appendChild(editor.getDoc().createElement("tbody"));
        while (thead.firstChild) tbody.insertBefore(thead.firstChild, tbody.firstChild);
        thead.remove();
      } else {
        thead = editor.getDoc().createElement("thead");
        const row = table.querySelector("tr");
        if (row) {
          thead.appendChild(row.cloneNode(true));
          row.remove();
          table.insertBefore(thead, table.firstChild);
          thead.querySelectorAll("td").forEach((td) => {
            const th = editor.getDoc().createElement("th");
            th.innerHTML = td.innerHTML;
            Array.from(td.attributes).forEach((a) => th.setAttribute(a.name, a.value));
            td.replaceWith(th);
          });
        }
      }
      editor.dom.setStyle(table, "page-break-inside", "auto");
      editor.nodeChanged();
    },
  });
  editor.ui.registry.addButton("tablecaption", {
    text: "Caption",
    tooltip: "Tambah/hapus caption tabel",
    onAction: () => {
      const table = editor.dom.getParent(editor.selection.getNode(), "table");
      if (!table) return;
      let cap = table.querySelector("caption");
      if (cap) cap.remove();
      else {
        cap = editor.getDoc().createElement("caption");
        cap.textContent = "Tabel ";
        table.insertBefore(cap, table.firstChild);
      }
      editor.nodeChanged();
    },
  });
  editor.ui.registry.addButton("tablemoveup", {
    text: "↑ Tabel",
    tooltip: "Pindahkan tabel ke atas",
    onAction: () => moveTable(editor, -1),
  });
  editor.ui.registry.addButton("tablemovedown", {
    text: "↓ Tabel",
    tooltip: "Pindahkan tabel ke bawah",
    onAction: () => moveTable(editor, 1),
  });

  editor.ui.registry.addButton("tableborderstyle", {
    text: "Border",
    tooltip: "Gaya, ketebalan, dan warna border",
    onAction: () => {
      const table = editor.dom.getParent(editor.selection.getNode(), "table");
      if (!table) return;
      editor.windowManager.open({
        title: "Border tabel",
        body: {
          type: "panel",
          items: [
            {
              type: "selectbox",
              name: "style",
              label: "Gaya",
              items: [
                { text: "Solid", value: "solid" },
                { text: "Dashed", value: "dashed" },
                { text: "Dotted", value: "dotted" },
                { text: "None", value: "none" },
              ],
            },
            { type: "input", name: "width", label: "Ketebalan (px)", placeholder: "1" },
            { type: "colorinput", name: "color", label: "Warna" },
          ],
        },
        initialData: { style: "solid", width: "1", color: "#666666" },
        buttons: [
          { type: "cancel", text: "Batal" },
          { type: "submit", text: "Terapkan", primary: true },
        ],
        onSubmit: (api) => {
          const d = api.getData();
          const border = d.style === "none"
            ? "none"
            : `${d.width || 1}px ${d.style} ${d.color || "#666"}`;
          table.querySelectorAll("td,th").forEach((c) => {
            editor.dom.setStyle(c, "border", border);
          });
          editor.dom.setAttrib(table, "border", d.style === "none" ? "0" : "1");
          api.close();
          editor.nodeChanged();
        },
      });
    },
  });

  editor.ui.registry.addButton("tablebgcolor", {
    text: "Bg",
    tooltip: "Warna latar cell",
    onAction: () => {
      const cell = editor.dom.getParent(editor.selection.getNode(), "td,th");
      if (!cell) return;
      editor.windowManager.open({
        title: "Latar cell",
        body: {
          type: "panel",
          items: [{ type: "colorinput", name: "bg", label: "Warna latar" }],
        },
        initialData: { bg: editor.dom.getStyle(cell, "background-color") || "#f0f0f0" },
        buttons: [
          { type: "cancel", text: "Batal" },
          { type: "submit", text: "Terapkan", primary: true },
        ],
        onSubmit: (api) => {
          editor.dom.setStyle(cell, "background-color", api.getData().bg || "");
          api.close();
          editor.nodeChanged();
        },
      });
    },
  });
}

function applyPageSetup(a4, d) {
  if (!a4) return;
  a4.dataset.pageOrient = d.orient || "portrait";
  a4.dataset.marginTop = d.mt || "20";
  a4.dataset.marginRight = d.mr || "20";
  a4.dataset.marginBottom = d.mb || "20";
  a4.dataset.marginLeft = d.ml || "25";
  const landscape = d.orient === "landscape";
  a4.style.width = landscape ? "297mm" : "210mm";
  a4.style.minHeight = landscape ? "210mm" : "297mm";
  a4.style.padding = `${d.mt || 20}mm ${d.mr || 20}mm ${d.mb || 20}mm ${d.ml || 25}mm`;
  a4.classList.toggle("page-landscape", landscape);
}

function distributeColumns(editor) {
  const table = editor.dom.getParent(editor.selection.getNode(), "table");
  if (!table) return;
  const first = table.querySelector("tr");
  if (!first) return;
  const cols = first.querySelectorAll(":scope > td, :scope > th");
  if (!cols.length) return;
  const pct = (100 / cols.length).toFixed(2);
  const colgroup = table.querySelector("colgroup");
  if (colgroup) {
    const colsEl = colgroup.querySelectorAll("col");
    colsEl.forEach((c) => {
      editor.dom.setStyle(c, "width", `${pct}%`);
    });
  }
  cols.forEach((c) => {
    editor.dom.setStyle(c, "width", `${pct}%`);
  });
  editor.dom.setStyle(table, "width", "100%");
  editor.nodeChanged();
}

function distributeRows(editor) {
  const table = editor.dom.getParent(editor.selection.getNode(), "table");
  if (!table) return;
  const rows = table.querySelectorAll("tr");
  if (!rows.length) return;
  const h = Math.max(22, Math.round(120 / rows.length));
  rows.forEach((r) => {
    editor.dom.setStyle(r, "height", `${h}pt`);
    r.querySelectorAll("td,th").forEach((c) => {
      editor.dom.setStyle(c, "height", `${h}pt`);
    });
  });
  editor.nodeChanged();
}

function moveTable(editor, dir) {
  const table = editor.dom.getParent(editor.selection.getNode(), "table");
  if (!table || !table.parentNode) return;
  const wrap = table.closest(".live-table-wrap") || table;
  if (dir < 0 && wrap.previousElementSibling) {
    wrap.parentNode.insertBefore(wrap, wrap.previousElementSibling);
  } else if (dir > 0 && wrap.nextElementSibling) {
    wrap.parentNode.insertBefore(wrap.nextElementSibling, wrap);
  }
  editor.nodeChanged();
}

/** Lightweight compliance warnings — never auto-removes user edits. */
export function formatComplianceWarnings(html, docType) {
  const warnings = [];
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  if (!/MEMORANDUM/i.test(html || "")) {
    warnings.push("Judul MEMORANDUM tidak ditemukan di kanvas — format standar BI biasanya memuat judul ini.");
  }
  if (String(docType || "").startsWith("M.02") && !/PERIHAL/i.test(html || "")) {
    warnings.push("Memo M.02 biasanya memuat baris PERIHAL (kapital).");
  }
  if (String(docType || "").startsWith("M.01") && !/Kepada/i.test(html || "")) {
    warnings.push("Memo M.01 biasanya memuat baris Kepada / Dari / Perihal.");
  }
  if ((html || "").includes('contenteditable="false"')) {
    warnings.push("Beberapa area dikunci; pastikan isi wajib tetap dapat diverifikasi.");
  }
  if (text.replace(/\s+/g, "").length < 40) {
    warnings.push("Isi dokumen terlihat sangat singkat.");
  }
  return warnings;
}
