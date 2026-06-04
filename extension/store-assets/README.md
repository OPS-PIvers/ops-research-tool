# Chrome Web Store listing assets

Branded graphics for the OPS Research Tool store listing. The PNGs in `png/`
are the upload-ready files; the `.html` + `_base.css` are the editable sources.

| Store field | File | Size |
| --- | --- | --- |
| Store icon | `../icons/icon128.png` | 128×128 |
| Screenshot 1 | `png/shot1-highlight.png` | 1280×800 |
| Screenshot 2 | `png/shot2-organize.png` | 1280×800 |
| Screenshot 3 | `png/shot3-bibliography.png` | 1280×800 |
| Small promo tile | `png/tile-small-440x280.png` | 440×280 |
| Marquee promo tile | `png/tile-marquee-1400x560.png` | 1400×560 |

All graphics use the OPS palette (brand blue `#2d3f89` / strong `#1d2a5d`,
red `#ad2122`), Lexend display + Roboto body, and the real History-Day bundle
swatch colors. They depict the actual UI (selection toolbar, in-page sidebar
facets, Docs bibliography) — not invented features.

## Regenerating the PNGs

The sources are plain HTML rendered to PNG at exact viewport sizes by a headless
browser. `file://` is blocked, so serve `extension/` over HTTP first:

```powershell
python -m http.server 8766 --directory "C:\Users\paul.ivers\Desktop\ops-research-tool\extension"
```

Then, for each asset, set the browser viewport to the target size, open
`http://localhost:8766/store-assets/<file>.html`, wait ~1.5s for fonts, and
screenshot the viewport (DPR 1 → exact pixels). Move the result into `png/`.
Edit the `.html` / `_base.css` and re-render to revise.
