import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {Cursor} from '../components/Cursor';
import {CAT} from '../theme';
import {LEXEND, ROBOTO} from '../fonts';
import {appear} from '../anim';

// Docs-sidebar / modal brand tokens (sidebar_css.html).
const D = {accent: '#2d3f89', strong: '#1d2a5d', muted: '#666666', line: '#e0e0e0', soft: '#f3f3f3', blueSubtle: '#eaecf5', redSubtle: '#e5c7c7', bad: '#ad2122', good: '#4356a9'};

const FIELDS: Array<[string, string]> = [
  ['Title', 'The 1963 March on Washington for Jobs and Freedom'],
  ['Site name', 'History.com'],
  ['Author', ''],
  ['Published date', '2021'],
  ['URL', 'history.com/topics/march-on-washington'],
];

const EVID = [
  {cat: 'Main Event', rgb: [219, 68, 55], text: '“More than 250,000 people gathered at the Lincoln Memorial to hear Dr. Martin Luther King Jr.”', note: 'Key turnout statistic.'},
  {cat: 'Long-Term Impact', rgb: [171, 71, 188], sec: 'Build-Up', text: '“The march helped galvanize support for the Civil Rights Act of 1964.”', note: 'Direct legislative outcome.'},
  {cat: 'Main Event', rgb: [219, 68, 55], text: '“King’s ‘I Have a Dream’ speech became one of the most iconic in American history.”', note: 'Defining rhetorical moment.'},
];

const M = {left: 360, top: 232, w: 1200, h: 726};

export const Modal: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const pop = spring({frame: f, fps, config: {damping: 18, mass: 0.7}});
  const scale = interpolate(pop, [0, 1], [0.9, 1]);
  const o = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});

  const ddOpen = f >= 36 && f < 92;
  const press = interpolate(f, [28, 36, 46], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cx = interpolate(f, [8, 28, 60, 84], [1700, 640, 640, 640], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [8, 28, 60, 84], [980, 262, 262, 336], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 176, 186], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const lbl = (t: string): React.CSSProperties => ({fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: D.muted, marginBottom: 4});
  const box = (): React.CSSProperties => ({width: '100%', padding: '6px 8px', border: `1px solid ${D.line}`, borderRadius: 4, fontSize: 12.5, color: '#333', background: '#fff'});

  return (
    <Brand>
      <AbsoluteFill style={{background: 'rgba(12,18,46,0.55)'}} />
      <Caption step="Open Editor" title="Edit any source in full" />

      <div style={{position: 'absolute', left: M.left, top: M.top, width: M.w, height: M.h, background: '#fff', borderRadius: 14, boxShadow: '0 50px 110px rgba(8,14,40,0.6)', opacity: o, transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: ROBOTO}}>
        {/* header: close + source switcher */}
        <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${D.line}`}}>
          <span style={{fontSize: 22, color: D.muted, padding: '0 8px'}}>×</span>
          <div style={{position: 'relative', flex: 1}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 8, fontFamily: LEXEND, fontSize: 15, fontWeight: 600, color: D.strong, border: `1.5px solid ${ddOpen ? D.accent : D.line}`, borderRadius: 8, padding: '7px 10px 7px 12px', boxShadow: ddOpen ? '0 0 0 3px rgba(45,63,137,0.12)' : 'none'}}>
              <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>The 1963 March on Washington for Jobs and Freedom</span>
              <span style={{fontSize: 10, color: D.muted, transform: ddOpen ? 'rotate(180deg)' : 'none'}}>▾</span>
            </div>
            {ddOpen ? (
              <div style={{position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', background: '#fff', border: `1px solid ${D.line}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(29,42,93,0.18)', padding: 6, zIndex: 5, opacity: appear(f, 36, 6)}}>
                {[
                  {on: true, dot: D.accent, t: 'The 1963 March on Washington for Jobs and Freedom'},
                  {on: false, dot: D.bad, t: '“I Have a Dream” — full speech transcript'},
                  {on: false, dot: D.line, t: 'Parting the Waters: America in the King Years'},
                ].map((opt, i) => (
                  <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 7, background: opt.on ? D.blueSubtle : '#fff', color: opt.on ? D.strong : '#333', fontWeight: opt.on ? 600 : 400, fontSize: 13, lineHeight: 1.35}}>
                    <span style={{width: 13, color: D.accent, fontWeight: 700}}>{opt.on ? '✓' : ''}</span>
                    <span style={{width: 9, height: 9, borderRadius: '50%', background: opt.dot, marginTop: 4, flexShrink: 0}} />
                    <span style={{flex: 1}}>{opt.t}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* body */}
        <div style={{flex: 1, display: 'flex', gap: 12, padding: 14, minHeight: 0}}>
          {/* left — citation */}
          <div style={{flex: '0 0 46%', borderRight: `1px solid ${D.line}`, paddingRight: 14, overflow: 'hidden', opacity: appear(f, 10, 14)}}>
            <div style={{fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: D.muted, marginBottom: 10}}>Citation</div>
            <div style={{marginBottom: 9}}><div style={lbl('')}>Source type</div><div style={{...box(), display: 'flex', justifyContent: 'space-between'}}>website <span style={{color: D.muted}}>▾</span></div></div>
            {FIELDS.map(([k, v]) => (
              <div key={k} style={{marginBottom: 9}}><div style={lbl('')}>{k}</div><div style={box()}>{v || <span style={{color: '#c4c9d0'}}>—</span>}</div></div>
            ))}
            {/* segmented */}
            <div style={{display: 'flex', border: `1px solid ${D.line}`, borderRadius: 6, overflow: 'hidden', marginBottom: 12}}>
              {[['Primary', true], ['Secondary', false], ['Unset', false]].map(([t, on], i) => (
                <div key={i} style={{flex: 1, textAlign: 'center', padding: '7px 6px', fontSize: 12, borderLeft: i ? `1px solid ${D.line}` : 'none', background: on ? D.blueSubtle : '#fff', color: on ? D.strong : D.muted, fontWeight: on ? 600 : 400}}>{t}</div>
              ))}
            </div>
            <div style={{fontSize: 11, color: D.muted, background: '#fff', border: `1px solid ${D.line}`, borderRadius: 4, padding: '6px 8px', lineHeight: 1.4, marginBottom: 10}}>
              “The 1963 March on Washington for Jobs and Freedom.” <i>History.com</i>, 2021.
            </div>
            <div style={lbl('')}>Annotation</div>
            <div style={{...box(), minHeight: 52, lineHeight: 1.45, color: '#333'}}>A historical overview of the 1963 March — turnout, key speeches, and its push toward the Civil Rights Act of 1964.</div>
          </div>

          {/* right — evidence */}
          <div style={{flex: 1, overflow: 'hidden', opacity: appear(f, 16, 14)}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10}}>
              <div style={{fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: D.muted}}>Evidence (3)</div>
              <div style={{display: 'flex', gap: 4}}>
                {[CAT[2], CAT[4], CAT[1]].map((c, i) => (
                  <span key={i} style={{width: 14, height: 14, borderRadius: '50%', background: c, border: '2px solid #fff', boxShadow: '0 0 0 1px ' + D.line}} />
                ))}
              </div>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
              {EVID.map((e, i) => {
                const [r, g, b] = e.rgb;
                return (
                  <div key={i} style={{...appearUp(f, 24 + i * 10), padding: '10px 12px', borderRadius: 6, background: `rgba(${r},${g},${b},0.09)`, border: `1.5px solid rgba(${r},${g},${b},0.55)`}}>
                    <div style={{fontSize: 10, color: D.muted, marginBottom: 3, display: 'flex', gap: 6, alignItems: 'center'}}>
                      <span style={{width: 9, height: 9, borderRadius: '50%', background: `rgb(${r},${g},${b})`}} />
                      {e.cat}
                      {e.sec ? <span style={{fontSize: 9, background: D.soft, padding: '1px 6px', borderRadius: 3}}>+ {e.sec}</span> : null}
                    </div>
                    <div style={{fontSize: 13, lineHeight: 1.45, color: '#333'}}>{e.text}</div>
                    <div style={{fontSize: 11, fontStyle: 'italic', color: D.muted, marginTop: 5}}>{e.note}</div>
                    <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4}}>
                      <span style={{fontSize: 10, color: D.accent}}>Edit</span>
                      <span style={{fontSize: 10, color: D.bad}}>Delete</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{padding: '6px 14px 10px', fontSize: 11, color: D.good, textAlign: 'center'}}>Saved.</div>
      </div>

      <Cursor x={cx} y={cy} press={press} opacity={cO} />
    </Brand>
  );
};

function appearUp(f: number, start: number): React.CSSProperties {
  const p = interpolate(f, [start, start + 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return {opacity: p, transform: `translateY(${(1 - p) * 14}px)`};
}
