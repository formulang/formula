import * as coreFunctions from '@formulang/core-functions';
import type { FormulaType, RuleNode } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import {
  createTestRuntime,
  evalErrors,
  evalFormulaOutput,
  evalOkWithOutput,
  withOther,
} from '../test-helpers/eval-formula';

/**
 * docs/functions.md states each function added to 1.0.0 as rules, and the rules all of them share
 * once, under "Shared rules". This spec reads the document as the repository holds it, runs every
 * example through the real runtime, and makes the checks of `DOCS_CHECKS`, each reported under its
 * id; what it cannot decide is in `REVIEWER_CHECKS`. Every file of the repository that names this
 * spec lists exactly those sentences, and the last tests below hold each file, and the checks this
 * file reports, to the table.
 */

type Check = { id: string; sentence: string };

/** What this spec checks of docs/functions.md, one sentence per check, in the order it checks. */
export const DOCS_CHECKS: readonly Check[] = [
  {
    id: 'sections',
    sentence:
      'Each function the 1.0.0 baseline does not name has a section, and no other section closes with an `Unspecified:` sentence.',
  },
  {
    id: 'signature',
    sentence:
      'Such a section opens with its signature line, the whole line as the live registry renders it.',
  },
  {
    id: 'form',
    sentence:
      'Its rules are top-level bullets, each followed by one code block of examples, and it closes with one sentence that starts with `Unspecified:`, and prose outside a rule, a nested bullet, a line of a code block that is no example and text after the closing sentence each fail.',
  },
  {
    id: 'characters',
    sentence:
      'With its code spans and link targets taken out and after NFKC normalisation, a bullet holds only letters, marks, numbers, spaces, `,`, `(`, `)`, `[` and `]`, a hyphen-minus, an apostrophe or an underscore after a letter, mark or number and before a letter or number, a `+` inside a `U+` code point in capitals, and one `.`, its last character, and the closing sentence is held to the same, with the colon of `Unspecified:` at its start.',
  },
  {
    id: 'conjunction',
    sentence:
      'No bullet holds a comma directly followed by "and", "or", "but", "nor", "so", "yet" or "then".',
  },
  {
    id: 'shared-overlap',
    sentence:
      'Read with link targets taken out, after NFKC normalisation, with format characters and the marks `` ` ``, `*`, `_` and `~` dropped, every other punctuation mark or symbol read as a space, and case folded by upper then lower case, no bullet of a section equals a shared rule, holds all its words in a row, has all its own words in a row inside one or starts with the same four words as one, and no shared rule equals another or holds all its words in a row.',
  },
  {
    id: 'shared-once',
    sentence:
      'The shared rules stand once, under their heading, opened by their one sentence, as bullets with examples in the form of the rules and with no closing sentence.',
  },
  {
    id: 'examples-count',
    sentence: 'Each bullet has at least two examples.',
  },
  {
    id: 'examples-call',
    sentence:
      'The parser, reading each example against the live registry, finds a call of the function of its section in it, or in the shared rules a call of a function the baseline does not name, and a name inside a string literal is no call.',
  },
  {
    id: 'examples-give',
    sentence:
      'Each example gives what its comment states, the value and the warning for `evalOk` and the error codes for `evalErrors`.',
  },
  {
    id: 'examples-differ',
    sentence: 'At least two of the examples of a bullet state different results.',
  },
  {
    id: 'examples-read',
    sentence:
      'Every example statement on the page is read, each inside a function section or the shared rules.',
  },
  {
    id: 'baseline',
    sentence:
      'Every example of a function the baseline names gives the value its comment states, read as JSON less a note in brackets after it, but six the spec names, two whose value is the current date, three that name a variable they do not give and one whose comment marks its value with `~`.',
  },
];

/** What the checks of `DOCS_CHECKS` cannot decide: the reviewer's. */
export const REVIEWER_CHECKS: readonly Check[] = [
  { id: 'one-condition', sentence: 'Whether a bullet states one condition and its outcome.' },
  { id: 'beyond-examples', sentence: 'Whether a rule holds beyond its examples.' },
  {
    id: 'either-side',
    sentence: 'Whether the examples of a rule sit on either side of its condition.',
  },
  { id: 'restated', sentence: 'Whether a bullet restates a shared rule in other words.' },
];

/** The line that opens the list of `DOCS_CHECKS` wherever the repository lists them. */
export const LEAD_IN = '`core-functions/src/functions/function-docs.spec.ts` checks exactly these:';

/** The line that opens the list of `REVIEWER_CHECKS`, after the first list. */
export const REVIEW_LEAD_IN = 'It cannot decide these, which the reviewer decides:';

/** The files that list the checks, named as the repository's root names them. */
const CLAIM_SITES = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'core-functions/README.md',
  'docs/functions.md',
];

/** A problem found by one of the checks of `DOCS_CHECKS`, named by its id. */
function problem(id: string, text: string): string {
  return `${id}: ${text}`;
}

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

/**
 * Prose with its code spans and link targets taken out, then NFKC-normalised, so that only its own
 * words remain, each character as the compatibility decomposition reads it (a full-width or small
 * form becomes the mark it stands for).
 */
function words(prose: string): string {
  return prose
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, 'C')
    .replace(/\]\([^)\s]*\)/g, ']')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A comma that joins two clauses into one bullet: one directly followed by a conjunction. */
const JOINED = /,\s+(?:and|or|but|nor|so|yet|then)\b/i;

/**
 * The characters of `text` (prose as `words` leaves it) outside those the rules may hold: letters,
 * marks, digits, spaces, `,`, `(`, `)`, `[`, `]`, a hyphen-minus, an apostrophe or an underscore
 * between two letters or digits, a `+` inside a `U+` code point, and the `.` that ends it. Every
 * other character, by its Unicode class, is one: each dash and minus, each mark that ends or joins
 * a sentence, each symbol and format character.
 */
function strayCharacters(text: string, closing: boolean): string[] {
  const rest = (closing ? text.replace(/^Unspecified:/, 'Unspecified') : text)
    .replace(/\bU\+[0-9A-F]{4,6}\b/g, 'U')
    .replace(/(?<=[\p{L}\p{M}\p{N}])['_-](?=[\p{L}\p{N}])/gu, '')
    .replace(/\.$/, '');
  return [...new Set(rest.match(/[^\p{L}\p{M}\p{N} ,()[\]]/gu) ?? [])];
}

/** How a character is named in a problem: itself and its code point. */
function named(character: string): string {
  return `"${character}" (U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})`;
}

/** The problems of a rule's prose, or of the closing sentence's: its characters and its end. */
function sentenceProblems(text: string, closing: boolean): string[] {
  const problems: string[] = [];
  const stray = strayCharacters(text, closing);
  if (stray.length > 0) {
    problems.push(problem('characters', `it holds ${stray.map(named).join(', ')}`));
  }
  if (!text.endsWith('.')) problems.push(problem('characters', 'it does not end with "."'));
  if (!closing && JOINED.test(text)) {
    problems.push(problem('conjunction', 'a comma and a conjunction join two clauses'));
  }
  return problems;
}

/**
 * A rule's words for comparison: link targets out, NFKC-normalised, format characters, code and
 * emphasis marks dropped, every other punctuation mark or symbol read as a space, and case folded
 * (upper case, then lower case, which folds `ß` to `ss` as well).
 */
function normal(prose: string): string[] {
  return prose
    .replace(/\]\([^)\s]*\)/g, ']')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .toUpperCase()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** How one rule states another again, or `null` when it does not by these checks. */
function overlap(rule: string, other: string, byFirstWords: boolean): string | null {
  const a = normal(rule);
  const b = normal(other);
  const spaced = (list: string[]) => ` ${list.join(' ')} `;
  if (spaced(a) === spaced(b)) return 'equals';
  if (spaced(a).includes(spaced(b))) return 'holds';
  if (spaced(b).includes(spaced(a))) return 'is held in';
  const first = (list: string[]) => list.slice(0, 4).join(' ');
  if (byFirstWords && first(a) === first(b)) return 'starts with the four words of';
  return null;
}

const { registry } = createTestRuntime(withOther);

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
      problems.push(
        problem('form', `${where(index)}: text after the unspecified sentence: ${line}`),
      );
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
      problems.push(problem('form', `${where(index)}: prose outside a rule bullet: ${line}`));
      index += 1;
      skipBlank();
      continue;
    }
    const bulletLine = section.line + 1 + index;
    const proseLines = [line.slice(2)];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '') {
      if (!lines[index].startsWith('  ') || /^\s+[-*+] /.test(lines[index])) {
        problems.push(problem('form', `${where(index)}: a line of a rule that is no part of it`));
      }
      proseLines.push(lines[index].trim());
      index += 1;
    }
    skipBlank();
    const fence = index < lines.length ? /^ {2}(`{3,})ts$/.exec(lines[index]) : null;
    const examples: Example[] = [];
    if (fence === null) {
      problems.push(problem('form', `line ${bulletLine}: a rule bullet without a code block`));
    } else {
      const open = index;
      index += 1;
      while (index < lines.length && lines[index] !== `  ${fence[1]}`) index += 1;
      if (index >= lines.length) {
        problems.push(problem('form', `${where(open)}: a code block that is not closed`));
      }
      const block = lines.slice(open + 1, index);
      examples.push(...readExamples(block, section.line + 2 + open));
      const covered = new Set<number>();
      for (const example of examples) {
        for (let at = example.first; at <= example.last; at++) covered.add(at);
      }
      block.forEach((text, at) => {
        if (text.trim() !== '' && !covered.has(at)) {
          problems.push(
            problem('form', `${where(open + 1 + at)}: a line of a code block that is no example`),
          );
        }
      });
      index += 1;
      skipBlank();
    }
    bullets.push({ line: bulletLine, prose: proseLines.join(' '), examples });
  }
  return { bullets, unspecified };
}

/** The names of the functions a formula calls, as the parser binds each call node. */
function calledNames(node: RuleNode | undefined, into: Set<string>): Set<string> {
  if (node === undefined) return into;
  if (node.kind === 'call') {
    const bound =
      node.signatureId === undefined ? undefined : registry.getFunction(node.signatureId);
    into.add((bound?.name ?? node.name).toUpperCase());
    for (const arg of node.args) calledNames(arg, into);
  } else if (node.kind === 'property' || node.kind === 'wildcard') {
    calledNames(node.object, into);
  }
  return into;
}

/**
 * Whether the parser finds a call of one of `names` in an example's formula: a call node, so a
 * name written inside a string literal, a callable a higher-order function is given included, is
 * none.
 */
function callsFunction(source: string, names: readonly string[]): boolean {
  const called = calledNames(parseFormula(source, { registry }).root, new Set());
  return names.some((name) => called.has(name));
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
  if (bullets.length === 0) problems.push(problem('form', `${section.name}: no rule bullets`));
  for (const bullet of bullets) {
    const at = `line ${bullet.line}`;
    for (const found of sentenceProblems(words(bullet.prose), false)) {
      problems.push(`${at}: ${found}`);
    }
    for (const rule of shared) {
      const how = overlap(bullet.prose, rule, true);
      if (how !== null) {
        problems.push(problem('shared-overlap', `${at}: ${how} the shared rule "${rule}"`));
      }
    }
    if (bullet.examples.length < 2) {
      problems.push(
        problem('examples-count', `${at}: ${bullet.examples.length} example(s), two needed`),
      );
    }
    const outcomes = new Set<string>();
    for (const example of bullet.examples) {
      const where = `line ${example.line}: ${example.source}`;
      if (example.variables === undefined) {
        problems.push(problem('examples-give', `${where}: a variable named but not given`));
        continue;
      }
      if (!callsFunction(example.source, calls)) {
        problems.push(
          problem(
            'examples-call',
            `${where}: calls none of ${calls.length === 1 ? calls[0] : 'the added functions'}`,
          ),
        );
      }
      const expected = stated(example);
      if (!expected.ok) {
        problems.push(problem('examples-give', `${where}: ${example.comment} is no stated result`));
        continue;
      }
      outcomes.add(JSON.stringify(expected.value));
      const actual = await given(example);
      if (!isDeepStrictEqual(actual, expected.value)) {
        problems.push(
          problem(
            'examples-give',
            `${where}: gives ${JSON.stringify(actual)}, not ${example.comment}`,
          ),
        );
      }
    }
    if (bullet.examples.length >= 2 && outcomes.size < 2) {
      problems.push(problem('examples-differ', `${at}: every example states the same result`));
    }
  }
  if (!closing) {
    if (unspecified !== null) {
      problems.push(problem('shared-once', `${section.name}: an unspecified sentence`));
    }
    return problems;
  }
  if (unspecified === null) {
    problems.push(problem('form', `${section.name}: no unspecified sentence`));
    return problems;
  }
  const sentence = words(unspecified);
  if (sentence.split('Unspecified:').length !== 2) {
    problems.push(problem('form', `${section.name}: "Unspecified:" more than once`));
  }
  for (const found of sentenceProblems(sentence, true)) {
    problems.push(`${section.name}, the unspecified sentence: ${found}`);
  }
  return problems;
}

/** The problems of one example of 1.0.0, whose comment may add a note in brackets after the value. */
async function baselineProblems(example: Example): Promise<string[]> {
  const where = `line ${example.line}: ${example.source}`;
  if (example.variables === undefined) {
    return [problem('baseline', `${where}: a variable named but not given`)];
  }
  const json = readJson(
    example.helper === 'evalErrors' ? example.comment : example.comment.replace(/\s+\(.*\)$/, ''),
  );
  if (!json.ok) return [problem('baseline', `${where}: ${example.comment} is no stated result`)];
  const actual =
    example.helper === 'evalErrors'
      ? await evalErrors(example.source, example.variables)
      : (await evalOkWithOutput(example.source, example.variables)).value;
  return isDeepStrictEqual(actual, json.value)
    ? []
    : [problem('baseline', `${where}: gives ${JSON.stringify(actual)}, not ${example.comment}`)];
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

/**
 * The markdown files of the repository, by their path from its root, outside its dependencies,
 * its build output and its dot directories.
 */
function markdownFiles(directory: URL, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...markdownFiles(new URL(`${entry.name}/`, directory), `${path}/`));
    } else if (entry.name.endsWith('.md')) {
      found.push(path);
    }
  }
  return found;
}

/** The bullets of the list that follows line `at`, each joined across its lines, and where it ends. */
function listAfter(lines: string[], at: number): { items: string[]; end: number } {
  const items: string[] = [];
  let index = at + 1;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  while (index < lines.length && /^\s*- /.test(lines[index])) {
    const parts = [lines[index].replace(/^\s*- /, '')];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '' && !/^\s*- /.test(lines[index])) {
      parts.push(lines[index].trim());
      index += 1;
    }
    items.push(parts.join(' ').replace(/\s+/g, ' ').trim());
  }
  return { items, end: index };
}

/**
 * Where a file departs from the table: each line that names this spec must open the list of
 * `DOCS_CHECKS` sentences, followed by the line that opens the list of `REVIEWER_CHECKS`; a
 * sentence the table lacks and a sentence of the table the file lacks are both departures.
 */
function claimProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  const spec = (checks: readonly Check[]) => checks.map((check) => check.sentence);
  const compare = (what: string, listed: string[], table: string[]) => {
    for (const sentence of listed.filter((item) => !table.includes(item))) {
      problems.push(`${path}: ${what} lists a check the table does not hold: ${sentence}`);
    }
    for (const sentence of table.filter((item) => !listed.includes(item))) {
      problems.push(`${path}: ${what} does not list the check: ${sentence}`);
    }
    if (problems.length === 0 && !isDeepStrictEqual(listed, table)) {
      problems.push(`${path}: ${what} lists the checks in another order than the table`);
    }
  };
  lines.forEach((line, index) => {
    if (!line.includes('function-docs.spec.ts')) return;
    if (line.trim() !== LEAD_IN) {
      problems.push(`${path}:${index + 1}: names the spec outside the line "${LEAD_IN}"`);
      return;
    }
    const checks = listAfter(lines, index);
    compare(`line ${index + 1}`, checks.items, spec(DOCS_CHECKS));
    let next = checks.end;
    while (next < lines.length && lines[next].trim() === '') next += 1;
    if (lines[next]?.trim() !== REVIEW_LEAD_IN) {
      problems.push(`${path}:${next + 1}: the list is not followed by "${REVIEW_LEAD_IN}"`);
      return;
    }
    compare(`line ${next + 1}`, listAfter(lines, next).items, spec(REVIEWER_CHECKS));
  });
  return problems;
}

describe('docs/functions.md examples', () => {
  it('reads every example statement on the page, each inside a function section or the shared rules', () => {
    const statements = DOCS.split('\n').filter((line) => /^\s*await /.test(line)).length;
    const read = [...SECTIONS, ...(SHARED ? [SHARED] : [])].flatMap((section) =>
      readExamples(section.lines, section.line + 1),
    );
    const problems: string[] = [];
    if (statements === 0) problems.push(problem('examples-read', 'no example statements'));
    if (read.length !== statements) {
      problems.push(problem('examples-read', `${statements} statements, ${read.length} read`));
    }
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });
});

describe('docs/functions.md for the functions added to 1.0.0', () => {
  it('documents each added function, and states rules this way for no other', () => {
    expect(ADDED.length).toBeGreaterThan(0);
    const problems = ADDED.filter((name) => !BY_NAME.has(name)).map((name) =>
      problem('sections', `${name}: no section`),
    );
    const stated = SECTIONS.filter((section) =>
      section.lines.some((line) => line.startsWith(UNSPECIFIED)),
    ).map((section) => section.name);
    for (const name of stated.filter((name) => !ADDED.includes(name))) {
      problems.push(problem('sections', `${name}: an unspecified sentence in a 1.0.0 section`));
    }
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });

  it('states the shared rules once, opened by their one sentence, in the form of the rules', async () => {
    const problems: string[] = [];
    if (SHARED === undefined) {
      problems.push(problem('shared-once', `no heading ${SHARED_HEADING}`));
    } else {
      const first = SHARED.lines.findIndex((line) => line.trim() !== '');
      if (SHARED.lines[first] !== SHARED_INTRO) {
        problems.push(problem('shared-once', `the opening sentence: ${SHARED.lines[first]}`));
      }
      if (DOCS.split('\n').filter((line) => line === SHARED_HEADING).length !== 1) {
        problems.push(problem('shared-once', `${SHARED_HEADING} more than once`));
      }
      problems.push(...(await ruleProblems(SHARED, first + 1, ADDED, false, [])));
      if (SHARED_RULES.length === 0) problems.push(problem('shared-once', 'no shared rules'));
      SHARED_RULES.forEach((rule, index) => {
        for (const other of SHARED_RULES.slice(index + 1)) {
          const how = overlap(rule, other, false);
          if (how !== null) {
            problems.push(problem('shared-overlap', `the shared rule "${rule}" ${how} "${other}"`));
          }
        }
      });
    }
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });

  for (const name of ADDED) {
    it(`${name}: one rule per bullet, each with examples that tell it apart, each answering as written`, async () => {
      const section = BY_NAME.get(name);
      expect(section, `${name}: its section`).toBeDefined();
      const lines = (section as Section).lines;
      const signature = lines.findIndex((line) => line.trim() !== '');
      const problems: string[] = [];
      if (lines[signature] !== signatureLine(name)) {
        problems.push(
          problem('signature', `${name}: ${lines[signature]}, not ${signatureLine(name)}`),
        );
      }
      problems.push(
        ...(await ruleProblems(section as Section, signature + 1, [name], true, SHARED_RULES)),
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
    const problems = Object.keys(NOT_RUN)
      .filter((source) => !sources.includes(source))
      .map((source) => problem('baseline', `${source}: listed as not run, and not on the page`));
    let ran = 0;
    for (const example of examples) {
      if (example.source in NOT_RUN) continue;
      problems.push(...(await baselineProblems(example)));
      ran += 1;
    }
    expect(problems, problems.join('\n')).toStrictEqual([]);
    expect(ran).toBe(examples.length - Object.keys(NOT_RUN).length);
  });
});

describe('the checks, as the table states them and as the repository lists them', () => {
  it('reports every problem under a check of the table, and makes every check of the table', () => {
    const own = readFileSync(new URL(import.meta.url), 'utf8');
    const reported = new Set(
      [...own.matchAll(/problem\(\s*'([a-z-]+)'/g)].map((match) => match[1]),
    );
    const ids = DOCS_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      new Set([...ids, ...REVIEWER_CHECKS.map((check) => check.id)]).size,
      'distinct ids',
    ).toBe(ids.length + REVIEWER_CHECKS.length);
    expect([...reported].sort()).toStrictEqual([...ids].sort());
  });

  it('is listed, sentence for sentence, by every file of the repository that names this spec', () => {
    const root = new URL('../../../', import.meta.url);
    const naming = markdownFiles(root).filter((path) =>
      readFileSync(new URL(path, root), 'utf8').includes('function-docs.spec.ts'),
    );
    expect(naming.sort()).toStrictEqual([...CLAIM_SITES].sort());
    const problems = naming.flatMap((path) =>
      claimProblems(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });
});
