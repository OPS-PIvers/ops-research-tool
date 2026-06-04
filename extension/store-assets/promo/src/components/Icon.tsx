import React from 'react';

/** OPS Research Tool icon — white pen-on-tile on the brand-blue gradient. */
export const Icon: React.FC<{size?: number}> = ({size = 120}) => {
  const r = size * 0.24;
  const g = size * 0.52;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background:
          'linear-gradient(150deg, #4256a8 0%, #283a86 55%, #1d2a5d 100%)',
        boxShadow:
          '0 24px 60px rgba(10,16,45,0.5), inset 0 1px 0 rgba(255,255,255,0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={g} height={g} viewBox="0 0 24 24" fill="none">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#fff" />
        <path
          d="M20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
          fill="#fff"
        />
      </svg>
    </div>
  );
};
