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
  referenceDocs: [],
  chatMessages: [],
  chatList: [],
  activeChatId: null,
  chatBusy: false,
  refPanel: "chats", // chats | corpus
  activeCitation: null,
  previewPdf: null,
  historyQuery: "",
  historyFilter: "all",
  historyItems: [],
  historyCounts: { all: 0, draft: 0, word: 0 },
  compareExample: false,
  roleGuidance: null,
  examples: [],
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

function sectionHeading(title, outlineNumber, arabicIndex = null) {
  const t = (title || "").trim();
  if (arabicIndex != null) {
    const num = `${arabicIndex}.`;
    if (new RegExp(`^${arabicIndex}\\.\\s`).test(t)) return t;
    return `${num} ${t}`;
  }
  if (!outlineNumber) return t;
  let num = String(outlineNumber).trim();
  if (!num.endsWith(".")) num += ".";
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

function metaFieldRow(label, innerHtml) {
  return `<div class="meta-row"><span class="meta-k">${esc(label)}</span><span class="meta-c">:</span><span class="meta-v">${innerHtml}</span></div>`;
}

function renderSignatureBlock(doc, m) {
  const s = doc.signatory || {};
  const unit = (m.dari || m.satker || "").trim();
  return `<div class="sig-block">
    <div class="sig-date"><span class="live-field" contenteditable="true" data-live-meta="city_date">${esc(m.city_date || "")}</span></div>
    <div class="sig-role"><span class="live-field" contenteditable="true" data-live-sig="title">${esc(s.title || "")}</span></div>
    ${unit ? `<div class="sig-unit">${esc(unit)}</div>` : ""}
    <div class="acc-sigspace"></div>
    <div class="sig-name"><span class="live-field" contenteditable="true" data-live-sig="name">${esc(s.name || "")}</span></div>
    <div class="sig-rank"><span class="live-field" contenteditable="true" data-live-sig="rank">${esc(s.rank || "")}</span></div>
  </div>`;
}

function renderA4(doc, tmpl) {
  const m = doc.metadata || {};
  const isM02 = (tmpl.layout_variant || "").startsWith("m02") || (tmpl.doc_type_code === "M.02");
  const isM01 = !isM02 && ((tmpl.layout_variant || "").startsWith("m01") || tmpl.doc_type_code === "M.01");
  const isMR = doc.type === "MEETING_REQUEST";
  const badge = isMR ? "MR" : (tmpl.doc_type_code || "");

  let secIndex = 0;
  const sections = tmpl.sections.map((sec) => {
    const data = doc.sections.find((s) => s.key === sec.key) || {};
    if (data.not_needed) return "";
    if (sec.input_mode === "structured_fields") {
      if (!data.fields) data.fields = {};
      const rows = (sec.fields || []).map((f) => {
        const val = (data.fields[f.key] || "").trim();
        const label = f.label === "Hari, Tanggal" ? "Hari/Tanggal" : f.label;
        return metaFieldRow(
          label,
          `<span class="live-field" contenteditable="true" data-live-field-section="${esc(sec.key)}" data-live-field-key="${esc(f.key)}">${esc(val)}</span>`,
        );
      }).join("");
      return `<div class="body-fields">${rows}</div>`;
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
      tableHtml = `<table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${data.table.rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    secIndex += 1;
    const titleHtml = isM01 || isMR
      ? ""
      : `<div class="sec-title">${esc(sectionHeading(sec.title, sec.outline_number, secIndex))}</div>`;
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
      ${metaFieldRow("Perihal", `<span class="live-field" contenteditable="true" data-live-meta="subject">${esc(m.subject || "")}</span>`)}
      ${metaFieldRow("Kepada", `<span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient || "")}</span>`)}
      ${(m.via || "").trim() ? metaFieldRow("Melalui", `<span class="live-field" contenteditable="true" data-live-meta="via">${esc(m.via)}</span>`) : ""}
      <hr class="meta-rule" />`;
  } else if (isM01) {
    metaBlock = `
      ${metaFieldRow("Perihal", `<span class="live-field" contenteditable="true" data-live-meta="subject">${esc(m.subject || "")}</span>`)}
      ${metaFieldRow("Kepada", `<span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient || "")}</span>`)}
      ${metaFieldRow("Dari", `<span class="live-field" contenteditable="true" data-live-meta="dari">${esc(m.dari || m.satker || "")}</span>`)}
      <hr class="meta-rule" />`;
  } else {
    metaBlock = `<div class="meta-lines">Hal: <span class="live-field" contenteditable="true" data-live-meta="subject">${esc(m.subject)}</span><br/>Yth.: <span class="live-field" contenteditable="true" data-live-meta="recipient">${esc(m.recipient)}</span></div>`;
  }

  let acc = "";
  if (tmpl.accountability?.mode === "grid") {
    const map = [
      ["prepared_by", "Dipersiapkan oleh"],
      ["reviewed_by", "Diperiksa oleh"],
      ["supported_by", "Didukung oleh"],
      ["approved_by", "Disetujui oleh"],
      ["received_by", "Diterima oleh"],
    ].filter(([k]) => doc.accountability?.[k]);
    const cells = map.map(([k, label]) => {
      const p = doc.accountability[k] || {};
      return `<td><div class="acc-cell">
        <div class="acc-head">${esc(label)}</div>
        <div class="acc-body">
          <div class="acc-role">${esc(p.title || "")}</div>
          <div class="acc-sigspace" aria-hidden="true"></div>
          <div class="acc-name">${esc(p.name || "")}</div>
          <div class="acc-rank">${esc(p.rank || "")}</div>
        </div>
      </div></td>`;
    });
    let rows = "";
    for (let i = 0; i < cells.length; i += 2) {
      const right = cells[i + 1] || `<td><div class="acc-cell empty"><div class="acc-head">&nbsp;</div><div class="acc-body"><div class="acc-sigspace"></div></div></div></td>`;
      rows += `<tr>${cells[i]}${right}</tr>`;
    }
    acc = `<table class="acc-table acc-grid2">${rows}</table>`;
    acc += renderSignatureBlock(doc, m);
  } else if (tmpl.accountability?.mode === "signatory_only" || isM01) {
    acc = renderSignatureBlock(doc, m);
  }

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
    <div class="kop-bar">
      <div class="kop-left"><img src="/static/bi-logo.png" alt="Bank Indonesia" /></div>
      <div class="kop-right">
        <div class="type-badge">${esc(badge)}</div>
        <div class="kop-num">No.&nbsp;&nbsp;:&nbsp;<span class="live-field" contenteditable="true" data-live-meta="document_number">${esc(m.document_number || "")}</span></div>
        <div class="kop-num">Lamp.&nbsp;:&nbsp;<span class="live-field" contenteditable="true" data-live-meta="attachments">${esc(m.attachments || "-")}</span></div>
      </div>
    </div>
    ${doc.status === "draft" ? `<div class="draft-stamp">KONSEP</div>` : ""}
    <div class="memo-title">${isMR ? "MEETING REQUEST" : "M E M O R A N D U M"}</div>
    ${metaBlock}
    ${sections}
    ${acc}
    ${lampiranHtml}
  `;
}

/** Template-faithful example for side-by-side compare (matches official M.01/M.02 blank). */
function renderExampleA4(docType) {
  const isM02 = String(docType || "").startsWith("M.02");
  if (isM02) {
    return `
      <div class="kop-bar">
        <div class="kop-left"><img src="/static/bi-logo.png" alt="Bank Indonesia" /></div>
        <div class="kop-right">
          <div class="type-badge">M.02</div>
          <div class="kop-num">No.&nbsp;&nbsp;: …………</div>
          <div class="kop-num">Lamp.&nbsp;: -</div>
        </div>
      </div>
      <div class="memo-title">M E M O R A N D U M</div>
      <div class="meta-row"><span class="meta-k">Perihal</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
      <div class="meta-row"><span class="meta-k">Kepada</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
      <hr class="meta-rule" />
      <div class="sec-title">1. Tujuan</div>
      <div class="body-p placeholder-preview">…………</div>
      <div class="sec-title">2. Latar Belakang dan Penjelasan</div>
      <div class="body-p placeholder-preview">…………</div>
      <div class="sec-title">3. Analisa Risiko dan Mitigasi</div>
      <div class="body-p placeholder-preview">…………</div>
      <div class="sec-title">4. Kesimpulan, Alternatif Usulan, dan Rekomendasi</div>
      <div class="body-p placeholder-preview">Rekomendasi: …………</div>
      <table class="acc-table acc-grid2">
        <tr>
          <td><div class="acc-cell"><div class="acc-head">Dipersiapkan oleh</div><div class="acc-body"><div class="acc-role">Analis</div><div class="acc-sigspace"></div><div class="acc-name">Laura Zefanya Simanjuntak</div><div class="acc-rank">Penata Muda Tingkat I (III/b)</div></div></div></td>
          <td><div class="acc-cell"><div class="acc-head">Diperiksa oleh</div><div class="acc-body"><div class="acc-sigspace"></div></div></div></td>
        </tr>
        <tr>
          <td><div class="acc-cell"><div class="acc-head">Didukung oleh</div><div class="acc-body"><div class="acc-sigspace"></div></div></div></td>
          <td><div class="acc-cell"><div class="acc-head">Disetujui oleh</div><div class="acc-body"><div class="acc-sigspace"></div></div></div></td>
        </tr>
      </table>
      <div class="sig-block">
        <div class="sig-date">Jakarta, 14 September 2026</div>
        <div class="sig-role">Analis</div>
        <div class="sig-unit">Departemen Pengelolaan Moneter</div>
        <div class="acc-sigspace"></div>
        <div class="sig-name">Laura Zefanya Simanjuntak</div>
        <div class="sig-rank">Penata Muda Tingkat I (III/b)</div>
      </div>
      <p class="example-caption">Template resmi M.02 — logo kiri, badge kanan, akuntabilitas 4 kolom, tanda tangan kanan.</p>
    `;
  }
  return `
    <div class="kop-bar">
      <div class="kop-left"><img src="/static/bi-logo.png" alt="Bank Indonesia" /></div>
      <div class="kop-right">
        <div class="type-badge">M.01</div>
        <div class="kop-num">No.&nbsp;&nbsp;: …………</div>
        <div class="kop-num">Lamp.&nbsp;: -</div>
      </div>
    </div>
    <div class="memo-title">M E M O R A N D U M</div>
    <div class="meta-row"><span class="meta-k">Perihal</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
    <div class="meta-row"><span class="meta-k">Kepada</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
    <div class="meta-row"><span class="meta-k">Dari</span><span class="meta-c">:</span><span class="meta-v">Analis Departemen Pengelolaan Moneter</span></div>
    <hr class="meta-rule" />
    <div class="body-p placeholder-preview">…………</div>
    <div class="body-fields">
      <div class="meta-row"><span class="meta-k">Hari/Tanggal</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
      <div class="meta-row"><span class="meta-k">Tempat</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
      <div class="meta-row"><span class="meta-k">Agenda</span><span class="meta-c">:</span><span class="meta-v">…………</span></div>
    </div>
    <div class="body-p placeholder-preview">…………</div>
    <div class="sig-block">
      <div class="sig-date">Jakarta, 14 September 2026</div>
      <div class="sig-role">Analis</div>
      <div class="sig-unit">Departemen Pengelolaan Moneter</div>
      <div class="acc-sigspace"></div>
      <div class="sig-name">Laura Zefanya Simanjuntak</div>
      <div class="sig-rank">Penata Muda Tingkat I (III/b)</div>
    </div>
    <p class="example-caption">Template resmi M.01 — logo kiri, Perihal/Kepada/Dari, garis, tanda tangan kanan.</p>
  `;
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


function exampleMetaForDoc(doc) {
  const type = doc?.type || "";
  if (type.startsWith("M.02")) {
    return { id: "m02_persetujuan", title: "Contoh M.02 Persetujuan", file: "/api/examples/m02_persetujuan/file" };
  }
  return { id: "m01_undangan", title: "Contoh M.01 Undangan", file: "/api/examples/m01_undangan/file" };
}


function navigate(route) {
  state.route = route;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.route === route);
  });
  if (route === "reference") {
    (async () => {
      if (!state.referenceDocs.length) {
        const pack = await api("/api/reference/docs");
        state.referenceDocs = pack.documents || [];
      }
      await loadChatList();
      render();
    })().catch((e) => {
      setSave(`Gagal muat referensi: ${e.message}`);
      render();
    });
    return;
  }
  if (route === "history") {
    loadHistory().then(() => render()).catch((e) => {
      setSave(`Gagal muat riwayat: ${e.message}`);
      render();
    });
    return;
  }
  render();
}

async function loadHistory() {
  const q = encodeURIComponent(state.historyQuery || "");
  const status = encodeURIComponent(state.historyFilter || "all");
  const pack = await api(`/api/documents/history?q=${q}&status=${status === "all" ? "" : status}`);
  state.historyItems = pack.items || [];
  state.historyCounts = pack.counts || state.historyCounts;
}

async function loadChatList() {
  const pack = await api("/api/chats");
  state.chatList = pack.items || [];
}

async function openChatSession(chatId) {
  const chat = await api(`/api/chats/${encodeURIComponent(chatId)}`);
  state.activeChatId = chat.id;
  state.chatMessages = chat.messages || [];
  state.activeCitation = null;
  state.previewPdf = null;
}

async function startNewChat() {
  state.activeChatId = null;
  state.chatMessages = [];
  state.activeCitation = null;
  state.previewPdf = null;
  state.refPanel = "chats";
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
  try {
    const ex = await api("/api/examples");
    state.examples = ex.items || [];
    state.roleGuidance = ex.role_guidance || null;
  } catch {
    state.examples = [];
  }
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
  else if (state.route === "history") main.innerHTML = viewHistory();
  else if (state.route === "reference") main.innerHTML = viewReference();
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
            <button class="btn btn-landing-ghost" id="btn-history">Riwayat</button>
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
  const ex = exampleMetaForDoc(doc);
  const compare = !!state.compareExample;
  const isMemo = String(doc.type || "").startsWith("M.0");
  return `
    <div class="topbar">
      <div>
        <h1>${esc(doc.draft_name || tmpl?.label || doc.type)}</h1>
        <p class="muted small">${esc(tmpl?.label || doc.type)} · template ${esc(doc.template_version)} · rule ${esc(doc.rule_version)}</p>
      </div>
      <div class="btn-row editor-actions" style="margin:0">
        <button class="btn btn-primary" id="btn-save-draft" type="button">Simpan draft</button>
        ${isMemo ? `<button class="btn ${compare ? "btn-primary" : ""}" id="btn-compare-example" type="button">${compare ? "Tutup bandingkan" : "Bandingkan ke contoh"}</button>` : ""}
        <button class="btn" id="btn-export-docx" type="button">Unduh DOCX…</button>
        <button class="btn" id="btn-export-pdf" type="button">Unduh PDF…</button>
        ${doc.type === "MEETING_REQUEST" ? `<button class="btn" id="btn-copy-email" type="button">Salin Meeting Request</button>` : ""}
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab==="metadata"?"active":""}" data-tab="metadata">Metadata</button>
      <button class="tab ${tab==="sections"?"active":""}" data-tab="sections">Substansi</button>
      <button class="tab ${tab==="accountability"?"active":""}" data-tab="accountability">Akuntabilitas</button>
      <button class="tab ${tab==="review"?"active":""}" data-tab="review">Cek kelengkapan</button>
      <button class="tab ${tab==="versions"?"active":""}" data-tab="versions">Riwayat</button>
    </div>
    <div class="workspace ${compare ? "compare-on" : ""}">
      <div class="panel" id="editor-pane">${editorPane(tmpl, tab)}</div>
      <div class="preview-shell ${compare ? "split" : ""}">
        <div class="preview-pane">
          <div class="preview-label">Draft Anda <span class="live">· live seperti Word</span></div>
          ${state.health?.fonts_ready ? "" : `<div class="font-warning">Font Optima/Frutiger 45 Light resmi belum di <code>assets/fonts/</code>. Preview memakai Source Sans 3 sebagai stand-in Frutiger (mirip humanis) — unduh DOCX tetap memakai nama font Frutiger 45 Light.</div>`}
          <div class="a4 ${ (tmpl.layout_variant||"").startsWith("m02") ? "layout-m02" : "layout-m01" }" id="a4-preview">${renderA4(doc, tmpl)}</div>
        </div>
        ${compare ? `
          <div class="preview-pane example-pane">
            <div class="preview-label">Contoh referensi · ${esc(ex.title)}
              <a class="btn btn-tiny" href="${esc(ex.file)}" download>Unduh DOCX contoh</a>
            </div>
            <div class="a4 ${(tmpl.layout_variant||"").startsWith("m02") ? "layout-m02" : "layout-m01"} example-locked">${renderExampleA4(doc.type)}</div>
          </div>
        ` : ""}
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
      <p class="hint">Urutan mengikuti template resmi: <b>Perihal → Kepada${isM02 ? "" : " → Dari"}</b>, logo BI kiri, badge M.01/M.02 kanan.</p>
      <div class="btn-row tight" style="margin-top:0.35rem">
        <button type="button" class="btn btn-primary" id="btn-save-draft-meta">Simpan draft</button>
      </div>

      <label>Nama draft (tampil di daftar)</label>
      <input data-draft-name="1" value="${esc(doc.draft_name || m.draft_name || "")}" placeholder="DMST_PS12_M.02_Judul_12-09-2026" />
      <p class="hint">Nama kerja di aplikasi agar draft mudah dibedakan. Saran mengikuti FILE-01. <button type="button" class="btn btn-tiny" id="btn-resync-name">Isi ulang dari satker/PS/perihal</button></p>

      <label>Sifat dokumen</label>
      <select data-meta="classification">
        <option ${m.classification==="Biasa"?"selected":""}>Biasa</option>
        <option ${m.classification==="Rahasia"?"selected":""}>Rahasia</option>
      </select>
      <p class="hint">Tingkat kerahasiaan. <b>Biasa</b> = kode nomor <code>/B</code>. <b>Rahasia</b> = <code>/Rhs</code>.</p>

      <label>Satker / kode unit (untuk nama file)</label>
      <input data-meta="satker" value="${esc(m.satker)}" placeholder="DMST / DR / DHk" />
      <p class="hint">Rubrik satker pencipta untuk penomoran & nama file.</p>

      <label>Perihal</label>
      <input data-meta="subject" value="${esc(m.subject)}" placeholder="Permohonan Persetujuan … / Undangan …" />
      <p class="hint">Baris pertama di bawah judul MEMORANDUM (template resmi).</p>

      <label>Kepada</label>
      <input data-meta="recipient" value="${esc(m.recipient)}" placeholder="${isM02 ? "Yth. Bapak/Ibu …, Kepala Departemen …" : "Yth. …"}" />
      <p class="hint">Penerima utama memo.</p>

      ${isM02 ? `
        <label>Melalui (opsional)</label>
        <input data-meta="via" value="${esc(m.via || "")}" placeholder="Yth. Kepala Grup …" />
        <p class="hint">Kosongkan jika tidak dipakai — template blank M.02 sering tanpa baris Melalui.</p>
      ` : `
        <label>Dari</label>
        <input data-meta="dari" value="${esc(m.dari || m.satker || "")}" placeholder="Analis Departemen Pengelolaan Moneter" />
        <p class="hint">Pengirim di blok metadata M.01 (setelah Kepada). Juga dipakai sebagai unit di blok tanda tangan.</p>
      `}

      <label>Kota dan tanggal</label>
      <input data-meta="city_date" value="${esc(m.city_date)}" placeholder="Jakarta, 14 September 2026" />
      <p class="hint">Di atas blok tanda tangan kanan bawah.</p>

      <label>Nomor dokumen</label>
      <input data-meta="document_number" value="${esc(m.document_number)}" placeholder="…………" />
      <p class="hint">Tampil di kanan atas di bawah badge M.01/M.02.</p>

      <label>Nomor Program Strategis</label>
      <input data-meta="program_strategis" value="${esc(m.program_strategis)}" placeholder="PS12" />
      <p class="hint">Untuk penamaan file (FILE-01), tidak selalu tercetak di badan memo.</p>

      <p class="hint">Lampiran (daftar isi) di tab <b>Substansi</b>; teks <code>Lamp.</code> di header ikut terisi.</p>

      <label>PIC / kontak</label>
      <input data-meta="pic" value="${esc(m.pic)}" placeholder="Nama — email — telepon" />

      <label>Tenggat</label>
      <input data-meta="deadline" value="${esc(m.deadline)}" placeholder="19 September 2026" />

      <label>Tembusan (pisahkan dengan | )</label>
      <input data-meta="tembusan" value="${esc((m.tembusan||[]).join(" | "))}" placeholder="Arsip | Kepala Grup terkait" />
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
      const guide = state.roleGuidance || {};
      return `
        <h2>Akuntabilitas</h2>
        <p class="hint">Template M.02: tabel akuntabilitas <b>2×2</b> (Dipersiapkan|Diperiksa / Didukung|Disetujui) dengan ruang tanda tangan di tiap sel. <b>Disetujui oleh</b> biasanya Kepala Satker / Kepala Departemen.</p>
        <div class="btn-row tight">
          <button type="button" class="btn btn-tiny" id="btn-compare-example-acc">Bandingkan ke contoh</button>
        </div>
        ${Object.entries(labels)
        .filter(([k]) => doc.accountability[k])
        .map(([k, label]) => {
          const p = doc.accountability[k];
          const g = guide[k] || {};
          return `
            <div class="section-block">
              <h2>${esc(label)}</h2>
              <p class="hint role-hint">${esc(g.who || "")}</p>
              <label>Nama (baris atas sel, tebal)</label>
              <input data-acc="${k}.name" value="${esc(p.name)}" placeholder="Nama pejabat" />
              <label>Jabatan</label>
              <input data-acc="${k}.title" value="${esc(p.title)}" placeholder="${esc(g.title_eg || "Kepala Departemen")}" />
              <label>Pangkat / golongan</label>
              <input data-acc="${k}.rank" value="${esc(p.rank)}" placeholder="${esc(g.rank_eg || "Direktur Eksekutif")}" />
            </div>`;
        }).join("")}
        <div class="section-block">
          <h2>Tanda tangan kanan bawah</h2>
          <p class="hint">Seperti template: tanggal, jabatan, unit (Dari/satker), nama digarisbawahi, pangkat.</p>
          <label>Jabatan</label><input data-sig="title" value="${esc((doc.signatory||{}).title || "")}" placeholder="Analis" />
          <label>Nama</label><input data-sig="name" value="${esc((doc.signatory||{}).name || "")}" placeholder="Nama pejabat" />
          <label>Pangkat</label><input data-sig="rank" value="${esc((doc.signatory||{}).rank || "")}" placeholder="Penata Muda Tingkat I (III/b)" />
        </div>`;
    }
    if (tmpl.accountability.mode === "signatory_only") {
      const s = doc.signatory || {};
      return `
        <h2>Penandatangan (M.01)</h2>
        <p class="hint">Seperti contoh undangan: blok kanan bawah = <b>Kepala Grup / Kepala Satker</b> pencipta, nama digarisbawahi, pangkat di bawah.</p>
        <div class="btn-row tight">
          <button type="button" class="btn btn-tiny" id="btn-compare-example-acc">Bandingkan ke contoh</button>
        </div>
        <label>Jabatan</label><input data-sig="title" value="${esc(s.title)}" placeholder="Kepala Grup" />
        <label>Nama</label><input data-sig="name" value="${esc(s.name)}" placeholder="Nama pejabat" />
        <label>Pangkat</label><input data-sig="rank" value="${esc(s.rank)}" placeholder="Direktur" />
      `;
    }
    return `<p class="muted">Meeting Request tidak memakai blok akuntabilitas M.02.</p>`;
  }
  if (tab === "review") {
    const items = state.findings || [];
    const errors = items.filter((f) => f.severity === "error").length;
    const warnings = items.filter((f) => f.severity === "warning").length;
    return `
      <h2>Cek kelengkapan</h2>
      <p class="hint">Ini menggantikan tombol Validasi di atas. Sistem membandingkan isian Anda dengan aturan template (bagian wajib, akuntabilitas, metadata). <b>Error</b> memblokir unduhan; <b>warning</b> hanya peringatan.</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btn-run-validate">Jalankan cek sekarang</button>
      </div>
      <p class="muted small" style="margin-top:0.75rem">Hasil: ${errors} error · ${warnings} warning · status unduh: ${state.canExport ? "siap" : (items.length ? "terblokir" : "belum dicek")}</p>
      <ul class="findings">
        ${items.length ? items.map((f) => `
          <li class="${esc(f.severity)}" data-jump="${esc(f.section_key || "")}">
            <strong>${esc(f.severity)}</strong> · ${esc(f.id || "")}<br/>
            ${esc(f.message)}
          </li>`).join("") : `<li class="info">Belum ada hasil. Klik “Jalankan cek sekarang”, atau cek otomatis saat final preview unduh.</li>`}
      </ul>
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

  root.querySelectorAll("[data-live-sig]").forEach((el) => {
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      if (!state.doc.signatory) state.doc.signatory = { name: "", title: "", rank: "" };
      const key = el.dataset.liveSig;
      state.doc.signatory[key] = el.innerText.replace(/\u00a0/g, " ").trim();
      const input = document.querySelector(`[data-sig="${key}"]`);
      if (input && document.activeElement !== input) input.value = state.doc.signatory[key];
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
  el.classList.toggle("layout-m01", !(tmpl.layout_variant || "").startsWith("m02"));
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

function statusBadge(item) {
  if (item.has_word || item.status === "exported") {
    return `<span class="hist-badge word">Word diekspor</span>`;
  }
  return `<span class="hist-badge draft">Draft</span>`;
}

function viewHistory() {
  const items = state.historyItems || [];
  const counts = state.historyCounts || {};
  const filter = state.historyFilter || "all";
  return `
    <section class="hist-page">
      <header class="hist-head">
        <div>
          <h1>Riwayat dokumen</h1>
          <p class="muted">Draft dan file Word yang sudah diunduh. Cari, buka lagi, atau kembalikan ke draft untuk revisi.</p>
        </div>
        <button class="btn btn-primary" id="hist-create">Buat dokumen baru</button>
      </header>

      <div class="hist-toolbar panel">
        <form id="hist-search-form" class="hist-search">
          <input id="hist-q" type="search" placeholder="Cari nama, perihal, satker, jenis…" value="${esc(state.historyQuery || "")}" />
          <button class="btn btn-primary" type="submit">Cari</button>
        </form>
        <div class="hist-filters" role="tablist">
          <button type="button" class="hist-filter ${filter==="all"?"on":""}" data-hist-filter="all">Semua (${counts.all ?? 0})</button>
          <button type="button" class="hist-filter ${filter==="draft"?"on":""}" data-hist-filter="draft">Draft (${counts.draft ?? 0})</button>
          <button type="button" class="hist-filter ${filter==="word"?"on":""}" data-hist-filter="word">Sudah Word (${counts.word ?? 0})</button>
        </div>
      </div>

      ${items.length ? `
        <ul class="hist-list">
          ${items.map((d) => `
            <li class="hist-card">
              <div class="hist-card-main">
                <div class="hist-card-top">
                  <span class="draft-type">${esc(typeShort(d.type))}</span>
                  ${statusBadge(d)}
                </div>
                <div class="hist-name">${esc(d.draft_name || "Tanpa nama")}</div>
                <div class="hist-meta muted small">
                  ${esc(d.subject || "—")}
                  ${d.satker ? ` · ${esc(d.satker)}` : ""}
                  · diubah ${esc(formatWhen(d.updated_at))}
                  ${d.last_export?.filename ? ` · terakhir: ${esc(d.last_export.filename)}` : ""}
                </div>
              </div>
              <div class="hist-actions">
                <button type="button" class="btn btn-primary btn-tiny" data-hist-open="${esc(d.id)}">Buka</button>
                ${d.has_word || d.status === "exported" ? `
                  <button type="button" class="btn btn-tiny" data-hist-reopen="${esc(d.id)}">Revisi (jadi draft)</button>
                ` : ""}
                ${d.last_export?.kind === "docx" && d.last_export?.stored_name ? `
                  <a class="btn btn-tiny" href="/api/documents/${esc(d.id)}/exports/${encodeURIComponent(d.last_export.stored_name)}">Unduh Word</a>
                ` : ""}
              </div>
            </li>
          `).join("")}
        </ul>
      ` : `
        <div class="draft-empty">
          <p>Tidak ada dokumen di filter ini.</p>
          <p class="muted small">Buat dokumen baru, atau unduh DOCX dari editor agar muncul di “Sudah Word”.</p>
        </div>
      `}
    </section>`;
}

function formatChatAnswer(text) {
  return esc(text)
    .replaceAll("\n", "<br/>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em class=\"claude-note\">$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function pdfPreviewSrc(url, page) {
  if (!url) return "";
  const base = String(url).split("#")[0].split("?")[0];
  // Never attach ?download=1 here — that forces attachment after consent only.
  return page ? `${base}#page=${encodeURIComponent(page)}` : base;
}

function closePdfConsent() {
  document.getElementById("pdf-consent-modal")?.remove();
}

function showPdfConsent({ title, url, mode }) {
  closePdfConsent();
  const name = title || "dokumen";
  const isDownload = mode === "download";
  const modal = document.createElement("div");
  modal.id = "pdf-consent-modal";
  modal.className = "pdf-consent-backdrop";
  modal.innerHTML = `
    <div class="pdf-consent-card" role="dialog" aria-modal="true" aria-labelledby="pdf-consent-title">
      <h3 id="pdf-consent-title">${isDownload ? "Konfirmasi unduh PDF" : "Buka preview PDF"}</h3>
      <p>${isDownload
        ? `Unduh <strong>${esc(name)}</strong> ke perangkat Anda? File tidak diunduh sebelum Anda setuju.`
        : `Tampilkan <strong>${esc(name)}</strong> di panel Sumber? Ini hanya preview di aplikasi — bukan unduhan.`}</p>
      <div class="btn-row">
        <button type="button" class="btn" data-consent-cancel>Batal</button>
        <button type="button" class="btn primary" data-consent-ok>${isDownload ? "Ya, unduh" : "Ya, preview"}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("[data-consent-cancel]")?.addEventListener("click", closePdfConsent);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closePdfConsent();
  });
  modal.querySelector("[data-consent-ok]")?.addEventListener("click", () => {
    closePdfConsent();
    if (isDownload) {
      const base = String(url).split("#")[0].split("?")[0];
      const a = document.createElement("a");
      a.href = `${base}?download=1`;
      a.rel = "noopener";
      a.setAttribute("download", "");
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    state.previewPdf = {
      url,
      title: name,
      page: state.previewPdf?.page || state.activeCitation?.page || null,
      consented: true,
    };
    render();
  });
}

function requestPdfDownload(url, title) {
  showPdfConsent({ title, url, mode: "download" });
}

function requestPdfPreview(url, title, page) {
  state.previewPdf = {
    url,
    title: title || "PDF",
    page: page || null,
    consented: false,
  };
  showPdfConsent({ title, url, mode: "preview" });
}

function viewReference() {
  const docs = state.referenceDocs || [];
  const messages = state.chatMessages || [];
  const chats = state.chatList || [];
  const citation = state.activeCitation;
  const previewPdf = state.previewPdf || null;
  const panel = state.refPanel || "chats";
  const suggestions = [
    "Kalau ngundang rapat satker lain, memo jenis apa?",
    "Gimana format penamaan file dokumen?",
    "Bedanya M.02 persetujuan sama pelaporan apa?",
  ];
  const activeTitle = (chats.find((c) => c.id === state.activeChatId) || {}).title
    || (messages.find((m) => m.role === "user")?.text || "").slice(0, 48)
    || "Percakapan baru";

  return `
    <section class="claude-page">
      <aside class="claude-rail">
        <button type="button" class="claude-new" id="chat-new">＋ Percakapan baru</button>
        <div class="claude-rail-tabs">
          <button type="button" class="claude-rail-tab ${panel==="chats"?"on":""}" data-ref-panel="chats">Chat</button>
          <button type="button" class="claude-rail-tab ${panel==="corpus"?"on":""}" data-ref-panel="corpus">Peraturan</button>
        </div>
        <div class="claude-rail-body">
          ${panel === "chats" ? `
            <div class="claude-chat-list">
              ${chats.length ? chats.map((c) => `
                <div class="claude-chat-item ${c.id === state.activeChatId ? "active" : ""}">
                  <button type="button" class="claude-chat-open" data-chat-open="${esc(c.id)}">
                    <span class="claude-chat-title">${esc(c.title || "Percakapan")}</span>
                    <span class="claude-chat-sub">${esc(formatWhen(c.updated_at))} · ${esc(c.message_count || 0)} pesan</span>
                  </button>
                  <button type="button" class="claude-chat-del" data-chat-del="${esc(c.id)}" title="Hapus chat" aria-label="Hapus">✕</button>
                </div>
              `).join("") : `<p class="claude-empty-rail">Belum ada chat tersimpan.</p>`}
            </div>
          ` : `
            <ul class="ref-doc-list claude-corpus">
              ${docs.map((d) => `
                <li class="ref-doc-item">
                  <button type="button" class="ref-doc-btn" data-ref-doc="${esc(d.id)}">
                    <strong>${esc(d.short || d.id)}</strong>
                    <span class="muted small">${esc(d.title)}</span>
                  </button>
                  ${d.has_pdf ? `
                    <div class="ref-doc-actions">
                      <button type="button" class="btn btn-tiny" data-preview-pdf="${esc(d.pdf_url)}" data-preview-title="${esc(d.short)}">Preview</button>
                      <button type="button" class="btn btn-tiny" data-download-pdf="${esc(d.pdf_url)}" data-download-title="${esc(d.short)}">Unduh…</button>
                    </div>
                  ` : ""}
                </li>
              `).join("")}
            </ul>
          `}
        </div>
      </aside>

      <section class="claude-main">
        <header class="claude-topbar">
          <div>
            <p class="claude-kicker">Asisten referensi BI</p>
            <h1 class="claude-title">${esc(activeTitle)}</h1>
          </div>
          <div class="claude-top-actions">
            ${state.activeChatId ? `<button type="button" class="btn btn-tiny" id="chat-rename">Ganti judul</button>` : ""}
            ${state.activeChatId ? `<button type="button" class="btn btn-tiny danger" id="chat-delete-current">Hapus</button>` : ""}
          </div>
        </header>

        <div id="ref-chat-log" class="claude-log" aria-live="polite">
          ${messages.length ? messages.map((m) => `
            <article class="claude-msg ${m.role}">
              <div class="claude-avatar" aria-hidden="true">${m.role === "user" ? "A" : "BI"}</div>
              <div class="claude-msg-body">
                <div class="claude-role">${m.role === "user" ? "Anda" : "Asisten"}</div>
                <div class="claude-text">${m.role === "assistant" ? formatChatAnswer(m.text) : esc(m.text)}</div>
                ${m.citations?.length ? `
                  <div class="ref-cites">
                    ${m.citations.map((c) => `
                      <button type="button" class="ref-cite" data-cite-doc="${esc(c.doc_id)}" data-cite-page="${esc(c.page)}">
                        ${esc(c.short)} · hlm. ${esc(c.page)}
                      </button>
                    `).join("")}
                  </div>
                ` : ""}
              </div>
            </article>
          `).join("") : `
            <div class="claude-hero-empty">
              <div class="claude-hero-mark">BI</div>
              <h2>Tanya ketentuan dokumen BI</h2>
              <p>Jawaban bahasa mudah + sitasi halaman. Chat otomatis tersimpan seperti Claude.</p>
              <div class="claude-suggestions">
                ${suggestions.map((s) => `
                  <button type="button" class="claude-suggest" data-suggest="${esc(s)}">${esc(s)}</button>
                `).join("")}
              </div>
            </div>
          `}
          ${state.chatBusy ? `<div class="claude-typing"><span></span><span></span><span></span></div>` : ""}
        </div>

        <form id="ref-chat-form" class="claude-composer">
          <textarea id="ref-chat-input" rows="1" placeholder="Tulis pertanyaan… (Enter kirim, Shift+Enter baris baru)" required></textarea>
          <button class="claude-send" type="submit" ${state.chatBusy ? "disabled" : ""}>Kirim</button>
        </form>
      </section>

      <aside class="claude-source" id="ref-source-panel">
        <h2>Sumber</h2>
        ${citation ? `
          <p class="ref-source-title"><strong>${esc(citation.short || citation.title)}</strong></p>
          <p class="muted small">${esc(citation.source_label)} · hlm. ${esc(citation.page)}</p>
          ${citation.text ? `<div class="ref-excerpt">${esc(String(citation.text).slice(0, 900))}${String(citation.text).length > 900 ? "…" : ""}</div>` : ""}
          <div class="btn-row tight">
            ${citation.pdf_url || citation.pdf ? `
              <button type="button" class="btn btn-tiny" data-open-pdf-preview="${esc(citation.pdf_url || `/api/reference/files/${citation.pdf}`)}" data-preview-title="${esc(citation.short || citation.title)}" data-preview-page="${esc(citation.page || "")}">Preview PDF…</button>
              <button type="button" class="btn btn-tiny" data-download-pdf="${esc(citation.pdf_url || `/api/reference/files/${citation.pdf}`)}" data-download-title="${esc(citation.short || citation.title)}">Unduh…</button>
            ` : ""}
          </div>
        ` : `<p class="muted small">Klik sitasi di jawaban untuk melihat cuplikan halaman di sini.</p>`}
        ${previewPdf?.consented ? `
          <div class="ref-pdf-frame-wrap">
            <div class="ref-pdf-frame-head">
              <strong>${esc(previewPdf.title || "PDF")}</strong>
              ${previewPdf.page ? `<span class="muted small">hlm. ${esc(previewPdf.page)}</span>` : ""}
              <button type="button" class="btn btn-tiny" id="pdf-close-preview">Tutup</button>
            </div>
            <iframe class="ref-pdf-frame" title="Preview PDF" src="${esc(pdfPreviewSrc(previewPdf.url, previewPdf.page))}"></iframe>
          </div>
        ` : `<div class="ref-pdf-empty muted small">PDF tidak dibuka otomatis. Pakai <em>Preview PDF…</em> (dengan konfirmasi) atau <em>Unduh…</em>.</div>`}
      </aside>
    </section>`;
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
  main.querySelector("#btn-history")?.addEventListener("click", () => navigate("history"));
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

  if (state.route === "history") {
    main.querySelector("#hist-create")?.addEventListener("click", () => navigate("create"));
    main.querySelector("#hist-search-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      state.historyQuery = main.querySelector("#hist-q")?.value || "";
      await loadHistory();
      render();
    });
    main.querySelectorAll("[data-hist-filter]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.historyFilter = btn.dataset.histFilter || "all";
        await loadHistory();
        render();
      });
    });
    main.querySelectorAll("[data-hist-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.doc = await api(`/api/documents/${btn.dataset.histOpen}`);
        await refreshFindings();
        state.route = "editor";
        state.editorTab = "metadata";
        document.querySelectorAll(".nav-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.route === "create");
        });
        render();
      });
    });
    main.querySelectorAll("[data-hist-reopen]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Kembalikan dokumen ini ke status draft untuk direvisi?")) return;
        state.doc = await api(`/api/documents/${btn.dataset.histReopen}/reopen`, {
          method: "POST",
          body: "{}",
        });
        state.documents = await api("/api/documents");
        await refreshFindings();
        state.route = "editor";
        state.editorTab = "metadata";
        setSave("Dibuka lagi sebagai draft");
        document.querySelectorAll(".nav-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.route === "create");
        });
        render();
      });
    });
  }

  if (state.route === "reference") {
    const log = main.querySelector("#ref-chat-log");
    if (log) log.scrollTop = log.scrollHeight;

    const openCitation = async (docId, page) => {
      try {
        const full = await api(`/api/reference/docs/${encodeURIComponent(docId)}/pages/${page}`);
        state.activeCitation = full;
        // Never auto-load PDF (browser often force-downloads). Show text excerpt only.
        state.previewPdf = null;
        render();
      } catch (e) {
        setSave(e.message);
      }
    };

    const sendChat = async (message) => {
      const textMsg = (message || "").trim();
      if (!textMsg || state.chatBusy) return;
      state.chatBusy = true;
      state.chatMessages = [...(state.chatMessages || []), { role: "user", text: textMsg }];
      render();
      try {
        const res = await api("/api/reference/chat", {
          method: "POST",
          body: JSON.stringify({ message: textMsg, chat_id: state.activeChatId || null }),
        });
        state.activeChatId = res.chat_id || state.activeChatId;
        state.chatMessages.push({
          role: "assistant",
          text: res.answer + (res.disclaimer ? `\n\n_${res.disclaimer}_` : ""),
          citations: res.citations || [],
        });
        await loadChatList();
        if (res.citations?.[0]) {
          const c = res.citations[0];
          const full = await api(`/api/reference/docs/${encodeURIComponent(c.doc_id)}/pages/${c.page}`);
          state.activeCitation = full;
          state.previewPdf = null;
        }
      } catch (err) {
        state.chatMessages.push({ role: "assistant", text: `Gagal: ${err.message}` });
      } finally {
        state.chatBusy = false;
        render();
      }
    };

    main.querySelector("#chat-new")?.addEventListener("click", () => {
      startNewChat();
      render();
    });

    main.querySelectorAll("[data-ref-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.refPanel = btn.dataset.refPanel || "chats";
        render();
      });
    });

    main.querySelectorAll("[data-chat-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await openChatSession(btn.dataset.chatOpen);
          render();
        } catch (e) {
          setSave(e.message);
        }
      });
    });

    main.querySelectorAll("[data-chat-del]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Hapus percakapan ini?")) return;
        const id = btn.dataset.chatDel;
        await api(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (state.activeChatId === id) startNewChat();
        await loadChatList();
        render();
      });
    });

    main.querySelector("#chat-delete-current")?.addEventListener("click", async () => {
      if (!state.activeChatId) return;
      if (!confirm("Hapus percakapan ini?")) return;
      await api(`/api/chats/${encodeURIComponent(state.activeChatId)}`, { method: "DELETE" });
      startNewChat();
      await loadChatList();
      render();
    });

    main.querySelector("#chat-rename")?.addEventListener("click", async () => {
      if (!state.activeChatId) return;
      const current = (state.chatList.find((c) => c.id === state.activeChatId) || {}).title || "";
      const title = prompt("Judul percakapan:", current);
      if (title == null) return;
      await api(`/api/chats/${encodeURIComponent(state.activeChatId)}`, {
        method: "PUT",
        body: JSON.stringify({ title: title.trim() || current }),
      });
      await loadChatList();
      render();
    });

    main.querySelectorAll("[data-suggest]").forEach((btn) => {
      btn.addEventListener("click", () => sendChat(btn.dataset.suggest));
    });

    main.querySelectorAll("[data-preview-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        requestPdfPreview(
          btn.dataset.previewPdf,
          btn.dataset.previewTitle || "PDF",
          btn.dataset.previewPage ? Number(btn.dataset.previewPage) : null,
        );
      });
    });

    main.querySelectorAll("[data-open-pdf-preview]").forEach((btn) => {
      btn.addEventListener("click", () => {
        requestPdfPreview(
          btn.dataset.openPdfPreview,
          btn.dataset.previewTitle || "PDF",
          btn.dataset.previewPage ? Number(btn.dataset.previewPage) : null,
        );
      });
    });

    main.querySelector("#pdf-close-preview")?.addEventListener("click", () => {
      state.previewPdf = null;
      render();
    });

    main.querySelectorAll("[data-download-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        requestPdfDownload(btn.dataset.downloadPdf, btn.dataset.downloadTitle || "dokumen");
      });
    });

    main.querySelectorAll("[data-cite-doc]").forEach((btn) => {
      btn.addEventListener("click", () => openCitation(btn.dataset.citeDoc, Number(btn.dataset.citePage)));
    });

    main.querySelectorAll("[data-ref-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const doc = (state.referenceDocs || []).find((d) => d.id === btn.dataset.refDoc);
        state.previewPdf = null;
        const hits = await api(`/api/reference/search?q=${encodeURIComponent(doc?.short || btn.dataset.refDoc)}`);
        const first = (hits.hits || [])[0];
        if (first) openCitation(first.doc_id, first.page);
        else render();
      });
    });

    const input = main.querySelector("#ref-chat-input");
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        main.querySelector("#ref-chat-form")?.requestSubmit();
      }
    });
    input?.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    });

    main.querySelector("#ref-chat-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = (input?.value || "").trim();
      if (!message) return;
      if (input) input.value = "";
      await sendChat(message);
    });
  }

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
    main.querySelector("#btn-save-draft")?.addEventListener("click", async () => {
      await saveDraftNow();
    });
    main.querySelector("#btn-save-draft-meta")?.addEventListener("click", async () => {
      await saveDraftNow();
    });
    const toggleCompare = () => {
      state.compareExample = !state.compareExample;
      render();
    };
    main.querySelector("#btn-compare-example")?.addEventListener("click", toggleCompare);
    main.querySelector("#btn-compare-example-acc")?.addEventListener("click", () => {
      state.compareExample = true;
      render();
    });
    main.querySelector("#btn-run-validate")?.addEventListener("click", async () => {
      await saveDraftNow({ quiet: true });
      await refreshFindings();
      render();
      setSave(state.canExport ? "Cek OK · siap unduh" : "Ada temuan — perbaiki dulu");
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
    main.querySelector("#btn-export-docx")?.addEventListener("click", () => openExportPreview("docx"));
    main.querySelector("#btn-export-pdf")?.addEventListener("click", () => openExportPreview("pdf"));
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

async function saveDraftNow({ quiet = false } = {}) {
  if (!state.doc?.id) return;
  clearTimeout(state.autosaveTimer);
  if (!quiet) setSave("Menyimpan draft…");
  try {
    const saved = await api(`/api/documents/${state.doc.id}`, {
      method: "PUT",
      body: JSON.stringify(state.doc),
    });
    state.doc.updated_at = saved.updated_at;
    state.doc.versions = saved.versions;
    state.doc.audit = saved.audit;
    if (!quiet) setSave(`Draft tersimpan · ${new Date().toLocaleTimeString("id-ID")}`);
  } catch (e) {
    setSave(`Gagal menyimpan: ${e.message}`);
    throw e;
  }
}

function closeExportPreview() {
  document.getElementById("export-preview-modal")?.remove();
}

async function openExportPreview(kind) {
  if (!state.doc) return;
  closeExportPreview();
  closePdfConsent();
  try {
    await saveDraftNow({ quiet: true });
    await refreshFindings();
  } catch (e) {
    alert(e.message || "Gagal menyimpan sebelum preview");
    return;
  }

  const tmpl = state.templates.templates[state.doc.type];
  const label = kind === "pdf" ? "PDF" : "DOCX";
  const findings = state.findings || [];
  const errors = findings.filter((f) => f.severity === "error");
  const blocked = errors.length > 0 || state.canExport === false;

  const a4Html = renderA4(state.doc, tmpl)
    .replaceAll('contenteditable="true"', "")
    .replaceAll("contenteditable='true'", "");

  const modal = document.createElement("div");
  modal.id = "export-preview-modal";
  modal.className = "export-preview-backdrop";
  modal.innerHTML = `
    <div class="export-preview-card" role="dialog" aria-modal="true" aria-labelledby="export-preview-title">
      <header class="export-preview-head">
        <div>
          <p class="muted small" style="margin:0">Final preview sebelum unduh</p>
          <h2 id="export-preview-title">${esc(state.doc.draft_name || tmpl?.label || "Memorandum")} → ${label}</h2>
        </div>
        <button type="button" class="btn" data-export-cancel>Tutup</button>
      </header>
      <div class="export-preview-body">
        <div class="export-preview-a4-wrap">
          <div class="a4 ${ (tmpl?.layout_variant||"").startsWith("m02") ? "layout-m02" : "" }">${a4Html}</div>
        </div>
        <aside class="export-preview-side">
          <h3>Cek kelengkapan</h3>
          ${blocked
            ? `<p class="export-blocked">Ada ${errors.length || "beberapa"} error. Perbaiki dulu sebelum unduh.</p>`
            : `<p class="export-ok">Tidak ada error penghalang. Anda bisa unduh setelah menyetujui.</p>`}
          <ul class="findings compact">
            ${findings.length ? findings.slice(0, 8).map((f) => `
              <li class="${esc(f.severity)}"><strong>${esc(f.severity)}</strong> · ${esc(f.message)}</li>
            `).join("") : `<li class="info">Tidak ada temuan.</li>`}
          </ul>
          <label class="export-consent">
            <input type="checkbox" id="export-consent-check" ${blocked ? "disabled" : ""} />
            <span>Saya sudah meninjau final preview dan setuju mengunduh berkas ${label} ke perangkat ini.</span>
          </label>
          <div class="btn-row" style="margin-top:1rem">
            <button type="button" class="btn" data-export-cancel>Batal</button>
            <button type="button" class="btn btn-primary" id="export-confirm-btn" disabled>Unduh ${label}</button>
          </div>
          ${blocked ? `<button type="button" class="btn" id="export-goto-review" style="margin-top:0.65rem;width:100%">Buka tab cek kelengkapan</button>` : ""}
        </aside>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const consent = modal.querySelector("#export-consent-check");
  const confirmBtn = modal.querySelector("#export-confirm-btn");
  const syncConsent = () => {
    confirmBtn.disabled = blocked || !consent?.checked;
  };
  consent?.addEventListener("change", syncConsent);
  modal.querySelectorAll("[data-export-cancel]").forEach((btn) => {
    btn.addEventListener("click", closeExportPreview);
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeExportPreview();
  });
  modal.querySelector("#export-goto-review")?.addEventListener("click", () => {
    closeExportPreview();
    state.editorTab = "review";
    render();
  });
  confirmBtn?.addEventListener("click", async () => {
    if (blocked || !consent?.checked) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Mengunduh…";
    try {
      await performExportDownload(kind);
      closeExportPreview();
    } catch (e) {
      alert(e.message || "Gagal unduh");
      confirmBtn.disabled = false;
      confirmBtn.textContent = `Unduh ${label}`;
    }
  });
}

async function performExportDownload(kind) {
  await saveDraftNow({ quiet: true });
  const res = await fetch(`/api/documents/${state.doc.id}/export/${kind}`, { method: "POST" });
  if (!res.ok) {
    const msg = await res.text();
    await refreshFindings();
    state.editorTab = "review";
    render();
    throw new Error(msg || "Ekspor gagal");
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename="(.+)"/.exec(cd);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || `memo.${kind}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  state.doc = await api(`/api/documents/${state.doc.id}`);
  setSave(`Diekspor ${kind.toUpperCase()}`);
}

async function downloadExport(kind) {
  // Kept for compatibility — always go through final preview + consent.
  await openExportPreview(kind);
}

boot().catch((e) => {
  $main().innerHTML = `<div class="banner error">Gagal memuat aplikasi: ${esc(e.message)}</div>`;
});
