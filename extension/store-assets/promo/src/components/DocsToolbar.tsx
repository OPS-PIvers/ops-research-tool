import React from 'react';

/** Minimal Google Docs chrome (doc icon + title + menu + formatting toolbar)
 *  so the editor reads as real Google Docs and the add-on sidebar clearly docks
 *  inside it. */
export const DocsToolbar: React.FC = () => (
  <div style={{height: 50, background: '#fff', borderBottom: '1px solid #e8eaed', display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', flexShrink: 0}}>
    {/* doc icon */}
    <div style={{width: 20, height: 25, background: '#4285F4', borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2}}>
      <span style={{width: 11, height: 1.6, background: '#fff', borderRadius: 1}} />
      <span style={{width: 11, height: 1.6, background: '#fff', borderRadius: 1}} />
      <span style={{width: 7, height: 1.6, background: '#fff', borderRadius: 1, alignSelf: 'flex-start', marginLeft: 4.5}} />
    </div>
    <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0}}>
      <span style={{fontSize: 14, color: '#222', whiteSpace: 'nowrap'}}>A Test of the Nation’s Promises</span>
      <span style={{fontSize: 10.5, color: '#5f6368', marginTop: 2}}>File&nbsp;&nbsp;Edit&nbsp;&nbsp;View&nbsp;&nbsp;Insert&nbsp;&nbsp;Format&nbsp;&nbsp;Tools&nbsp;&nbsp;Extensions</span>
    </div>
    {/* formatting toolbar pill */}
    <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: '#edf2fa', borderRadius: 20, padding: '6px 14px'}}>
      <span style={{fontSize: 13, color: '#444', fontWeight: 700}}>B</span>
      <span style={{fontSize: 13, color: '#444', fontStyle: 'italic'}}>I</span>
      <span style={{fontSize: 13, color: '#444', textDecoration: 'underline'}}>U</span>
      <span style={{width: 1, height: 16, background: '#c7d0e0'}} />
      {[0, 1, 2, 3].map((i) => <span key={i} style={{width: 14, height: 14, borderRadius: 3, background: '#c7d0e0'}} />)}
    </div>
  </div>
);
