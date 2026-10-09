(function () {
  'use strict';

  const MAX_GENERATORS = 5;
  const MAX_ESCAPES = 4;
  const MAX_KILLS = 4;
  const MAX_HOOKS = 12;

  function blankGame() {
    return {
      started: false,
      generatorsCompleted: null,
      exitEscapes: 0,
      hatch: false,
      kills: 0,
      allKillsBeforeEndgame: false,
      hooks: 0,
      confirmed: false
    };
  }

  function normalizeGame(value) {
    return { ...blankGame(), ...(value || {}) };
  }

  function blankScorecard() {
    return { game1: blankGame(), game2: blankGame() };
  }

  function normalizeScorecard(value) {
    const card = value || {};
    return { game1: normalizeGame(card.game1), game2: normalizeGame(card.game2) };
  }

  function calculateGame(value) {
    const game = normalizeGame(value);
    const generators = game.generatorsCompleted == null ? null : clampInt(game.generatorsCompleted, 0, MAX_GENERATORS);
    const escapes = clampInt(game.exitEscapes, 0, MAX_ESCAPES);
    const kills = clampInt(game.kills, 0, MAX_KILLS);
    const hooks = clampInt(game.hooks, 0, MAX_HOOKS);
    const hatchPoints = game.hatch ? 1 : 0;
    const early4KPoints = kills === 4 && game.allKillsBeforeEndgame ? 1 : 0;
    const survivors = game.started ? (generators == null ? 0 : generators) + escapes + hatchPoints : 0;
    const remainingGenerators = game.started && generators != null ? MAX_GENERATORS - generators : 0;
    const killer = game.started ? remainingGenerators + kills + early4KPoints + hooks * 0.5 : 0;

    return {
      survivorScore: tidy(survivors),
      killerScore: tidy(killer),
      breakdown: {
        generators: generators == null ? 0 : generators,
        generatorsSelected: generators != null,
        escapes,
        hatch: hatchPoints,
        remainingGenerators,
        kills,
        early4K: early4KPoints,
        hooks,
        hookPoints: hooks * 0.5
      },
      started: game.started,
      confirmed: game.confirmed,
      valid: generators != null
    };
  }

  function calculateMatch(scorecardValue) {
    const scorecard = normalizeScorecard(scorecardValue);
    const game1 = calculateGame(scorecard.game1); // Team A killer, Team B survivor
    const game2 = calculateGame(scorecard.game2); // Team B killer, Team A survivor
    const teamA = tidy(game1.killerScore + game2.survivorScore);
    const teamB = tidy(game1.survivorScore + game2.killerScore);
    return {
      scorecard,
      game1,
      game2,
      teamA,
      teamB,
      bothConfirmed: scorecard.game1.confirmed && scorecard.game2.confirmed,
      game1Confirmed: scorecard.game1.confirmed,
      game2Confirmed: scorecard.game2.confirmed
    };
  }

  function clampInt(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function tidy(value) {
    const n = Math.round(Number(value) * 2) / 2;
    return Number.isFinite(n) ? n : 0;
  }

  window.EntityScoring = {
    MAX_GENERATORS,
    MAX_ESCAPES,
    MAX_KILLS,
    MAX_HOOKS,
    blankGame,
    blankScorecard,
    normalizeGame,
    normalizeScorecard,
    calculateGame,
    calculateMatch
  };
})();
