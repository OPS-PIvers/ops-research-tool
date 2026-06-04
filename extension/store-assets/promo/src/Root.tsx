import React from 'react';
import {Composition} from 'remotion';
import {OpsPromo} from './OpsPromo';
import {FPS, WIDTH, HEIGHT} from './theme';
import {TOTAL} from './timing';
import './fonts';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OpsPromo"
      component={OpsPromo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
