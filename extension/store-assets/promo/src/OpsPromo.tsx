import React from 'react';
import {AbsoluteFill} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {T} from './timing';
import {Intro} from './scenes/Intro';
import {Highlight} from './scenes/Highlight';
import {Organize} from './scenes/Organize';
import {Bibliography} from './scenes/Bibliography';
import {Outro} from './scenes/Outro';

export const OpsPromo: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#1d2a5d'}}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={T.intro}>
        <Intro />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({durationInFrames: T.trans})}
      />

      <TransitionSeries.Sequence durationInFrames={T.highlight}>
        <Highlight />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({direction: 'from-right'})}
        timing={linearTiming({durationInFrames: T.trans})}
      />

      <TransitionSeries.Sequence durationInFrames={T.organize}>
        <Organize />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({direction: 'from-right'})}
        timing={linearTiming({durationInFrames: T.trans})}
      />

      <TransitionSeries.Sequence durationInFrames={T.bibliography}>
        <Bibliography />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({durationInFrames: T.trans})}
      />

      <TransitionSeries.Sequence durationInFrames={T.outro}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
