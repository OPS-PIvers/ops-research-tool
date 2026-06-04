import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {CAT, CAT_LABELS} from '../theme';
import {LEXEND} from '../fonts';
import {appear} from '../anim';

const K = {accent: '#2d3f89', strong: '#1d2a5d', muted: '#666666', line: '#cccccc', soft: '#f3f3f3', red: '#ad2122'};
const CATS = [3, 3, 4, 3, 2]; // Emma's highlights per category
const MAXCAT = 4;
const COMP = [['Citation', 100], ['Classification', 100], ['Annotation', 100]] as const;
const ACTIVITY = [1, 0, 2, 3, 1, 0, 4, 2, 3, 5, 2, 4]; // highlights/day sparkline

const block: React.CSSProperties = {background: '#fff', border: `1px solid ${K.line}`, borderRadius: 8, padding: '16px 18px'};
const blockTitle: React.CSSProperties = {fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: K.muted, marginBottom: 12, fontFamily: LEXEND};

export const Drilldown: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  return (
    <Brand>
      <Caption step="For teachers" title="A detailed breakdown for every student" />

      <div style={{position: 'absolute', left: 290, top: 268, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="script.google.com/.../OPS Research Console">
          <div style={{height: 566, background: '#f7f8fb', display: 'flex', flexDirection: 'column'}}>
            <div style={{background: K.strong, color: '#fff', padding: '13px 22px', display: 'flex', alignItems: 'center', gap: 14}}>
              <span style={{fontFamily: LEXEND, fontSize: 18, fontWeight: 600}}>Wilson, Emma</span>
              <span style={{fontSize: 13, opacity: 0.7}}>· Period 3</span>
            </div>
            <div style={{padding: '10px 22px', borderBottom: `1px solid ${K.line}`, background: '#fff'}}>
              <span style={{fontSize: 13, color: '#333', border: `1px solid ${K.line}`, borderRadius: 6, padding: '5px 12px'}}>← Dashboard</span>
            </div>

            <div style={{flex: 1, padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto 1fr', gap: 16}}>
              {/* source counts */}
              <div style={{...block, opacity: appear(f, 10, 12)}}>
                <div style={blockTitle}>Source counts</div>
                <div style={{display: 'flex', gap: 12}}>
                  {[['Primary', 5], ['Secondary', 3], ['Unclassified', 0]].map(([lab, n], i) => (
                    <div key={i} style={{flex: 1, background: K.soft, borderRadius: 6, padding: '14px 8px', textAlign: 'center'}}>
                      <div style={{fontFamily: LEXEND, fontSize: 34, fontWeight: 600, color: K.strong}}>{n}</div>
                      <div style={{fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: K.muted, marginTop: 2}}>{lab}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* category breakdown */}
              <div style={{...block, gridRow: 'span 2', opacity: appear(f, 18, 12)}}>
                <div style={blockTitle}>Category breakdown</div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4}}>
                  {CATS.map((n, i) => {
                    const grow = appear(f, 30 + i * 6, 18);
                    return (
                      <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12}}>
                        <span style={{width: 130, fontSize: 13, color: '#333'}}>{CAT_LABELS[i]}</span>
                        <div style={{flex: 1, height: 18, background: K.soft, borderRadius: 4, overflow: 'hidden'}}>
                          <div style={{width: `${(n / MAXCAT) * 100 * grow}%`, height: '100%', background: CAT[i], borderRadius: 4}} />
                        </div>
                        <span style={{width: 20, textAlign: 'right', fontSize: 13, color: K.muted, fontVariantNumeric: 'tabular-nums'}}>{n}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* completion */}
              <div style={{...block, opacity: appear(f, 24, 12)}}>
                <div style={blockTitle}>Completion</div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 13}}>
                  {COMP.map(([lab, pct], i) => {
                    const grow = appear(f, 40 + i * 6, 18);
                    return (
                      <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12}}>
                        <span style={{width: 120, fontSize: 13, color: '#333'}}>{lab}</span>
                        <div style={{flex: 1, height: 8, background: K.line, borderRadius: 4, overflow: 'hidden'}}>
                          <div style={{width: `${pct * grow}%`, height: '100%', background: K.red}} />
                        </div>
                        <span style={{width: 38, textAlign: 'right', fontSize: 12, color: K.muted}}>{Math.round(pct * grow)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* activity sparkline (spans both cols) */}
              <div style={{...block, gridColumn: '1 / span 2', opacity: appear(f, 52, 12)}}>
                <div style={{...blockTitle, marginBottom: 8}}>Activity over time</div>
                <div style={{display: 'flex', alignItems: 'flex-end', gap: 8, height: 56}}>
                  {ACTIVITY.map((v, i) => {
                    const grow = appear(f, 58 + i * 2, 14);
                    return <div key={i} style={{flex: 1, height: `${(v / 5) * 100 * grow}%`, minHeight: 3, background: i % 3 === 0 ? K.accent : '#9fb0d8', borderRadius: '3px 3px 0 0'}} />;
                  })}
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 10, color: K.muted, marginTop: 6}}>
                  <span>3 weeks ago</span><span>today</span>
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>
      </div>
    </Brand>
  );
};
