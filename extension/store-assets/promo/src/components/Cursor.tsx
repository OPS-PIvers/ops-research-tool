import React from 'react';

/**
 * Mouse pointer whose (x, y) is the EXACT tip / click point. The arrow SVG's
 * tip sits at (4,2) in a 24-unit viewBox rendered at 36px (scale 1.5) → (6,3)px,
 * so we offset the glyph by (-6,-3) to land the tip on (x,y). The click ripple
 * is centered on that same point so a press reads as a real click.
 */
export const Cursor: React.FC<{
  x: number;
  y: number;
  press?: number;
  opacity?: number;
}> = ({x, y, press = 0, opacity = 1}) => (
  <div style={{position: 'absolute', left: x, top: y, opacity, zIndex: 90, pointerEvents: 'none'}}>
    {press > 0 ? (
      <div
        style={{
          position: 'absolute',
          left: -22,
          top: -22,
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: '3px solid rgba(45,63,137,0.9)',
          transform: `scale(${0.3 + press * 0.95})`,
          opacity: 1 - press,
        }}
      />
    ) : null}
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate(-6px,-3px) scale(${1 - press * 0.14})`,
        transformOrigin: '6px 3px',
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.4))',
      }}
    >
      <svg width="36" height="36" viewBox="0 0 24 24">
        <path
          d="M4 2 L4 21 L9 16.2 L12.4 23 L15.4 21.7 L12 15.2 L18.6 15.2 Z"
          fill="#fff"
          stroke="#1b2330"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  </div>
);
