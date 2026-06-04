# Promo video (Remotion)

`ops-research-tool-promo.mp4` — the Chrome Web Store / YouTube promo & feature
tour. **1920×1080, 30 fps, ~52 s, H.264.** The Web Store's "promotional video"
field takes a **YouTube URL**, so upload this MP4 to YouTube (unlisted is fine)
and paste the link into the listing.

Nine scenes (`src/scenes/`), stitched with crossfade/slide transitions
(`src/OpsPromo.tsx`). Every product surface is recreated faithfully from the real
UI (not approximated), with an animated cursor whose tip is its exact click point.

1. **Intro** — the real extension icon (`public/icon128.png`, the installed
   Chrome/sidebar icon) + wordmark.
2. **Highlight & annotate** — a sentence is selected; the floating toolbar pops,
   a category swatch is clicked (**the highlight recolors to that category**), and
   an optional **note is typed** in (mirrors `extension/content/toolbar.js`).
3. **Build the citation** — the extension **Source tab** citation builder: type →
   per-type fields → Primary/Secondary → annotation → live **MLA preview**.
4. **Organize** — the extension **Annotations tab**: facet list (rounded-square
   dots, `#1a73e8` accents) + entry cards (Edit/Delete/Alt). (`sidebar.js`.)
5. **Edit any source** — the **Open Editor modal**: the source-switcher dropdown,
   left = citation form + MLA preview + annotation, right = evidence review cards
   (mirrors `source_editor.html`).
6. **Cite & insert in Google Docs** — the Docs sidebar: **Copy citation** (in-text
   parenthetical, pasted into the doc) **and** Insert References ▾ → **Annotated
   Bibliography** lands in the doc (`sidebar.html` / `sidebar_css.html`).
7. **Teacher dashboard** — the project dashboard: class tabs, the student table
   with category-mix bars, red completion bars, and stoplight **gap pills**
   (green/amber/red by threshold) (`console_*` / `62_aggregator.js`).
8. **Student drill-down** — one student's analytics: source counts, category
   breakdown bars, completion meters, activity-over-time sparkline.
9. **Outro** — tagline + "Available to Orono Public Schools students & staff."

Surfaces use each real UI's exact palette and labels, Lexend/Roboto (self-hosted
in `public/fonts/`, FontFace-loaded), and the real History-Day swatch colors.

## Re-rendering

This folder has no `node_modules` of its own — it renders against an existing
Remotion 4.x install (authored against `…/SpartBoard/remotion/node_modules`).
Run from THIS folder so Remotion treats it as the project root (`public/` mounts
at `/`):

```powershell
<remotion-install>\node_modules\.bin\remotion render src/index.ts OpsPromo `
  ops-research-tool-promo.mp4 --codec=h264 --crf=18
```

or `pnpm add remotion @remotion/cli @remotion/transitions react react-dom` here
first, then `npx remotion render src/index.ts OpsPromo out.mp4`. Copy tweaks live
in the scene files + `src/theme.ts`; scene lengths in `src/timing.ts`.
`npx remotion studio src/index.ts` gives a live preview.
