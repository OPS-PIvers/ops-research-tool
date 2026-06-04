import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {CAT} from '../theme';
import {LEXEND} from '../fonts';
import {fadeUp, appear} from '../anim';

const D = {accent: '#2d3f89', strong: '#1d2a5d', muted: '#666666', line: '#e0e0e0', soft: '#f3f3f3', blueSubtle: '#eaecf5', bad: '#ad2122', good: '#4356a9'};

const ENTRIES = [
  {who: 'Branch, Taylor. ', title: 'Parting the Waters: America in the King Years.', rest: ' Simon & Schuster, 1988.', note: 'Narrative history used to corroborate the sequence of events.'},
  {who: 'King, Martin Luther, Jr. ', title: 'I Have a Dream: Writings and Speeches That Changed the World.', rest: ' HarperOne, 1992.', note: 'Primary text of the address analyzed in the main-event section.'},
  {who: 'National Archives. “The March on Washington.” ', title: 'National Archives', rest: ', www.archives.gov/civil-rights. Accessed 4 June 2026.', note: 'Primary-source overview used for background on the march’s scale.'},
];

export const DocsEditor: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  // 1) Copy citation  2) Insert References  3) pick Annotated Bibliography
  const pressCopy = interpolate(f, [22, 30, 40], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pressIns = interpolate(f, [60, 68, 78], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pressPick = interpolate(f, [104, 112, 122], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const copied = f >= 30;
  const pasted = f >= 40;
  const menuOpen = f >= 68 && f < 116;
  const inserted = f >= 116;

  const cx = interpolate(f, [8, 24, 44, 64, 84, 100], [1720, 1542, 1542, 1460, 1460, 1460], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [8, 24, 44, 64, 84, 100], [980, 524, 524, 853, 853, 762], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 210, 220], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <Brand>
      <Caption step="Step 5" title="Insert your bibliography" />

      <div style={{position: 'absolute', left: 290, top: 270, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://docs.google.com/document/d/…/edit">
          <div style={{display: 'flex', height: 564}}>
            {/* doc page */}
            <div style={{flex: 1, background: '#f6f7fb', padding: '34px 0', display: 'flex', justifyContent: 'center', overflow: 'hidden'}}>
              <div style={{width: 640, background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', padding: '44px 62px'}}>
                <p style={{fontSize: 14.5, lineHeight: 1.8, color: '#222', margin: '0 0 18px'}}>
                  The march drew more than 250,000 people to the National Mall in a single afternoon
                  {pasted ? <span style={{background: interpolate(f, [40, 58], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) > 0.05 ? '#fff3a8' : 'transparent', borderRadius: 2}}> (National Archives)</span> : null}.
                </p>
                <div style={{textAlign: 'center', fontSize: 16, color: '#222', margin: '24px 0 18px', opacity: inserted ? 1 : 0.18}}>Annotated Bibliography</div>
                {inserted ? ENTRIES.map((e, i) => (
                  <div key={i} style={{...fadeUp(f, 120 + i * 15, 16, 16), fontSize: 14, lineHeight: 1.7, color: '#222', textIndent: -28, paddingLeft: 28, marginBottom: 14}}>
                    {e.who}<i>{e.title}</i>{e.rest}
                    <div style={{textIndent: 0, paddingLeft: 0, color: '#475', fontSize: 13, marginTop: 3}}>{e.note}</div>
                  </div>
                )) : null}
              </div>
            </div>

            {/* OPS Docs sidebar */}
            <div style={{width: 340, borderLeft: `1px solid ${D.line}`, background: '#fff', display: 'flex', flexDirection: 'column', position: 'relative'}}>
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
              {/* source list with Copy citation */}
              <div style={{flex: 1, padding: '8px 0', overflow: 'hidden'}}>
                {[
                  {title: 'The March on Washington', url: 'archives.gov/civil-rights', chip: 'Primary', cat: CAT[0], n: 3},
                  {title: 'I Have a Dream — full text', url: 'archives.gov/i-have-a-dream', chip: 'Primary', cat: CAT[2], n: 2},
                ].map((s, i) => (
                  <div key={i} style={{margin: '0 10px', padding: '10px 0', borderTop: i ? `1px solid ${D.line}` : 'none'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'flex-start'}}>
                      <div style={{fontWeight: 500, fontSize: 13, color: '#333'}}>{s.title}</div>
                      <span style={{fontSize: 10, padding: '2px 6px', borderRadius: 999, background: D.blueSubtle, color: D.strong, whiteSpace: 'nowrap'}}>{s.chip}</span>
                    </div>
                    <div style={{fontSize: 11, color: D.muted, marginTop: 2}}>{s.url}</div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11}}>
                      <span style={{color: D.muted}}>{s.n} highlights</span>
                      <span style={{color: D.accent}}>Edit citation</span>
                      <span style={{color: D.accent, fontWeight: i === 0 && f >= 22 && f < 40 ? 700 : 400}}>Copy citation</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* footer */}
              <div style={{borderTop: `1px solid ${D.line}`, padding: '10px 12px', background: '#fff', position: 'relative'}}>
                <div style={{padding: '7px 12px', textAlign: 'center', background: '#fff', color: D.accent, border: `1px solid ${D.accent}`, borderRadius: 4, fontWeight: 500, fontSize: 13, marginBottom: 6}}>Open Editor</div>
                <div style={{padding: '8px 12px', textAlign: 'center', background: D.accent, color: '#fff', borderRadius: 4, fontWeight: 500, fontSize: 13, transform: `scale(${1 - pressIns * 0.03})`}}>Insert References <span style={{fontSize: 9}}>▾</span></div>
                <div style={{fontSize: 11, textAlign: 'center', marginTop: 6, minHeight: 14, color: inserted ? D.good : D.good, opacity: copied || inserted ? 1 : 0}}>
                  {inserted ? '✓ Inserted annotated bibliography — 6 sources' : copied ? '✓ Copied in-text citation: (National Archives)' : ''}
                </div>
                {menuOpen ? (
                  <div style={{position: 'absolute', left: 12, right: 12, bottom: 'calc(100% - 2px)', background: '#fff', border: `1px solid ${D.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(29,42,93,0.16)', padding: 4, display: 'flex', flexDirection: 'column', gap: 2, opacity: appear(f, 68, 6)}}>
                    <div style={{padding: '8px 10px', borderRadius: 6, background: f >= 98 ? D.soft : '#fff'}}>
                      <div style={{fontSize: 13, fontWeight: 500, color: '#333'}}>Annotated Bibliography</div>
                      <div style={{fontSize: 11, color: D.muted}}>Citations + your annotations</div>
                    </div>
                    <div style={{padding: '8px 10px', borderRadius: 6}}>
                      <div style={{fontSize: 13, fontWeight: 500, color: '#333'}}>Works Cited</div>
                      <div style={{fontSize: 11, color: D.muted}}>Citations only</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </BrowserFrame>
      </div>

      <Cursor x={cx} y={cy} press={Math.max(pressCopy, pressIns, pressPick)} opacity={cO} />
    </Brand>
  );
};
