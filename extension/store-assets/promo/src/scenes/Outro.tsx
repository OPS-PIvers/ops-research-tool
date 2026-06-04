import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Icon} from '../components/Icon';
import {LEXEND} from '../fonts';
import {C, CAT} from '../theme';
import {fadeUp} from '../anim';

export const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const pop = spring({frame: f, fps, config: {damping: 14, mass: 0.8}});
  const iconScale = interpolate(pop, [0, 1], [0.7, 1]);
  const iconO = interpolate(f, [0, 10], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <Brand>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
        <div style={{transform: `scale(${iconScale})`, opacity: iconO}}>
          <Icon size={120} />
        </div>
        <div
          style={{
            ...fadeUp(f, 14, 20, 24),
            fontFamily: LEXEND,
            fontSize: 58,
            fontWeight: 600,
            marginTop: 34,
            letterSpacing: -0.8,
            maxWidth: 1180,
            lineHeight: 1.18,
          }}
        >
          From first highlight to finished bibliography.
        </div>
        <div style={{...fadeUp(f, 30, 20, 20), fontSize: 27, opacity: 0.82, marginTop: 22}}>
          Available to Orono Public Schools students &amp; staff.
        </div>
        <div style={{display: 'flex', gap: 16, marginTop: 40}}>
          {CAT.map((c, i) => {
            const s = interpolate(f, [40 + i * 4, 54 + i * 4], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div key={c} style={{width: 18, height: 18, borderRadius: '50%', background: c, transform: `scale(${s})`}} />
            );
          })}
        </div>
        <div style={{...fadeUp(f, 52, 18, 16), marginTop: 40, fontSize: 19, color: 'rgba(255,255,255,0.6)', letterSpacing: 1}}>
          OPS Research Tool
        </div>
      </AbsoluteFill>
    </Brand>
  );
};
