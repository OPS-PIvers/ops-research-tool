// Scene lengths in frames @30fps. TransitionSeries overlaps each transition,
// so the composition total = sum(scenes) - sum(transitions).
export const T = {
  intro: 100,
  highlight: 250,
  citation: 185,
  organize: 170,
  modal: 205,
  docs: 245,
  dashboard: 200,
  drilldown: 215,
  outro: 130,
  trans: 18,
};

// 8 transitions between the 9 scenes.
export const TOTAL =
  T.intro + T.highlight + T.citation + T.organize + T.modal + T.docs + T.dashboard + T.drilldown + T.outro - 8 * T.trans;
