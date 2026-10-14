#!/usr/bin/env node
'use strict';

/**
 * Writes `scripts/compat/baseline-1.0.0.json`: the outcome of every formula of `corpus.json`, and
 * of the probes `harness.js` derives for every function name the current source adds, under every
 * registry shape of `harness.js`, computed by the built packages of a checkout. It ran against
 * 1.0.0 (`699d57e`, after `pnpm install` and `pnpm run build` in that checkout), with the packages
 * of this repository built so their core registry gives the added names; before it records, it
 * aborts unless both builds are what their sources build to. `runner/src/compat.spec.ts` requires
 * the source to produce the same outcomes.
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

const PACKAGE_DIRECTORIES = ['definitions', 'parser', 'runner', 'core-functions'];

/** The built packages of the checkout at `root`. */
function packagesAt(root) {
  return {
    definitions: require(path.join(root, 'definitions/dist/index.js')),
    parser: require(path.join(root, 'parser/dist/index.js')),
    runner: require(path.join(root, 'runner/dist/index.js')),
    coreFunctions: require(path.join(root, 'core-functions/dist/index.js')),
  };
}

/** Every file under `directory`, as paths relative to it. */
function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

/** Whether `exclude`, a package tsconfig pattern (`**\/*.suffix` or `src/dir/**`), matches. */
function excluded(patterns, relative) {
  return patterns.some((pattern) => {
    if (pattern.startsWith('**/*')) return relative.endsWith(pattern.slice(4));
    if (pattern.endsWith('/**')) return relative.startsWith(pattern.slice(0, -2));
    throw new Error(`cannot read the tsconfig exclude pattern ${pattern}`);
  });
}

/** The `KEY: 'value'` entries of the object literal `name` exports in `file`. */
function declaredConstants(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(`export const ${name} = {`);
  if (start < 0) throw new Error(`${file} declares no ${name}`);
  const body = text.slice(start, text.indexOf('\n}', start));
  return Object.fromEntries(
    [...body.matchAll(/^\s+(\w+): '([^']+)',?$/gm)].map((m) => [m[1], m[2]]),
  );
}

/**
 * Aborts unless the built packages of `root` are what its source builds to: every compiled source
 * file has a built file at least as new and every built file a source, both ways, and the built
 * signature ids and error codes are the ones the source declares, both ways. With `committed`, the
 * tracked sources must also be the checkout's commit.
 */
function checkBuiltFromSource(root, packages, committed) {
  const problems = [];
  if (committed) {
    const changed = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' },
    ).trim();
    if (changed !== '') problems.push(`tracked files differ from the commit:\n${changed}`);
  }
  for (const directory of PACKAGE_DIRECTORIES) {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(root, directory, 'tsconfig.json'), 'utf8'),
    );
    const patterns = tsconfig.exclude ?? [];
    const sources = filesUnder(path.join(root, directory, 'src'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
      .filter((file) => !excluded(patterns, path.join('src', file)));
    const built = new Set(
      filesUnder(path.join(root, directory, 'dist')).filter((file) => file.endsWith('.js')),
    );
    for (const source of sources) {
      const output = source.replace(/\.ts$/, '.js');
      if (!built.delete(output)) {
        problems.push(`${directory}/src/${source} has no built file`);
        continue;
      }
      const sourceTime = fs.statSync(path.join(root, directory, 'src', source)).mtimeMs;
      const builtTime = fs.statSync(path.join(root, directory, 'dist', output)).mtimeMs;
      if (builtTime < sourceTime)
        problems.push(`${directory}/dist/${output} is older than its source`);
    }
    for (const output of built) problems.push(`${directory}/dist/${output} has no source`);
  }
  const vocabularies = [
    ['builtin-signature-ids.ts', 'BuiltinSignatureIds'],
    ['errors.ts', 'FormulaErrorCodes'],
  ];
  for (const [file, name] of vocabularies) {
    const declared = declaredConstants(path.join(root, 'definitions/src', file), name);
    const builtValues = packages.definitions[name] ?? {};
    for (const key of new Set([...Object.keys(declared), ...Object.keys(builtValues)])) {
      if (declared[key] !== builtValues[key]) {
        problems.push(`${name}.${key}: source ${declared[key]}, built ${builtValues[key]}`);
      }
    }
  }
  if (problems.length > 0) {
    console.error(`the built packages of ${root} are not its source:\n${problems.join('\n')}`);
    process.exit(4);
  }
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
  checkBuiltFromSource(checkout, packages, true);
  const here = path.join(__dirname, '..', '..');
  const current = packagesAt(here);
  checkBuiltFromSource(here, current, false);
  const functionNames = coreFunctionNames(packages);
  const addedNames = addedFunctionNames(current, functionNames);
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
