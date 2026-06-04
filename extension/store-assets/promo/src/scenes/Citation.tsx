import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Easing} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {Cursor} from '../components/Cursor';
import {ExtShell, EXT} from '../components/ExtShell';
import {LEXEND} from '../fonts';
import {fadeUp, appear} from '../anim';

const SB_LEFT = 1390;
const SB_TOP = 168;
const SB_H = 786;

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
  const sbX = interpolate(spring({frame: f - 6, fps, config: {damping: 18, mass: 0.8}}), [0, 1], [400, 0]);

  // cursor → Primary segment, click ~frame 74
  const primaryOn = f >= 78;
  const press = interpolate(f, [70, 78, 90], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cx = interpolate(f, [10, 60], [1760, 1452], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cy = interpolate(f, [10, 60], [980, 660], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const cO = interpolate(f, [4, 14, 170, 182], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const seg = (label: string, kind: 'primary' | 'secondary' | 'unset') => {
    const on = primaryOn ? kind === 'primary' : kind === 'unset';
    return (
      <div
        style={{
          flex: 1,
          padding: '7px 4px',
          textAlign: 'center',
          fontSize: 12,
          borderRight: kind !== 'unset' ? '1px solid #eceff1' : 'none',
          background: on ? EXT.blueWash : '#fff',
          color: on ? EXT.blue : EXT.gray,
          fontWeight: on ? 600 : 400,
          transform: on && kind === 'primary' ? `scale(${1 - press * 0.05})` : 'none',
        }}
      >
        {label}
      </div>
    );
  };

  return (
    <Brand>
      <Caption step="Step 2" title="Build the citation" />

      {/* the page being cited, behind-left */}
      <div style={{position: 'absolute', left: 120, top: 322, opacity: winO * 0.97, transform: `translateY(${interpolate(winO, [0, 1], [40, 0])}px)`}}>
        <BrowserFrame width={880} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{padding: '34px 44px', height: 470}}>
            <div style={{fontFamily: LEXEND, fontSize: 30, fontWeight: 600, color: '#15203a', marginBottom: 18}}>The March on Washington, 1963</div>
            <p style={{fontSize: 20, lineHeight: 1.85, color: '#5a6472', margin: 0}}>
              On August 28, 1963, more than 250,000 people gathered on the National Mall in one of the
              largest political rallies for human rights in U.S. history. The day’s program drew speakers
              from labor, faith, and civil-rights organizations and built national pressure toward the
              Civil Rights Act of 1964.
            </p>
            <div style={{marginTop: 18, fontSize: 13, color: '#9aa3b0'}}>National Archives · Educator Resources</div>
          </div>
        </BrowserFrame>
      </div>

      {/* citation builder panel, pinned right */}
      <div style={{position: 'absolute', left: SB_LEFT, top: SB_TOP, opacity: winO, transform: `translateX(${sbX}px)`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 44px 100px rgba(8,14,40,0.5)'}}>
        <ExtShell active="source" annCount={7} height={SB_H}>
          <div style={{padding: '10px 14px 16px', fontSize: 12.5}}>
            <FieldLabel>Source type</FieldLabel>
            <div style={{...box(), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9}}>
              website <span style={{color: EXT.grayMid, fontSize: 10}}>▾</span>
            </div>

            {FIELDS.map(([label, val], i) => (
              <div key={label} style={{...fadeUp(f, 16 + i * 6, 14, 14), marginBottom: 9}}>
                <FieldLabel>{label}</FieldLabel>
                <div style={box()}>{val || <span style={{color: '#c4c9d0'}}>—</span>}</div>
              </div>
            ))}

            <FieldLabel>Tag</FieldLabel>
            <div style={{display: 'flex', border: `1px solid ${EXT.border}`, borderRadius: 7, overflow: 'hidden', marginBottom: 10}}>
              {seg('Primary', 'primary')}
              {seg('Secondary', 'secondary')}
              {seg('Unset', 'unset')}
            </div>

            <FieldLabel>Annotation</FieldLabel>
            <div style={{...box(), minHeight: 50, lineHeight: 1.5, marginBottom: 10, opacity: appear(f, 88, 16), color: '#3c4043'}}>
              A primary-source overview of the march, used for background on its scale and organization.
            </div>

            <div style={{background: '#f8f9fa', border: '1px solid #eceff1', borderRadius: 7, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5, color: '#3c4043', opacity: appear(f, 96, 16)}}>
              <span style={{display: 'block', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9aa0a6', marginBottom: 3}}>MLA preview</span>
              National Archives. “The March on Washington.” <i>National Archives</i>, www.archives.gov/civil-rights. Accessed 4 June 2026.
            </div>
            <div style={{fontSize: 10.5, color: EXT.green, marginTop: 8, opacity: appear(f, 110, 12)}}>✓ saved</div>
          </div>
        </ExtShell>
      </div>

      <Cursor x={cx} y={cy} press={press} opacity={cO} />
    </Brand>
  );
};

const FieldLabel: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#80868b', marginBottom: 3}}>{children}</div>
);

function box(): React.CSSProperties {
  return {border: '1px solid #dadce0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: '#202124', background: '#fff'};
}
