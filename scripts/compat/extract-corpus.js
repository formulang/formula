#!/usr/bin/env node
'use strict';

/**
 * Writes `scripts/compat/corpus.json`: every formula of a checkout's spec files and docs, plus the
 * formulas of the compatibility probes listed below. It runs against 1.0.0 (`699d57e`), so the
 * corpus is the formulas 1.0.0 documented and tested, and the probes.
 *
 * Usage: node scripts/compat/extract-corpus.js <checkout> <commit>
 *
 * Spec files: the first argument of each call to a formula-taking helper when it is a string.
 * Docs: the same calls inside ts/js code blocks of every Markdown file, and every line of the
 * untyped code blocks of docs/language.md, which hold formulas annotated with `-- comments`.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const FORMULA_HELPERS = new Set([
  'compile',
  'evalFormula',
  'evalFormulaOutput',
  'evalOk',
  'evalOkWithOutput',
  'evalWithExpectedReturnType',
  'evalWithMaxLength',
  'evalWithValue',
  'parseFormula',
]);

/**
 * Formulas of the compatibility probes: the callable validation of re-versioned higher-order
 * functions, a higher-order function an embedder registers (`MAP_ALL`, compat shapes only), and a
 * name 1.1.0 adds written as a nested callable with a mode it does not list, which 1.0.0 resolves
 * only when the nested call runs on a list (and the second formula never runs).
 */
const PROBE_FORMULAS = [
  'FILTER(LIST("a"; "bb"); "LEN")',
  'FILTER(LIST(1; 2); "STARTS_WITH")',
  'EACH(LIST("a"); "LEN"; 1)',
  'REDUCE(0; LIST(1; 2); "LEN")',
  'FILTER_PROPERTY(value; "a"; "LEN")',
  'EACH(LIST("a"; "bb"); "LEN")',
  'EACH(LIST(1; 2); "UPPER")',
  'EACH(LIST(LIST("a")); "UPPER")',
  'FILTER(LIST(1; 2; 3); ">"; 1)',
  'FILTER(LIST(1; 2); value; 1)',
  'FILTER(LIST(1; 2); "NOPE"; 1)',
  'EACH(LIST(LIST(1)); "FILTER"; "NOPE")',
  'EACH(LIST(LIST(1; 2)); "FILTER"; ">"; 1)',
  'REDUCE(""; LIST("a"; "b"); "CONCAT")',
  'SORT_BY_PROPERTY(value; "a")',
  'SORT_BY_PROPERTY(value; value)',
  'MAP_ALL(LIST("a"; "bb"); "LEN")',
  'MAP_ALL(LIST(1; 2); "NOPE")',
  'MAP_ALL(LIST(1); value)',
  'MAP_ALL(LIST("a"); "LEN"; 1)',
  'MAP_ALL(LIST(LIST(1; 2)); "LEN")',
  'MAP_ALL(LIST(1; 2); ">")',
  'EACH(value; "EACH"; "WORD_COUNT"; "whitespce")',
  'IF(FALSE; EACH(LIST(LIST("a b")); "EACH"; "WORD_COUNT"; "whitespce"); EMPTY())',
];

function walk(dir, accept, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

function helperStrings(fileName, text) {
  const formulas = [];
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      const first = node.arguments[0];
      if (
        FORMULA_HELPERS.has(name) &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
        formulas.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return formulas;
}

function codeBlocks(markdown) {
  const blocks = [];
  const fence = /^```([a-z]*)\s*$/;
  let current = null;
  for (const line of markdown.split('\n')) {
    const match = fence.exec(line);
    if (current === null) {
      if (match) current = { language: match[1], lines: [] };
    } else if (/^```\s*$/.test(line)) {
      blocks.push(current);
      current = null;
    } else {
      current.lines.push(line);
    }
  }
  return blocks;
}

/** Writes `value` as JSON formatted by the repository prettier config, so prettier:check passes. */
async function writeFormattedJson(target, value) {
  const prettier = require('prettier');
  const options = (await prettier.resolveConfig(target)) ?? {};
  const text = await prettier.format(JSON.stringify(value), { ...options, parser: 'json' });
  fs.writeFileSync(target, text);
}

async function main() {
  const [checkoutArg, commit] = process.argv.slice(2);
  if (!checkoutArg || !commit) {
    console.error('usage: node scripts/compat/extract-corpus.js <checkout> <commit>');
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

  const seen = new Set();
  const formulas = [];
  const add = (sourceText, origin) => {
    if (sourceText.trim().length === 0 || seen.has(sourceText)) return;
    seen.add(sourceText);
    formulas.push({ source: sourceText, origin });
  };

  const specFiles = ['definitions', 'parser', 'runner', 'core-functions']
    .flatMap((pkg) => walk(path.join(checkout, pkg, 'src'), (name) => name.endsWith('.spec.ts')))
    .sort();
  for (const file of specFiles) {
    const relative = path.relative(checkout, file);
    for (const formula of helperStrings(file, fs.readFileSync(file, 'utf8')))
      add(formula, relative);
  }

  const docFiles = walk(checkout, (name) => name.endsWith('.md')).sort();
  for (const file of docFiles) {
    const relative = path.relative(checkout, file);
    for (const block of codeBlocks(fs.readFileSync(file, 'utf8'))) {
      if (['ts', 'typescript', 'js', 'javascript'].includes(block.language)) {
        for (const formula of helperStrings(`${relative}.ts`, block.lines.join('\n'))) {
          add(formula, relative);
        }
      } else if (block.language === '' && relative === path.join('docs', 'language.md')) {
        for (const line of block.lines) add(line.replace(/\s+--.*$/, '').trim(), relative);
      }
    }
  }

  for (const formula of PROBE_FORMULAS) add(formula, 'compatibility probe');

  const corpus = {
    provenance: {
      extractor: 'scripts/compat/extract-corpus.js',
      commit,
      specFiles: specFiles.length,
      docFiles: docFiles.length,
    },
    formulas,
  };
  const target = path.join(__dirname, 'corpus.json');
  await writeFormattedJson(target, corpus);
  console.log(`wrote ${formulas.length} formulas to ${path.relative(process.cwd(), target)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
