export const TICK_HZ = 20;

// Seconds per tick, for surfaces that need a wall-clock conversion. Sim
// logic stays in integer ticks and must never use DT in combat math.
export const DT = 1 / TICK_HZ;

// Phase 4 Slice A primitives, #147: adds the augment primitive
// (UnitBuildSchema.augmentIds, a replay-input shape change) plus the
// stun/empower status kinds. No existing build's outcome changes; the
// golden-replay hash moves only because match-start embeds this version.
export const RULESET_VERSION = 3;

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

// Sentinel behaviorId consumed by stepTick's decide slot (see loop.ts) and
// init's eager-validation skip (see init.ts): a unit built with this id
// draws its Action from the `externalActions` map passed into
// stepTick/SteppedTransport.step instead of a registered Behavior, and so
// never draws rng in the decide slot. Defined here (not in stepped.ts, which
// re-exports it) so loop.ts and init.ts can depend on it without a circular
// import through stepped.ts, which itself imports both of them. Deliberately
// excluded from index.ts's `behaviorIds`: it is not a selectable in-game
// Behavior, only an injection seam for a future gym bridge.
export const EXTERNAL_BEHAVIOR_ID = 'external';
