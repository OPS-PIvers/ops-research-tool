import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {C} from '../theme';
import {LEXEND} from '../fonts';
import {fadeUp} from '../anim';

type Entry = {who: string; title: string; rest: string; note?: string};
const ENTRIES: Entry[] = [
  {
    who: 'Branch, Taylor. ',
    title: 'Parting the Waters: America in the King Years.',
    rest: ' Simon & Schuster, 1988.',
  },
  {
    who: 'King, Martin Luther, Jr. ',
    title: 'I Have a Dream: Writings and Speeches That Changed the World.',
    rest: ' HarperOne, 1992.',
    note: 'Primary text of the address analyzed in the main-event section.',
  },
  {
    who: 'National Archives. “The March on Washington.” ',
    title: 'National Archives',
    rest: ', www.archives.gov/civil-rights. Accessed 4 June 2026.',
    note: 'Primary-source overview used for background on the march’s scale.',
  },
];

export const Bibliography: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  const press = interpolate(f, [36, 44, 56], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const inserted = f >= 46;

  const cx = interpolate(f, [8, 38], [1700, 1452], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [8, 38], [900, 556], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 150, 162], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <Brand>
      <Caption step="Step 3" title="Finish in Google Docs" />

      <div style={{position: 'absolute', left: 290, top: 284, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://docs.google.com/document/d/…/edit">
          <div style={{display: 'flex', height: 560}}>
            {/* doc page */}
            <div style={{flex: 1, background: '#f6f7fb', padding: '34px 0', display: 'flex', justifyContent: 'center', overflow: 'hidden'}}>
              <div style={{width: 660, background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', padding: '46px 64px'}}>
                <div style={{textAlign: 'center', fontSize: 17, color: '#222', marginBottom: 22, opacity: inserted ? 1 : 0.25}}>
                  Works Cited
                </div>
                {ENTRIES.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      ...(inserted ? fadeUp(f, 50 + i * 16, 16, 18) : {opacity: 0}),
                      fontSize: 15,
                      lineHeight: 1.7,
                      color: '#222',
                      textIndent: -30,
                      paddingLeft: 30,
                      marginBottom: 16,
                    }}
                  >
                    {e.who}
                    <i>{e.title}</i>
                    {e.rest}
                    {e.note ? (
                      <div style={{textIndent: 0, paddingLeft: 0, color: '#475', fontSize: 14, marginTop: 4}}>
                        {e.note}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* OPS panel */}
            <div style={{width: 330, borderLeft: '1px solid #e4e7ef', background: '#fff', display: 'flex', flexDirection: 'column'}}>
              <div style={{background: C.blue, color: '#fff', padding: '15px 18px', fontFamily: LEXEND, fontSize: 16, fontWeight: 600}}>
                OPS Research Panel
              </div>
              <div style={{padding: 18, fontSize: 14.5, color: C.inkSoft}}>
                <div style={{color: C.muted, fontSize: 13, marginBottom: 12}}>Civil Rights — 7th Grade</div>
                {[
                  ['Sources', '8', C.ink],
                  ['Cited & annotated', '6', C.good],
                  ['Needs annotation', '2', CatAmber()],
                ].map(([k, v, col], i) => (
                  <div key={i} style={{display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid ' + C.line}}>
                    <span>{k}</span>
                    <b style={{color: col as string}}>{v}</b>
                  </div>
                ))}
                <button
                  style={{
                    marginTop: 20,
                    width: '100%',
                    background: C.blue,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 9,
                    padding: 14,
                    fontSize: 15,
                    fontWeight: 600,
                    fontFamily: LEXEND,
                    transform: `scale(${1 - press * 0.04})`,
                    boxShadow: press > 0.2 ? 'inset 0 2px 6px rgba(0,0,0,0.25)' : '0 6px 16px rgba(45,63,137,0.35)',
                  }}
                >
                  Insert Bibliography
                </button>
                <button
                  style={{
                    marginTop: 11,
                    width: '100%',
                    background: '#fff',
                    color: C.blue,
                    border: `1.5px solid ${C.blue}`,
                    borderRadius: 9,
                    padding: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: LEXEND,
                  }}
                >
                  Insert In-Text Citation
                </button>
                <div style={{marginTop: 16, fontSize: 13.5, color: C.good, fontWeight: 600, opacity: interpolate(f, [60, 74], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
                  ✓ Inserted at cursor
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

function CatAmber() {
  return '#b8860b';
}
