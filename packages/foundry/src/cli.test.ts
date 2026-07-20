import { describe, expect, it } from 'vitest';
import { formatReport, parseCliArgs } from './cli.js';
import type { ValidateReport } from './validate.js';

describe('parseCliArgs', () => {
  it('parses "validate <dir>"', () => {
    expect(parseCliArgs(['validate', 'packages/foundry/submissions/sample-aggro'])).toEqual({
      dir: 'packages/foundry/submissions/sample-aggro',
    });
  });

  it('parses a bare "<dir>" (no "validate" token) -- the form the root foundry:validate script invokes', () => {
    expect(parseCliArgs(['packages/foundry/submissions/sample-aggro'])).toEqual({
      dir: 'packages/foundry/submissions/sample-aggro',
    });
  });

  it('throws when the submission dir is missing', () => {
    expect(() => parseCliArgs(['validate'])).toThrow(/validate/i);
    expect(() => parseCliArgs([])).toThrow(/validate/i);
  });

  it('throws on extra, unrecognized positional arguments', () => {
    expect(() => parseCliArgs(['validate', 'a-dir', 'extra'])).toThrow(/validate/i);
  });
});

describe('formatReport', () => {
  it('formats a passing report with the stage-3 win rate', () => {
    const report: ValidateReport = {
      ok: true,
      submissionId: 'sample-aggro',
      manifest: {
        id: 'sample-aggro',
        author: 'foundry-fixtures',
        entry: 'behavior.ts',
        build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
        shape: 'general',
      },
      stage3: {
        stage: 3,
        status: 'pass',
        submissionId: 'sample-aggro',
        wins: 25,
        total: 25,
        winRate: 1,
        threshold: 0.6,
      },
    };

    const text = formatReport(report);

    expect(text).toMatch(/pass/i);
    expect(text).toMatch(/sample-aggro/);
    expect(text).toMatch(/25\/25/);
  });

  it('formats a failing report with the failing stage and reason', () => {
    const report: ValidateReport = {
      ok: false,
      submissionId: 'weak-idle',
      stage: 3,
      reason: 'Stage 3 (gauntlet) rejected submission "weak-idle": win rate 0 is below the bar',
    };

    const text = formatReport(report);

    expect(text).toMatch(/fail/i);
    expect(text).toMatch(/stage 3/i);
    expect(text).toContain('weak-idle');
  });
});
