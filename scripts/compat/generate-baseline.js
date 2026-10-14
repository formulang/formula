#!/usr/bin/env node
'use strict';

/**
 * Writes `scripts/compat/baseline-1.0.0.json`: the outcome of every formula of `corpus.json`, and
 * of the probes `harness.js` derives for every function name the current source adds, under every
 * registry shape of `harness.js`, computed by the built packages of a checkout. It ran against
 * 1.0.0 (`699d57e`, after `pnpm install` and `pnpm run build` in that checkout), with the packages
 * of this repository built so their core registry gives the added names;
 * `runner/src/compat.spec.ts` requires the source to produce the same outcomes.
 *
 * Usage: node scripts/compat/generate-baseline.js <checkout> <commit>
 *
 * Each formula stores the outcome most shapes give (`outcome`) and, under `byShape`, the outcome of
 * every shape that gives another.
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  addedFunctionNames,
  coreFunctionNames,
  formulasFor,
  runCorpus,
  shapeNames,
} = require('./harness');

/** The built packages of the checkout at `root`. */
function packagesAt(root) {
  return {
    definitions: require(path.join(root, 'definitions/dist/index.js')),
    parser: require(path.join(root, 'parser/dist/index.js')),
    runner: require(path.join(root, 'runner/dist/index.js')),
    coreFunctions: require(path.join(root, 'core-functions/dist/index.js')),
  };
}

/** The outcome most shapes give, and every other shape's own. */
function storedOutcomes(source, shapes, outcomes) {
  const serialised = outcomes.map((outcome) => JSON.stringify(outcome));
  const counts = new Map();
  for (const text of serialised) counts.set(text, (counts.get(text) ?? 0) + 1);
  let common = serialised[0];
  for (const [text, count] of counts) {
    if (count > counts.get(common)) common = text;
  }
  const entry = { source, outcome: JSON.parse(common) };
  const others = shapes.filter((_, index) => serialised[index] !== common);
  if (others.length > 0) {
    entry.byShape = Object.fromEntries(
      others.map((shape) => [shape, outcomes[shapes.indexOf(shape)]]),
    );
  }
  return entry;
}

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
  const packages = packagesAt(checkout);
  const functionNames = coreFunctionNames(packages);
  const addedNames = addedFunctionNames(
    packagesAt(path.join(__dirname, '..', '..')),
    functionNames,
  );
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
  const shapes = shapeNames(addedNames);
  const byShape = await runCorpus(packages, corpus, addedNames);

  const formulas = formulasFor(corpus, addedNames).map((source, index) =>
    storedOutcomes(
      source,
      shapes,
      shapes.map((shape) => byShape[shape][index]),
    ),
  );

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
    shapes,
    functionNames,
    addedFunctionNames: addedNames,
    formulas,
  };
  const target = path.join(__dirname, 'baseline-1.0.0.json');
  fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`);
  const differing = formulas.filter((f) => f.byShape).length;
  console.log(
    `wrote ${formulas.length} outcomes under ${shapes.length} shapes (${differing} differ by shape) to ${path.relative(process.cwd(), target)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
