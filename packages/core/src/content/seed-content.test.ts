import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EFFECT_KINDS, STATUS_KINDS } from '../sim/vocab.js';
import { parseRole, parseSkill, parseWarband } from './schemas.js';
import { roles } from './data/roles.js';
import { skills } from './data/skills.js';

// content/ -> src/ -> core/ -> packages/ -> repo root = four `../`.
const readWarband = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../builds/${name}`, import.meta.url)), 'utf8'),
  ) as unknown;

describe('seed roles', () => {
  it('has exactly 4 roles', () => {
    expect(roles.length).toBe(4);
  });

  it('parses every role', () => {
    for (const role of roles) {
      expect(() => parseRole(role)).not.toThrow();
    }
  });
});

describe('seed skills', () => {
  it('has exactly 6 skills', () => {
    expect(skills.length).toBe(6);
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

  it('covers every status kind', () => {
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

describe('seed warbands', () => {
  it('parses builds/warband-a.json', () => {
    expect(() => parseWarband(readWarband('warband-a.json'))).not.toThrow();
  });

  it('parses builds/warband-b.json', () => {
    expect(() => parseWarband(readWarband('warband-b.json'))).not.toThrow();
  });
});
