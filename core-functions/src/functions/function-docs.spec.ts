import * as coreFunctions from '@formulang/core-functions';
import { readFileSync } from 'node:fs';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import { evalErrors, evalOkWithOutput } from '../test-helpers/eval-formula';

/**
 * docs/functions.md states each function added to 1.0.0 as rule bullets, each carrying examples,
 * and one sentence naming what it leaves unspecified. This spec reads the document as the
 * repository holds it and runs every example in it through the real runtime, so a rule whose
 * example is wrong, and a rule with no example, are red.
 */

/** docs/functions.md, as the repository holds it. */
const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

/** The sentence that closes each added function's section. */
const UNSPECIFIED = 'Unspecified: ';

/**
 * The examples outside the added functions' sections that this spec does not run, each with the
 * reason, by the source they evaluate.
 */
const NOT_RUN: Record<string, string> = {
  'ROUND(EXP(1); 8)': 'the comment marks its value with `~`',
  'NOW().date.iso': 'the value is the current date',
  'TODAY().iso': 'the value is the current date',
  'SORT_BY_PROPERTY(value; "a")': 'the variable is named, not given',
  'SORT_BY_PROPERTY(value; "a.b")': 'the variable is named, not given',
  'FILTER_PROPERTY(value; "a.b"; "="; 2)': 'the variable is named, not given',
};

type Section = { name: string; line: number; lines: string[] };

type Example = {
  helper: 'evalOk' | 'evalErrors';
  source: string;
  /** `undefined` when the call names a variable it does not give (`{ value }`). */
  variables?: Record<string, unknown>;
  comment: string;
  line: number;
};

type Bullet = { line: number; text: string; examples: Example[] };

/** The sections that start with `### NAME`, each running to the next heading or rule. */
function readSections(docs: string): Section[] {
  const all = docs.split('\n');
  const found: Section[] = [];
  for (let index = 0; index < all.length; index++) {
    const heading = /^### ([A-Z0-9_]+)$/.exec(all[index]);
    if (heading === null) continue;
    let end = index + 1;
    while (end < all.length && !/^(#{1,3} |---$)/.test(all[end])) end += 1;
    found.push({ name: heading[1], line: index + 1, lines: all.slice(index + 1, end) });
  }
  return found;
}

/** The source and the variables of an example's call, read as JavaScript reads its literals. */
function readCall(call: string): { source: string; variables?: Record<string, unknown> } {
  const capture = (source: string, variables: Record<string, unknown> = {}) => ({
    source,
    variables,
  });
  try {
    return new Function('evalOk', 'evalErrors', `return ${call};`)(capture, capture) as {
      source: string;
      variables: Record<string, unknown>;
    };
  } catch {
    // A variable named but not given: the source alone, from the call's first literal.
    const literal = /^\w+\(\s*('(?:[^'\\]|\\.)*')/.exec(call);
    expect(literal, call).not.toBeNull();
    return { source: new Function(`return ${(literal as RegExpExecArray)[1]};`)() as string };
  }
}

/**
 * The example statements of `lines` (numbered from `first`): `await evalOk(source, variables?);`
 * or `await evalErrors(source, variables?);`, as a rule followed by `// ` and what it gives,
 * written on one line or across several.
 */
function readExamples(lines: string[], first: number): Example[] {
  const found: Example[] = [];
  for (let index = 0; index < lines.length; index++) {
    const start = /^\s*await (evalOk|evalErrors)\(/.exec(lines[index]);
    if (start === null) continue;
    let end = index;
    while (end < lines.length && !/\);\s*(\/\/ .*)?$/.test(lines[end])) end += 1;
    expect(end, `line ${first + index}: an example that does not end`).toBeLessThan(lines.length);
    const statement = lines.slice(index, end + 1).join('\n');
    const split = /^\s*await ((?:evalOk|evalErrors)\([\s\S]*\));\s*(?:\/\/ (.*))?$/.exec(statement);
    expect(split, `line ${first + index}: ${statement}`).not.toBeNull();
    const [, call, comment] = split as RegExpExecArray;
    found.push({
      helper: start[1] as Example['helper'],
      ...readCall(call),
      comment: (comment ?? '').trim(),
      line: first + index,
    });
    index = end;
  }
  return found;
}

/**
 * The rule bullets of an added function's section: its signature line, then top-level bullets,
 * each with its examples in indented code blocks, then the one `Unspecified: ` sentence. Any
 * other line at the left margin, and any nested bullet, is a claim outside a rule and fails.
 */
function readBullets(section: Section): { bullets: Bullet[]; unspecified: string } {
  const where = (offset: number) => `${section.name}, line ${section.line + 1 + offset}`;
  const lines = section.lines;
  let index = 0;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  expect(lines[index], `${where(index)}: the signature`).toMatch(/^`[A-Z0-9_]+\(.*\) -> .+`$/);
  index += 1;
  const bullets: Bullet[] = [];
  let unspecified = '';
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
    } else if (line.startsWith('- ')) {
      let end = index + 1;
      while (end < lines.length && (lines[end].trim() === '' || lines[end].startsWith('  '))) {
        expect(lines[end], `${where(end)}: a nested bullet`).not.toMatch(/^\s+[-*+] /);
        end += 1;
      }
      const body = lines.slice(index, end);
      bullets.push({
        line: section.line + 1 + index,
        text: body
          .filter((part) => !part.startsWith('  ```') && !/^\s+await /.test(part))
          .join(' '),
        examples: readExamples(body, section.line + 1 + index),
      });
      index = end;
    } else {
      expect(line, `${where(index)}: prose outside a rule bullet`).toMatch(/^Unspecified: /);
      expect(unspecified, `${where(index)}: a second unspecified sentence`).toBe('');
      let end = index;
      while (end < lines.length && lines[end].trim() !== '') end += 1;
      unspecified = lines.slice(index, end).join(' ');
      index = end;
    }
  }
  expect(unspecified, `${section.name}: the unspecified sentence`).not.toBe('');
  return { bullets, unspecified };
}

/** The value a comment states as JSON; a comment that is not JSON fails. */
function readJson(text: string, where: string): unknown {
  let value: unknown;
  expect(() => {
    value = JSON.parse(text);
  }, `${where}: the comment ${text}`).not.toThrow();
  return value;
}

/**
 * Runs one example. An `evalOk` comment states the value, and for an added function the warning
 * too (`null with a TYPE warning`; none stated is none given); the comments of 1.0.0's examples
 * may add a note in brackets after the value. An `evalErrors` comment states the error codes.
 */
async function check(example: Example, added: boolean): Promise<void> {
  const where = `line ${example.line}: ${example.source}`;
  expect(example.variables, `${where}: the variables`).toBeDefined();
  if (example.helper === 'evalErrors') {
    expect(await evalErrors(example.source, example.variables), where).toStrictEqual(
      readJson(example.comment, where),
    );
    return;
  }
  const withWarning = added ? /^(.*) with an? ([A-Z_]+) warning$/.exec(example.comment) : null;
  const valueText = withWarning === null ? example.comment : withWarning[1];
  const stated = readJson(added ? valueText : valueText.replace(/\s+\(.*\)$/, ''), where);
  const { output, value } = await evalOkWithOutput(example.source, example.variables);
  expect(value, where).toStrictEqual(stated);
  if (!added) return;
  const warnings = (output.warnings ?? []).map((warning) => warning.code);
  expect(warnings, `${where}: warnings`).toStrictEqual(withWarning ? [withWarning[2]] : []);
}

const SECTIONS = readSections(DOCS);
const BY_NAME = new Map(SECTIONS.map((section) => [section.name, section]));

describe('docs/functions.md examples', () => {
  it('reads every example statement on the page, each inside a function section', () => {
    const statements = DOCS.split('\n').filter((line) => /^\s*await /.test(line)).length;
    const read = SECTIONS.flatMap((section) => readExamples(section.lines, section.line + 1));
    expect(statements).toBeGreaterThan(0);
    expect(read.length).toBe(statements);
  });
});

describe('docs/functions.md for the functions added to 1.0.0', () => {
  it('documents each added function, and states rules this way for no other', () => {
    expect(ADDED.length).toBeGreaterThan(0);
    expect(ADDED.filter((name) => !BY_NAME.has(name))).toStrictEqual([]);
    const stated = SECTIONS.filter((section) =>
      section.lines.some((line) => line.startsWith(UNSPECIFIED)),
    ).map((section) => section.name);
    expect([...stated].sort()).toStrictEqual([...ADDED].sort());
  });

  for (const name of ADDED) {
    it(`${name}: every rule bullet has an example, and every example answers as written`, async () => {
      const section = BY_NAME.get(name);
      expect(section, `${name}: its section`).toBeDefined();
      const { bullets } = readBullets(section as Section);
      expect(bullets.length, `${name}: rule bullets`).toBeGreaterThan(0);
      for (const bullet of bullets) {
        expect(bullet.examples.length, `line ${bullet.line}: ${bullet.text}`).toBeGreaterThan(0);
        for (const example of bullet.examples) await check(example, true);
      }
    });
  }
});

describe('docs/functions.md for the functions of 1.0.0', () => {
  it('runs every example but those listed as not run, and lists only examples it finds', async () => {
    const others = SECTIONS.filter((section) => !ADDED.includes(section.name));
    const examples = others.flatMap((section) => readExamples(section.lines, section.line + 1));
    expect(others.length).toBeGreaterThan(0);
    expect(examples.length).toBeGreaterThan(Object.keys(NOT_RUN).length);
    const sources = examples.map((example) => example.source);
    expect(Object.keys(NOT_RUN).filter((source) => !sources.includes(source))).toStrictEqual([]);
    let ran = 0;
    for (const example of examples) {
      if (example.source in NOT_RUN) continue;
      await check(example, false);
      ran += 1;
    }
    expect(ran).toBe(examples.length - Object.keys(NOT_RUN).length);
  });
});
