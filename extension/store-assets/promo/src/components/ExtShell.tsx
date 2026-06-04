import React from 'react';
import {LEXEND} from '../fonts';

// Extension in-page sidebar palette (from sidebar.js SIDEBAR_CSS): brand-blue
// header, Google-blue active accents, true-gray neutrals.
export const EXT = {
  header: '#2d3f89',
  blue: '#1a73e8',
  blueWash: '#e8f0fe',
  ink: '#202124',
  gray: '#5f6368',
  grayMid: '#80868b',
  border: '#dadce0',
  hairline: '#e8eaed',
  green: '#0f9d58',
};

/**
 * The extension sidebar chrome: brand-blue header with the OPS wordmark + a
 * "→" collapse control, the Project picker row, and the Source / Annotations
 * tab bar. `children` is the active tab's body.
 */
export const ExtShell: React.FC<{
  active: 'source' | 'annotations';
  annCount?: number;
  height: number;
  children: React.ReactNode;
}> = ({active, annCount = 0, height, children}) => {
  const tab = (label: string, on: boolean, badge?: number) => (
    <div
      style={{
        flex: 1,
        textAlign: 'center',
        padding: '11px 6px 9px',
        fontSize: 13,
        fontWeight: 600,
        color: on ? EXT.blue : EXT.grayMid,
        borderBottom: `2.5px solid ${on ? EXT.blue : 'transparent'}`,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      {badge ? (
        <span
          style={{
            minWidth: 16,
            padding: '0 5px',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            borderRadius: 999,
            background: on ? EXT.blueWash : '#eceff1',
            color: on ? EXT.blue : EXT.gray,
          }}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );

  return (
    <div style={{width: 360, height, background: '#fff', display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${EXT.border}`}}>
      {/* header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: EXT.header, color: '#fff'}}>
        <span style={{fontFamily: LEXEND, fontWeight: 600, fontSize: 14}}>OPS Research Tool</span>
        <span style={{background: 'rgba(255,255,255,0.14)', width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16}}>→</span>
      </div>
      {/* project */}
      <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: `1px solid ${EXT.border}`}}>
        <span style={{fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: EXT.gray}}>Project</span>
        <div style={{flex: 1, border: `1px solid ${EXT.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, color: EXT.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          Civil Rights — 7th Grade <span style={{color: EXT.grayMid, fontSize: 10}}>▾</span>
        </div>
      </div>
      {/* tabs */}
      <div style={{display: 'flex', borderBottom: `1px solid ${EXT.hairline}`, padding: '0 8px', gap: 2}}>
        {tab('Source', active === 'source')}
        {tab('Annotations', active === 'annotations', annCount)}
      </div>
      <div style={{flex: 1, minHeight: 0, overflow: 'hidden'}}>{children}</div>
    </div>
  );
};
