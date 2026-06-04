import React from 'react';
import {useCurrentFrame} from 'remotion';
import {LEXEND} from '../fonts';
import {fadeUp} from '../anim';

/** Top kicker + headline used on each content scene. */
export const Caption: React.FC<{step: string; title: string}> = ({
  step,
  title,
}) => {
  const f = useCurrentFrame();
  return (
    <div style={{position: 'absolute', top: 80, left: 0, right: 0, textAlign: 'center'}}>
      <div
        style={{
          ...fadeUp(f, 4, 16, 16),
          fontSize: 19,
          letterSpacing: 6,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.68)',
          textTransform: 'uppercase',
        }}
      >
        {step}
      </div>
      <div
        style={{
          ...fadeUp(f, 10, 18, 22),
          fontFamily: LEXEND,
          fontSize: 60,
          fontWeight: 600,
          color: '#fff',
          marginTop: 12,
          letterSpacing: -0.5,
        }}
      >
        {title}
      </div>
    </div>
  );
};
