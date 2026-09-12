# Official BI fonts (Optima + Frutiger)

Place licensed font files here:

- Optima.ttf (or .otf renamed/configured in templates.json)
- Frutiger.ttf

Until these files exist, `/api/health` reports `fonts_ready: false`.
Preview uses CSS fallbacks clearly marked `needs_bi_verification`.
DOCX/PDF export still runs in prototype mode with a validation warning; production should block or refuse silent Arial/Calibri substitution per policy.

Do not commit proprietary font binaries unless BI licensing permits.
