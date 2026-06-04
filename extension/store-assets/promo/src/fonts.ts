import {staticFile, delayRender, continueRender} from 'remotion';

export const LEXEND = 'Lexend';
export const ROBOTO = 'Roboto';

// Self-hosted variable woff2 (latin) loaded via the FontFace API so the
// headless render waits for them. @remotion/google-fonts per-font modules
// aren't present in this install, hence the manual load.
//
// Hardened against a flaky per-tab font fetch (which once hung past the 28s
// default and failed the whole render at a single frame): a long delayRender
// timeout + retries, and a per-font race so a hung fetch falls back to system
// fonts instead of stalling the frame.
const handle = delayRender('load-fonts', {timeoutInMilliseconds: 100000, retries: 2});

const defs: Array<[string, string]> = [
  [LEXEND, 'fonts/lexend-400.woff2'],
  [ROBOTO, 'fonts/roboto-400.woff2'],
];

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);

Promise.all(
  defs.map(async ([family, path]) => {
    try {
      const face = new FontFace(family, `url(${staticFile(path)}) format('woff2')`, {
        weight: '100 900',
        display: 'block',
      });
      const loaded = await withTimeout(face.load(), 12000);
      if (loaded) document.fonts.add(loaded as FontFace);
    } catch (err) {
      // one font failing must never block the render — fall back to system fonts
    }
  })
)
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));
