import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { behaviorIds, roles, skills } from '@warwright/core';
import type { UnitBuild, Warband } from '@warwright/core';
import { downloadWarbandFile, readWarbandFile, tryParseWarband } from './warband-io.js';
import { loadWarband, saveWarband } from './persistence.js';

function firstOrThrow<T>(items: readonly T[], label: string): T {
  const [first] = items;
  if (first === undefined) {
    throw new Error(`No ${label} available`);
  }
  return first;
}

const DEFAULT_ROLE_ID = firstOrThrow(roles, 'roles').id;
const DEFAULT_BEHAVIOR_ID = firstOrThrow(behaviorIds, 'behaviors');

function createDefaultUnit(): UnitBuild {
  return {
    roleId: DEFAULT_ROLE_ID,
    skillIds: [],
    behaviorId: DEFAULT_BEHAVIOR_ID,
    position: { x: 0, y: 0 },
    augmentIds: [],
  };
}

function createDefaultWarband(): Warband {
  return { name: 'New Warband', units: [createDefaultUnit()] };
}

// Falls back to a fresh default on any storage/parse failure so a corrupt
// or missing localStorage entry never blocks the builder from loading.
function loadInitialWarband(): Warband {
  try {
    return loadWarband() ?? createDefaultWarband();
  } catch {
    return createDefaultWarband();
  }
}

export function WarbandBuilder() {
  const [warband, setWarband] = useState<Warband>(loadInitialWarband);
  const [importError, setImportError] = useState<string | null>(null);

  const validation = useMemo(() => tryParseWarband(warband), [warband]);

  function updateUnit(index: number, patch: Partial<UnitBuild>): void {
    setWarband((current) => ({
      ...current,
      units: current.units.map((unit, i) => (i === index ? { ...unit, ...patch } : unit)),
    }));
  }

  function toggleSkill(index: number, skillId: string): void {
    setWarband((current) => ({
      ...current,
      units: current.units.map((unit, i) => {
        if (i !== index) {
          return unit;
        }
        const hasSkill = unit.skillIds.includes(skillId);
        return {
          ...unit,
          skillIds: hasSkill
            ? unit.skillIds.filter((id) => id !== skillId)
            : [...unit.skillIds, skillId],
        };
      }),
    }));
  }

  function addUnit(): void {
    setWarband((current) => ({ ...current, units: [...current.units, createDefaultUnit()] }));
  }

  function removeUnit(index: number): void {
    setWarband((current) => ({
      ...current,
      units: current.units.filter((_, i) => i !== index),
    }));
  }

  function handleSave(): void {
    if (!validation.ok) {
      return;
    }
    saveWarband(warband);
  }

  function handleExport(): void {
    if (!validation.ok) {
      return;
    }
    downloadWarbandFile(validation.warband, 'warband.json');
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const imported = await readWarbandFile(file);
      setWarband(imported);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section>
      <h2>Warband Builder</h2>

      <label>
        Name
        <input
          value={warband.name}
          onChange={(event) =>
            setWarband((current) => ({ ...current, name: event.target.value }))
          }
        />
      </label>

      {warband.units.map((unit, index) => (
        <fieldset key={index}>
          <legend>Unit {index + 1}</legend>

          <label>
            Role
            <select
              value={unit.roleId}
              onChange={(event) => updateUnit(index, { roleId: event.target.value })}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Behavior
            <select
              value={unit.behaviorId}
              onChange={(event) => updateUnit(index, { behaviorId: event.target.value })}
            >
              {behaviorIds.map((behaviorId) => (
                <option key={behaviorId} value={behaviorId}>
                  {behaviorId}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Skills</legend>
            {skills.map((skill) => (
              <label key={skill.id}>
                <input
                  type="checkbox"
                  checked={unit.skillIds.includes(skill.id)}
                  onChange={() => toggleSkill(index, skill.id)}
                />
                {skill.name}
              </label>
            ))}
          </fieldset>

          <label>
            X
            <input
              type="number"
              value={unit.position.x}
              onChange={(event) =>
                updateUnit(index, {
                  position: { ...unit.position, x: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Y
            <input
              type="number"
              value={unit.position.y}
              onChange={(event) =>
                updateUnit(index, {
                  position: { ...unit.position, y: Number(event.target.value) },
                })
              }
            />
          </label>

          <button type="button" onClick={() => removeUnit(index)}>
            Remove unit
          </button>
        </fieldset>
      ))}

      <button type="button" onClick={addUnit}>
        Add unit
      </button>

      {!validation.ok && <p role="alert">{validation.error}</p>}
      {importError !== null && <p role="alert">{importError}</p>}

      <button type="button" onClick={handleSave} disabled={!validation.ok}>
        Save to browser
      </button>
      <button type="button" onClick={handleExport} disabled={!validation.ok}>
        Export JSON
      </button>
      <label>
        Import JSON
        <input type="file" accept="application/json" onChange={handleImport} />
      </label>
    </section>
  );
}
