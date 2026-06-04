import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {DocsToolbar} from '../components/DocsToolbar';
import {Cursor} from '../components/Cursor';
import {CAT} from '../theme';
import {LEXEND} from '../fonts';
import {fadeUp} from '../anim';

const D = {accent: '#2d3f89', strong: '#1d2a5d', muted: '#666666', line: '#e0e0e0', soft: '#f3f3f3', blueSubtle: '#eaecf5'};

const SOURCES = [
  {title: 'The March on Washington', url: 'archives.gov/civil-rights', chip: 'Primary', cat: CAT[0], n: 3},
  {title: 'I Have a Dream — full text', url: 'archives.gov/i-have-a-dream', chip: 'Primary', cat: CAT[2], n: 2},
];

export const DocsIntro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);
  const sbX = interpolate(spring({frame: f - 14, fps, config: {damping: 18, mass: 0.8}}), [0, 1], [360, 0]);

  const press = interpolate(f, [76, 84, 96], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cx = interpolate(f, [16, 64], [1720, 1460], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [16, 64], [980, 822], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [10, 22, 120, 132], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <Brand>
      <Caption step="Step 4" title="Write in Google Docs" />

      <div style={{position: 'absolute', left: 290, top: 270, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://docs.google.com/document/d/…/edit">
          <div style={{display: 'flex', flexDirection: 'column', height: 568}}>
            <DocsToolbar />
            <div style={{display: 'flex', flex: 1, minHeight: 0}}>
              {/* doc canvas */}
              <div style={{flex: 1, background: '#f6f7fb', padding: '30px 0', display: 'flex', justifyContent: 'center', overflow: 'hidden'}}>
                <div style={{width: 600, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.12)', padding: '40px 58px'}}>
                  <div style={{fontFamily: LEXEND, fontSize: 21, fontWeight: 600, color: '#222', marginBottom: 16}}>A Test of the Nation’s Promises</div>
                  <p style={{fontSize: 14, lineHeight: 1.85, color: '#333', margin: '0 0 12px'}}>
                    On August 28, 1963, the March on Washington drew more than a quarter-million people to
                    the National Mall. The day’s speeches reframed the movement’s demands as a test of the
                    country’s founding promises…
                  </p>
                  <p style={{fontSize: 14, lineHeight: 1.85, color: '#9aa3b0', margin: 0}}>The writing continues here.</p>
                </div>
              </div>

              {/* OPS Docs add-on sidebar — docked, separated */}
              <div style={{width: 340, borderLeft: `1px solid ${D.line}`, background: '#fff', display: 'flex', flexDirection: 'column', transform: `translateX(${sbX}px)`, boxShadow: '-3px 0 12px rgba(8,14,40,0.08)'}}>
                <div style={{padding: '10px 14px', borderBottom: `1px solid ${D.line}`}}>
                  <div style={{fontFamily: LEXEND, fontSize: 15, fontWeight: 700, color: D.strong}}>OPS Research Tool</div>
                  <div style={{fontSize: 11, color: D.muted, marginTop: 2}}>You · paul.ivers@orono.k12.mn.us</div>
                </div>
                <div style={{padding: '8px 14px', borderBottom: `1px solid ${D.line}`, display: 'flex', flexDirection: 'column', gap: 4}}>
                  <span style={{fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: D.muted}}>Project</span>
                  <div style={{padding: '6px 8px', border: `1.5px solid ${D.line}`, borderRadius: 6, fontSize: 12.5, display: 'flex', justifyContent: 'space-between'}}>Civil Rights — 7th Grade <span style={{color: D.muted}}>▾</span></div>
                </div>
                <div style={{padding: '6px 10px', borderBottom: `1px solid ${D.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div style={{display: 'inline-flex', background: D.soft, borderRadius: 999, padding: 2}}>
                    <span style={{padding: '4px 12px', fontSize: 11, borderRadius: 999, background: '#fff', color: D.accent, fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.08)'}}>By source</span>
                    <span style={{padding: '4px 12px', fontSize: 11, color: D.muted}}>By evidence</span>
                  </div>
                  <div style={{display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: `1.5px solid ${D.line}`, borderRadius: 6, fontSize: 12, fontWeight: 500, color: '#333'}}>Sort &amp; Filter <span style={{fontSize: 9, color: D.muted}}>▾</span></div>
                </div>
                <div style={{flex: 1, padding: '8px 0', overflow: 'hidden'}}>
                  {SOURCES.map((s, i) => (
                    <div key={i} style={{...fadeUp(f, 34 + i * 10, 14, 16), margin: '0 10px', padding: '10px 0', borderTop: i ? `1px solid ${D.line}` : 'none'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'flex-start'}}>
                        <div style={{fontWeight: 500, fontSize: 13, color: '#333'}}>{s.title}</div>
                        <span style={{fontSize: 10, padding: '2px 6px', borderRadius: 999, background: D.blueSubtle, color: D.strong, whiteSpace: 'nowrap'}}>{s.chip}</span>
                      </div>
                      <div style={{fontSize: 11, color: D.muted, marginTop: 2}}>{s.url}</div>
                      <div style={{marginTop: 8, padding: '7px 9px', border: `1px solid ${D.line}`, borderRadius: 6, fontSize: 12}}>
                        <div style={{fontSize: 10, color: D.muted, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2}}>
                          <span style={{width: 8, height: 8, borderRadius: '50%', background: s.cat}} /> {s.n} highlights
                        </div>
                        <div style={{lineHeight: 1.4, color: '#333'}}>“250,000 people gathered on the National Mall”</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{borderTop: `1px solid ${D.line}`, padding: '10px 12px', background: '#fff'}}>
                  <div style={{padding: '7px 12px', textAlign: 'center', background: '#fff', color: D.accent, border: `1px solid ${D.accent}`, borderRadius: 4, fontWeight: 500, fontSize: 13, marginBottom: 6, transform: `scale(${1 - press * 0.04})`, boxShadow: press > 0.2 ? 'inset 0 2px 6px rgba(45,63,137,0.2)' : 'none'}}>Open Editor</div>
                  <div style={{padding: '8px 12px', textAlign: 'center', background: D.accent, color: '#fff', borderRadius: 4, fontWeight: 500, fontSize: 13}}>Insert References <span style={{fontSize: 9}}>▾</span></div>
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>
      </div>

      <Cursor x={cx} y={cy} press={press} opacity={cO} />
    </Brand>
  );
};
