# Promo video (Remotion)

`ops-research-tool-promo.mp4` — the Chrome Web Store / YouTube promo. **1920×1080,
30 fps, ~32 s, H.264.** The Web Store's "promotional video" field takes a
**YouTube URL**, so upload this MP4 to YouTube (unlisted is fine) and paste the
link into the listing.

Six scenes (`src/scenes/`), stitched with crossfade/slide transitions
(`src/OpsPromo.tsx`). The product surfaces are recreated faithfully from the real
UIs (not approximated):

1. **Intro** — brand wordmark + icon.
2. **Highlight** — a sentence is selected on a page; the floating toolbar pops and
   a category is clicked (mirrors `extension/content/toolbar.*`).
3. **Build the citation** — the extension sidebar **Source tab** (the citation
   builder): source type → per-type fields → Primary/Secondary segmented control →
   annotation → live **MLA preview** (mirrors `extension/content/sidebar.js`).
4. **Organize** — the extension sidebar **Annotations tab**: facet list (rounded-
   square category dots, Google-blue active accents) + entry cards with
   Edit / Delete / Alt, matching `sidebar.js`.
5. **Insert it in Google Docs** — the Phase-3 **Docs sidebar** (OPS-brand recolor,
   "By evidence / By source" pills, source list, footer **Insert References ▾**);
   the popover opens, **Annotated Bibliography** is chosen, and it lands in the doc.
   Mirrors `apps-script/src/sidebar.html` + `sidebar_css.html`.
6. **Outro** — tagline + "Available to Orono Public Schools students & staff."

Surfaces use the exact palettes of each real UI (the extension sidebar's
brand-blue header + `#1a73e8` accents; the Docs sidebar's OPS-brand tokens),
Lexend/Roboto (self-hosted in `public/fonts/`, FontFace-loaded), and the real
History-Day bundle swatch colors. The animated cursor's (x, y) is its exact tip,
so click ripples land on the control being pressed.

## Re-rendering

This folder has no `node_modules` of its own — it renders against an existing
Remotion 4.x install (it was authored against the one in
`C:\Users\paul.ivers\Desktop\SpartBoard\remotion\node_modules`). To rebuild,
run from THIS folder so Remotion treats it as the project root (`public/`
mounts at `/`):

```powershell
<remotion-install>\node_modules\.bin\remotion render src/index.ts OpsPromo `
  ops-research-tool-promo.mp4 --codec=h264 --crf=18
```

or `pnpm add remotion @remotion/cli @remotion/transitions react react-dom` here
first, then `npx remotion render src/index.ts OpsPromo out.mp4`. Tweak copy/colors
in `src/theme.ts` + the scene files; scene lengths live in `src/timing.ts`.
`npx remotion studio src/index.ts` gives a live preview.
