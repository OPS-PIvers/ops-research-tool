// Scene lengths in frames @30fps. TransitionSeries overlaps each transition,
// so the composition total = sum(scenes) - sum(transitions).
export const T = {
  intro: 100,
  highlight: 250,
  citation: 185,
  organize: 170,
  docsIntro: 150,
  modal: 205,
  docs: 215,
  dashboard: 200,
  drilldown: 215,
  outro: 130,
  trans: 18,
};

// 9 transitions between the 10 scenes.
export const TOTAL =
  T.intro + T.highlight + T.citation + T.organize + T.docsIntro + T.modal + T.docs +
  T.dashboard + T.drilldown + T.outro - 9 * T.trans;
