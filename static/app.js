const state = {
  route: "dashboard",
  documents: [],
  templates: null,
  health: null,
  doc: null,
  classification: null,
  findings: [],
  editorTab: "metadata",
  autosaveTimer: null,
};

const $main = () => document.getElementById("main");
const $save = () => document.getElementById("save-indicator");

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.location.href = "/login";
    throw new Error("Login diperlukan");
  }
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).detail || msg; } catch {}
    throw new Error(msg || res.statusText);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function setSave(text) {
  $save().textContent = text;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** BI outline: I. (bagian) · 1. 2. 3. · a. b. c. · i. ii. iii. — contoh M.02 */
const RE_OUTLINE_L3 = /^\s*(?:\(?((?:ix|iv|iii|ii|i|viii|vii|vi|v|xii|xi|x))\)?[.)])\s+(.*)$/i;
const RE_OUTLINE_L1 = /^\s*(?:\(?(\d+)\)?[.)])\s+(.*)$/;
const RE_OUTLINE_L2 = /^\s*(?:\(?([a-z])\)?[.)])\s+(.*)$/i;

function parseOutlineLine(line) {
  const raw = String(line ?? "");
  if (!raw.trim()) return { level: 0, marker: "", text: "", blank: true };
  let m = raw.match(RE_OUTLINE_L3);
  if (m) return { level: 3, marker: `${m[1].toLowerCase()}.`, text: m[2], blank: false };
  m = raw.match(RE_OUTLINE_L1);
  if (m) return { level: 1, marker: `${m[1]}.`, text: m[2], blank: false };
  m = raw.match(RE_OUTLINE_L2);
  if (m) return { level: 2, marker: `${m[1].toLowerCase()}.`, text: m[2], blank: false };
  return { level: 0, marker: "", text: raw.trim(), blank: false };
}

function sectionHeading(title, outlineNumber) {
  if (!outlineNumber) return title || "";
  let num = String(outlineNumber).trim();
  if (!num.endsWith(".")) num += ".";
  const t = (title || "").trim();
  if (new RegExp(`^${num.replace(".", "\\.")}\\s`, "i").test(t)) return t;
  return `${num} ${t}`;
}

function formatOutlineHtml(text) {
  const lines = String(text ?? "").split("\n");
  if (!lines.length) return "";
  return lines.map((line) => {
    const b = parseOutlineLine(line);
    if (b.blank) return `<div class="outline-line blank"><br/></div>`;
    if (b.level === 0) return `<div class="outline-line plain">${esc(b.text)}</div>`;
    return `<div class="outline-line l${b.level}"><span class="mk">${esc(b.marker)}</span> <span class="tx">${esc(b.text)}</span></div>`;
  }).join("");
}


const TABLE_PRESETS = {
  agenda: { label: "Agenda", columns: ["No", "Waktu", "Agenda"] },
  kontribusi: { label: "Kontribusi peserta", columns: ["No", "Satuan Kerja", "Kontribusi/Ekspektasi"] },
  risiko: { label: "Risiko & mitigasi", columns: ["Risiko", "Dampak", "Kemungkinan", "Mitigasi", "PIC"] },
  custom: { label: "Tabel kosong (2 kolom)", columns: ["Kolom 1", "Kolom 2"] },
};

const ID_COUNT_WORDS = {
  1: "satu", 2: "dua", 3: "tiga", 4: "empat", 5: "lima",
  6: "enam", 7: "tujuh", 8: "delapan", 9: "sembilan", 10: "sepuluh",
};

function formatAttachmentCount(n, unit = "berkas") {
  if (!n || n <= 0) return "-";
  return `${n} (${ID_COUNT_WORDS[n] || n}) ${unit}`;
}

function romanLower(n) {
  const map = [[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]];
  let out = "", x = n;
  for (const [v, s] of map) {
    while (x >= v) { out += s; x -= v; }
  }
  return out;
}

function letterMarker(n) {
  if (n >= 1 && n <= 26) return String.fromCharCode(96 + n);
  return String(n);
}

function assignMarkers(points) {
  const counters = { 1: 0, 2: 0, 3: 0 };
  return (points || []).map((raw) => {
    let level = Number(raw.level) || 1;
    level = Math.min(3, Math.max(1, level));
    for (let d = level + 1; d <= 3; d++) counters[d] = 0;
    counters[level] += 1;
    const n = counters[level];
    let marker = `${n}.`;
    if (level === 2) marker = `${letterMarker(n)}.`;
    if (level === 3) marker = `${romanLower(n)}.`;
    return { ...raw, level, marker };
  });
}

function pointsToContent(points, keepEmpty = false) {
  return assignMarkers(points)
    .filter((p) => keepEmpty || (p.text || "").trim())
    .map((p) => `${p.marker} ${(p.text || "").trim()}`.trimEnd())
    .join("\n");
}

function contentToPoints(text) {
  const points = [];
  String(text || "").split("\n").forEach((line) => {
    const b = parseOutlineLine(line);
    if (b.blank) return;
    if (b.level === 0) points.push({ level: 1, text: b.text });
    else points.push({ level: b.level, text: b.text });
  });
  return points;
}

function ensureSectionPoints(sec) {
  if (!sec) return [];
  if (!Array.isArray(sec.points) || (!sec.points.length && (sec.content || "").trim() && sec.body_mode === "points")) {
    sec.points = contentToPoints(sec.content || "");
  }
  if (!Array.isArray(sec.points)) sec.points = [];
  return sec.points;
}

function ensureBodyMode(sec) {
  if (!sec) return "prose";
  if (sec.body_mode === "prose" || sec.body_mode === "points") return sec.body_mode;
  const content = (sec.content || "").trim();
  if (!content) {
    sec.body_mode = "prose";
    return "prose";
  }
  const pts = contentToPoints(content);
  const looksNumbered = content.split("\n").some((line) => {
    const b = parseOutlineLine(line);
    return !b.blank && b.level > 0;
  });
  sec.body_mode = looksNumbered && pts.length > 1 ? "points" : "prose";
  if (sec.body_mode === "points") sec.points = pts;
  return sec.body_mode;
}

function syncSectionContentFromPoints(sec) {
  ensureSectionPoints(sec);
  sec.content = pointsToContent(sec.points);
}


function proseEditor(secKey, content, placeholder) {
  return `
    <div class="prose-editor">
      <div class="hint">Teks bebas — satu atau beberapa paragraf, tanpa penomoran 1. a. i.</div>
      <textarea data-section="${esc(secKey)}" rows="5" placeholder="${esc(placeholder || "Tulis isi bagian…")}">${esc(content || "")}</textarea>
    </div>`;
}

function bodyModeToggle(secKey, mode) {
  return `
    <div class="mode-toggle" role="group" aria-label="Mode penulisan">
      <button type="button" class="btn btn-tiny ${mode === "prose" ? "on" : ""}" data-body-mode="${esc(secKey)}" data-mode="prose">Teks bebas</button>
      <button type="button" class="btn btn-tiny ${mode === "points" ? "on" : ""}" data-body-mode="${esc(secKey)}" data-mode="points">Poin 1. a. i.</button>
    </div>`;
}

function pointsEditor(secKey, points) {
  const marked = assignMarkers(points || []);
  const rows = marked.map((p, i) => `
    <div class="point-row level-${p.level}" data-point-row="${i}">
      <span class="point-mark">${esc(p.marker)}</span>
      <input class="point-input" data-point-sec="${esc(secKey)}" data-point-idx="${i}"
             value="${esc(p.text || "")}" placeholder="Isi poin…" />
      <div class="point-actions">
        <button type="button" class="btn btn-tiny" title="Indent (Tab)" data-point-indent="${esc(secKey)}" data-point-idx="${i}">⇥</button>
        <button type="button" class="btn btn-tiny" title="Outdent (Shift+Tab)" data-point-outdent="${esc(secKey)}" data-point-idx="${i}">⇤</button>
        <button type="button" class="btn btn-tiny danger" title="Hapus" data-point-remove="${esc(secKey)}" data-point-idx="${i}">×</button>
      </div>
    </div>`).join("");
  return `
    <div class="points-editor" data-points-for="${esc(secKey)}">
      <div class="hint">Poin otomatis: 1. 2. 3. → a. b. c. → i. ii. iii. · Tab = subpoin · Shift+Tab = naik tingkat</div>
      ${rows || `<p class="muted small">Belum ada poin. Klik “Tambah poin”.</p>`}
      <div class="btn-row tight">
        <button type="button" class="btn" data-point-add="${esc(secKey)}" data-point-level="1">+ Poin (1. 2. 3.)</button>
        <button type="button" class="btn" data-point-add="${esc(secKey)}" data-point-level="2">+ Subpoin (a. b. c.)</button>
        <button type="button" class="btn" data-point-add="${esc(secKey)}" data-point-level="3">+ Sub-sub (i. ii. iii.)</button>
      </div>
    </div>`;
}


function tableEditor(sec, data) {
  const hasTable = !!(data.table && Array.isArray(data.table.columns) && data.table.columns.length);
  if (!hasTable) {
    return `
      <div class="table-panel">
        <div class="hint">Tabel (opsional) — agenda, kontribusi, risiko, atau kustom</div>
        <div class="btn-row tight">
          ${Object.entries(TABLE_PRESETS).map(([key, preset]) => `
            <button type="button" class="btn" data-add-table="${esc(sec.key)}" data-preset="${key}">+ ${esc(preset.label)}</button>
          `).join("")}
        </div>
      </div>`;
  }
  const cols = data.table.columns;
  const rows = data.table.rows || [];
  return `
    <div class="table-panel">
      <div class="section-head" style="margin-bottom:0.35rem">
        <div class="hint">Tabel terstruktur</div>
        <button type="button" class="btn btn-tiny danger" data-remove-table="${esc(sec.key)}">Hapus tabel</button>
      </div>
      <div class="btn-row tight" style="margin-bottom:0.35rem">
        <button type="button" class="btn btn-tiny" data-add-col="${esc(sec.key)}">+ Kolom</button>
      </div>
      <table class="table-editor">
        <thead><tr>
          ${cols.map((c, ci) => `<th>
            <input data-col-name="${esc(sec.key)}" data-col-idx="${ci}" value="${esc(c)}" />
          </th>`).join("")}
          <th style="width:2.2rem"></th>
        </tr></thead>
        <tbody>
          ${rows.map((r, ri) => `<tr>
            ${cols.map((c) => `
              <td><input data-table="${esc(sec.key)}" data-row="${ri}" data-col="${esc(c)}" value="${esc(r[c] || "")}" /></td>
            `).join("")}
            <td><button type="button" class="btn btn-tiny danger" data-remove-row="${esc(sec.key)}" data-row="${ri}">×</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
      <button type="button" class="btn" data-add-row="${esc(sec.key)}">Tambah baris</button>
    </div>`;
}

function attachmentMeaningful(a) {
  if ((a.title || a.description || "").trim()) return true;
  if ((a.type || "note") === "table" && a.table?.rows?.length) return true;
  if (a.type === "image" && a.image?.stored_name) return true;
  return false;
}

function syncAttachmentsMeta() {
  if (!state.doc) return;
  if (!Array.isArray(state.doc.attachments_list)) state.doc.attachments_list = [];
  const n = state.doc.attachments_list.filter(attachmentMeaningful).length;
  if (n > 0) state.doc.metadata.attachments = formatAttachmentCount(n);
  else if (!state.doc.metadata.attachments) state.doc.metadata.attachments = "-";
}

function attachTableEditor(idx, item) {
  const table = item.table || { columns: ["No", "Uraian"], rows: [] };
  const cols = table.columns || [];
  const rows = table.rows || [];
  return `
    <div class="attach-table">
      <div class="btn-row tight">
        <button type="button" class="btn btn-tiny" data-attach-add-col="${idx}">+ Kolom</button>
        <button type="button" class="btn btn-tiny" data-attach-add-row="${idx}">+ Baris</button>
      </div>
      <table class="table-editor">
        <thead><tr>
          ${cols.map((c, ci) => `<th><input data-attach-col-name="${idx}" data-col-idx="${ci}" value="${esc(c)}" /></th>`).join("")}
          <th></th>
        </tr></thead>
        <tbody>
          ${rows.map((r, ri) => `<tr>
            ${cols.map((c) => `<td><input data-attach-cell="${idx}" data-row="${ri}" data-col="${esc(c)}" value="${esc(r[c] || "")}" /></td>`).join("")}
            <td><button type="button" class="btn btn-tiny danger" data-attach-del-row="${idx}" data-row="${ri}">×</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function attachmentsEditor(doc) {
  if (!Array.isArray(doc.attachments_list)) doc.attachments_list = [];
  const list = doc.attachments_list;
  const typeLabel = { note: "Catatan", table: "Tabel", image: "Foto / screenshot" };
  return `
    <div class="section-block" id="sec-lampiran">
      <div class="section-head">
        <div>
          <h2>Lampiran</h2>
          <p class="hint">Bisa catatan, tabel, atau foto/screenshot. Muncul di bawah dokumen; bisa diunduh. Jumlah mengisi Lamp. di header.</p>
        </div>
      </div>
      ${list.map((a, i) => {
        const kind = a.type || "note";
        const img = a.image || {};
        return `
        <div class="attach-card" data-attach-card="${i}">
          <div class="attach-card-head">
            <span class="badge">${esc(typeLabel[kind] || kind)}</span>
            <button type="button" class="btn btn-tiny danger" data-attach-remove="${i}">Hapus</button>
          </div>
          <input data-attach-title="${i}" placeholder="Judul lampiran" value="${esc(a.title || "")}" />
          <input data-attach-desc="${i}" placeholder="Keterangan singkat (opsional)" value="${esc(a.description || "")}" />
          ${kind === "table" ? attachTableEditor(i, a) : ""}
          ${kind === "image" ? `
            <div class="attach-image-panel">
              ${img.stored_name ? `
                <img class="attach-thumb" src="/api/documents/${esc(doc.id)}/attachments/${esc(img.stored_name)}" alt="${esc(img.original_name || "lampiran")}" />
                <div class="btn-row tight">
                  <a class="btn btn-tiny" href="/api/documents/${esc(doc.id)}/attachments/${esc(img.stored_name)}" download="${esc(img.original_name || "lampiran")}">Unduh</a>
                  <label class="btn btn-tiny" style="cursor:pointer">Ganti foto
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-attach-file="${i}" />
                  </label>
                </div>
                <p class="muted small">${esc(img.original_name || "")} · ${img.size ? Math.round(img.size/1024) + " KB" : ""}</p>
              ` : `
                <label class="btn" style="cursor:pointer">Pilih foto / screenshot
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-attach-file="${i}" />
                </label>
              `}
            </div>` : ""}
        </div>`;
      }).join("")}
      <div class="btn-row tight">
        <button type="button" class="btn" data-attach-add="note">+ Catatan</button>
        <button type="button" class="btn" data-attach-add="table">+ Tabel</button>
        <button type="button" class="btn" data-attach-add="image">+ Foto / screenshot</button>
      </div>
      <label>Teks Lamp. di header</label>
      <input data-meta="attachments" value="${esc(doc.metadata.attachments || "")}" placeholder="1 (satu) berkas" />
    </div>`;
}

function renderA4(doc, tmpl) {
  const m = doc.metadata;
  const isM02 = (tmpl.layout_variant || "").startsWith("m02");
  const isM01 = (tmpl.layout_variant || "").startsWith("m01") || (tmpl.doc_type_code === "M.01");
  const isMR = doc.type === "MEETING_REQUEST";

  const sections = tmpl.sections.map((sec) => {
    const data = doc.sections.find((s) => s.key === sec.key) || {};
    if (data.not_needed) return "";
    if (sec.input_mode === "structured_fields") {
      if (!data.fields) data.fields = {};
      const rows = (sec.fields || []).map((f) => {
        const val = (data.fields[f.key] || "").trim();
        return `<tr>
          <td style="width:28mm;white-space:nowrap">${esc(f.label)}</td>
          <td style="width:4mm">:</td>
          <td><span class="live-field" contenteditable="true" data-live-field-section="${esc(sec.key)}" data-live-field-key="${esc(f.key)}">${esc(val)}</span></td>
        </tr>`;
      }).join("");
      const titleHtml = isM01 ? "" : `<div class="sec-title">${esc(sectionHeading(sec.title, sec.outline_number))}</div>`;
      return `${titleHtml}<table class="meta-table">${rows}</table>`;
    }
    if (ensureBodyMode(data) === "points") {
      ensureSectionPoints(data);
      if (data.points?.length) syncSectionContentFromPoints(data);
    }
    const content = (data.content || "").trim();
    const showPlaceholder = !content;
    let tableHtml = "";
    if (data.table?.rows?.length) {
      const cols = data.table.columns || [];
      tableHtml = `<table class="data"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${data.table.rows.map(r => `<tr>${cols.map(c=>`<td>${esc(r[c]||"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    const titleHtml = isM01 ? "" : `<div class="sec-title">${esc(sectionHeading(sec.title, sec.outline_number))}</div>`;
    const bodyText = showPlaceholder ? sec.placeholder : content;
    return `${titleHtml}
      <div class="body-p ${showPlaceholder ? "placeholder-preview" : ""}"
           contenteditable="true"
           data-live-section="${esc(sec.key)}"
           spellcheck="true">${formatOutlineHtml(bodyText || "")}</div>
      ${tableHtml}`;
  }).join("");

  let metaBlock = "";
  if (isM02) {
    metaBlock = `
      <div class="perihal-line"><strong>PERIHAL :</strong>
        <span class="live-field" contenteditable="true" data-live-meta="subject">${esc((m.subject || "").toUpperCase())}</span>
      </div>
      <div>Kepada&nbsp;&nbsp;:
        <span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient)}</span>
      </div>
      <div>Melalui&nbsp;:
        <span class="live-field" contenteditable="true" data-live-meta="via">${esc(m.via || "")}</span>
      </div>`;
  } else if (!isMR) {
    metaBlock = `
      <table class="meta-table">
        <tr><td>Kepada</td><td>:</td><td><span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient)}</span></td></tr>
        <tr><td>Dari</td><td>:</td><td><span class="live-field" contenteditable="true" data-live-meta="dari">${esc(m.dari || m.satker)}</span></td></tr>
        <tr><td>Perihal</td><td>:</td><td><span class="live-field" contenteditable="true" data-live-meta="subject">${esc(m.subject)}</span></td></tr>
      </table>`;
  } else {
    metaBlock = `<div class="meta-lines">Hal: <span class="live-field" contenteditable="true" data-live-meta="subject">${esc(m.subject)}</span><br/>Yth.: <span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient)}</span></div>`;
  }

  let acc = "";
  if (tmpl.accountability.mode === "grid") {
    const map = [
      ["prepared_by", "Dipersiapkan oleh"],
      ["reviewed_by", "Diperiksa oleh"],
      ["supported_by", "Didukung oleh"],
      ["approved_by", "Disetujui oleh"],
      ["received_by", "Diterima oleh"],
    ].filter(([k]) => doc.accountability[k]);
    const cells = map.map(([k, label]) => {
      const p = doc.accountability[k] || {};
      return `<td><div class="acc-cell">
        <div class="acc-head">${esc(label)}:</div>
        <div class="acc-body">
          <div class="acc-role">${esc(p.title || "")}</div>
          <div class="acc-sigspace"></div>
          <div class="acc-name">${esc(p.name || "")}</div>
          <div class="acc-rank">${esc(p.rank || "")}</div>
        </div>
      </div></td>`;
    });
    let rows = "";
    for (let i = 0; i < cells.length; i += 2) {
      const right = cells[i + 1] || `<td><div class="acc-cell"><div class="acc-head">&nbsp;</div><div class="acc-body"></div></div></td>`;
      rows += `<tr>${cells[i]}${right}</tr>`;
    }
    acc = `<div style="margin-top:5mm"><span class="live-field" contenteditable="true" data-live-meta="city_date">${esc(m.city_date)}</span></div>
      <table class="acc-table">${rows}</table>`;
  } else if (tmpl.accountability.mode === "signatory_only") {
    const s = doc.signatory;
    acc = `<div class="sig-right"><span class="live-field" contenteditable="true" data-live-meta="city_date">${esc(m.city_date)}</span><br/><br/>${esc(s.title)}<br/><br/><br/><span style="text-decoration:underline">${esc(s.name)}</span><br/>${esc(s.rank)}</div>`;
  }

  const badge = isMR ? "MR" : (tmpl.doc_type_code || "");
  const lamp = isM02 ? "Lamp:" : "Lamp.:";
  const attachList = (doc.attachments_list || []).filter(attachmentMeaningful);
  const lampiranHtml = attachList.length ? `
    <div class="lampiran-block">
      <div class="sec-title">Lampiran</div>
      ${attachList.map((a, i) => {
        const title = (a.title || "").trim() || `Lampiran ${i + 1}`;
        const desc = (a.description || "").trim();
        const kind = a.type || "note";
        let extra = "";
        if (kind === "table" && a.table?.rows?.length) {
          const cols = a.table.columns || [];
          extra = `<table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
            <tbody>${a.table.rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        } else if (kind === "image" && a.image?.stored_name) {
          extra = `<div class="lampiran-img"><img src="/api/documents/${esc(doc.id)}/attachments/${esc(a.image.stored_name)}" alt="${esc(a.image.original_name || title)}" /></div>`;
        }
        return `<div class="lampiran-item">
          <div class="outline-line l1"><span class="mk">${i + 1}.</span> <span class="tx">${esc(title)}${desc ? " — " + esc(desc) : ""}${kind === "image" ? " (foto)" : kind === "table" ? " (tabel)" : ""}</span></div>
          ${extra}
        </div>`;
      }).join("")}
    </div>` : "";
  return `
    <div class="kop"><img src="/static/bi-logo.png" alt="Bank Indonesia" /></div>
    ${doc.status === "draft" ? `<div class="draft-stamp">KONSEP</div>` : ""}
    <div class="type-badge">${esc(badge)}</div>
    <div class="meta-lines">No. <span class="live-field" contenteditable="true" data-live-meta="document_number">${esc(m.document_number)}</span><br/>${lamp}
      <span class="live-field" contenteditable="true" data-live-meta="attachments">${esc(m.attachments || "-")}</span></div>
    <div class="memo-title">${isMR ? "MEETING REQUEST" : "MEMORANDUM"}</div>
    ${metaBlock}
    ${sections}
    ${acc}
    ${lampiranHtml}
  `;
}


function navigate(route) {
  state.route = route;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.route === route);
  });
  render();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.route));
});

async function boot() {
  const me = await api("/api/auth/me");
  if (!me.authenticated) {
    window.location.href = "/login";
    return;
  }
  state.user = me.username;
  const chip = document.getElementById("user-chip");
  const nameEl = document.getElementById("user-name");
  if (chip && nameEl) {
    nameEl.textContent = me.username;
    chip.hidden = false;
  }
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    window.location.href = "/login";
  });
  state.health = await api("/api/health");
  state.templates = await api("/api/templates");
  state.documents = await api("/api/documents");
  render();
}

function scheduleAutosave() {
  if (!state.doc?.id) return;
  clearTimeout(state.autosaveTimer);
  setSave("Menyimpan…");
  state.autosaveTimer = setTimeout(async () => {
    try {
      const id = state.doc.id;
      const saved = await api(`/api/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify(state.doc),
      });
      state.doc.updated_at = saved.updated_at;
      state.doc.versions = saved.versions;
      state.doc.audit = saved.audit;
      setSave(`Tersimpan · ${new Date().toLocaleTimeString("id-ID")}`);
    } catch (e) {
      setSave(`Gagal menyimpan: ${e.message}`);
    }
  }, 700);
}

function ensureStructuredFields(doc, tmpl) {
  if (!doc || !tmpl) return;
  if (!Array.isArray(doc.attachments_list)) doc.attachments_list = [];
  tmpl.sections.forEach((sec) => {
    const data = doc.sections.find((s) => s.key === sec.key);
    if (!data) return;
    if (sec.input_mode === "structured_fields") {
      if (!data.fields) data.fields = {};
      (sec.fields || []).forEach((f) => {
        if (data.fields[f.key] == null) data.fields[f.key] = "";
      });
    } else {
      ensureBodyMode(data);
      if (data.body_mode === "points") ensureSectionPoints(data);
    }
  });
}

function livePreview() {
  if (state.route !== "editor" || !state.doc) return;
  renderPreviewOnly();
  bindPreviewEditable();
  scheduleAutosave();
}


async function refreshFindings() {
  if (!state.doc) return;
  const result = await api("/api/validate", {
    method: "POST",
    body: JSON.stringify(state.doc),
  });
  state.findings = result.findings;
  state.canExport = result.can_export;
}

function render() {
  const main = $main();
  const app = document.getElementById("app");
  if (app) app.dataset.route = state.route;
  if (state.route === "dashboard") main.innerHTML = viewDashboard();
  else if (state.route === "create") main.innerHTML = viewCreate();
  else if (state.route === "editor") main.innerHTML = viewEditor();
  else if (state.route === "library") main.innerHTML = viewLibrary();
  else if (state.route === "admin") main.innerHTML = viewAdmin();
  bindView();
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function typeShort(t) {
  if (!t) return "Dokumen";
  if (t.startsWith("M.01")) return "M.01";
  if (t.startsWith("M.02")) return "M.02";
  if (t === "MEETING_REQUEST") return "MR";
  return t;
}

function viewDashboard() {
  const docs = state.documents || [];
  const tmplVer = state.templates?.version || "—";
  const ruleVer = (state.health?.rule_versions || []).slice(-1)[0] || "—";
  const fontOk = !!state.health?.fonts_ready;
  return `
    <section class="landing">
      <div class="landing-atmosphere" aria-hidden="true">
        <div class="landing-orb landing-orb-a"></div>
        <div class="landing-orb landing-orb-b"></div>
        <div class="landing-grid"></div>
        <div class="landing-sweep"></div>
      </div>

      <div class="landing-stage">
        <div class="landing-copy">
          <div class="landing-mark">
            <img src="/static/bi-mark.png" alt="Bank Indonesia" />
            <span class="landing-mark-line" aria-hidden="true"></span>
            <span class="landing-mark-sub">Internal</span>
          </div>
          <p class="landing-product">MemoBuilder</p>
          <h1 class="landing-headline">Memorandum terstandar, siap unduh.</h1>
          <p class="landing-lead">Pilih tujuan, isi substansi, validasi aturan BI — lalu unduh DOCX atau PDF tanpa menghafal template Word.</p>
          <div class="landing-cta">
            <button class="btn btn-landing" id="btn-create">Buat dokumen</button>
            <button class="btn btn-landing-ghost" id="btn-seed">Muat contoh</button>
          </div>
          <p class="landing-meta">Template v${esc(tmplVer)} · Rules v${esc(ruleVer)} · Font ${fontOk ? "siap" : "perlu dipasang"}</p>
        </div>

        <div class="landing-visual" aria-hidden="true">
          <div class="memo-float">
            <div class="memo-sheet">
              <div class="memo-kop">
                <div class="memo-kop-mark">BI</div>
                <div class="memo-kop-text">
                  <strong>BANK INDONESIA</strong>
                  <span>Memorandum</span>
                </div>
              </div>
              <div class="memo-meta-row"><span>Nomor</span><em>…/…/DMST/M.02</em></div>
              <div class="memo-meta-row"><span>Sifat</span><em>Rahasia</em></div>
              <div class="memo-meta-row"><span>Hal</span><em>PERMOHONAN PERSETUJUAN</em></div>
              <div class="memo-to">Yth. Kepala Departemen…</div>
              <div class="memo-body">
                <div class="memo-line w90"></div>
                <div class="memo-line w75"></div>
                <div class="memo-line w82"></div>
                <div class="memo-line w60"></div>
              </div>
              <div class="memo-sign">
                <div class="memo-sign-line"></div>
                <span>Pejabat berwenang</span>
              </div>
            </div>
            <div class="memo-sheet memo-sheet-back"></div>
          </div>
        </div>
      </div>

      <section class="landing-drafts">
        <div class="dash-drafts-head">
          <h2>Draft terkini</h2>
          ${docs.length ? `<button class="btn btn-tiny danger" id="btn-clear-drafts">Kosongkan semua</button>` : ""}
        </div>
        ${docs.length ? `
          <ul class="draft-list">
            ${docs.map((d) => `
              <li>
                <button class="draft-row" data-open="${esc(d.id)}">
                  <span class="draft-type">${esc(typeShort(d.type))}</span>
                  <span class="draft-main">
                    <span class="draft-subject">${esc(d.draft_name || d.subject || "Tanpa nama")}</span>
                    <span class="draft-sub">${esc(d.subject && d.draft_name && d.subject !== d.draft_name ? d.subject + " · " : "")}${esc(d.status || "draft")} · ${esc(formatWhen(d.updated_at))}</span>
                  </span>
                  <span class="draft-go" aria-hidden="true">→</span>
                </button>
              </li>
            `).join("")}
          </ul>
        ` : `
          <div class="draft-empty">
            <p>Belum ada draft.</p>
            <p class="muted small">Mulai dari tujuan dokumen, atau muat contoh untuk mencoba alur lengkap.</p>
          </div>
        `}
      </section>
    </section>`;
}

function viewCreate() {
  const c = state.classification;
  return `
    <h1>Buat Dokumen</h1>
    <p class="muted">Apa tujuan utama dokumen ini? (bukan pilihan kode M.01/M.02)</p>
    <div class="grid-cards" id="purpose-cards">
      <button class="choice-card" data-purpose="koordinasi"><h3>Koordinasi / minta informasi</h3><p class="muted small">Ke satker/unit lain</p></button>
      <button class="choice-card" data-purpose="undangan"><h3>Undangan rapat / kegiatan</h3><p class="muted small">Akan ditanya soal anggaran</p></button>
      <button class="choice-card" data-purpose="persetujuan"><h3>Minta persetujuan / keputusan</h3><p class="muted small">Keputusan pimpinan</p></button>
      <button class="choice-card" data-purpose="pelaporan"><h3>Menyampaikan laporan / pendapat</h3><p class="muted small">Laporan atau masukan</p></button>
    </div>
    <div id="classify-panel"></div>
  `;
}

function classifyPanelHtml() {
  const c = state.classification;
  if (!c) return "";
  if (c.needs_budget_question) {
    return `<div class="panel" style="margin-top:1rem">
      <h2>Satu pertanyaan lagi</h2>
      <p>${esc(c.explanation)}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-budget="true">Ya, ada pembebanan anggaran kedinasan</button>
        <button class="btn" data-budget="false">Tidak</button>
      </div>
    </div>`;
  }
  const resultType = c.result_type || "";
  const tmpl = state.templates?.templates?.[resultType] || {};
  const code = tmpl.doc_type_code || "DOC";
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2,"0")}-${String(today.getMonth()+1).padStart(2,"0")}-${today.getFullYear()}`;
  state.pendingName = state.pendingName || {
    satker: "DMST",
    program_strategis: "PS12",
    title: "",
    draft_name: "",
    suggested: "",
    doc_type: code,
  };
  state.pendingName.doc_type = code;
  return `<div class="banner naming-panel" style="margin-top:1rem">
      <strong>Klasifikasi:</strong> ${esc(c.explanation)}
      <div class="muted small" style="margin-top:0.35rem">Rule ${esc(c.rule_id)} · ${esc(c.label)} · kode ${esc(code)}</div>

      <div class="name-form">
        <h3>Nama draft</h3>
        <p class="hint">Menurut Pedoman 2022 (FILE-01): <code>[SATKER]_[PSXX]_[JENIS]_[JUDUL]_[DD-MM-YYYY]</code>. Contoh: <code>DMST_PS12_M.02_Hasil Asesmen Governance_19-02-2020</code>.</p>
        <div class="name-grid">
          <div>
            <label>Satker</label>
            <input id="name-satker" value="${esc(state.pendingName.satker)}" placeholder="DMST / DR" />
          </div>
          <div>
            <label>Program Strategis</label>
            <input id="name-ps" value="${esc(state.pendingName.program_strategis)}" placeholder="PS12" />
          </div>
        </div>
        <label>Judul singkat (untuk saran nama & perihal awal)</label>
        <input id="name-title" value="${esc(state.pendingName.title)}" placeholder="mis. Permohonan Persetujuan Asesmen Governance" />
        <label>Nama draft (bisa diedit)</label>
        <input id="name-draft" value="${esc(state.pendingName.draft_name)}" placeholder="Terisi dari saran peraturan…" />
        <p class="hint" id="name-suggest-line">Saran peraturan akan muncul di sini.</p>
        <div class="btn-row tight">
          <button type="button" class="btn" id="btn-apply-suggest">Pakai saran peraturan</button>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="btn-start-doc">Buat draft dengan nama ini</button>
        <label class="small" style="display:flex;align-items:center;gap:0.4rem">
          Override tipe
          <select id="override-type">
            <option value="">(ikuti rule)</option>
            ${Object.keys(state.templates.templates).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="hint">Override akan memunculkan warning jika bertentangan dengan rule. Tanggal saran: ${esc(dateStr)}.</p>
    </div>`;
}

function viewEditor() {
  const doc = state.doc;
  if (!doc) return `<p>Tidak ada dokumen.</p>`;
  const tmpl = state.templates.templates[doc.type];
  const tab = state.editorTab;
  return `
    <div class="topbar">
      <div>
        <h1>${esc(doc.draft_name || tmpl?.label || doc.type)}</h1>
        <p class="muted small">${esc(tmpl?.label || doc.type)} · template ${esc(doc.template_version)} · rule ${esc(doc.rule_version)}</p>
      </div>
      <div class="btn-row" style="margin:0">
        <button class="btn" id="btn-validate">Validasi</button>
        <button class="btn btn-primary" id="btn-export-docx" ${state.canExport === false ? "" : ""}>Unduh DOCX</button>
        <button class="btn" id="btn-export-pdf">Unduh PDF</button>
        ${doc.type === "MEETING_REQUEST" ? `<button class="btn" id="btn-copy-email">Salin Meeting Request</button>` : ""}
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab==="metadata"?"active":""}" data-tab="metadata">Metadata</button>
      <button class="tab ${tab==="sections"?"active":""}" data-tab="sections">Substansi</button>
      <button class="tab ${tab==="accountability"?"active":""}" data-tab="accountability">Akuntabilitas</button>
      <button class="tab ${tab==="review"?"active":""}" data-tab="review">Review & Validasi</button>
      <button class="tab ${tab==="versions"?"active":""}" data-tab="versions">Riwayat</button>
    </div>
    <div class="workspace">
      <div class="panel" id="editor-pane">${editorPane(tmpl, tab)}</div>
      <div class="preview-shell">
        ${state.health?.fonts_ready ? "" : `<div class="font-warning">Font Optima/Frutiger resmi belum terpasang. Preview memakai fallback bertanda needs_bi_verification.</div>`}
        <div class="a4 ${ (tmpl.layout_variant||"").startsWith("m02") ? "layout-m02" : "" }" id="a4-preview">${renderA4(doc, tmpl)}</div>
      </div>
    </div>`;
}

function editorPane(tmpl, tab) {
  const doc = state.doc;
  const m = doc.metadata;
  const isM02 = (tmpl.layout_variant || "").startsWith("m02");
  if (tab === "metadata") {
    return `
      <h2>Metadata</h2>
      <p class="hint">Isian mengikuti susunan contoh memorandum BI (M.01: Kepada/Dari/Perihal · M.02: Perihal/Kepada/Melalui). Sumber: PCPM 40 DMST, Pedoman Dokumen Elektronik 2022.</p>

      <label>Nama draft (tampil di daftar)</label>
      <input data-draft-name="1" value="${esc(doc.draft_name || m.draft_name || "")}" placeholder="DMST_PS12_M.02_Judul_12-09-2026" />
      <p class="hint">Nama kerja di aplikasi agar draft mudah dibedakan. Saran mengikuti FILE-01. <button type="button" class="btn btn-tiny" id="btn-resync-name">Isi ulang dari satker/PS/perihal</button></p>

      <label>Sifat dokumen</label>
      <select data-meta="classification">
        <option ${m.classification==="Biasa"?"selected":""}>Biasa</option>
        <option ${m.classification==="Rahasia"?"selected":""}>Rahasia</option>
      </select>
      <p class="hint">Tingkat kerahasiaan. <b>Biasa</b> = informasi biasa (kode nomor <code>/B</code>). <b>Rahasia</b> = informasi rahasia jabatan (kode <code>/Rhs</code>, penanganan lebih ketat). Ref: PCPM 40 DMST — Sifat Dokumen BI.</p>

      <label>Satker / kode unit (untuk nama file)</label>
      <input data-meta="satker" value="${esc(m.satker)}" placeholder="DMST / DR / DHk" />
      <p class="hint">Rubrik satuan kerja pencipta, dipakai di penomoran & nama file. Contoh: <code>DMST</code>, <code>DR</code>. Ref: PCPM contoh No.17/9/DMST/M.01/Rhs; FILE-01 Pedoman 2022.</p>

      ${isM02 ? "" : `
        <label>Dari</label>
        <input data-meta="dari" value="${esc(m.dari || m.satker || "")}" placeholder="Departemen Manajemen Strategis" />
        <p class="hint">Pengirim / unit pencipta pada blok metadata M.01. Contoh: <code>Departemen Regional</code> atau nama grup/divisi. Ref: layout contoh M.01 (Kepada–Dari–Perihal).</p>
      `}

      <label>${isM02 ? "Kepada" : "Kepada / penerima"}</label>
      <input data-meta="recipient" value="${esc(m.recipient)}" placeholder="${isM02 ? "Yth. Bapak/Ibu …, Kepala Departemen …" : "Yth. Kepala Divisi …"}" />
      <p class="hint">Penerima utama memo. Format lazim diawali <code>Yth.</code> + jabatan/nama. Contoh M.02: <code>Yth. Bapak Arief Hartawan, Kepala Departemen Regional</code>. Ref: contoh DOCX M.01/M.02; struktur M.02 PCPM.</p>

      ${isM02 ? `
        <label>Melalui (opsional)</label>
        <input data-meta="via" value="${esc(m.via || "")}" placeholder="Yth. Kepala Grup …" />
        <p class="hint">Jalur hierarki / pejabat perantara sebelum penerima utama (hanya M.02). Contoh: <code>Yth. Bapak Bayu Martanto, Kepala Grup …</code>. Kosongkan jika tidak dipakai. Ref: layout contoh M.02 persetujuan.</p>
      ` : ""}

      <label>Perihal</label>
      <input data-meta="subject" value="${esc(m.subject)}" placeholder="Permohonan Persetujuan … / Penyampaian Laporan …" />
      <p class="hint">Pokok surat — ringkas dan jelas. Di M.02 biasanya ditulis HURUF BESAR pada baris PERIHAL. Contoh: <code>PERMOHONAN PERSETUJUAN PELAKSANAAN …</code>. Ref: contoh M.02; struktur isi PCPM.</p>

      <label>Kota dan tanggal</label>
      <input data-meta="city_date" value="${esc(m.city_date)}" placeholder="Jakarta, 12 September 2026" />
      <p class="hint">Tempat & tanggal penandatanganan (biasanya di atas blok tanda tangan). Format: <code>Jakarta, 12 September 2026</code> atau <code>Jakarta, Juli 2025</code> bila tanggal belum final.</p>

      <label>Nomor dokumen</label>
      <input data-meta="document_number" value="${esc(m.document_number)}" placeholder="27/       /DR/M.01/B" />
      <p class="hint">Nomor resmi — biasanya diisi agendaris <b>setelah</b> ditandatangani. Pola: <code>tahun/nomor/rubrik/jenis/sifat</code>. Contoh: <code>17/9/DMST/M.01/Rhs</code> (rahasia), <code>…/M.02/B</code> (biasa). Ref: PCPM penomoran dokumen; FAQ MDEBI.</p>

      <label>Nomor Program Strategis</label>
      <input data-meta="program_strategis" value="${esc(m.program_strategis)}" placeholder="PS12" />
      <p class="hint">Kode PS untuk penamaan file/ekspor (FILE-01), bukan selalu tercetak di badan memo. Contoh: <code>PS12</code>. Ref: Pedoman 2022 pola nama file.</p>

      <p class="hint">Lampiran (daftar isi lampiran) diisi di tab <b>Substansi</b> bagian bawah; teks <code>Lamp.</code>/<code>Lamp:</code> di header ikut terisi. Contoh: <code>1 (satu) berkas</code>, <code>1 (satu) set</code>.</p>

      <label>PIC / kontak</label>
      <input data-meta="pic" value="${esc(m.pic)}" placeholder="Nama — email — telepon" />
      <p class="hint">Bantuan operasional (siapa dihubungi), sering relevan untuk undangan/konfirmasi. Tidak selalu baris wajib di template Word resmi.</p>

      <label>Tenggat</label>
      <input data-meta="deadline" value="${esc(m.deadline)}" placeholder="19 September 2026 / 1 hari sebelum kegiatan" />
      <p class="hint">Batas waktu tindak lanjut yang diharapkan. Contoh: <code>19 September 2026</code>. Metadata bantu; cantumkan juga di substansi bila penting bagi penerima.</p>

      <label>Tembusan (pisahkan dengan | )</label>
      <input data-meta="tembusan" value="${esc((m.tembusan||[]).join(" | "))}" placeholder="Arsip | Kepala Grup terkait" />
      <p class="hint">Pihak yang diberi salinan (bukan penerima utama), biasanya sebagai <code>cc</code> di halaman terakhir kiri bawah. Contoh: <code>Arsip | DAI | Kepala Grup …</code>. Ref: PCPM — tembusan / cc / bcc.</p>
    `;
  }
  if (tab === "sections") {
    const blocks = tmpl.sections.map((sec) => {
      const data = doc.sections.find((s) => s.key === sec.key) || { content: "", fields: {}, points: [] };
      if (sec.input_mode === "structured_fields" && !data.fields) {
        data.fields = Object.fromEntries((sec.fields || []).map((f) => [f.key, ""]));
      }
      if (sec.input_mode !== "structured_fields") ensureBodyMode(data);
      const structuredFilled = sec.input_mode === "structured_fields"
        && (sec.fields || []).every((f) => !!(data.fields?.[f.key] || "").trim());
      const filled = structuredFilled
        || !!(data.content || "").trim()
        || (data.points || []).some((p) => (p.text || "").trim())
        || (data.table?.rows?.length > 0)
        || data.not_needed;
      let body = "";
      if (sec.input_mode === "structured_fields") {
        body = `<div class="field-grid">
            ${(sec.fields || []).map((f) => `
              <label>${esc(f.label)}</label>
              <input data-field-section="${esc(sec.key)}" data-field-key="${esc(f.key)}"
                     value="${esc((data.fields || {})[f.key] || "")}"
                     placeholder="${esc(f.placeholder || "")}" />
            `).join("")}
          </div>`;
      } else {
        const mode = ensureBodyMode(data);
        body = bodyModeToggle(sec.key, mode)
          + (mode === "points"
            ? pointsEditor(sec.key, ensureSectionPoints(data))
            : proseEditor(sec.key, data.content, sec.placeholder))
          + `<div class="btn-row tight">
               <button class="btn" data-polish="${esc(sec.key)}">Rapikan bahasa</button>
             </div>`;
      }
      return `
        <div class="section-block" id="sec-${esc(sec.key)}">
          <div class="section-head">
            <div>
              <h2>${esc(sectionHeading(sec.title, sec.outline_number))}</h2>
              <p class="hint">${esc(sec.guidance)}</p>
              ${sec.explicit_field_label ? `<p class="hint"><strong>${esc(sec.explicit_field_label)}</strong></p>` : ""}
            </div>
            <div class="${filled ? "complete" : "incomplete"}">${filled ? "Lengkap" : "Belum lengkap"}</div>
          </div>
          ${body}
          <div class="btn-row">
            ${sec.allow_not_needed ? `
              <label class="small" style="display:flex;gap:0.35rem;align-items:center">
                <input type="checkbox" data-not-needed="${esc(sec.key)}" ${data.not_needed ? "checked" : ""} /> Tidak diperlukan
              </label>
              <input data-not-reason="${esc(sec.key)}" placeholder="Alasan" value="${esc(data.not_needed_reason || "")}" style="max-width:240px" />
            ` : ""}
          </div>
          ${data.ai_suggested ? `<p class="hint">Saran AI—perlu verifikasi pengguna</p>` : ""}
          ${tableEditor(sec, data)}
        </div>`;
    });
    return blocks.join("") + attachmentsEditor(doc);
  }
  if (tab === "accountability") {
    if (tmpl.accountability.mode === "grid") {
      const labels = {
        prepared_by: "Dipersiapkan oleh",
        reviewed_by: "Diperiksa oleh",
        supported_by: "Didukung oleh",
        approved_by: "Disetujui oleh",
        received_by: "Diterima oleh",
      };
      return Object.entries(labels)
        .filter(([k]) => doc.accountability[k])
        .map(([k, label]) => {
          const p = doc.accountability[k];
          return `
            <div class="section-block">
              <h2>${esc(label)}</h2>
              <label>Jabatan (baris atas sel)</label><input data-acc="${k}.title" value="${esc(p.title)}" placeholder="Analis Yunior" />
              <label>Nama (digarisbawahi)</label><input data-acc="${k}.name" value="${esc(p.name)}" />
              <label>Pangkat (baris bawah)</label><input data-acc="${k}.rank" value="${esc(p.rank)}" placeholder="Asisten Manajer" />
            </div>`;
        }).join("");
    }
    if (tmpl.accountability.mode === "signatory_only") {
      const s = doc.signatory;
      return `
        <h2>Penandatangan</h2>
        <label>Jabatan</label><input data-sig="title" value="${esc(s.title)}" />
        <label>Nama</label><input data-sig="name" value="${esc(s.name)}" />
        <label>Pangkat</label><input data-sig="rank" value="${esc(s.rank)}" />
      `;
    }
    return `<p class="muted">Meeting Request tidak memakai blok akuntabilitas M.02.</p>`;
  }
  if (tab === "review") {
    const items = state.findings || [];
    return `
      <h2>Validasi</h2>
      <ul class="findings">
        ${items.length ? items.map((f) => `
          <li class="${esc(f.severity)}" data-jump="${esc(f.section_key || "")}">
            <strong>${esc(f.severity)}</strong> · ${esc(f.id || "")}<br/>
            ${esc(f.message)}
          </li>`).join("") : `<li class="info">Belum ada temuan. Jalankan validasi setelah mengisi dokumen.</li>`}
      </ul>
      <p class="hint">Status ekspor: ${state.canExport ? "siap (tidak ada error)" : "terblokir atau belum divalidasi"}</p>
    `;
  }
  if (tab === "versions") {
    return `
      <h2>Riwayat versi</h2>
      <ul class="findings">
        ${(doc.versions || []).slice().reverse().map(v => `
          <li class="info">v${esc(v.version)} · ${esc(v.actor)} · ${esc(v.at)}</li>
        `).join("") || `<li class="info">Belum ada versi tersimpan.</li>`}
      </ul>
      <h2>Audit trail</h2>
      <ul class="findings">
        ${(doc.audit || []).slice().reverse().slice(0, 20).map(a => `
          <li class="info">${esc(a.event)} · ${esc(a.at || "")} ${a.filename ? "· " + esc(a.filename) : ""}</li>
        `).join("")}
      </ul>`;
  }
  return "";
}

function bindPreviewEditable() {
  const root = document.getElementById("a4-preview");
  if (!root || !state.doc) return;

  root.querySelectorAll("[data-live-section]").forEach((el) => {
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("focus", () => {
      if (el.classList.contains("placeholder-preview")) {
        el.textContent = "";
        el.classList.remove("placeholder-preview");
      }
    });
    el.addEventListener("input", () => {
      const key = el.dataset.liveSection;
      const sec = state.doc.sections.find((s) => s.key === key);
      const text = el.innerText.replace(/\u00a0/g, " ");
      sec.content = text;
      sec.points = contentToPoints(text);
      sec.ai_suggested = false;
      scheduleAutosave();
      setSave("Live · belum tersimpan…");
    });
  });

  root.querySelectorAll("[data-live-meta]").forEach((el) => {
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      const key = el.dataset.liveMeta;
      let val = el.innerText.replace(/\u00a0/g, " ").trim();
      state.doc.metadata[key] = val;
      const input = document.querySelector(`[data-meta="${key}"]`);
      if (input && document.activeElement !== input) input.value = val;
      scheduleAutosave();
      setSave("Live · belum tersimpan…");
    });
  });

  root.querySelectorAll("[data-live-field-section]").forEach((el) => {
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      const skey = el.dataset.liveFieldSection;
      const fkey = el.dataset.liveFieldKey;
      const sec = state.doc.sections.find((s) => s.key === skey);
      if (!sec.fields) sec.fields = {};
      sec.fields[fkey] = el.innerText.replace(/\u00a0/g, " ").trim();
      const input = document.querySelector(`[data-field-section="${skey}"][data-field-key="${fkey}"]`);
      if (input && document.activeElement !== input) input.value = sec.fields[fkey];
      scheduleAutosave();
      setSave("Live · belum tersimpan…");
    });
  });

}

function renderPreviewOnly() {
  const el = document.getElementById("a4-preview");
  if (!el || !state.doc) return;
  if (el.contains(document.activeElement) && document.activeElement.isContentEditable) {
    return;
  }
  const tmpl = state.templates.templates[state.doc.type];
  el.classList.toggle("layout-m02", (tmpl.layout_variant || "").startsWith("m02"));
  el.innerHTML = renderA4(state.doc, tmpl);
}

function viewLibrary() {
  const t = state.templates.templates;
  return `
    <h1>Template Library</h1>
    <p class="muted">Empat keluaran MVP + Meeting Request. Sumber tertanam di metadata template.</p>
    <div class="grid-cards">
      ${Object.entries(t).map(([id, tmpl]) => `
        <div class="panel">
          <div class="badge">${esc(id)}</div>
          <h3>${esc(tmpl.label)}</h3>
          <p class="muted small">${esc(tmpl.source_page_or_section)}</p>
          <ul class="small">${tmpl.sections.map(s => `<li>${esc(s.title)}${s.required ? " *" : ""}</li>`).join("")}</ul>
          ${tmpl.accountability?.final_label ? `<p class="badge">${esc(tmpl.accountability.final_label)}</p>` : ""}
        </div>
      `).join("")}
    </div>`;
}

function viewAdmin() {
  return `
    <h1>Admin Rules & Templates</h1>
    <p class="muted">Terbitkan versi baru tanpa mengubah kode aplikasi. Setiap versi menyimpan source metadata.</p>
    <div class="panel">
      <h2>Status font</h2>
      <p>${state.health?.fonts_ready ? "Font resmi tersedia." : "Font belum ada — letakkan Optima.ttf dan Frutiger.ttf di <code>assets/fonts/</code>."}</p>
      <p class="hint">Missing: ${(state.health?.missing_fonts || []).map(esc).join(", ") || "-"}</p>
    </div>
    <div class="panel" style="margin-top:1rem">
      <h2>Versi terpasang</h2>
      <p>Rules: ${(state.health?.rule_versions || []).map(esc).join(", ")}</p>
      <p>Templates: ${(state.health?.template_versions || []).map(esc).join(", ")}</p>
      <p class="hint">Untuk publish versi baru, POST ke <code>/api/admin/rules</code> atau <code>/api/admin/templates</code> dengan payload JSON lengkap (lihat README).</p>
      <div class="btn-row">
        <button class="btn" id="btn-clone-template">Publish template v1.0.1 (klon + catatan verifikasi)</button>
      </div>
      <pre id="admin-out" class="small" style="white-space:pre-wrap"></pre>
    </div>`;
}

function bindView() {
  const main = $main();

  main.querySelector("#btn-create")?.addEventListener("click", () => navigate("create"));
  main.querySelector("#btn-seed")?.addEventListener("click", async () => {
    setSave("Menyiapkan contoh…");
    await api("/api/seed", { method: "POST" });
    state.documents = await api("/api/documents");
    setSave("Contoh siap");
    render();
  });
  main.querySelector("#btn-clear-drafts")?.addEventListener("click", async () => {
    if (!confirm("Kosongkan semua draft di perangkat ini?")) return;
    setSave("Menghapus draft…");
    await api("/api/documents", { method: "DELETE" });
    state.documents = [];
    state.doc = null;
    setSave("Draft dikosongkan");
    render();
  });

  main.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.doc = await api(`/api/documents/${btn.dataset.open}`);
      await refreshFindings();
      state.route = "editor";
      state.editorTab = "metadata";
      render();
    });
  });

  if (state.route === "create") {
    const panel = main.querySelector("#classify-panel");
    if (panel) panel.innerHTML = classifyPanelHtml();

    const refreshSuggest = async () => {
      if (!state.classification || state.classification.needs_budget_question) return;
      const satker = main.querySelector("#name-satker")?.value || "DMST";
      const ps = main.querySelector("#name-ps")?.value || "PS12";
      const title = main.querySelector("#name-title")?.value || state.classification.label || "Draft";
      const override = main.querySelector("#override-type")?.value;
      const resultType = override || state.classification.result_type;
      const code = state.templates?.templates?.[resultType]?.doc_type_code || "DOC";
      state.pendingName = {
        ...(state.pendingName || {}),
        satker, program_strategis: ps, title, doc_type: code,
      };
      try {
        const res = await api("/api/suggest-name", {
          method: "POST",
          body: JSON.stringify({
            satker, program_strategis: ps, doc_type: code, title,
          }),
        });
        state.pendingName.suggested = res.suggested;
        const line = main.querySelector("#name-suggest-line");
        if (line) line.innerHTML = `Saran peraturan (${esc(res.rule_id)}): <code>${esc(res.suggested)}</code>`;
        const draftInput = main.querySelector("#name-draft");
        if (draftInput && (!draftInput.value.trim() || draftInput.dataset.auto === "1")) {
          draftInput.value = res.suggested;
          draftInput.dataset.auto = "1";
          state.pendingName.draft_name = res.suggested;
        }
      } catch (e) {
        /* ignore preview errors */
      }
    };

    main.querySelectorAll("[data-purpose]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.pendingPurpose = btn.dataset.purpose;
        state.pendingName = null;
        state.classification = await api("/api/classify", {
          method: "POST",
          body: JSON.stringify({ purpose: btn.dataset.purpose }),
        });
        render();
      });
    });
    main.querySelectorAll("[data-budget]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.pendingName = null;
        state.classification = await api("/api/classify", {
          method: "POST",
          body: JSON.stringify({
            purpose: "undangan",
            budget_impact: btn.dataset.budget === "true",
          }),
        });
        state.pendingBudget = btn.dataset.budget === "true";
        render();
      });
    });
    ["#name-satker", "#name-ps", "#name-title", "#override-type"].forEach((sel) => {
      main.querySelector(sel)?.addEventListener("input", () => {
        const draftInput = main.querySelector("#name-draft");
        if (draftInput) draftInput.dataset.auto = "1";
        refreshSuggest();
      });
      main.querySelector(sel)?.addEventListener("change", () => {
        const draftInput = main.querySelector("#name-draft");
        if (draftInput) draftInput.dataset.auto = "1";
        refreshSuggest();
      });
    });
    main.querySelector("#name-draft")?.addEventListener("input", (ev) => {
      ev.target.dataset.auto = "0";
      if (state.pendingName) state.pendingName.draft_name = ev.target.value;
    });
    main.querySelector("#btn-apply-suggest")?.addEventListener("click", async () => {
      await refreshSuggest();
      const draftInput = main.querySelector("#name-draft");
      if (draftInput && state.pendingName?.suggested) {
        draftInput.value = state.pendingName.suggested;
        draftInput.dataset.auto = "1";
        state.pendingName.draft_name = state.pendingName.suggested;
      }
    });
    refreshSuggest();
    main.querySelector("#btn-start-doc")?.addEventListener("click", async () => {
      const override = main.querySelector("#override-type")?.value || null;
      const purpose = state.pendingPurpose || state.classification?.purpose || inferPurpose();
      const budget = state.classification?.budget_impact ?? state.pendingBudget ?? null;
      const satker = main.querySelector("#name-satker")?.value || "DMST";
      const ps = main.querySelector("#name-ps")?.value || "PS12";
      const title = main.querySelector("#name-title")?.value || "";
      let draftName = (main.querySelector("#name-draft")?.value || "").trim();
      if (!draftName) {
        await refreshSuggest();
        draftName = state.pendingName?.suggested || "";
      }
      if (!draftName) {
        alert("Isi nama draft terlebih dahulu.");
        return;
      }
      state.doc = await api("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          purpose,
          budget_impact: budget,
          override_type: override || null,
          draft_name: draftName,
          satker,
          program_strategis: ps,
          subject: title,
        }),
      });
      state.documents = await api("/api/documents");
      await refreshFindings();
      state.route = "editor";
      state.editorTab = "metadata";
      navigate("editor");
    });
  }

  if (state.route === "editor" && state.doc) {
    ensureStructuredFields(state.doc, state.templates.templates[state.doc.type]);
    bindPreviewEditable();
    main.querySelectorAll("[data-tab]").forEach((t) => {
      t.addEventListener("click", () => {
        state.editorTab = t.dataset.tab;
        render();
      });
    });
    main.querySelectorAll("[data-meta]").forEach((el) => {
      el.addEventListener("input", () => {
        const key = el.dataset.meta;
        if (key === "tembusan") {
          state.doc.metadata.tembusan = el.value.split("|").map((x) => x.trim()).filter(Boolean);
        } else {
          state.doc.metadata[key] = el.value;
        }
        livePreview();
      });
    });
    main.querySelector("[data-draft-name]")?.addEventListener("input", (ev) => {
      state.doc.draft_name = ev.target.value;
      state.doc.metadata.draft_name = ev.target.value;
      scheduleAutosave();
    });
    main.querySelector("#btn-resync-name")?.addEventListener("click", async () => {
      const m = state.doc.metadata;
      const code = state.templates.templates[state.doc.type]?.doc_type_code || "DOC";
      const res = await api("/api/suggest-name", {
        method: "POST",
        body: JSON.stringify({
          satker: m.satker || "DMST",
          program_strategis: m.program_strategis || "PS12",
          doc_type: code,
          title: m.subject || "Draft",
        }),
      });
      state.doc.draft_name = res.suggested;
      state.doc.metadata.draft_name = res.suggested;
      scheduleAutosave();
      render();
    });
    main.querySelectorAll("[data-field-section]").forEach((el) => {
      el.addEventListener("input", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.fieldSection);
        if (!sec.fields) sec.fields = {};
        sec.fields[el.dataset.fieldKey] = el.value;
        livePreview();
      });
    });
    main.querySelectorAll("[data-section]").forEach((el) => {
      el.addEventListener("input", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.section);
        sec.content = el.value;
        sec.body_mode = "prose";
        sec.ai_suggested = false;
        livePreview();
      });
    });
    main.querySelectorAll("[data-body-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.bodyMode);
        const next = btn.dataset.mode;
        if (!sec || (sec.body_mode || "prose") === next) return;
        if (next === "points") {
          ensureSectionPoints(sec);
          if (!sec.points.length && (sec.content || "").trim()) {
            sec.points = contentToPoints(sec.content);
          }
          if (!sec.points.length) sec.points = [{ level: 1, text: "" }];
          sec.body_mode = "points";
          syncSectionContentFromPoints(sec);
        } else {
          // teks bebas: simpan isi tanpa marker otomatis
          ensureSectionPoints(sec);
          const texts = (sec.points || []).map((p) => (p.text || "").trim()).filter(Boolean);
          if (texts.length) sec.content = texts.join("\n\n");
          sec.body_mode = "prose";
        }
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-polish]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.polish);
        if (sec.body_mode === "points") syncSectionContentFromPoints(sec);
        const result = await api("/api/ai/polish", { method: "POST", body: JSON.stringify({ text: sec.content }) });
        if (result.text) {
          sec.content = result.text;
          if (sec.body_mode === "points") sec.points = contentToPoints(result.text);
          sec.ai_suggested = true;
          scheduleAutosave();
          render();
        } else {
          alert(result.note);
        }
      });
    });
    main.querySelectorAll("[data-not-needed]").forEach((el) => {
      el.addEventListener("change", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.notNeeded);
        sec.not_needed = el.checked;
        livePreview();
      });
    });
    main.querySelectorAll("[data-not-reason]").forEach((el) => {
      el.addEventListener("input", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.notReason);
        sec.not_needed_reason = el.value;
        livePreview();
      });
    });
    main.querySelectorAll("[data-acc]").forEach((el) => {
      el.addEventListener("input", () => {
        const [role, field] = el.dataset.acc.split(".");
        state.doc.accountability[role][field] = el.value;
        livePreview();
      });
    });
    main.querySelectorAll("[data-sig]").forEach((el) => {
      el.addEventListener("input", () => {
        state.doc.signatory[el.dataset.sig] = el.value;
        livePreview();
      });
    });

    // Points editor
    const focusPoint = (secKey, idx) => {
      requestAnimationFrame(() => {
        const el = main.querySelector(`[data-point-sec="${secKey}"][data-point-idx="${idx}"]`);
        el?.focus();
      });
    };
    const touchPoints = (secKey, focusIdx) => {
      const sec = state.doc.sections.find((s) => s.key === secKey);
      syncSectionContentFromPoints(sec);
      scheduleAutosave();
      render();
      if (focusIdx != null) focusPoint(secKey, focusIdx);
      else livePreview();
    };
    main.querySelectorAll("[data-point-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.pointAdd);
        ensureSectionPoints(sec);
        const level = Number(btn.dataset.pointLevel) || 1;
        sec.points.push({ level, text: "" });
        touchPoints(sec.key, sec.points.length - 1);
      });
    });
    main.querySelectorAll("[data-point-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.pointRemove);
        ensureSectionPoints(sec);
        sec.points.splice(Number(btn.dataset.pointIdx), 1);
        touchPoints(sec.key);
      });
    });
    main.querySelectorAll("[data-point-indent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.pointIndent);
        const i = Number(btn.dataset.pointIdx);
        ensureSectionPoints(sec);
        sec.points[i].level = Math.min(3, (sec.points[i].level || 1) + 1);
        touchPoints(sec.key, i);
      });
    });
    main.querySelectorAll("[data-point-outdent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.pointOutdent);
        const i = Number(btn.dataset.pointIdx);
        ensureSectionPoints(sec);
        sec.points[i].level = Math.max(1, (sec.points[i].level || 1) - 1);
        touchPoints(sec.key, i);
      });
    });
    main.querySelectorAll("[data-point-sec]").forEach((el) => {
      el.addEventListener("input", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.pointSec);
        ensureSectionPoints(sec);
        sec.points[Number(el.dataset.pointIdx)].text = el.value;
        syncSectionContentFromPoints(sec);
        livePreview();
      });
      el.addEventListener("keydown", (ev) => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.pointSec);
        const i = Number(el.dataset.pointIdx);
        ensureSectionPoints(sec);
        if (ev.key === "Tab") {
          ev.preventDefault();
          sec.points[i].level = ev.shiftKey
            ? Math.max(1, (sec.points[i].level || 1) - 1)
            : Math.min(3, (sec.points[i].level || 1) + 1);
          touchPoints(sec.key, i);
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          const level = sec.points[i].level || 1;
          sec.points.splice(i + 1, 0, { level, text: "" });
          touchPoints(sec.key, i + 1);
        } else if (ev.key === "Backspace" && !el.value && sec.points.length > 1) {
          ev.preventDefault();
          sec.points.splice(i, 1);
          touchPoints(sec.key, Math.max(0, i - 1));
        }
      });
    });
    // Tables on every section
    main.querySelectorAll("[data-add-table]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.addTable);
        const preset = TABLE_PRESETS[btn.dataset.preset] || TABLE_PRESETS.custom;
        sec.table = { columns: [...preset.columns], rows: [{}] };
        sec.table.rows[0] = Object.fromEntries(preset.columns.map((c) => [c, ""]));
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-remove-table]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.removeTable);
        sec.table = null;
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-add-col]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.addCol);
        if (!sec.table) return;
        let n = sec.table.columns.length + 1;
        let name = `Kolom ${n}`;
        while (sec.table.columns.includes(name)) { n += 1; name = `Kolom ${n}`; }
        sec.table.columns.push(name);
        (sec.table.rows || []).forEach((r) => { r[name] = ""; });
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-col-name]").forEach((el) => {
      el.addEventListener("change", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.colName);
        const idx = Number(el.dataset.colIdx);
        const oldName = sec.table.columns[idx];
        const newName = el.value.trim() || oldName;
        sec.table.columns[idx] = newName;
        (sec.table.rows || []).forEach((r) => {
          if (oldName !== newName) {
            r[newName] = r[oldName] || "";
            delete r[oldName];
          }
        });
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-remove-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.removeRow);
        sec.table.rows.splice(Number(btn.dataset.row), 1);
        scheduleAutosave();
        render();
      });
    });
    // Lampiran: catatan / tabel / foto
    main.querySelectorAll("[data-attach-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!state.doc.attachments_list) state.doc.attachments_list = [];
        const kind = btn.dataset.attachAdd || "note";
        if (kind === "table") {
          state.doc.attachments_list.push({
            type: "table",
            title: "Tabel lampiran",
            description: "",
            table: { columns: ["No", "Waktu", "Uraian"], rows: [{ No: "1", Waktu: "", Uraian: "" }] },
          });
        } else if (kind === "image") {
          state.doc.attachments_list.push({ type: "image", title: "", description: "", image: null });
        } else {
          state.doc.attachments_list.push({ type: "note", title: "", description: "" });
        }
        syncAttachmentsMeta();
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.doc.attachments_list.splice(Number(btn.dataset.attachRemove), 1);
        syncAttachmentsMeta();
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-title]").forEach((el) => {
      el.addEventListener("input", () => {
        state.doc.attachments_list[Number(el.dataset.attachTitle)].title = el.value;
        syncAttachmentsMeta();
        const metaInput = main.querySelector('[data-meta="attachments"]');
        if (metaInput && document.activeElement !== metaInput) metaInput.value = state.doc.metadata.attachments;
        livePreview();
      });
    });
    main.querySelectorAll("[data-attach-desc]").forEach((el) => {
      el.addEventListener("input", () => {
        state.doc.attachments_list[Number(el.dataset.attachDesc)].description = el.value;
        livePreview();
      });
    });
    main.querySelectorAll("[data-attach-add-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state.doc.attachments_list[Number(btn.dataset.attachAddRow)];
        if (!item.table) item.table = { columns: ["Kolom 1", "Kolom 2"], rows: [] };
        const row = {};
        item.table.columns.forEach((c) => { row[c] = ""; });
        item.table.rows.push(row);
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-add-col]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state.doc.attachments_list[Number(btn.dataset.attachAddCol)];
        if (!item.table) return;
        let n = item.table.columns.length + 1;
        let name = `Kolom ${n}`;
        while (item.table.columns.includes(name)) { n += 1; name = `Kolom ${n}`; }
        item.table.columns.push(name);
        (item.table.rows || []).forEach((r) => { r[name] = ""; });
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-del-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state.doc.attachments_list[Number(btn.dataset.attachDelRow)];
        item.table.rows.splice(Number(btn.dataset.row), 1);
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-col-name]").forEach((el) => {
      el.addEventListener("change", () => {
        const item = state.doc.attachments_list[Number(el.dataset.attachColName)];
        const idx = Number(el.dataset.colIdx);
        const oldName = item.table.columns[idx];
        const newName = el.value.trim() || oldName;
        item.table.columns[idx] = newName;
        (item.table.rows || []).forEach((r) => {
          if (oldName !== newName) {
            r[newName] = r[oldName] || "";
            delete r[oldName];
          }
        });
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-attach-cell]").forEach((el) => {
      el.addEventListener("input", () => {
        const item = state.doc.attachments_list[Number(el.dataset.attachCell)];
        item.table.rows[Number(el.dataset.row)][el.dataset.col] = el.value;
        livePreview();
      });
    });
    main.querySelectorAll("[data-attach-file]").forEach((el) => {
      el.addEventListener("change", async () => {
        const idx = Number(el.dataset.attachFile);
        const file = el.files?.[0];
        if (!file || !state.doc?.id) return;
        const fd = new FormData();
        fd.append("file", file);
        setSave("Mengunggah lampiran…");
        try {
          const res = await fetch(`/api/documents/${state.doc.id}/attachments/upload?index=${idx}`, {
            method: "POST",
            body: fd,
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          state.doc = data.document;
          syncAttachmentsMeta();
          setSave("Foto lampiran tersimpan");
          render();
        } catch (e) {
          alert(e.message || "Gagal unggah");
          setSave("Gagal unggah lampiran");
        }
      });
    });

    main.querySelectorAll("[data-add-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = state.doc.sections.find((s) => s.key === btn.dataset.addRow);
        if (!sec.table || !sec.table.columns?.length) {
          sec.table = { columns: ["Kolom 1", "Kolom 2"], rows: [] };
        }
        if (!sec.table.rows) sec.table.rows = [];
        const row = {};
        sec.table.columns.forEach((c) => { row[c] = ""; });
        sec.table.rows.push(row);
        scheduleAutosave();
        render();
      });
    });
    main.querySelectorAll("[data-table]").forEach((el) => {
      el.addEventListener("input", () => {
        const sec = state.doc.sections.find((s) => s.key === el.dataset.table);
        sec.table.rows[Number(el.dataset.row)][el.dataset.col] = el.value;
        livePreview();
      });
    });
    main.querySelector("#btn-validate")?.addEventListener("click", async () => {
      await api(`/api/documents/${state.doc.id}`, { method: "PUT", body: JSON.stringify(state.doc) });
      await refreshFindings();
      state.editorTab = "review";
      render();
    });
    main.querySelectorAll("[data-jump]").forEach((li) => {
      li.addEventListener("click", () => {
        const key = li.dataset.jump;
        if (key === "metadata" || key === "classification" || key === "config") state.editorTab = "metadata";
        else if (key === "accountability" || key === "signatory") state.editorTab = "accountability";
        else state.editorTab = "sections";
        render();
        if (key && key.startsWith) {
          document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    main.querySelector("#btn-export-docx")?.addEventListener("click", () => downloadExport("docx"));
    main.querySelector("#btn-export-pdf")?.addEventListener("click", () => downloadExport("pdf"));
    main.querySelector("#btn-copy-email")?.addEventListener("click", async () => {
      const res = await api(`/api/documents/${state.doc.id}/email-body`);
      await navigator.clipboard.writeText(res.body);
      setSave("Meeting Request disalin ke clipboard");
      alert("Body Meeting Request telah disalin.");
    });
  }

  if (state.route === "admin") {
    main.querySelector("#btn-clone-template")?.addEventListener("click", async () => {
      const payload = structuredClone(state.templates);
      payload.version = "1.0.1";
      payload.status = "active";
      payload.last_reviewed_by = "template-admin-demo";
      payload.last_reviewed_at = new Date().toISOString();
      payload.styles.margin_mm.status = "needs_bi_verification";
      const res = await api("/api/admin/templates", {
        method: "POST",
        body: JSON.stringify({ version: "1.0.1", payload }),
      });
      state.health = await api("/api/health");
      main.querySelector("#admin-out").textContent = JSON.stringify(res, null, 2);
    });
  }
}

function inferPurpose() {
  const t = state.classification?.result_type;
  if (t?.includes("KOORDINASI")) return "koordinasi";
  if (t?.includes("UNDANGAN") || t === "MEETING_REQUEST") return "undangan";
  if (t?.includes("PERSETUJUAN")) return "persetujuan";
  if (t?.includes("PELAPORAN")) return "pelaporan";
  return state.pendingPurpose || "koordinasi";
}

async function downloadExport(kind) {
  await api(`/api/documents/${state.doc.id}`, { method: "PUT", body: JSON.stringify(state.doc) });
  const res = await fetch(`/api/documents/${state.doc.id}/export/${kind}`, { method: "POST" });
  if (!res.ok) {
    const msg = await res.text();
    alert(msg);
    await refreshFindings();
    state.editorTab = "review";
    render();
    return;
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename="(.+)"/.exec(cd);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || `memo.${kind}`;
  a.click();
  state.doc = await api(`/api/documents/${state.doc.id}`);
  setSave(`Diekspor ${kind.toUpperCase()}`);
}

boot().catch((e) => {
  $main().innerHTML = `<div class="banner error">Gagal memuat aplikasi: ${esc(e.message)}</div>`;
});
