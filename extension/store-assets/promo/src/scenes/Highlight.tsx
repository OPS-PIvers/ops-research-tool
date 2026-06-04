import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, interpolateColors, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {C, CAT, CAT_LABELS} from '../theme';
import {LEXEND} from '../fonts';

const TB_LEFT = 700;
const TB_TOP = 590;
const NOTE = 'King’s framing — central to my thesis.';

export const Highlight: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame: f, fps, config: {damping: 16}});
  const winY = interpolate(enter, [0, 1], [70, 0]);
  const winO = interpolate(f, [0, 14], [0, 1], {extrapolateRight: 'clamp'});

  const sweep = interpolate(f, [30, 56], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  // selection blue → Main-Event red once the swatch is clicked (~frame 96).
  const hlColor = interpolateColors(f, [96, 110], ['#cfe0ff', '#f6b3ab']);

  const tbSpring = spring({frame: f - 52, fps, config: {damping: 15}});
  const tbScale = interpolate(tbSpring, [0, 1], [0.82, 1]);
  const tbO = interpolate(f, [52, 64], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const catChosen = f >= 96;
  const press1 = interpolate(f, [88, 96, 106], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}); // swatch
  const noteOpen = f >= 128;
  const press2 = interpolate(f, [120, 128, 138], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}); // Add note
  const typed = Math.round(interpolate(f, [140, 208], [0, NOTE.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const caretOn = noteOpen && typed < NOTE.length && Math.floor(f / 8) % 2 === 0;
  const saved = interpolate(f, [216, 230], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // cursor: selection → red swatch → Add note toggle
  const cx = interpolate(f, [8, 36, 60, 92, 116, 126], [1660, 980, 980, 935, 935, 772], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [8, 36, 60, 92, 116, 126], [940, 520, 520, 672, 672, 754], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 236, 246], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <Brand>
      <Caption step="Step 1" title="Highlight & annotate" />

      <div style={{position: 'absolute', left: 370, top: 282, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1180} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{padding: '44px 56px 56px'}}>
            <div style={{fontFamily: LEXEND, fontSize: 38, fontWeight: 600, color: '#15203a', marginBottom: 22}}>The March on Washington, 1963</div>
            <p style={{fontSize: 24, lineHeight: 1.85, color: C.inkSoft, margin: 0}}>
              On August 28, 1963, more than 250,000 people gathered on the National Mall in one of the
              largest political rallies for human rights in U.S. history. The day’s final address{' '}
              <span style={{backgroundImage: `linear-gradient(${hlColor},${hlColor})`, backgroundRepeat: 'no-repeat', backgroundSize: `${sweep * 100}% 100%`, borderRadius: 3, padding: '2px 1px'}}>
                reframed the movement’s demands as a test of the nation’s founding promises
              </span>{' '}
              drawn from the language of the Declaration of Independence.
            </p>
          </div>
        </BrowserFrame>
      </div>

      {/* selection toolbar (faithful to extension/content/toolbar.js) */}
      <div style={{position: 'absolute', left: TB_LEFT, top: TB_TOP, width: 470, background: '#fff', borderRadius: 14, boxShadow: '0 18px 50px rgba(8,14,40,0.3), 0 0 0 1px rgba(8,14,40,0.05)', padding: '18px 20px', opacity: tbO, transform: `scale(${tbScale})`, transformOrigin: '20% 0%'}}>
        <div style={{fontSize: 15, color: C.muted, marginBottom: 14}}>Saving to: <b style={{color: C.blue, fontWeight: 600}}>Civil Rights — 7th Grade</b></div>
        <div style={{display: 'flex', gap: 14}}>
          {CAT.map((c, i) => {
            const isSel = catChosen && i === 2;
            return (
              <div key={c} style={{textAlign: 'center', width: 74}}>
                <div style={{width: 48, height: 48, borderRadius: '50%', margin: '0 auto 7px', background: c, boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.65), 0 2px 5px rgba(0,0,0,0.2)', outline: isSel ? '3px solid #202124' : 'none', outlineOffset: 2, transform: isSel ? `scale(${1 + press1 * 0.12})` : 'scale(1)'}} />
                <div style={{fontSize: 12, color: C.muted}}>{CAT_LABELS[i]}</div>
              </div>
            );
          })}
        </div>
        {catChosen ? <div style={{fontSize: 13, color: '#202124', fontWeight: 500, marginTop: 14}}>✓ Main Event</div> : null}
        <div style={{fontSize: 13, color: C.blue, marginTop: 10}}>{noteOpen ? 'Hide note' : 'Add note'}</div>
        {noteOpen ? (
          <div style={{marginTop: 8, border: '1px solid #dadce0', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#202124', minHeight: 34, lineHeight: 1.4}}>
            {typed > 0 ? NOTE.slice(0, typed) : <span style={{color: '#9aa0a6'}}>optional note…</span>}
            {caretOn ? <span style={{borderLeft: '1.5px solid #202124', marginLeft: 1}}>&nbsp;</span> : null}
          </div>
        ) : null}
        <div style={{fontSize: 11, color: '#9aa0a6', fontStyle: 'italic', marginTop: 10}}>
          {saved > 0.5 ? '✓ Saved to your project' : 'Click outside or press Enter to save · Esc to cancel'}
        </div>
      </div>

      <Cursor x={cx} y={cy} press={Math.max(press1, press2)} opacity={cO} />
    </Brand>
  );
};
