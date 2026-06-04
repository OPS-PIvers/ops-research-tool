import React from 'react';

/** Faux Chrome window: traffic-light dots + URL pill + children. */
export const BrowserFrame: React.FC<{
  width: number;
  url: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({width, url, children, style}) => (
  <div
    style={{
      width,
      background: '#fff',
      borderRadius: 18,
      boxShadow: '0 44px 100px rgba(8,14,40,0.5)',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 54,
        background: '#f1f3f8',
        borderBottom: '1px solid #e4e7ef',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 22px',
      }}
    >
      <span style={{width: 14, height: 14, borderRadius: '50%', background: '#ff5f57'}} />
      <span style={{width: 14, height: 14, borderRadius: '50%', background: '#febc2e'}} />
      <span style={{width: 14, height: 14, borderRadius: '50%', background: '#28c840'}} />
      <div
        style={{
          marginLeft: 18,
          flex: 1,
          height: 30,
          background: '#fff',
          border: '1px solid #e0e4ee',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          fontSize: 15,
          color: '#8a93a6',
        }}
      >
        {url}
      </div>
    </div>
    {children}
  </div>
);
