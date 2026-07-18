/**
 * A pure, side-effect-free implementation of Glickman's Glicko-2 rating
 * system (http://www.glicko.net/glicko/glicko2.pdf). No Node/DOM/network
 * dependency and no I/O — this module is a straight port of the paper's
 * "Step" numbering below, so it stays directly checkable against the
 * paper's own worked example (see glicko2.test.ts).
 *
 * Package A's usage (#110's sub-plan): every ranked match is treated as its
 * own one-game rating period — the Lichess/online-play adaptation of a
 * system originally designed for periodic (e.g. weekly) tournament pools.
 * Each call to updateGlicko2Period() rates exactly one player against the
 * game(s) supplied, immediately, rather than batching a pool of games per
 * period.
 *
 * Values are stored and returned UNROUNDED at Glicko's display scale
 * (rating ~1500, ratingDeviation ~350 default, volatility ~0.06 default).
 * Round only for UI presentation, if ever — never round a stored value.
 */

/** A player's rating state at Glicko's display scale (not the internal μ/φ scale used below). */
export interface GlickoPlayer {
  rating: number;
  ratingDeviation: number;
  volatility: number;
}

/** One game result from `player`'s perspective: 1 win, 0 loss, 0.5 draw. */
export interface GlickoGame {
  opponent: GlickoPlayer;
  score: 0 | 0.5 | 1;
}

// Step 1: system constant. Glickman recommends τ between 0.3 and 1.2;
// 0.5 is the paper's own worked-example value and the sub-plan's binding
// choice.
const TAU = 0.5;

// Converts between the display scale (rating ~1500, RD ~350) and the
// internal Glicko-2 scale (μ ~0, φ ~1). Glickman's own constant.
const GLICKO2_SCALE = 173.7178;

// Step 5's Illinois-algorithm convergence tolerance.
const EPSILON = 1e-6;

/** Step 2: rating -> μ (internal scale). */
function toMu(rating: number): number {
  return (rating - 1500) / GLICKO2_SCALE;
}

/** Step 2: ratingDeviation -> φ (internal scale). */
function toPhi(ratingDeviation: number): number {
  return ratingDeviation / GLICKO2_SCALE;
}

/** Step 3: the g(φ) weighting function — de-weights opponents with high uncertainty. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Step 3: the expected-score function E(μ, μⱼ, φⱼ). */
function expectedScore(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

interface InternalGame {
  gPhi: number;
  expected: number;
  score: number;
}

/** Step 3: estimated variance v of the rating, based only on game outcomes. */
function estimateVariance(games: readonly InternalGame[]): number {
  const sum = games.reduce((total, game) => total + game.gPhi * game.gPhi * game.expected * (1 - game.expected), 0);
  return 1 / sum;
}

/** Step 4: estimated improvement Δ in rating, computable only once v is known. */
function estimateImprovement(games: readonly InternalGame[], variance: number): number {
  const sum = games.reduce((total, game) => total + game.gPhi * (game.score - game.expected), 0);
  return variance * sum;
}

/**
 * Step 5: solves for the new volatility σ' via the Illinois algorithm (a
 * bracketing, regula-falsi variant), converging f(x) = 0 to within
 * EPSILON. f is the paper's own log-volatility optimality function.
 */
function newVolatility(phi: number, volatility: number, delta: number, variance: number): number {
  const phiSquared = phi * phi;
  const a = Math.log(volatility * volatility);

  function f(x: number): number {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phiSquared - variance - ex);
    const denominator = 2 * (phiSquared + variance + ex) * (phiSquared + variance + ex);
    return numerator / denominator - (x - a) / (TAU * TAU);
  }

  let A = a;
  let B: number;
  if (delta * delta > phiSquared + variance) {
    B = Math.log(delta * delta - phiSquared - variance);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) {
      k += 1;
    }
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }

    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

/**
 * Rates `player` against every game in `games` as a single Glicko-2 rating
 * period (steps 1-8 of the paper), returning a new, unrounded GlickoPlayer.
 * `games` empty is valid (Step 7's no-games case): rating and volatility
 * are unchanged, ratingDeviation grows to reflect the elapsed-but-unplayed
 * period.
 */
export function updateGlicko2Period(player: GlickoPlayer, games: readonly GlickoGame[]): GlickoPlayer {
  const mu = toMu(player.rating);
  const phi = toPhi(player.ratingDeviation);

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + player.volatility * player.volatility);
    return {
      rating: player.rating,
      ratingDeviation: phiStar * GLICKO2_SCALE,
      volatility: player.volatility,
    };
  }

  const internalGames: InternalGame[] = games.map((game) => {
    const muOpponent = toMu(game.opponent.rating);
    const phiOpponent = toPhi(game.opponent.ratingDeviation);
    return {
      gPhi: g(phiOpponent),
      expected: expectedScore(mu, muOpponent, phiOpponent),
      score: game.score,
    };
  });

  const variance = estimateVariance(internalGames);
  const delta = estimateImprovement(internalGames, variance);
  const volatilityPrime = newVolatility(phi, player.volatility, delta, variance);

  // Step 6: pre-rating-period value φ*.
  const phiStar = Math.sqrt(phi * phi + volatilityPrime * volatilityPrime);

  // Step 7: new φ' and μ'.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);
  const sum = internalGames.reduce((total, game) => total + game.gPhi * (game.score - game.expected), 0);
  const muPrime = mu + phiPrime * phiPrime * sum;

  // Step 8: back to the display scale.
  return {
    rating: GLICKO2_SCALE * muPrime + 1500,
    ratingDeviation: GLICKO2_SCALE * phiPrime,
    volatility: volatilityPrime,
  };
}
