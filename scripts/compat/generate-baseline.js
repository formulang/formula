#!/usr/bin/env node
'use strict';

/**
 * Writes `scripts/compat/baseline-1.0.0.json`: the outcome of every formula of `corpus.json` under
 * every registry shape of `harness.js`, computed by the built packages of a checkout. It ran once,
 * against 1.0.0 (`699d57e`, after `pnpm install` and `pnpm run build` in that checkout);
 * `runner/src/compat.spec.ts` requires the source to produce the same outcomes.
 *
 * Usage: node scripts/compat/generate-baseline.js <checkout> <commit>
 *
 * A formula whose outcome is the same under every shape is stored once (`outcome`), otherwise per
 * shape (`byShape`).
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SHAPE_NAMES, coreFunctionNames, runCorpus } = require('./harness');

async function main() {
  const [checkoutArg, commit] = process.argv.slice(2);
  if (!checkoutArg || !commit) {
    console.error('usage: node scripts/compat/generate-baseline.js <checkout> <commit>');
    process.exit(2);
  }
  const checkout = path.resolve(checkoutArg);
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== commit) {
    console.error(`checkout is at ${head}, not ${commit}`);
    process.exit(3);
  }
  const packages = {
    definitions: require(path.join(checkout, 'definitions/dist/index.js')),
    parser: require(path.join(checkout, 'parser/dist/index.js')),
    runner: require(path.join(checkout, 'runner/dist/index.js')),
    coreFunctions: require(path.join(checkout, 'core-functions/dist/index.js')),
  };
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
  const byShape = await runCorpus(packages, corpus);

  const formulas = corpus.formulas.map(({ source }, index) => {
    const outcomes = SHAPE_NAMES.map((shape) => byShape[shape][index]);
    const first = JSON.stringify(outcomes[0]);
    if (outcomes.every((outcome) => JSON.stringify(outcome) === first)) {
      return { source, outcome: outcomes[0] };
    }
    return { source, byShape: Object.fromEntries(SHAPE_NAMES.map((s, i) => [s, outcomes[i]])) };
  });

  const baseline = {
    provenance: {
      generator: 'scripts/compat/generate-baseline.js',
      commit,
      // Over the formula list, not the file text, so reformatting the file keeps it valid.
      corpusSha256: crypto
        .createHash('sha256')
        .update(JSON.stringify(corpus.formulas.map((f) => f.source)))
        .digest('hex'),
      node: process.version,
    },
    shapes: SHAPE_NAMES,
    functionNames: coreFunctionNames(packages),
    formulas,
  };
  const target = path.join(__dirname, 'baseline-1.0.0.json');
  fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`);
  const differing = formulas.filter((f) => f.byShape).length;
  console.log(
    `wrote ${formulas.length} outcomes (${differing} differ by shape) to ${path.relative(process.cwd(), target)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
