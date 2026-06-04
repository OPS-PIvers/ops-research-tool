import {staticFile, delayRender, continueRender} from 'remotion';

export const LEXEND = 'Lexend';
export const ROBOTO = 'Roboto';

// Self-hosted variable woff2 (latin) loaded via the FontFace API so the
// headless render waits for them. @remotion/google-fonts per-font modules
// aren't present in this install, hence the manual load.
const handle = delayRender('load-fonts');

const defs: Array<[string, string]> = [
  [LEXEND, 'fonts/lexend-400.woff2'],
  [ROBOTO, 'fonts/roboto-400.woff2'],
];

Promise.all(
  defs.map(async ([family, path]) => {
    const face = new FontFace(family, `url(${staticFile(path)}) format('woff2')`, {
      weight: '100 900',
      display: 'block',
    });
    await face.load();
    document.fonts.add(face);
  })
)
  .then(() => continueRender(handle))
  .catch((err) => {
    // Never hang the render on a font failure — fall back to system fonts.
    // eslint-disable-next-line no-console
    console.error('Font load failed', err);
    continueRender(handle);
  });
