// Scene lengths in frames @30fps. TransitionSeries overlaps each transition,
// so the composition total = sum(scenes) - sum(transitions).
export const T = {
  intro: 110,
  highlight: 200,
  citation: 205,
  organize: 190,
  docs: 220,
  outro: 135,
  trans: 20,
};

// 5 transitions between the 6 scenes.
export const TOTAL =
  T.intro + T.highlight + T.citation + T.organize + T.docs + T.outro - 5 * T.trans;
