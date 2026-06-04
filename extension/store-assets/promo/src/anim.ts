import {interpolate, Easing} from 'remotion';

const EASE = Easing.out(Easing.cubic);

/** Fade + rise. Returns a style object you can spread. */
export const fadeUp = (frame: number, start: number, dur = 18, dist = 26) => {
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  return {opacity: p, transform: `translateY(${(1 - p) * dist}px)`};
};

/** Plain 0→1 eased ramp. */
export const appear = (frame: number, start: number, dur = 14) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
