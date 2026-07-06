export const TICK_HZ = 20;

// Seconds per tick, for surfaces that need a wall-clock conversion. Sim
// logic stays in integer ticks and must never use DT in combat math.
export const DT = 1 / TICK_HZ;

export const RULESET_VERSION = 2;

// Square arena, origin top-left at (0, 0), integer coordinates. 1000 units
// per axis leaves clean room for melee ranges (tens of units) versus ranged
// (hundreds) and for per-tick movement steps; the renderer scales freely.
export const ARENA_MIN_X = 0;
export const ARENA_MIN_Y = 0;
export const ARENA_MAX_X = 1000;
export const ARENA_MAX_Y = 1000;

// 5 minutes at 20 Hz. Bounds a non-terminating match with a `'draw'`; not
// correctness-critical.
export const MATCH_TICK_CAP = 6000;
