import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Brand} from '../components/Brand';
import {Caption} from '../components/Caption';
import {BrowserFrame} from '../components/BrowserFrame';
import {ExtShell, EXT} from '../components/ExtShell';
import {CAT} from '../theme';
import {LEXEND} from '../fonts';
import {fadeUp, appear} from '../anim';

const WIN_TOP = 250;
const CONTENT_H = 690;

const FACETS = [
  {label: 'All notes', color: null as string | null, count: 7, all: true},
  {label: 'Background', color: CAT[0], count: 2},
  {label: 'Build-Up', color: CAT[1], count: 1},
  {label: 'Main Event', color: CAT[2], count: 3},
  {label: 'Short-Term', color: CAT[3], count: 1},
  {label: 'Long-Term', color: CAT[4], count: 0},
];

const CARDS = [
  {color: CAT[2], cat: 'Main Event', text: '“reframed the movement’s demands as a test of the nation’s founding promises”', note: 'King’s framing — central to my thesis.'},
  {color: CAT[0], cat: 'Background', text: '“250,000 people gathered on the National Mall”', note: ''},
  {color: CAT[1], cat: 'Build-Up', text: '“spent months coordinating transportation, marshals, and a speaker program”', note: ''},
];

export const Organize: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();

  const winO = interpolate(f, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const winY = interpolate(spring({frame: f, fps, config: {damping: 16}}), [0, 1], [60, 0]);

  return (
    <Brand>
      <Caption step="Step 3" title="Organize your evidence" />

      <div style={{position: 'absolute', left: 290, top: WIN_TOP, opacity: winO, transform: `translateY(${winY}px)`}}>
        <BrowserFrame width={1340} url="https://www.archives.gov/civil-rights/march-on-washington">
          <div style={{display: 'flex', height: CONTENT_H, overflow: 'hidden'}}>
            {/* page on the left */}
            <div style={{flex: 1, padding: '40px 52px', overflow: 'hidden'}}>
              <div style={{fontFamily: LEXEND, fontSize: 32, fontWeight: 600, color: '#15203a', marginBottom: 20}}>The March on Washington, 1963</div>
              <p style={{fontSize: 21, lineHeight: 1.95, color: '#5a6472', margin: 0}}>
                On August 28, 1963, more than{' '}
                <mark style={{background: '#ffe39a', borderRadius: 3, padding: '1px 2px'}}>250,000 people gathered on the National Mall</mark>{' '}
                in one of the largest political rallies for human rights in U.S. history.{' '}
                <mark style={{background: '#ffd2c4', borderRadius: 3, padding: '1px 2px'}}>Organizers spent months coordinating transportation, marshals, and a speaker program.</mark>{' '}
                The day’s final address{' '}
                <mark style={{background: '#f6c4be', borderRadius: 3, padding: '1px 2px'}}>reframed the movement’s demands as a test of the nation’s founding promises.</mark>
              </p>
            </div>

            {/* docked extension sidebar — Annotations tab */}
            <ExtShell active="annotations" annCount={7} height={CONTENT_H}>
              <div style={{padding: '6px 8px 8px', borderBottom: '1px solid #f1f3f4'}}>
                {FACETS.map((x, i) => {
                  const o = appear(f, 16 + i * 4, 12);
                  const active = x.all;
                  return (
                    <div key={x.label} style={{display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', borderRadius: 6, marginBottom: x.all ? 2 : 0, background: active ? EXT.blueWash : 'transparent', color: active ? EXT.blue : '#3c4043', fontWeight: x.all ? 600 : 400, fontSize: 12, opacity: x.count === 0 ? o * 0.42 : o}}>
                      {x.color ? <span style={{width: 11, height: 11, borderRadius: 3, background: x.color}} /> : null}
                      <span style={{flex: 1}}>{x.label}</span>
                      <span style={{color: active ? EXT.blue : '#9aa0a6'}}>{x.count}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{padding: '8px 0'}}>
                {CARDS.map((c, i) => (
                  <div key={i} style={{...fadeUp(f, 40 + i * 13, 16, 20), position: 'relative', margin: '6px 12px', padding: '10px 12px 10px 16px', background: '#fff', border: `1px solid ${EXT.border}`, borderRadius: 6}}>
                    <div style={{position: 'absolute', top: 8, bottom: 8, left: 4, width: 4, borderRadius: 2, background: c.color}} />
                    <div style={{fontSize: 11, color: EXT.gray, marginBottom: 4}}>{c.cat}</div>
                    <div style={{fontSize: 12, lineHeight: 1.45, color: EXT.ink, marginBottom: 6}}>{c.text}</div>
                    {c.note ? <div style={{fontSize: 11, fontStyle: 'italic', color: EXT.gray, marginBottom: 6}}>{c.note}</div> : null}
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6}}>
                      <span style={{fontSize: 10, color: EXT.green}}>✓ saved</span>
                      <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                        <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f3f4', borderRadius: 999, padding: '3px 9px 3px 6px', fontSize: 11, color: EXT.gray}}>
                          <span style={{width: 10, height: 10, borderRadius: '50%', border: '1px dashed #5f6368'}} />
                          Alt: None
                        </span>
                        <span style={{fontSize: 11, color: EXT.blue}}>Edit</span>
                        <span style={{fontSize: 11, color: '#d93025'}}>Delete</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ExtShell>
          </div>
        </BrowserFrame>
      </div>
    </Brand>
  );
};
