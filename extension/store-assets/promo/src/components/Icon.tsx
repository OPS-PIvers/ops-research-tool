import React from 'react';
import {Img, staticFile} from 'remotion';

/**
 * The real extension icon (extension/icons/icon128.png) — the exact pen-on-tile
 * used in the Chrome toolbar and the sidebar launcher tab. Embedded as-is so the
 * promo's icon matches the installed product.
 */
export const Icon: React.FC<{size?: number}> = ({size = 120}) => {
  const r = size * 0.235;
  return (
    <div style={{width: size, height: size, borderRadius: r, overflow: 'hidden', position: 'relative', boxShadow: '0 24px 60px rgba(10,16,45,0.5)'}}>
      <Img src={staticFile('icon128.png')} style={{width: '100%', height: '100%', display: 'block'}} />
      <div style={{position: 'absolute', inset: 0, borderRadius: r, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)'}} />
    </div>
  );
};
