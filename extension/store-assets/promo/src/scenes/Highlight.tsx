import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {C, CAT, CAT_LABELS} from '../theme';
import {LEXEND} from '../fonts';

const TB_LEFT = 700;
const TB_TOP = 596;

export const Highlight: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame: f, fps, config: {damping: 16}});
  const winY = interpolate(enter, [0, 1], [70, 0]);
  const winO = interpolate(f, [0, 14], [0, 1], {extrapolateRight: 'clamp'});

  const sweep = interpolate(f, [40, 68], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  const tbSpring = spring({frame: f - 58, fps, config: {damping: 15}});
  const tbScale = interpolate(tbSpring, [0, 1], [0.8, 1]);
  const tbO = interpolate(f, [58, 70], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const selected = f >= 100;
  const press = interpolate(f, [92, 100, 110], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const saved = interpolate(f, [106, 120], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const cx = interpolate(f, [8, 40, 66, 96], [1640, 980, 980, 928], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const cy = interpolate(f, [8, 40, 66, 96], [900, 520, 520, 648], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const cO = interpolate(f, [4, 14, 122, 132], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Brand>
      <Caption step="Step 1" title="Highlight as you research" />

      <div
        style={{
          position: 'absolute',
          left: 370,
          top: 282,
          opacity: winO,
          transform: `translateY(${winY}px)`,
        }}
      >
        <BrowserFrame width={1180} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{padding: '44px 56px 56px'}}>
            <div
              style={{
                fontFamily: LEXEND,
                fontSize: 38,
                fontWeight: 600,
                color: '#15203a',
                marginBottom: 22,
              }}
            >
              The March on Washington, 1963
            </div>
            <p style={{fontSize: 24, lineHeight: 1.85, color: C.inkSoft, margin: 0}}>
              On August 28, 1963, more than 250,000 people gathered on the National Mall in one
              of the largest political rallies for human rights in U.S. history.{' '}
              <span
                style={{
                  backgroundImage: 'linear-gradient(#ffe39a,#ffe39a)',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: `${sweep * 100}% 100%`,
                  borderRadius: 3,
                  padding: '2px 1px',
                }}
              >
                Organizers spent months coordinating transportation, marshals, and a speaker
                program
              </span>{' '}
              drawn from labor, faith, and civil-rights groups.
            </p>
          </div>
        </BrowserFrame>
      </div>

      {/* floating selection toolbar */}
      <div
        style={{
          position: 'absolute',
          left: TB_LEFT,
          top: TB_TOP,
          width: 470,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 18px 50px rgba(8,14,40,0.3), 0 0 0 1px rgba(8,14,40,0.05)',
          padding: 22,
          opacity: tbO,
          transform: `scale(${tbScale})`,
          transformOrigin: '20% 0%',
        }}
      >
        <div style={{fontSize: 17, color: C.muted, marginBottom: 16}}>
          Saving to <b style={{color: C.blue, fontWeight: 600}}>Civil Rights — 7th Grade</b>
        </div>
        <div style={{display: 'flex', gap: 14}}>
          {CAT.map((c, i) => {
            const isSel = selected && i === 2;
            return (
              <div key={c} style={{textAlign: 'center', width: 74}}>
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: '50%',
                    margin: '0 auto 8px',
                    background: c,
                    boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.65), 0 2px 5px rgba(0,0,0,0.2)',
                    outline: isSel ? `4px solid ${C.blue}` : 'none',
                    outlineOffset: 3,
                    transform: isSel ? `scale(${1 + press * 0.12})` : 'scale(1)',
                  }}
                />
                <div style={{fontSize: 13, color: C.muted, lineHeight: 1.15}}>{CAT_LABELS[i]}</div>
              </div>
            );
          })}
        </div>
        <div style={{marginTop: 16, fontSize: 16, color: C.good, fontWeight: 600, opacity: saved}}>
          ✓ Saved — works offline too
        </div>
      </div>

      <Cursor x={cx} y={cy} press={press} opacity={cO} />
    </Brand>
  );
};
