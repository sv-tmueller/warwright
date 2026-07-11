import type { ChangeEvent } from 'react';
import type { Warband } from '@warwright/core';
import { readWarbandFile } from './warband-io.js';
import type { WarbandSource } from './match-setup.js';

export type UploadedFile = { readonly warband: Warband; readonly fileName: string };

export type MatchSetupSide = 'A' | 'B';

export type MatchSetupProps = {
  readonly seed: string;
  readonly onSeedChange: (seed: string) => void;
  readonly sourceA: WarbandSource;
  readonly sourceB: WarbandSource;
  readonly uploadedA: UploadedFile | null;
  readonly uploadedB: UploadedFile | null;
  readonly onSourceChange: (side: MatchSetupSide, source: WarbandSource) => void;
  readonly onUploadSuccess: (side: MatchSetupSide, warband: Warband, fileName: string) => void;
  readonly onUploadError: (message: string) => void;
  readonly sampleAName: string;
  readonly sampleBName: string;
  readonly error: string | null;
  readonly onRun: () => void;
};

type SelectValue = 'sample-a' | 'sample-b' | 'draft' | 'upload';

function sourceToSelectValue(source: WarbandSource): SelectValue {
  if (source.kind === 'sample') {
    return source.id === 'a' ? 'sample-a' : 'sample-b';
  }
  return source.kind;
}

/**
 * Thin, untested-by-convention component (see the sub-plan on issue #93,
 * mirroring the Hud/EventFeed pattern): all resolution logic lives in
 * match-setup.ts, all validated import logic lives in warband-io.ts. This
 * component only wires user input to those pure functions and to the
 * onRun commit point - it never runs a match itself.
 */
function SideSetup({
  side,
  source,
  uploaded,
  sampleAName,
  sampleBName,
  onSourceChange,
  onUploadSuccess,
  onUploadError,
}: {
  readonly side: MatchSetupSide;
  readonly source: WarbandSource;
  readonly uploaded: UploadedFile | null;
  readonly sampleAName: string;
  readonly sampleBName: string;
  readonly onSourceChange: (source: WarbandSource) => void;
  readonly onUploadSuccess: (warband: Warband, fileName: string) => void;
  readonly onUploadError: (message: string) => void;
}) {
  function handleSelectChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value as SelectValue;
    switch (value) {
      case 'sample-a':
        onSourceChange({ kind: 'sample', id: 'a' });
        return;
      case 'sample-b':
        onSourceChange({ kind: 'sample', id: 'b' });
        return;
      case 'draft':
        onSourceChange({ kind: 'draft' });
        return;
      case 'upload':
        if (uploaded) {
          onSourceChange({ kind: 'upload', warband: uploaded.warband, fileName: uploaded.fileName });
        }
        return;
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const warband = await readWarbandFile(file);
      onUploadSuccess(warband, file.name);
    } catch (error) {
      onUploadError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <fieldset>
      <legend>Side {side}</legend>
      <label>
        Warband
        <select value={sourceToSelectValue(source)} onChange={handleSelectChange}>
          <option value="sample-a">Sample: {sampleAName}</option>
          <option value="sample-b">Sample: {sampleBName}</option>
          <option value="draft">Builder draft</option>
          <option value="upload" disabled={uploaded === null}>
            Uploaded file{uploaded ? `: ${uploaded.fileName}` : ''}
          </option>
        </select>
      </label>
      <label>
        Upload JSON
        <input type="file" accept="application/json" onChange={handleFileChange} />
      </label>
    </fieldset>
  );
}

export function MatchSetup({
  seed,
  onSeedChange,
  sourceA,
  sourceB,
  uploadedA,
  uploadedB,
  onSourceChange,
  onUploadSuccess,
  onUploadError,
  sampleAName,
  sampleBName,
  error,
  onRun,
}: MatchSetupProps) {
  return (
    <section>
      <h2>Match Setup</h2>
      <label>
        Seed
        <input value={seed} onChange={(event) => onSeedChange(event.target.value)} />
      </label>
      <SideSetup
        side="A"
        source={sourceA}
        uploaded={uploadedA}
        sampleAName={sampleAName}
        sampleBName={sampleBName}
        onSourceChange={(source) => onSourceChange('A', source)}
        onUploadSuccess={(warband, fileName) => onUploadSuccess('A', warband, fileName)}
        onUploadError={onUploadError}
      />
      <SideSetup
        side="B"
        source={sourceB}
        uploaded={uploadedB}
        sampleAName={sampleAName}
        sampleBName={sampleBName}
        onSourceChange={(source) => onSourceChange('B', source)}
        onUploadSuccess={(warband, fileName) => onUploadSuccess('B', warband, fileName)}
        onUploadError={onUploadError}
      />
      {error !== null && <p role="alert">{error}</p>}
      <button type="button" onClick={onRun}>
        Run match
      </button>
    </section>
  );
}
