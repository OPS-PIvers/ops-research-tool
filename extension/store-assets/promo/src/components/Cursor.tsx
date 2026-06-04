import React from 'react';

/** Mouse pointer with an optional click pulse (press 0→1→0). */
export const Cursor: React.FC<{
  x: number;
  y: number;
  press?: number;
  opacity?: number;
}> = ({x, y, press = 0, opacity = 1}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - press * 0.16})`,
      transformOrigin: 'top left',
      zIndex: 90,
      filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.4))',
      pointerEvents: 'none',
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
    {press > 0 ? (
      <div
        style={{
          position: 'absolute',
          left: -10,
          top: -10,
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.85)',
          transform: `scale(${1 + press * 1.4})`,
          opacity: 1 - press,
        }}
      />
    ) : null}
  </div>
);
