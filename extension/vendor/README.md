# extension/vendor

Self-hosted third-party libraries. Tracked in git so the extension is fully
self-contained — no CDN dependency, works offline.

## PDF.js

- `pdf.min.mjs` — main library (ES module, legacy build for broad compat)
- `pdf.worker.min.mjs` — Web Worker; PDF.js needs this to do anything
- Version: 4.7.76
- Source: https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/legacy/build/
- License: Apache-2.0 (https://github.com/mozilla/pdf.js/blob/master/LICENSE)

To upgrade:

```powershell
$ver = "<new version>"
$base = "https://cdn.jsdelivr.net/npm/pdfjs-dist@$ver/legacy/build"
$out = "extension/vendor"
Invoke-WebRequest -Uri "$base/pdf.min.mjs" -OutFile "$out/pdf.min.mjs"
Invoke-WebRequest -Uri "$base/pdf.worker.min.mjs" -OutFile "$out/pdf.worker.min.mjs"
```

After upgrading, smoke-test the PDF panel (`pdf/panel.html?src=<some pdf url>`)
against:
- a normal text PDF (most news/journal article PDFs)
- a scanned PDF (the "no extractable text" empty state should trigger)
