import * as coreFunctions from '@formulang/core-functions';
import type { FormulaType } from '@formulang/definitions';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import {
  createTestRuntime,
  evalErrors,
  evalFormulaOutput,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';

/**
 * docs/functions.md states each function added to 1.0.0 as rules, and the rules all of them share
 * once, under "Shared rules". This spec reads the document as the repository holds it, runs every
 * example through the real runtime, and checks, for each added function's section and for the
 * shared rules:
 *
 * - a section opens with its function's signature, the whole line as the live registry renders it;
 * - each rule is a top-level bullet followed by one code block of examples, and a section closes
 *   with one sentence, `Unspecified: ...`; prose outside a rule, a nested bullet, a line of a code
 *   block that is no example, and text after the closing sentence are red;
 * - each bullet, its code spans and link targets taken out, is one sentence: it ends with `.`,
 *   holds no other `.`, `!` or `?`, no `;`, `:`, en dash, em dash or hyphen between spaces, and no
 *   comma directly followed by "and", "or", "but", "nor", "so", "yet" or "then"; the closing
 *   sentence is held to the same form but for the commas;
 * - no bullet of a section, lower-cased and with its code marks dropped, equals a shared rule,
 *   holds one, is held in one, or starts with the same four words as one, and no shared rule
 *   equals, holds or is held in another;
 * - each bullet has at least two examples, every example calls the section's function (in the
 *   shared rules, an added function) and gives what its comment states, and at least two of a
 *   bullet's examples state different results.
 *
 * What these checks cannot see is the reviewer's: whether a bullet states one condition and one
 * outcome, whether a rule holds beyond its examples, whether its examples sit on either side of
 * its condition, and a shared rule restated in other words.
 */

/** docs/functions.md, as the repository holds it. */
const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

/** The sentence that closes each added function's section. */
const UNSPECIFIED = 'Unspecified: ';

/** The heading of the rules every added function follows, and the one sentence that opens them. */
const SHARED_HEADING = '## Shared rules';
const SHARED_INTRO =
  'These rules hold in every section that states its function as rules, for each argument but a mode and the operator of `FILTER_BY`, which a formula writes as literals.';

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
  /** The lines of its code block the statement spans, from 0. */
  first: number;
  last: number;
};

type Bullet = { line: number; prose: string; examples: Example[] };

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

/** The shared rules: the lines after their heading, up to the next heading or rule. */
function readShared(docs: string): Section | undefined {
  const all = docs.split('\n');
  const start = all.indexOf(SHARED_HEADING);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < all.length && !/^(#{1,3} |---$)/.test(all[end])) end += 1;
  return { name: 'Shared rules', line: start + 1, lines: all.slice(start + 1, end) };
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
      first: index,
      last: end,
    });
    index = end;
  }
  return found;
}

/** Prose with its code spans and link targets taken out, so only its own words remain. */
function words(prose: string): string {
  return prose
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, 'C')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A comma that joins two clauses into one bullet: one directly followed by a conjunction. */
const JOINED = /,\s+(?:and|or|but|nor|so|yet|then)\b/i;

/** A dash between two clauses: an en dash, an em dash, or a hyphen between spaces. */
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|\\s-\\s`);

/**
 * What makes prose more than one sentence: a `;`, a `:`, a dash, a mark that ends a sentence
 * before its last character, and in a bullet a comma joining two clauses.
 */
function sentenceProblems(text: string, bullet: boolean): string[] {
  const problems: string[] = [];
  if (text.includes(';')) problems.push('a ";" joins two rules');
  if (text.includes(':')) problems.push('a ":" joins two rules');
  if (DASH.test(text)) problems.push('a dash joins two rules');
  if (bullet && JOINED.test(text)) problems.push('a comma and a conjunction join two rules');
  if (!text.endsWith('.')) problems.push('it does not end with "."');
  if (/[.!?]/.test(text.slice(0, -1))) problems.push('it holds more than one sentence');
  return problems;
}

/** A rule's words: lower-cased, code marks dropped, whitespace collapsed, no closing period. */
function normal(prose: string): string {
  return prose.replace(/`/g, '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/** How one rule states another again, or `null` when it does not by these checks. */
function overlap(rule: string, other: string, byFirstWords: boolean): string | null {
  const a = normal(rule);
  const b = normal(other);
  if (a === b) return 'equals';
  if (a.includes(b)) return 'holds';
  if (b.includes(a)) return 'is held in';
  const first = (text: string) => text.split(' ').slice(0, 4).join(' ');
  if (byFirstWords && first(a) === first(b)) return 'starts with the four words of';
  return null;
}

const { registry } = createTestRuntime();

/** A type as the signature lines write it. */
function typeText(type: FormulaType): string {
  switch (type.kind) {
    case 'list':
      return `list<${typeText(type.of)}>`;
    case 'template':
      return type.name;
    case 'union':
      return type.of.map(typeText).join(' | ');
    default:
      return type.kind;
  }
}

/** The signature line of a function with one definition, rendered from the live registry. */
function signatureLine(name: string): string {
  const definitions = registry.listFunctionsByName(name);
  expect(definitions, `${name}: its definitions`).toHaveLength(1);
  const [definition] = definitions;
  const params = definition.params.map(
    (param) =>
      `${param.variadic ? '...' : ''}${param.name}${param.optional ? '?' : ''}: ${typeText(param.type)}`,
  );
  return `\`${name}(${params.join(', ')}) -> ${typeText(definition.returnType)}\``;
}

/**
 * The rules of a section's lines, from `from` on: top-level bullets, each one sentence of prose,
 * then one indented code block of examples, and at most a closing `Unspecified: ` sentence.
 * Every departure from that form is a problem: prose outside a bullet, a nested bullet, a bullet
 * without a code block, a line of a code block that is no example, prose after a code block, and
 * text after the closing sentence.
 */
function readRules(
  section: Section,
  from: number,
  problems: string[],
): { bullets: Bullet[]; unspecified: string | null } {
  const lines = section.lines;
  const where = (offset: number) => `${section.name}, line ${section.line + 1 + offset}`;
  const bullets: Bullet[] = [];
  let unspecified: string | null = null;
  let index = from;
  const skipBlank = () => {
    while (index < lines.length && lines[index].trim() === '') index += 1;
  };
  skipBlank();
  while (index < lines.length) {
    const line = lines[index];
    if (unspecified !== null) {
      problems.push(`${where(index)}: text after the unspecified sentence: ${line}`);
      index += 1;
      skipBlank();
      continue;
    }
    if (line.startsWith(UNSPECIFIED)) {
      const start = index;
      while (index < lines.length && lines[index].trim() !== '') index += 1;
      unspecified = lines.slice(start, index).join(' ');
      skipBlank();
      continue;
    }
    if (!line.startsWith('- ')) {
      problems.push(`${where(index)}: prose outside a rule bullet: ${line}`);
      index += 1;
      skipBlank();
      continue;
    }
    const bulletLine = section.line + 1 + index;
    const proseLines = [line.slice(2)];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '') {
      if (!lines[index].startsWith('  ') || /^\s+[-*+] /.test(lines[index])) {
        problems.push(`${where(index)}: a line of a rule that is no part of its sentence`);
      }
      proseLines.push(lines[index].trim());
      index += 1;
    }
    skipBlank();
    const fence = index < lines.length ? /^ {2}(`{3,})ts$/.exec(lines[index]) : null;
    const examples: Example[] = [];
    if (fence === null) {
      problems.push(`line ${bulletLine}: a rule bullet without a code block of examples`);
    } else {
      const open = index;
      index += 1;
      while (index < lines.length && lines[index] !== `  ${fence[1]}`) index += 1;
      if (index >= lines.length) problems.push(`${where(open)}: a code block that is not closed`);
      const block = lines.slice(open + 1, index);
      examples.push(...readExamples(block, section.line + 2 + open));
      const covered = new Set<number>();
      for (const example of examples) {
        for (let at = example.first; at <= example.last; at++) covered.add(at);
      }
      block.forEach((text, at) => {
        if (text.trim() !== '' && !covered.has(at)) {
          problems.push(`${where(open + 1 + at)}: a line of a code block that is no example`);
        }
      });
      index += 1;
      skipBlank();
    }
    bullets.push({ line: bulletLine, prose: proseLines.join(' '), examples });
  }
  return { bullets, unspecified };
}

/** Whether an example's source calls the function `name`, or names it as a callable. */
function callsFunction(source: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\(|"${name}"`).test(source);
}

/** The value a comment states as JSON, or a problem when it is not JSON. */
function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * What an example states it gives, read from its comment: for `evalOk` the value and the warning
 * (`null with a TYPE warning`; none stated is none given), for `evalErrors` the error codes.
 */
function stated(example: Example): { ok: true; value: unknown } | { ok: false } {
  if (example.helper === 'evalErrors') {
    const codes = readJson(example.comment);
    return codes.ok ? { ok: true, value: { errors: codes.value } } : codes;
  }
  const withWarning = /^(.*) with an? ([A-Z_]+) warning$/.exec(example.comment);
  const value = readJson(withWarning === null ? example.comment : withWarning[1]);
  if (!value.ok) return value;
  return { ok: true, value: { value: value.value, warnings: withWarning ? [withWarning[2]] : [] } };
}

/** What an example gives when it runs, in the shape `stated` reads from its comment. */
async function given(example: Example): Promise<unknown> {
  if (example.helper === 'evalErrors') {
    return { errors: await evalErrors(example.source, example.variables) };
  }
  const { parsed, compiled, output, errors } = await evalFormulaOutput(
    example.source,
    example.variables,
  );
  const all = [...parsed.errors, ...compiled.errors, ...errors].map((error) => error.code);
  if (all.length > 0) return { errors: all };
  return {
    value: output.value ?? null,
    warnings: (output.warnings ?? []).map((warning) => warning.code),
  };
}

/**
 * Every problem of a block of rules: the form of each bullet and of the closing sentence, a
 * bullet that states one of `shared` again, the examples each bullet needs, and every example
 * that does not give what its comment states.
 */
async function ruleProblems(
  section: Section,
  from: number,
  calls: readonly string[],
  closing: boolean,
  shared: readonly string[],
): Promise<string[]> {
  const problems: string[] = [];
  const { bullets, unspecified } = readRules(section, from, problems);
  if (bullets.length === 0) problems.push(`${section.name}: no rule bullets`);
  for (const bullet of bullets) {
    const at = `line ${bullet.line}`;
    for (const problem of sentenceProblems(words(bullet.prose), true)) {
      problems.push(`${at}: one rule per bullet, in one sentence: ${problem}`);
    }
    for (const rule of shared) {
      const how = overlap(bullet.prose, rule, true);
      if (how !== null) problems.push(`${at}: ${how} the shared rule "${rule}"`);
    }
    if (bullet.examples.length < 2) {
      problems.push(`${at}: ${bullet.examples.length} example(s), at least two needed`);
    }
    const outcomes = new Set<string>();
    for (const example of bullet.examples) {
      const where = `line ${example.line}: ${example.source}`;
      if (example.variables === undefined) {
        problems.push(`${where}: a variable named but not given`);
        continue;
      }
      if (!calls.some((name) => callsFunction(example.source, name))) {
        problems.push(
          `${where}: calls none of ${calls.length === 1 ? calls[0] : 'the added functions'}`,
        );
      }
      const expected = stated(example);
      if (!expected.ok) {
        problems.push(`${where}: the comment ${example.comment} is not a stated result`);
        continue;
      }
      outcomes.add(JSON.stringify(expected.value));
      const actual = await given(example);
      if (!isDeepStrictEqual(actual, expected.value)) {
        problems.push(`${where}: gives ${JSON.stringify(actual)}, not ${example.comment}`);
      }
    }
    if (bullet.examples.length >= 2 && outcomes.size < 2) {
      problems.push(`${at}: every example gives the same result, so none tells the rule apart`);
    }
  }
  if (!closing) {
    if (unspecified !== null) problems.push(`${section.name}: an unspecified sentence`);
    return problems;
  }
  if (unspecified === null) {
    problems.push(`${section.name}: no unspecified sentence`);
    return problems;
  }
  const sentence = words(unspecified);
  if (sentence.split('Unspecified:').length !== 2) {
    problems.push(`${section.name}: "Unspecified:" more than once`);
  }
  for (const problem of sentenceProblems(sentence.slice(UNSPECIFIED.length), false)) {
    problems.push(`${section.name}: the unspecified sentence: ${problem}`);
  }
  return problems;
}

/** Runs one example of 1.0.0, whose comment may add a note in brackets after the value. */
async function checkBaseline(example: Example): Promise<void> {
  const where = `line ${example.line}: ${example.source}`;
  expect(example.variables, `${where}: the variables`).toBeDefined();
  const json = readJson(
    example.helper === 'evalErrors' ? example.comment : example.comment.replace(/\s+\(.*\)$/, ''),
  );
  expect(json.ok, `${where}: the comment ${example.comment}`).toBe(true);
  const value = json.ok ? json.value : undefined;
  if (example.helper === 'evalErrors') {
    expect(await evalErrors(example.source, example.variables), where).toStrictEqual(value);
    return;
  }
  expect((await evalOkWithOutput(example.source, example.variables)).value, where).toStrictEqual(
    value,
  );
}

const SECTIONS = readSections(DOCS);
const BY_NAME = new Map(SECTIONS.map((section) => [section.name, section]));
const SHARED = readShared(DOCS);

/** The prose of each shared rule, as the rules of a section are read. */
function readSharedRules(shared: Section | undefined): string[] {
  if (shared === undefined) return [];
  const first = shared.lines.findIndex((line) => line.trim() !== '');
  return readRules(shared, first + 1, []).bullets.map((bullet) => bullet.prose);
}

const SHARED_RULES = readSharedRules(SHARED);

describe('docs/functions.md examples', () => {
  it('reads every example statement on the page, each inside a function section or the shared rules', () => {
    const statements = DOCS.split('\n').filter((line) => /^\s*await /.test(line)).length;
    const read = [...SECTIONS, ...(SHARED ? [SHARED] : [])].flatMap((section) =>
      readExamples(section.lines, section.line + 1),
    );
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

  it('states the shared rules once, opened by their one sentence, in the form of the rules', async () => {
    expect(SHARED, SHARED_HEADING).toBeDefined();
    const shared = SHARED as Section;
    const first = shared.lines.findIndex((line) => line.trim() !== '');
    expect(shared.lines[first], 'the sentence that opens the shared rules').toBe(SHARED_INTRO);
    expect(DOCS.split('\n').filter((line) => line === SHARED_HEADING)).toHaveLength(1);
    const problems = await ruleProblems(shared, first + 1, ADDED, false, []);
    expect(SHARED_RULES.length, 'the shared rules').toBeGreaterThan(0);
    SHARED_RULES.forEach((rule, index) => {
      for (const other of SHARED_RULES.slice(index + 1)) {
        const how = overlap(rule, other, false);
        if (how !== null) problems.push(`the shared rule "${rule}" ${how} "${other}"`);
      }
    });
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });

  for (const name of ADDED) {
    it(`${name}: one rule per bullet, each with examples that tell it apart, each answering as written`, async () => {
      const section = BY_NAME.get(name);
      expect(section, `${name}: its section`).toBeDefined();
      const lines = (section as Section).lines;
      const signature = lines.findIndex((line) => line.trim() !== '');
      expect(lines[signature], `${name}: the signature`).toBe(signatureLine(name));
      const problems = await ruleProblems(
        section as Section,
        signature + 1,
        [name],
        true,
        SHARED_RULES,
      );
      expect(problems, problems.join('\n')).toStrictEqual([]);
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
      await checkBaseline(example);
      ran += 1;
    }
    expect(ran).toBe(examples.length - Object.keys(NOT_RUN).length);
  });
});
