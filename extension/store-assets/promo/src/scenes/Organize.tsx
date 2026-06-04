import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {C, CAT, CAT_LABELS} from '../theme';
import {LEXEND} from '../fonts';
import {fadeUp, appear} from '../anim';

const FACETS = [
  {label: 'All notes', color: '#9aa5c8', count: 7, dim: false},
  {label: 'Background', color: CAT[0], count: 2, dim: false},
  {label: 'Build-Up', color: CAT[1], count: 1, dim: false},
  {label: 'Main Event', color: CAT[2], count: 3, dim: false},
  {label: 'Short-Term', color: CAT[3], count: 1, dim: false},
  {label: 'Long-Term', color: CAT[4], count: 0, dim: true},
];

const CARDS = [
  {color: CAT[2], text: '“reframed the movement’s demands as a test of the nation’s founding promises”', tag: 'Main Event · note added'},
  {color: CAT[0], text: '“250,000 people gathered on the National Mall”', tag: 'Background'},
  {color: CAT[1], text: '“spent months coordinating transportation, marshals, and a speaker program”', tag: 'Build-Up'},
];

export const Organize: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame: f, fps, config: {damping: 16}});
  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(enter, [0, 1], [60, 0]);

  const sb = spring({frame: f - 8, fps, config: {damping: 18, mass: 0.8}});
  const sbX = interpolate(sb, [0, 1], [380, 0]);

  return (
    <Brand>
      <Caption step="Step 2" title="Organize your evidence" />

      <div style={{position: 'absolute', left: 290, top: 284, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{display: 'flex', height: 540, overflow: 'hidden'}}>
            {/* page */}
            <div style={{flex: 1, padding: '38px 48px'}}>
              <div style={{fontFamily: LEXEND, fontSize: 32, fontWeight: 600, color: '#15203a', marginBottom: 20}}>
                The March on Washington, 1963
              </div>
              <p style={{fontSize: 21, lineHeight: 1.9, color: '#56606e', margin: 0}}>
                On August 28, 1963, more than{' '}
                <mark style={{background: '#ffe39a', borderRadius: 3, padding: '1px 2px'}}>250,000 people gathered on the National Mall</mark>{' '}
                in one of the largest political rallies for human rights in U.S. history.{' '}
                <mark style={{background: '#ffd2c4', borderRadius: 3, padding: '1px 2px'}}>Organizers spent months coordinating transportation, marshals, and a speaker program</mark>{' '}
                drawn from labor, faith, and civil-rights groups. The day’s final address,{' '}
                <mark style={{background: '#f6c4be', borderRadius: 3, padding: '1px 2px'}}>reframed the movement’s demands as a test of the nation’s founding promises.</mark>
              </p>
            </div>

            {/* docked sidebar */}
            <div
              style={{
                width: 360,
                borderLeft: '1px solid #e4e7ef',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                transform: `translateX(${sbX}px)`,
              }}
            >
              <div style={{background: C.blue, color: '#fff', padding: '16px 18px'}}>
                <div style={{fontFamily: LEXEND, fontSize: 17, fontWeight: 600}}>Civil Rights — 7th Grade</div>
                <div style={{fontSize: 12.5, opacity: 0.8, marginTop: 3}}>archives.gov · The March on Washington</div>
              </div>
              <div style={{display: 'flex', borderBottom: '1px solid ' + C.line}}>
                <div style={{flex: 1, textAlign: 'center', padding: 11, fontSize: 13.5, color: C.muted}}>Source</div>
                <div style={{flex: 1, textAlign: 'center', padding: 11, fontSize: 13.5, fontWeight: 600, color: C.blue, borderBottom: `2px solid ${C.blue}`}}>Annotations</div>
              </div>
              <div style={{display: 'flex', flex: 1, minHeight: 0}}>
                <div style={{width: 128, borderRight: '1px solid ' + C.line, padding: '11px 8px', fontSize: 12.5}}>
                  {FACETS.map((x, i) => {
                    const o = appear(f, 30 + i * 5, 12);
                    const first = i === 0;
                    return (
                      <div
                        key={x.label}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          padding: '6px 7px',
                          borderRadius: 6,
                          marginBottom: 1,
                          background: first ? '#eef1fb' : 'transparent',
                          fontWeight: first ? 600 : 400,
                          color: first ? C.blue : C.ink,
                          opacity: x.dim ? o * 0.45 : o,
                        }}
                      >
                        <span style={{width: 11, height: 11, borderRadius: '50%', background: x.color}} />
                        {x.label}
                        <span style={{marginLeft: 'auto', color: first ? C.blue : C.muted}}>{x.count}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10}}>
                  {CARDS.map((card, i) => (
                    <div
                      key={i}
                      style={{
                        ...fadeUp(f, 48 + i * 14, 16, 22),
                        border: '1px solid ' + C.line,
                        borderLeft: `4px solid ${card.color}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{fontSize: 13, lineHeight: 1.4, color: '#28333f'}}>{card.text}</div>
                      <div style={{fontSize: 11, color: C.muted, marginTop: 6}}>{card.tag}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>
      </div>
    </Brand>
  );
};
