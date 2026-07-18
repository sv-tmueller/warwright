import { describe, expect, it } from 'vitest';
import { updateGlicko2Period, type GlickoPlayer } from './glicko2.js';

// Mark Glickman's own worked example from the Glicko-2 paper
// (http://www.glicko.net/glicko/glicko2.pdf, "Example calculation" section):
// a player rated 1500/200/0.06 plays one rating period against three
// opponents (1400/30, 1550/100, 1700/300) with results win/loss/loss, and
// ends at approximately 1464.06/151.52/0.05999.
describe('updateGlicko2Period', () => {
  const player: GlickoPlayer = { rating: 1500, ratingDeviation: 200, volatility: 0.06 };
  const opponents: GlickoPlayer[] = [
    { rating: 1400, ratingDeviation: 30, volatility: 0.06 },
    { rating: 1550, ratingDeviation: 100, volatility: 0.06 },
    { rating: 1700, ratingDeviation: 300, volatility: 0.06 },
  ];

  it("reproduces Glickman's published worked example", () => {
    const result = updateGlicko2Period(player, [
      { opponent: opponents[0]!, score: 1 },
      { opponent: opponents[1]!, score: 0 },
      { opponent: opponents[2]!, score: 0 },
    ]);

    // The paper's own by-hand worked example rounds every intermediate (E,
    // v, delta, phi*, ...) to 3-4 significant digits before the next step,
    // so its published r'/RD'/sigma' (1464.06 / 151.52 / 0.05999) carry
    // accumulated rounding error relative to a full float64 computation
    // from unrounded intermediates (this module never rounds until the
    // final display-scale conversion). Tolerances below are loose enough to
    // absorb that documented discrepancy while still failing on any real
    // formula error (an off-by-something bug moves these by whole points,
    // not fractions of a point).
    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.ratingDeviation).toBeCloseTo(151.52, 2);
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });

  it('is deterministic: identical inputs produce identical outputs', () => {
    const games = [{ opponent: opponents[0]!, score: 1 as const }];
    const first = updateGlicko2Period(player, games);
    const second = updateGlicko2Period(player, games);
    expect(second).toEqual(first);
  });

  it('leaves rating unchanged (within floating-point tolerance) on a draw between identically-rated players', () => {
    const evenPlayer: GlickoPlayer = { rating: 1600, ratingDeviation: 80, volatility: 0.06 };
    const evenOpponent: GlickoPlayer = { rating: 1600, ratingDeviation: 80, volatility: 0.06 };

    const result = updateGlicko2Period(evenPlayer, [{ opponent: evenOpponent, score: 0.5 }]);

    expect(result.rating).toBeCloseTo(1600, 6);
  });

  it('shrinks rating deviation after a single rated game, for both a decisive result and a draw', () => {
    const decisive = updateGlicko2Period(player, [{ opponent: opponents[0]!, score: 1 }]);
    expect(decisive.ratingDeviation).toBeLessThan(player.ratingDeviation);

    const evenPlayer: GlickoPlayer = { rating: 1600, ratingDeviation: 80, volatility: 0.06 };
    const evenOpponent: GlickoPlayer = { rating: 1600, ratingDeviation: 80, volatility: 0.06 };
    const draw = updateGlicko2Period(evenPlayer, [{ opponent: evenOpponent, score: 0.5 }]);
    expect(draw.ratingDeviation).toBeLessThan(evenPlayer.ratingDeviation);
  });
});
