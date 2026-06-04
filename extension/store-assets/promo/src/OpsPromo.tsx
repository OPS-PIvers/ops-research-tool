import React from 'react';
import {AbsoluteFill} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {T} from './timing';
import {Intro} from './scenes/Intro';
import {Highlight} from './scenes/Highlight';
import {Citation} from './scenes/Citation';
import {Organize} from './scenes/Organize';
import {DocsEditor} from './scenes/DocsEditor';
import {Outro} from './scenes/Outro';

const slideR = slide({direction: 'from-right'});
const t = linearTiming({durationInFrames: T.trans});

export const OpsPromo: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#1d2a5d'}}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={T.intro}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />

      <TransitionSeries.Sequence durationInFrames={T.highlight}>
        <Highlight />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slideR} timing={t} />

      <TransitionSeries.Sequence durationInFrames={T.citation}>
        <Citation />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slideR} timing={t} />

      <TransitionSeries.Sequence durationInFrames={T.organize}>
        <Organize />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slideR} timing={t} />

      <TransitionSeries.Sequence durationInFrames={T.docs}>
        <DocsEditor />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />

      <TransitionSeries.Sequence durationInFrames={T.outro}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
