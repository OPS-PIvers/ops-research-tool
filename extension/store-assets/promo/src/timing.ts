// Scene lengths in frames @30fps. TransitionSeries overlaps each transition,
// so the composition total = sum(scenes) - sum(transitions).
export const T = {
  intro: 110,
  highlight: 210,
  organize: 200,
  bibliography: 220,
  outro: 135,
  trans: 20,
};

export const TOTAL =
  T.intro + T.highlight + T.organize + T.bibliography + T.outro - 4 * T.trans;
