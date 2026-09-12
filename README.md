# BI MemoBuilder

Rule-based internal web app to draft Bank Indonesia memoranda (M.01 / M.02) and Meeting Requests without hunting Word templates or memorizing structures.

**Principle:** classification, required sections, accountability labels, validation, formatting, and export are driven by versioned rules/templates. AI is assistive only (local polish in MVP — no external calls).

## Quick start

```bash
cd bi-memobuilder
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open http://127.0.0.1:8000

Optional: from repo root if you already created `../.venv`:

```bash
cd "/Users/alaia/Documents/cursor memo/bi-memobuilder"
../.venv/bin/uvicorn app.main:app --reload --port 8000
```

## What the MVP includes

- Decision tree from plain-language purpose (not “pick M.01/M.02”)
- Four flows + Meeting Request for non-budget invitations
- Structured editor + live A4 preview
- Error / Warning / Info validation (server-side re-check on export)
- DOCX (editable) + PDF export
- Filename pattern `[SATKER]_[PSXX]_[JENIS]_[JUDUL]_[DD-MM-YYYY]`
- Draft autosave + simple version/audit history
- Admin publish of new template/rule versions without code changes
- Seeded Indonesian happy-path samples

## Template & rule configuration

- Rules: `data/rules/<version>/rules.json`
- Templates: `data/templates/<version>/templates.json`
- Drafts: `data/store/*.json`
- Each document pins `template_version` and `rule_version`

Publish via UI (Admin → clone) or:

```bash
curl -X POST http://127.0.0.1:8000/api/admin/templates \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

## Font installation

1. Obtain licensed **Optima** and **Frutiger** files authorized for BI use.
2. Place them as `assets/fonts/Optima.ttf` and `assets/fonts/Frutiger.ttf` (paths configurable in template JSON).
3. Restart the server; `/api/health` should show `fonts_ready: true`.

Until fonts are present, the UI shows a configuration warning. The app does **not** silently treat Arial/Calibri as official BI fonts.

Exact margins/sizes currently carry `needs_bi_verification` — see `docs/ASSUMPTIONS.md`.

## Security assumptions (prototype)

- Intended for private/internal deployment behind BI SSO (SSO not implemented in MVP; demo user only).
- Roles modeled conceptually: User, Reviewer, Template Admin, System Admin.
- No third-party telemetry; AI polish is local/deterministic.
- Rahasia documents are flagged; listing ACL is stubbed (owner-visible in demo store).
- Encrypt in transit/at rest, retention, and IdP integration are deployment concerns for IT Security.

## Tests

```bash
cd bi-memobuilder
pytest -q
```

Coverage includes classification, required sections, accountability labels, leftover placeholders, filename generation, DOCX/PDF export consistency, and admin version publish.

## Docs

- `../docs/ASSUMPTIONS.md` — gaps & verification items
- `../docs/RULE_MATRIX.md` — rule matrix with sources
- `../docs/IA_AND_FLOWS.md` — IA / flows
- `../docs/DATA_MODEL.md` — data model

Source PDFs/ZIP extracts live under `../source-docs/`.

## Out of MVP scope

Official e-signature, authoritative numbering, automatic sending, production BI system integrations.
