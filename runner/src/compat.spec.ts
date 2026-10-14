import * as coreFunctions from '@formulang/core-functions';
import * as definitions from '@formulang/definitions';
import * as parser from '@formulang/parser';
import { createHash } from 'node:crypto';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import corpus from '../../scripts/compat/corpus.json';
import harness from '../../scripts/compat/harness.js';
import * as runner from './index';

/** The commit both committed fixtures were generated from: the 1.0.0 release. */
const BASELINE_COMMIT = '699d57efa2c51e8f32747b1aa081c00538c0fa05';

const packages = { definitions, parser, runner, coreFunctions };

type Outcome = unknown;
type BaselineFormula = { source: string; outcome?: Outcome; byShape?: Record<string, Outcome> };

describe('compatibility with 1.0.0', () => {
  it('compares against a baseline generated from 1.0.0 for exactly this corpus', () => {
    expect(corpus.provenance.commit).toBe(BASELINE_COMMIT);
    expect(baseline.provenance.commit).toBe(BASELINE_COMMIT);
    const sources = corpus.formulas.map((f: { source: string }) => f.source);
    const sha = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
    expect(baseline.provenance.corpusSha256).toBe(sha);
    expect(baseline.formulas.map((f: BaselineFormula) => f.source)).toStrictEqual(sources);
    expect(baseline.shapes).toStrictEqual(harness.SHAPE_NAMES);
    // Not vacuous: the 1.0.0 spec files, docs and probes, with outcomes some shapes change.
    expect(sources.length).toBeGreaterThan(400);
    expect(baseline.formulas.filter((f: BaselineFormula) => f.byShape).length).toBeGreaterThan(0);
  });

  it('holds no formula that calls or references a function 1.1.0 adds', () => {
    const added = harness
      .coreFunctionNames(packages)
      .filter((name: string) => !baseline.functionNames.includes(name));
    expect(added.length).toBeGreaterThan(0);
    const names = added.join('|');
    const reference = new RegExp(`\\b(${names})\\s*\\(|"(${names})"`);
    const offending = corpus.formulas
      .map((f: { source: string }) => f.source)
      .filter((source: string) => reference.test(source));
    expect(offending).toStrictEqual([]);
  });

  it('gives every corpus formula its 1.0.0 outcome under every registry shape', async () => {
    const byShape = await harness.runCorpus(packages, corpus);
    const differences: Array<{ shape: string; source: string; want: Outcome; got: Outcome }> = [];
    baseline.formulas.forEach((expected: BaselineFormula, index: number) => {
      for (const shape of harness.SHAPE_NAMES) {
        const want = expected.byShape ? expected.byShape[shape] : expected.outcome;
        const got = byShape[shape][index];
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          differences.push({ shape, source: expected.source, want, got });
        }
      }
    });
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
  }, 120_000);
});
