# Promo video (Remotion)

`ops-research-tool-promo.mp4` — the Chrome Web Store / YouTube promo. **1920×1080,
30 fps, ~26 s, H.264, ~3 MB.** The Web Store's "promotional video" field takes a
**YouTube URL**, so upload this MP4 to YouTube (unlisted is fine) and paste the
link into the listing.

Five scenes (`src/scenes/`), stitched with crossfade/slide transitions
(`src/OpsPromo.tsx`):

1. **Intro** — brand wordmark + icon.
2. **Highlight** — a sentence is selected on a page; the floating toolbar pops and a
   category is chosen ("Saved — works offline too").
3. **Organize** — the in-page sidebar docks in; facet list + highlight cards.
4. **Bibliography** — Google Docs; "Insert Bibliography" is clicked; an MLA
   annotated Works Cited animates in.
5. **Outro** — tagline + "Available to Orono Public Schools students & staff."

All visuals use the OPS palette, Lexend/Roboto (self-hosted in `public/fonts/`,
loaded via the FontFace API), and the real History-Day bundle swatch colors.

## Re-rendering

This folder has no `node_modules` of its own — it renders against an existing
Remotion 4.x install (it was authored against the one in
`C:\Users\paul.ivers\Desktop\SpartBoard\remotion\node_modules`). To rebuild:

```powershell
# point at any Remotion 4.x install's CLI, run from THIS folder so Remotion
# treats it as the project root (public/ mounts at /):
<remotion-install>\node_modules\.bin\remotion render src/index.ts OpsPromo `
  ops-research-tool-promo.mp4 --codec=h264 --crf=18
```

or, if you `pnpm add remotion @remotion/cli @remotion/transitions react react-dom`
here first, simply `npx remotion render src/index.ts OpsPromo out.mp4`.

Tweak copy/colors in `src/theme.ts` + the scene files; adjust scene lengths in
`src/timing.ts`. `npx remotion studio src/index.ts` gives a live preview.
