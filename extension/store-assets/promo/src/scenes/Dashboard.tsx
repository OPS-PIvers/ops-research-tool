import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {CAT} from '../theme';
import {LEXEND} from '../fonts';
import {appear} from '../anim';

const K = {accent: '#2d3f89', strong: '#1d2a5d', muted: '#666666', line: '#cccccc', soft: '#f3f3f3', red: '#ad2122', blue50: '#f4f6fa'};
const GOOD = ['#dcfce7', '#15803d'];
const WARN = ['#fef3c7', '#b45309'];
const BAD = ['#e5c7c7', '#ad2122'];

type Row = {name: string; mix: number[]; pct: number; gaps: {cite: number; tag: number; note: number; total: number} | null; act: string};
const ROWS: Row[] = [
  {name: 'Wilson, Emma', mix: [3, 3, 4, 3, 2], pct: 100, gaps: {cite: 0, tag: 0, note: 0, total: 8}, act: '1h ago'},
  {name: 'Brown, Lucas', mix: [2, 2, 2, 2, 1], pct: 88, gaps: {cite: 0, tag: 0, note: 1, total: 5}, act: '2h ago'},
  {name: 'Martinez, Olivia', mix: [2, 1, 2, 2, 1], pct: 50, gaps: {cite: 0, tag: 0, note: 3, total: 6}, act: '6h ago'},
  {name: 'Johnson, Mia', mix: [1, 1, 0, 0, 1], pct: 0, gaps: {cite: 0, tag: 3, note: 3, total: 3}, act: '8d ago'},
  {name: 'Patel, Noah', mix: [1, 1, 1, 1, 0], pct: 0, gaps: {cite: 4, tag: 0, note: 4, total: 4}, act: '5d ago'},
  {name: 'Nguyen, Ava', mix: [0, 0, 0, 0, 0], pct: 0, gaps: null, act: 'never'},
];

const stop = (n: number, total: number) => (n === 0 ? GOOD : n / total <= 0.5 ? WARN : BAD);

export const Dashboard: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  const th: React.CSSProperties = {padding: '12px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fff', textAlign: 'left', fontFamily: LEXEND};
  const td: React.CSSProperties = {padding: '12px 14px', borderBottom: `1px solid ${K.line}`, verticalAlign: 'middle'};

  return (
    <Brand>
      <Caption step="For teachers" title="See the whole class at a glance" />

      <div style={{position: 'absolute', left: 290, top: 268, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="script.google.com/.../OPS Research Console">
          <div style={{height: 566, background: '#fff', display: 'flex', flexDirection: 'column'}}>
            {/* console header */}
            <div style={{background: K.strong, color: '#fff', padding: '13px 22px', display: 'flex', alignItems: 'center', gap: 16}}>
              <span style={{fontFamily: LEXEND, fontSize: 18, fontWeight: 600}}>Civil Rights — 7th Grade</span>
              <span style={{fontSize: 13, opacity: 0.7}}>· Period 3 · 24 students · 2 groups</span>
            </div>
            {/* toolbar + class tabs */}
            <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 22px', borderBottom: `1px solid ${K.line}`}}>
              <span style={{fontSize: 13, color: '#333', border: `1px solid ${K.line}`, borderRadius: 6, padding: '5px 12px'}}>← My Projects</span>
              <span style={{fontSize: 13, color: K.accent, border: `1px solid ${K.line}`, borderRadius: 6, padding: '5px 12px'}}>↻ Refresh</span>
              <div style={{display: 'flex', gap: 8, marginLeft: 10}}>
                {['All classes', 'Period 3', 'Period 5'].map((t) => {
                  const on = t === 'Period 3';
                  return <span key={t} style={{fontSize: 13, padding: '6px 14px', borderRadius: 999, border: `1px solid ${on ? K.accent : K.line}`, background: on ? K.accent : '#fff', color: on ? '#fff' : '#333', fontWeight: on ? 600 : 400}}>{t}</span>;
                })}
              </div>
              <span style={{marginLeft: 'auto', fontSize: 12, color: K.muted}}>Refreshed now</span>
            </div>
            {/* table */}
            <table style={{width: '100%', borderCollapse: 'collapse'}}>
              <thead>
                <tr style={{background: K.accent}}>
                  <th style={th}>Student</th>
                  <th style={th}>Category mix</th>
                  <th style={th}>Completion</th>
                  <th style={th}>Gaps</th>
                  <th style={th}>Activity</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => {
                  const o = appear(f, 16 + i * 7, 12);
                  const grow = appear(f, 24 + i * 7, 18);
                  const total = r.mix.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={r.name} style={{opacity: o}}>
                      <td style={{...td, fontWeight: 500, color: '#333', fontSize: 14}}>{r.name}</td>
                      <td style={td}>
                        <div style={{width: 150, height: 14, borderRadius: 3, overflow: 'hidden', display: 'flex', background: total ? 'transparent' : 'repeating-linear-gradient(45deg,#f3f3f3,#f3f3f3 4px,#e8e8e8 4px,#e8e8e8 8px)'}}>
                          {r.mix.map((c, j) => c > 0 ? <div key={j} style={{flexGrow: c, background: CAT[j], height: '100%'}} /> : null)}
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                          <div style={{width: 120, height: 8, borderRadius: 4, background: K.line, overflow: 'hidden'}}>
                            <div style={{width: `${r.pct * grow}%`, height: '100%', background: K.red}} />
                          </div>
                          <span style={{fontSize: 12, color: K.muted, width: 32}}>{Math.round(r.pct * grow)}%</span>
                        </div>
                      </td>
                      <td style={td}>
                        {r.gaps ? (
                          <div style={{display: 'flex', gap: 5}}>
                            {([['cite', r.gaps.cite], ['tag', r.gaps.tag], ['note', r.gaps.note]] as const).map(([lab, n]) => {
                              const [bg, fg] = stop(n, r.gaps!.total);
                              return <span key={lab} style={{fontSize: 10, fontWeight: 500, fontFamily: LEXEND, padding: '2px 7px', borderRadius: 999, background: bg, color: fg}}>{lab} {n}</span>;
                            })}
                          </div>
                        ) : <span style={{fontSize: 12, color: '#b0b0b0'}}>—</span>}
                      </td>
                      <td style={{...td, fontSize: 12, color: r.act === 'never' ? '#b0b0b0' : K.muted, fontStyle: r.act === 'never' ? 'italic' : 'normal'}}>{r.act}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </BrowserFrame>
      </div>
    </Brand>
  );
};
