import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {ExtShell, EXT} from '../components/ExtShell';
import {LEXEND} from '../fonts';
import {fadeUp, appear} from '../anim';

const WIN_TOP = 250;
const CONTENT_H = 690;

const FIELDS: Array<[string, string]> = [
  ['Title', 'The March on Washington'],
  ['Site name', 'National Archives'],
  ['Author', ''],
  ['Published date', '1963'],
  ['URL', 'www.archives.gov/civil-rights'],
];

export const Citation: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  // cursor → Primary segment, click ~frame 82
  const primaryOn = f >= 82;
  const press = interpolate(f, [74, 82, 94], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cx = interpolate(f, [12, 64], [1760, 1342], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [12, 64], [980, 806], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 170, 182], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const seg = (label: string, kind: 'primary' | 'secondary' | 'unset') => {
    const on = primaryOn ? kind === 'primary' : kind === 'unset';
    return (
      <div style={{flex: 1, padding: '7px 4px', textAlign: 'center', fontSize: 12, borderRight: kind !== 'unset' ? '1px solid #eceff1' : 'none', background: on ? EXT.blueWash : '#fff', color: on ? EXT.blue : EXT.gray, fontWeight: on ? 600 : 400, transform: on && kind === 'primary' ? `scale(${1 - press * 0.05})` : 'none'}}>{label}</div>
    );
  };
  const lbl: React.CSSProperties = {fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#80868b', marginBottom: 3};
  const box: React.CSSProperties = {border: '1px solid #dadce0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: '#202124', background: '#fff'};

  return (
    <Brand>
      <Caption step="Step 2" title="Build the citation" />

      <div style={{position: 'absolute', left: 290, top: WIN_TOP, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{display: 'flex', height: CONTENT_H, overflow: 'hidden'}}>
            {/* page on the left — the panel docks against it */}
            <div style={{flex: 1, padding: '40px 52px', overflow: 'hidden'}}>
              <div style={{fontFamily: LEXEND, fontSize: 32, fontWeight: 600, color: '#15203a', marginBottom: 20}}>The March on Washington, 1963</div>
              <p style={{fontSize: 21, lineHeight: 1.9, color: '#5a6472', margin: 0}}>
                On August 28, 1963, more than 250,000 people gathered on the National Mall in one of the
                largest political rallies for human rights in U.S. history. The day’s program drew speakers
                from labor, faith, and civil-rights organizations and built national pressure toward the
                Civil Rights Act of 1964.
              </p>
              <div style={{marginTop: 22, fontSize: 14, color: '#9aa3b0'}}>National Archives · Educator Resources</div>
            </div>

            {/* docked extension sidebar — Source tab */}
            <ExtShell active="source" annCount={7} height={CONTENT_H}>
              <div style={{padding: '10px 14px 16px', fontSize: 12.5}}>
                <div style={lbl}>Source type</div>
                <div style={{...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>website <span style={{color: EXT.grayMid, fontSize: 10}}>▾</span></div>
                {FIELDS.map(([label, val], i) => (
                  <div key={label} style={{...fadeUp(f, 16 + i * 6, 14, 14), marginBottom: 8}}>
                    <div style={lbl}>{label}</div>
                    <div style={box}>{val || <span style={{color: '#c4c9d0'}}>—</span>}</div>
                  </div>
                ))}
                <div style={lbl}>Tag</div>
                <div style={{display: 'flex', border: `1px solid ${EXT.border}`, borderRadius: 7, overflow: 'hidden', marginBottom: 9}}>
                  {seg('Primary', 'primary')}
                  {seg('Secondary', 'secondary')}
                  {seg('Unset', 'unset')}
                </div>
                <div style={lbl}>Annotation</div>
                <div style={{...box, minHeight: 44, lineHeight: 1.5, marginBottom: 9, opacity: appear(f, 88, 16), color: '#3c4043'}}>A primary-source overview of the march, used for background on its scale and organization.</div>
                <div style={{background: '#f8f9fa', border: '1px solid #eceff1', borderRadius: 7, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5, color: '#3c4043', opacity: appear(f, 96, 16)}}>
                  <span style={{display: 'block', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9aa0a6', marginBottom: 3}}>MLA preview</span>
                  National Archives. “The March on Washington.” <i>National Archives</i>, www.archives.gov/civil-rights. Accessed 4 June 2026.
                </div>
                <div style={{fontSize: 10.5, color: EXT.green, marginTop: 8, opacity: appear(f, 110, 12)}}>✓ saved</div>
              </div>
            </ExtShell>
          </div>
        </BrowserFrame>
      </div>

      <Cursor x={cx} y={cy} press={press} opacity={cO} />
    </Brand>
  );
};
