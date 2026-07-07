import { behaviorIds, parseWarband, roles, skills } from '@warwright/core';
import type { UnitBuild, Warband } from '@warwright/core';

// Mirrors builds/warband-a.json and warband-b.json byte for byte: 2-space
// indent for the outer shape, skillIds and position compacted onto one
// line. Hand-written to match that exact layout; JSON.stringify(x, null, 2)
// would expand skillIds/position across multiple lines instead.
function serializeUnit(unit: UnitBuild): string {
  const skillIds = unit.skillIds.map((id) => JSON.stringify(id)).join(', ');
  return [
    '    {',
    `      "roleId": ${JSON.stringify(unit.roleId)},`,
    `      "skillIds": [${skillIds}],`,
    `      "behaviorId": ${JSON.stringify(unit.behaviorId)},`,
    `      "position": { "x": ${unit.position.x}, "y": ${unit.position.y} }`,
    '    }',
  ].join('\n');
}

export function serializeWarband(warband: Warband): string {
  const units = warband.units.map(serializeUnit).join(',\n');
  return `{\n  "name": ${JSON.stringify(warband.name)},\n  "units": [\n${units}\n  ]\n}\n`;
}

export function deserializeWarband(json: string): Warband {
  return parseWarband(JSON.parse(json));
}

export type WarbandParseResult = { ok: true; warband: Warband } | { ok: false; error: string };

// Live-validation for the builder's in-progress draft: parseWarband's own
// shape checks (non-empty name, >=1 unit, position in bounds), surfaced as
// a loud message instead of a thrown exception so the UI can render it.
export function tryParseWarband(data: unknown): WarbandParseResult {
  try {
    return { ok: true, warband: parseWarband(data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const KNOWN_ROLE_IDS = new Set(roles.map((role) => role.id));
const KNOWN_SKILL_IDS = new Set(skills.map((skill) => skill.id));
const KNOWN_BEHAVIOR_IDS = new Set<string>(behaviorIds);

// parseWarband validates shape only: a well-formed but nonexistent id
// passes it and would only fail later, at runMatch time. This cross-checks
// every id in a warband against core's public content enumeration so an
// imported file with such an id can be rejected up front, loudly.
export function findUnknownContentIds(warband: Warband): string[] {
  const problems: string[] = [];

  warband.units.forEach((unit, index) => {
    if (!KNOWN_ROLE_IDS.has(unit.roleId)) {
      problems.push(`unit ${index}: unknown roleId "${unit.roleId}"`);
    }
    if (!KNOWN_BEHAVIOR_IDS.has(unit.behaviorId)) {
      problems.push(`unit ${index}: unknown behaviorId "${unit.behaviorId}"`);
    }
    for (const skillId of unit.skillIds) {
      if (!KNOWN_SKILL_IDS.has(skillId)) {
        problems.push(`unit ${index}: unknown skillId "${skillId}"`);
      }
    }
  });

  return problems;
}

export async function readWarbandFile(file: File): Promise<Warband> {
  const text = await file.text();
  const warband = deserializeWarband(text);
  const unknownIds = findUnknownContentIds(warband);
  if (unknownIds.length > 0) {
    throw new Error(`Unknown content id(s) in imported warband: ${unknownIds.join('; ')}`);
  }
  return warband;
}

export function downloadWarbandFile(warband: Warband, filename: string): void {
  const blob = new Blob([serializeWarband(warband)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
