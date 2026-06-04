import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Icon} from '../components/Icon';
import {LEXEND} from '../fonts';
import {CAT} from '../theme';
import {fadeUp} from '../anim';

export const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const pop = spring({frame: f, fps, config: {damping: 13, mass: 0.9}});
  const iconScale = interpolate(pop, [0, 1], [0.55, 1]);
  const iconY = interpolate(pop, [0, 1], [44, 0]);
  const iconO = interpolate(f, [0, 10], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <Brand>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: `translateY(${iconY}px) scale(${iconScale})`, opacity: iconO}}>
          <Icon size={156} />
        </div>
        <div
          style={{
            ...fadeUp(f, 18, 22, 28),
            fontFamily: LEXEND,
            fontSize: 80,
            fontWeight: 600,
            marginTop: 42,
            letterSpacing: -1.2,
          }}
        >
          OPS Research Tool
        </div>
        <div style={{...fadeUp(f, 30, 22, 22), fontSize: 31, opacity: 0.84, marginTop: 16}}>
          Research, organized.
        </div>
        <div style={{display: 'flex', gap: 17, marginTop: 46}}>
          {CAT.map((c, i) => {
            const s = interpolate(f, [46 + i * 5, 60 + i * 5], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div
                key={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: c,
                  transform: `scale(${s})`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                }}
              />
            );
          })}
        </div>
      </AbsoluteFill>
    </Brand>
  );
};
