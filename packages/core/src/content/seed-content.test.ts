import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EFFECT_KINDS, STATUS_KINDS } from '../sim/vocab.js';
import { runMatch } from '../sim/match.js';
import { parseAugment, parseRole, parseSkill, parseWarband } from './schemas.js';
import { roles } from './data/roles.js';
import { skills } from './data/skills.js';
import { augments } from './data/augments.js';

// content/ -> src/ -> core/ -> packages/ -> repo root = four `../`.
const readWarband = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../builds/${name}`, import.meta.url)), 'utf8'),
  ) as unknown;

describe('seed roles', () => {
  it('has exactly 6 roles', () => {
    expect(roles.length).toBe(6);
  });

  it('parses every role', () => {
    for (const role of roles) {
      expect(() => parseRole(role)).not.toThrow();
    }
  });

  it('includes a skirmisher role: a fast, fragile harasser', () => {
    const skirmisher = roles.find((r) => r.id === 'skirmisher');
    expect(skirmisher).toBeDefined();
    expect(() => parseRole(skirmisher)).not.toThrow();

    const vanguard = roles.find((r) => r.id === 'vanguard');
    expect(vanguard).toBeDefined();
    // Fast: quicker than every other role.
    for (const role of roles) {
      if (role.id === 'skirmisher') continue;
      expect(skirmisher!.moveSpeed).toBeGreaterThan(role.moveSpeed);
    }
    // Fragile: lower effective bulk (hp + armor) than the melee frontline.
    expect(skirmisher!.maxHp + skirmisher!.armor).toBeLessThan(
      vanguard!.maxHp + vanguard!.armor,
    );
  });

  it('includes a bulwark role: a slow, high-hp frontline', () => {
    const bulwark = roles.find((r) => r.id === 'bulwark');
    expect(bulwark).toBeDefined();
    expect(() => parseRole(bulwark)).not.toThrow();

    // Slow: no faster than every other role.
    for (const role of roles) {
      if (role.id === 'bulwark') continue;
      expect(bulwark!.moveSpeed).toBeLessThanOrEqual(role.moveSpeed);
    }
    // High-HP: strictly tankier (hp + armor) than every other role.
    for (const role of roles) {
      if (role.id === 'bulwark') continue;
      expect(bulwark!.maxHp + bulwark!.armor).toBeGreaterThan(role.maxHp + role.armor);
    }
  });
});

describe('seed skills', () => {
  it('has exactly 10 skills', () => {
    expect(skills.length).toBe(10);
  });

  it('parses every skill', () => {
    for (const skill of skills) {
      expect(() => parseSkill(skill)).not.toThrow();
    }
  });

  it('covers every effect kind', () => {
    const effectKinds = new Set(skills.map((s) => s.effect.kind));
    for (const kind of EFFECT_KINDS) {
      expect(effectKinds.has(kind)).toBe(true);
    }
  });

  it('covers every status kind (Slice C added Crippling Strike/stun and Rally/empower)', () => {
    const statuses = new Set(
      skills
        .filter((s) => s.effect.kind === 'apply-status')
        .map((s) => (s.effect as { status: (typeof STATUS_KINDS)[number] }).status),
    );
    for (const status of STATUS_KINDS) {
      expect(statuses.has(status)).toBe(true);
    }
  });
});

describe('seed augments', () => {
  it('has no augment instances yet (they land in Slice D/#150)', () => {
    expect(augments.length).toBe(0);
  });

  it('parses every augment', () => {
    for (const augment of augments) {
      expect(() => parseAugment(augment)).not.toThrow();
    }
  });
});

describe('skirmisher and bulwark resolve in a match', () => {
  it('reaches a non-draw winner via elimination using only existing engine primitives', () => {
    const result = runMatch({
      version: 1,
      seed: 42,
      buildA: {
        name: 'Skirmisher Test',
        units: [
          {
            roleId: 'skirmisher',
            skillIds: [],
            behaviorId: 'aggro-lowest-hp',
            position: { x: 0, y: 0 },
          },
        ],
      },
      buildB: {
        name: 'Bulwark Test',
        units: [
          {
            roleId: 'bulwark',
            skillIds: [],
            behaviorId: 'aggro-lowest-hp',
            position: { x: 10, y: 0 },
          },
        ],
      },
    });

    expect(result.winner).not.toBe('draw');
    expect(result.eventLog.some((e) => e.kind === 'attack')).toBe(true);
    expect(result.eventLog).toContainEqual({
      kind: 'death',
      tick: expect.any(Number),
      unitId: expect.any(Number),
    });
  });
});

describe('seed warbands', () => {
  it('parses builds/warband-a.json', () => {
    expect(() => parseWarband(readWarband('warband-a.json'))).not.toThrow();
  });

  it('parses builds/warband-b.json', () => {
    expect(() => parseWarband(readWarband('warband-b.json'))).not.toThrow();
  });
});
