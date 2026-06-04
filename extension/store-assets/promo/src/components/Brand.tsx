import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {ROBOTO} from '../fonts';

/** Brand-blue gradient backdrop with soft drifting glow blobs. */
export const Brand: React.FC<{children?: React.ReactNode}> = ({children}) => {
  const f = useCurrentFrame();
  const drift = interpolate(f, [0, 220], [0, 26]);
  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(130% 130% at 6% -12%, #3a4ea7 0%, #2d3f89 45%, #1a275a 100%)',
        fontFamily: ROBOTO,
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 680,
          height: 680,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(120,150,255,0.20), transparent 70%)',
          top: -200 + drift * 0.4,
          left: -140,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 560,
          height: 560,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(173,33,34,0.18), transparent 70%)',
          bottom: -200 - drift * 0.3,
          right: -120,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
