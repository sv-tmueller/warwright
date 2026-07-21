import { describe, expect, it } from 'vitest';
import warbandA from '../../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../../builds/warband-b.json' with { type: 'json' };
import { createSeedRegistry } from './seed-registry.js';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { mulberry32 } from './prng.js';
import { init, initWithRegistry } from './init.js';

const VERSION = 1;
const SEED = 42;

describe('init', () => {
  it('produces exactly 8 units from two 4-unit seed builds', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.units).toHaveLength(8);
  });

  it('assigns strictly ascending unique ids 0..7 across both teams', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.units.map((unit) => unit.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('assigns team A to buildA units and team B to buildB units', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.units[0]?.team).toBe('A');
    expect(world.units[4]?.team).toBe('B');
  });

  it('resolves role stats for the warband-a vanguard from content/data/roles.ts', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);
    const vanguard = world.units[0];

    expect(vanguard?.maxHp).toBe(200);
    expect(vanguard?.hp).toBe(vanguard?.maxHp);
    expect(vanguard?.armor).toBe(10);
    expect(vanguard?.moveSpeed).toBe(3);
    expect(vanguard?.attackDamage).toBe(8);
    expect(vanguard?.attackRangeSquared).toBe(400);
    expect(vanguard?.attackCooldownTicks).toBe(20);
    expect(vanguard?.attackCooldownRemaining).toBe(0);
  });

  it('builds unit.skills from the build skillIds in order with zero cooldowns', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);
    const vanguard = world.units[0];

    expect(vanguard?.skills).toEqual([
      { skillId: 'guardian-ward', cooldownRemaining: 0 },
      { skillId: 'shield-bash', cooldownRemaining: 0 },
    ]);
  });

  it('copies the build position verbatim onto unit.pos', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.units[0]?.pos).toEqual({ x: 100, y: 400 });
    expect(world.units[4]?.pos).toEqual({ x: 900, y: 600 });
  });

  it('spawns every unit with no active statuses or dots', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    for (const unit of world.units) {
      expect(unit.slow).toBeNull();
      expect(unit.shield).toBeNull();
      expect(unit.activeDots).toEqual([]);
      expect(unit.stun).toBeNull();
      expect(unit.empower).toBeNull();
    }
  });

  it('sets tick to 0 and echoes version/seed onto the returned world', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.tick).toBe(0);
    expect(world.version).toBe(VERSION);
    expect(world.seed).toBe(SEED);
  });

  it('emits exactly one match-start event with SpawnInfo for every unit in order', () => {
    const world = init(VERSION, SEED, warbandA, warbandB);

    expect(world.eventLog).toHaveLength(1);
    const [event] = world.eventLog;
    expect(event).toEqual({
      kind: 'match-start',
      tick: 0,
      version: VERSION,
      seed: SEED,
      units: world.units.map((unit) => ({
        id: unit.id,
        team: unit.team,
        roleId: unit.roleId,
        pos: unit.pos,
        hp: unit.hp,
        maxHp: unit.maxHp,
      })),
    });
    expect(event?.kind === 'match-start' ? event.units : []).toHaveLength(8);
  });

  it('throws loud on an unknown roleId', () => {
    const badBuild = structuredClone(warbandA);
    badBuild.units[0]!.roleId = 'not-a-real-role';

    expect(() => init(VERSION, SEED, badBuild, warbandB)).toThrow(
      'Unknown role id: not-a-real-role',
    );
  });

  it('throws loud on an unknown skillId', () => {
    const badBuild = structuredClone(warbandA);
    badBuild.units[0]!.skillIds = ['not-a-real-skill'];

    expect(() => init(VERSION, SEED, badBuild, warbandB)).toThrow(
      'Unknown skill id: not-a-real-skill',
    );
  });

  it('throws loud on an unknown behaviorId', () => {
    const badBuild = structuredClone(warbandA);
    badBuild.units[0]!.behaviorId = 'not-a-real-behavior';

    expect(() => init(VERSION, SEED, badBuild, warbandB)).toThrow(
      'Unknown behavior id: not-a-real-behavior',
    );
  });

  it('does not throw on the external sentinel behaviorId, even though it is never registered', () => {
    const externalBuild = structuredClone(warbandA);
    externalBuild.units[0]!.behaviorId = EXTERNAL_BEHAVIOR_ID;

    const world = init(VERSION, SEED, externalBuild, warbandB);

    expect(world.units[0]?.behaviorId).toBe(EXTERNAL_BEHAVIOR_ID);
  });

  it('leaves match-start emit, unit construction order/ids, and rng creation unaffected by an external unit', () => {
    const externalBuild = structuredClone(warbandA);
    externalBuild.units[0]!.behaviorId = EXTERNAL_BEHAVIOR_ID;

    const world = init(VERSION, SEED, externalBuild, warbandB);

    expect(world.units.map((unit) => unit.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(world.eventLog).toHaveLength(1);
    expect(world.eventLog[0]?.kind).toBe('match-start');

    const freshRng = mulberry32(SEED);
    expect(world.rng.next()).toEqual(freshRng.next());
  });

  describe('augment stat-delta application', () => {
    function buildWithAugments(augmentIds: string[]) {
      const badBuild = structuredClone(warbandA) as {
        units: Array<{ augmentIds?: string[] }>;
      };
      badBuild.units[0]!.augmentIds = augmentIds;
      return badBuild;
    }

    it('applies a single augment delta additively over the role stat-line, floors hp to maxHp', () => {
      const registry = createSeedRegistry();
      registry.loadAugment({ id: 'iron-plating', name: 'Iron Plating', armorDelta: 5 });
      const build = buildWithAugments(['iron-plating']);

      const world = initWithRegistry(3, SEED, build, warbandB, registry);
      const vanguard = world.units[0];

      // Base vanguard: maxHp 200, armor 10, moveSpeed 3 (content/data/roles.ts).
      expect(vanguard?.armor).toBe(15);
      expect(vanguard?.maxHp).toBe(200);
      expect(vanguard?.moveSpeed).toBe(3);
      expect(vanguard?.hp).toBe(vanguard?.maxHp);
    });

    it('applies two distinct augments plus a duplicate id, stacking additively in augmentIds order', () => {
      const registry = createSeedRegistry();
      registry.loadAugment({ id: 'iron-plating', name: 'Iron Plating', armorDelta: 5 });
      registry.loadAugment({ id: 'swift-boots', name: 'Swift Boots', moveSpeedDelta: 2 });
      const build = buildWithAugments(['iron-plating', 'swift-boots', 'iron-plating']);

      const world = initWithRegistry(3, SEED, build, warbandB, registry);
      const vanguard = world.units[0];

      expect(vanguard?.armor).toBe(20); // 10 + 5 + 5
      expect(vanguard?.moveSpeed).toBe(5); // 3 + 2
      expect(vanguard?.maxHp).toBe(200);
      expect(vanguard?.hp).toBe(vanguard?.maxHp);
    });

    it('applies maxHpDelta and sets hp to the new maxHp', () => {
      const registry = createSeedRegistry();
      registry.loadAugment({ id: 'vital-surge', name: 'Vital Surge', maxHpDelta: 50 });
      const build = buildWithAugments(['vital-surge']);

      const world = initWithRegistry(3, SEED, build, warbandB, registry);
      const vanguard = world.units[0];

      expect(vanguard?.maxHp).toBe(250);
      expect(vanguard?.hp).toBe(250);
    });

    it('floors maxHp at 1, armor at 0, and moveSpeed at 1 when negative deltas would push below the floor', () => {
      const registry = createSeedRegistry();
      registry.loadAugment({
        id: 'lopsided',
        name: 'Lopsided',
        maxHpDelta: -1000,
        armorDelta: -1000,
        moveSpeedDelta: -1000,
      });
      const build = buildWithAugments(['lopsided']);

      const world = initWithRegistry(3, SEED, build, warbandB, registry);
      const vanguard = world.units[0];

      expect(vanguard?.maxHp).toBe(1);
      expect(vanguard?.armor).toBe(0);
      expect(vanguard?.moveSpeed).toBe(1);
      expect(vanguard?.hp).toBe(1);
    });

    it('throws loud on an unknown augmentId at init', () => {
      const registry = createSeedRegistry();
      const build = buildWithAugments(['not-a-real-augment']);

      expect(() => initWithRegistry(3, SEED, build, warbandB, registry)).toThrow(
        'Unknown augment id: not-a-real-augment',
      );
    });

    it('leaves a unit with no augmentIds unaffected (base role stats, stun/empower null)', () => {
      const world = init(VERSION, SEED, warbandA, warbandB);
      const vanguard = world.units[0];

      expect(vanguard?.maxHp).toBe(200);
      expect(vanguard?.armor).toBe(10);
      expect(vanguard?.moveSpeed).toBe(3);
      expect(vanguard?.stun).toBeNull();
      expect(vanguard?.empower).toBeNull();
    });
  });

  it('is deterministic and draws nothing from rng', () => {
    const worldOne = init(VERSION, SEED, warbandA, warbandB);
    const worldTwo = init(VERSION, SEED, warbandA, warbandB);

    expect(worldOne.units).toEqual(worldTwo.units);
    expect(worldOne.eventLog).toEqual(worldTwo.eventLog);

    const freshRng = mulberry32(SEED);
    const fromWorld = Array.from({ length: 5 }, () => worldOne.rng.next());
    const fromFresh = Array.from({ length: 5 }, () => freshRng.next());
    expect(fromWorld).toEqual(fromFresh);
  });
});
