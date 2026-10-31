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
 * once, under "Shared rules". This spec reads the page as the repository holds it, by a closed
 * grammar of its lines: every line of a rules section must be the one production the grammar
 * expects there, and any other line fails. It runs every example through the real runtime and
 * makes the checks of `DOCS_CHECKS`, each reported under its id; what it cannot decide is in
 * `REVIEWER_CHECKS`. Each check carries a fixture, an edit of a small page built from the real one,
 * that the check must turn red, so a check that stops checking fails this spec. Every file of the
 * repository that names this spec lists exactly those sentences, by a closed grammar too.
 */

type Check = { id: string; sentence: string };

/** What this spec checks of docs/functions.md, one sentence per check, in the order it checks. */
export const DOCS_CHECKS: readonly Check[] = [
  {
    id: 'sections',
    sentence:
      'Each function the 1.0.0 baseline does not name has one section, under a heading of its name that no other heading repeats, and no other section has a line that, read with every whitespace character as one space, starts with `Unspecified:`.',
  },
  {
    id: 'signature',
    sentence:
      'Such a section opens with its signature line, the whole line as the live registry renders it.',
  },
  {
    id: 'form',
    sentence:
      'Read line by line up to the next heading, after NFKC normalisation, with every whitespace character as one space and format characters dropped, such a section is its signature line, then rules, each a top-level bullet of one line followed by one code block every line of which belongs to an example, then one line that starts with `Unspecified:`, with only blank lines between them, and any other line fails, a `---` rule, a line after the closing one and a nested or numbered item among them.',
  },
  {
    id: 'characters',
    sentence:
      'With its code spans taken out, the target of each link that a `[` opens taken out with it, every whitespace character read as one space and after NFKC normalisation, a bullet holds only letters, marks, numbers, spaces, `,`, `(`, `)`, `[` and `]`, a hyphen-minus, an apostrophe or an underscore after a letter, mark or number and before a letter or number, a `+` inside a `U+` code point in capitals, and one `.`, its last character, the closing line is held to the same, with the colon of `Unspecified:` at its start, and a `](` that no `[` opens fails.',
  },
  {
    id: 'conjunction',
    sentence:
      'No bullet holds a comma followed, after any whitespace or none, by "and", "or", "but", "nor", "so", "yet" or "then".',
  },
  {
    id: 'shared-overlap',
    sentence:
      'Read with the target of each link that a `[` opens taken out, after NFKC normalisation, with format characters and the marks `` ` ``, `*`, `_` and `~` dropped, every other punctuation mark or symbol read as a space, and case folded by upper then lower case, no bullet of a section equals a shared rule, holds all its words in a row, has all its own words in a row inside one or starts with the same four words as one, and no shared rule equals another or holds all its words in a row.',
  },
  {
    id: 'shared-once',
    sentence:
      'The shared rules stand once, under their heading, opened by their one sentence and read by the same grammar as a section, with no signature line and no closing line.',
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
    id: 'examples-unique',
    sentence:
      'No code block shows one call twice, the same source with the same variables, under either helper.',
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

/**
 * The line that opens the list of `DOCS_CHECKS` wherever the repository lists them: the checks of
 * the page, beside which the spec holds its own checks and the files that list them to this table.
 */
export const LEAD_IN =
  '`core-functions/src/functions/function-docs.spec.ts` checks exactly these in `docs/functions.md`:';

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

/**
 * A line as the grammar reads it: NFKC-normalised, every whitespace character one space, every
 * format character dropped.
 */
function normalLine(line: string): string {
  return line
    .normalize('NFKC')
    .replace(/[\s\p{White_Space}]/gu, ' ')
    .replace(/\p{Cf}/gu, '');
}

/** A heading of the page: the end of the section before it. */
const HEADING = /^#{1,6} /;

/** The productions of a rules section, besides a blank line, as they read a normalised line. */
const BULLET = /^- \S/;
const FENCE_OPEN = /^ {2}(`{3,})ts$/;
const CLOSING = /^Unspecified:( |$)/;
const EXAMPLE_START = /^\s*await (evalOk|evalErrors)\(/;

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

/** The sections of a page that start with `### NAME`, each running to the next heading. */
function readSections(page: string): Section[] {
  const all = page.split('\n');
  const found: Section[] = [];
  for (let index = 0; index < all.length; index++) {
    const heading = /^### ([A-Z0-9_]+)$/.exec(normalLine(all[index]).trimEnd());
    if (heading === null) continue;
    let end = index + 1;
    while (end < all.length && !HEADING.test(all[end])) end += 1;
    found.push({ name: heading[1], line: index + 1, lines: all.slice(index + 1, end) });
  }
  return found;
}

/** The shared rules: the lines after their heading, up to the next heading. */
function readShared(page: string): Section | undefined {
  const all = page.split('\n');
  const start = all.indexOf(SHARED_HEADING);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < all.length && !HEADING.test(all[end])) end += 1;
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
 * or `await evalErrors(source, variables?);`, followed by `// ` and what it gives, written on one
 * line or across several.
 */
function readExamples(lines: string[], first: number): Example[] {
  const found: Example[] = [];
  for (let index = 0; index < lines.length; index++) {
    const start = EXAMPLE_START.exec(lines[index]);
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
 * The rules of a section, read by the grammar of its lines: for a function's section, after blank
 * lines, its signature line; for the shared rules, their one opening sentence; then, separated by
 * blank lines only, rules, each a top-level bullet of one line followed by one code block of
 * examples, and, in a function's section, one closing line. A line the grammar does not expect
 * where it stands is a problem.
 */
function readRules(
  section: Section,
  kind: 'function' | 'shared',
  problems: string[],
): { opening: string | undefined; bullets: Bullet[]; closing: string | undefined } {
  const raw = section.lines;
  const lines = raw.map(normalLine);
  const at = (index: number) => section.line + 1 + index;
  const where = (index: number) => `${section.name}, line ${at(index)}`;
  const bullets: Bullet[] = [];
  let index = 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index].trim() === '') index += 1;
  };
  skipBlank();
  const opening = index < lines.length ? raw[index] : undefined;
  index += 1;
  let closing: string | undefined;
  for (;;) {
    skipBlank();
    if (index >= lines.length) break;
    const line = lines[index];
    if (closing !== undefined) {
      problems.push(
        problem('form', `${where(index)}: a line after the closing one: ${raw[index]}`),
      );
      index += 1;
      continue;
    }
    if (CLOSING.test(line)) {
      if (kind === 'shared') {
        problems.push(problem('shared-once', `${where(index)}: a closing line`));
      }
      closing = raw[index];
      index += 1;
      continue;
    }
    if (!BULLET.test(line)) {
      problems.push(
        problem('form', `${where(index)}: a line the grammar does not take here: ${raw[index]}`),
      );
      index += 1;
      continue;
    }
    const bullet: Bullet = { line: at(index), prose: line.slice(2), examples: [] };
    bullets.push(bullet);
    index += 1;
    skipBlank();
    const fence = index < lines.length ? FENCE_OPEN.exec(lines[index]) : null;
    if (fence === null) {
      problems.push(
        problem('form', `${where(bullet.line - section.line - 1)}: a rule without a code block`),
      );
      continue;
    }
    const open = index;
    index += 1;
    while (index < lines.length && lines[index] !== `  ${fence[1]}`) index += 1;
    if (index >= lines.length) {
      problems.push(problem('form', `${where(open)}: a code block that is not closed`));
    }
    const block = raw.slice(open + 1, index);
    bullet.examples = readExamples(block, at(open + 1));
    const covered = new Set<number>();
    for (const example of bullet.examples) {
      for (let line = example.first; line <= example.last; line++) covered.add(line);
    }
    block.forEach((text, line) => {
      if (!covered.has(line)) {
        problems.push(
          problem(
            'form',
            `${where(open + 1 + line)}: a line of a code block that is no example: ${text}`,
          ),
        );
      }
    });
    index += 1;
  }
  return { opening, bullets, closing };
}

/**
 * Prose with its code spans taken out, the target of each link a `[` opens taken out with it,
 * NFKC-normalised and every whitespace character one space, so that only its own words remain;
 * format characters stay, for `strayCharacters` to name.
 */
function words(prose: string): string {
  return prose
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, 'C')
    .replace(/\[([^[\]]*)\]\([^)\s]*\)/g, '[$1]')
    .normalize('NFKC')
    .replace(/[\s\p{White_Space}]+/gu, ' ')
    .trim();
}

/** A comma that joins two clauses into one bullet: one followed by a conjunction. */
const JOINED = /,\s*(?:and|or|but|nor|so|yet|then)\b/i;

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

/** The problems of a rule's prose, or of the closing line's: its characters, its end, its joins. */
function sentenceProblems(text: string, closing: boolean): string[] {
  const problems: string[] = [];
  const stray = strayCharacters(text, closing);
  if (stray.length > 0) {
    problems.push(problem('characters', `it holds ${stray.map(named).join(', ')}`));
  }
  if (text.includes('](')) {
    problems.push(problem('characters', 'a "](" that no "[" opens'));
  }
  if (!text.endsWith('.')) problems.push(problem('characters', 'it does not end with "."'));
  if (!closing && JOINED.test(text)) {
    problems.push(problem('conjunction', 'a comma and a conjunction join two clauses'));
  }
  return problems;
}

/**
 * A rule's words for comparison: the target of each link a `[` opens out, NFKC-normalised, format
 * characters, code and emphasis marks dropped, every other punctuation mark or symbol read as a
 * space, and case folded (upper case, then lower case, which folds `ß` to `ss` as well).
 */
function normal(prose: string): string[] {
  return prose
    .replace(/\[([^[\]]*)\]\([^)\s]*\)/g, '[$1]')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .toUpperCase()
    .toLowerCase()
    .split(/[\s\p{White_Space}]+/u)
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

/** The call an example makes, whichever helper makes it: its source and its variables. */
function callKey(example: Example): string {
  return JSON.stringify([example.source, example.variables ?? null]);
}

/** What examples give when they run, each call run once for this spec, in the shape `stated` reads. */
const GIVEN = new Map<string, Promise<unknown>>();

function given(example: Example): Promise<unknown> {
  const key = `${example.helper} ${callKey(example)}`;
  let found = GIVEN.get(key);
  if (found === undefined) {
    found = (async () => {
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
    })();
    GIVEN.set(key, found);
  }
  return found;
}

/**
 * Every problem of the rules of a section: its grammar, the form of each bullet and of the closing
 * line, a bullet that states one of `shared` again, the examples each bullet needs, each call shown
 * once in its block, and every example that does not give what its comment states.
 */
async function ruleProblems(
  section: Section,
  kind: 'function' | 'shared',
  calls: readonly string[],
  shared: readonly string[],
): Promise<{ problems: string[]; opening: string | undefined; bullets: Bullet[] }> {
  const problems: string[] = [];
  const { opening, bullets, closing } = readRules(section, kind, problems);
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
    const shown = new Set<string>();
    const outcomes = new Set<string>();
    for (const example of bullet.examples) {
      const where = `line ${example.line}: ${example.source}`;
      if (shown.has(callKey(example))) {
        problems.push(problem('examples-unique', `${where}: the same call shown again`));
      }
      shown.add(callKey(example));
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
  if (kind === 'function') {
    if (closing === undefined) {
      problems.push(problem('form', `${section.name}: no closing line`));
    } else {
      const sentence = words(normalLine(closing));
      if (sentence.split('Unspecified:').length !== 2) {
        problems.push(problem('form', `${section.name}: "Unspecified:" more than once`));
      }
      for (const found of sentenceProblems(sentence, true)) {
        problems.push(`${section.name}, the closing line: ${found}`);
      }
    }
  }
  return { problems, opening, bullets };
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

/** The prose of each shared rule, as the rules of a section are read. */
function readSharedRules(shared: Section | undefined): string[] {
  if (shared === undefined) return [];
  return readRules(shared, 'shared', []).bullets.map((bullet) => bullet.prose);
}

/** Every problem of a page by the checks of `DOCS_CHECKS`, each under its id. */
async function checkPage(page: string): Promise<string[]> {
  const sections = readSections(page);
  const shared = readShared(page);
  const sharedRules = readSharedRules(shared);
  const problems: string[] = [];

  // sections: each added function has one section, and no 1.0.0 section has a closing line.
  for (const name of ADDED) {
    const count = sections.filter((section) => section.name === name).length;
    if (count !== 1) problems.push(problem('sections', `${name}: ${count} section(s), one wanted`));
  }
  for (const section of sections.filter((section) => !ADDED.includes(section.name))) {
    if (section.lines.some((line) => CLOSING.test(normalLine(line)))) {
      problems.push(problem('sections', `${section.name}: a closing line in a 1.0.0 section`));
    }
  }
  const named = sections.map((section) => section.name);
  for (const name of new Set(named.filter((name, index) => named.indexOf(name) !== index))) {
    if (!ADDED.includes(name)) {
      problems.push(problem('sections', `${name}: a heading another heading repeats`));
    }
  }

  // The shared rules: once, opened by their one sentence, read by the grammar of the rules.
  if (shared === undefined) {
    problems.push(problem('shared-once', `no heading ${SHARED_HEADING}`));
  } else {
    if (page.split('\n').filter((line) => line === SHARED_HEADING).length !== 1) {
      problems.push(problem('shared-once', `${SHARED_HEADING} more than once`));
    }
    const read = await ruleProblems(shared, 'shared', ADDED, []);
    if (read.opening !== SHARED_INTRO) {
      problems.push(problem('shared-once', `the opening sentence: ${read.opening}`));
    }
    problems.push(...read.problems);
    if (sharedRules.length === 0) problems.push(problem('shared-once', 'no shared rules'));
    sharedRules.forEach((rule, index) => {
      for (const other of sharedRules.slice(index + 1)) {
        const how = overlap(rule, other, false);
        if (how !== null) {
          problems.push(problem('shared-overlap', `the shared rule "${rule}" ${how} "${other}"`));
        }
      }
    });
  }

  // Each section of an added function, every one of them where a heading repeats.
  for (const section of sections.filter((section) => ADDED.includes(section.name))) {
    const read = await ruleProblems(section, 'function', [section.name], sharedRules);
    const expected = signatureLine(section.name);
    if (read.opening !== expected) {
      problems.push(problem('signature', `${section.name}: ${read.opening}, not ${expected}`));
    }
    problems.push(...read.problems);
  }

  // Every example statement on the page is read inside a section or the shared rules.
  const statements = page.split('\n').filter((line) => EXAMPLE_START.test(line)).length;
  const read = [...sections, ...(shared ? [shared] : [])].flatMap((section) =>
    readExamples(section.lines, section.line + 1),
  );
  if (statements === 0) problems.push(problem('examples-read', 'no example statements'));
  if (read.length !== statements) {
    problems.push(problem('examples-read', `${statements} statements, ${read.length} read`));
  }

  // The examples of 1.0.0's functions give what their comments state.
  const others = sections.filter((section) => !ADDED.includes(section.name));
  const examples = others.flatMap((section) => readExamples(section.lines, section.line + 1));
  const sources = examples.map((example) => example.source);
  for (const source of Object.keys(NOT_RUN).filter((source) => !sources.includes(source))) {
    problems.push(problem('baseline', `${source}: listed as not run, and not on the page`));
  }
  for (const example of examples) {
    if (example.source in NOT_RUN) continue;
    problems.push(...(await baselineProblems(example)));
  }
  return problems;
}

/**
 * The text of a section of the real page, from its heading up to the next heading, for the small
 * page the fixtures edit.
 */
function sectionText(heading: string): string {
  const lines = DOCS.split('\n');
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && !HEADING.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

/**
 * A small page built from the real one: the shared rules, the section of one added function
 * (`TAKE`) and of one function of 1.0.0 (`LEN`). Each fixture edits it, and the check it belongs to
 * must report a problem the unedited page does not have.
 */
const SMALL_PAGE = [
  '# Functions',
  '',
  sectionText(SHARED_HEADING),
  '## Lists',
  '',
  sectionText('### TAKE'),
  sectionText('### LEN'),
].join('\n');

/** A fixture: text to find once in the small page and what to put in its place. */
type Fixture = { find: string; replace: string };

const TAKE_RULE = '- Items are taken as they are, `null` and `""` included.';
const TAKE_CLOSING = 'Unspecified: nothing.';
const LEN_EXAMPLE = 'await evalOk(\'LEN("abc")\'); // 3';

/** One fixture for each check of `DOCS_CHECKS`: an edit the check turns red. */
const FIXTURES: Record<string, Fixture> = {
  sections: { find: '### TAKE', replace: `${sectionText('### TAKE')}\n### TAKE` },
  signature: {
    find: '`TAKE(list: list<T>, count: number, start?: number) -> list<T>`',
    replace: '`TAKE(list: list<T>, count: number, start: number) -> list<T>`',
  },
  form: {
    find: TAKE_CLOSING,
    replace: `${TAKE_CLOSING}\n\n---\n\n- A count of 9 gives every item.`,
  },
  characters: {
    find: TAKE_RULE,
    replace: '- Items are taken as they are; `null` and `""` included.',
  },
  conjunction: {
    find: TAKE_RULE,
    replace: '- Items are taken as they are,and `null` and `""` are included.',
  },
  'shared-overlap': {
    find: TAKE_RULE,
    replace: '- A `null` given for an argument the function requires returns `null`.',
  },
  'shared-once': {
    find: SHARED_INTRO,
    replace: 'These rules hold in the sections that state their function as rules.',
  },
  'examples-count': {
    find: TAKE_RULE,
    replace: `- A list of one item gives that item.\n\n  \`\`\`ts\n  await evalOk('TAKE(LIST(1); 1)'); // [1]\n  \`\`\`\n\n${TAKE_RULE}`,
  },
  'examples-call': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.\n\n  \`\`\`ts\n  await evalOk('TAKE(LIST(1; 2); 2)'); // [1, 2]\n  await evalOk('LEN("ab")'); // 2\n  \`\`\`\n\n${TAKE_RULE}`,
  },
  'examples-give': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.\n\n  \`\`\`ts\n  await evalOk('TAKE(LIST(1; 2); 2)'); // [2, 1]\n  await evalOk('TAKE(LIST(1; 2); 1)'); // [1]\n  \`\`\`\n\n${TAKE_RULE}`,
  },
  'examples-differ': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.\n\n  \`\`\`ts\n  await evalOk('TAKE(LIST(1; 2); 2)'); // [1, 2]\n  await evalOk('TAKE(LIST(1; 2); 3)'); // [1, 2]\n  \`\`\`\n\n${TAKE_RULE}`,
  },
  'examples-unique': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.\n\n  \`\`\`ts\n  await evalOk('TAKE(LIST(1; 2); 2)'); // [1, 2]\n  await evalErrors('TAKE(LIST(1; 2); 2)'); // []\n  \`\`\`\n\n${TAKE_RULE}`,
  },
  'examples-read': {
    find: '# Functions',
    replace: `# Functions\n\n\`\`\`ts\nawait evalOk('TAKE(LIST(1); 1)'); // [1]\n\`\`\``,
  },
  baseline: { find: LEN_EXAMPLE, replace: 'await evalOk(\'LEN("abc")\'); // 4' },
};

/** The small page with one fixture applied. */
function edited(fixture: Fixture): string {
  expect(SMALL_PAGE.split(fixture.find).length, `${fixture.find}: found once`).toBe(2);
  return SMALL_PAGE.replace(fixture.find, () => fixture.replace);
}

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

/**
 * Where a file departs from the grammar of a claim site: the one line that names this spec is the
 * lead-in, then a blank line, the table's sentences as one list of one line each, a blank line,
 * the reviewer's lead-in, a blank line, the reviewer's sentences as one list, and nothing but blank
 * lines after them up to the next heading or the end of the file, all at the lead-in's indent.
 */
function claimProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  const naming = lines.flatMap((line, index) =>
    line.includes('function-docs.spec.ts') ? [index] : [],
  );
  if (naming.length !== 1) {
    problems.push(`${path}: names this spec on ${naming.length} lines, one wanted`);
  }
  for (const start of naming) {
    if (lines[start].trim() !== LEAD_IN) {
      problems.push(`${path}:${start + 1}: names the spec outside the line "${LEAD_IN}"`);
      continue;
    }
    const indent = lines[start].length - lines[start].trimStart().length;
    const pad = ' '.repeat(indent);
    let index = start + 1;
    const blank = () => {
      if (lines[index]?.trim() !== '') {
        problems.push(`${path}:${index + 1}: a blank line wanted: ${lines[index] ?? '<end>'}`);
      }
      index += 1;
    };
    const list = (table: readonly Check[], what: string) => {
      const items: string[] = [];
      while (index < lines.length && lines[index].startsWith(`${pad}- `)) {
        items.push(lines[index].slice(indent + 2));
        index += 1;
      }
      if (
        !isDeepStrictEqual(
          items,
          table.map((check) => check.sentence),
        )
      ) {
        problems.push(`${path}: ${what} does not list exactly the table's sentences, in its order`);
      }
    };
    blank();
    list(DOCS_CHECKS, 'the list of checks');
    blank();
    if (lines[index] !== `${pad}${REVIEW_LEAD_IN}`) {
      problems.push(`${path}:${index + 1}: "${REVIEW_LEAD_IN}" wanted: ${lines[index] ?? '<end>'}`);
    }
    index += 1;
    blank();
    list(REVIEWER_CHECKS, "the reviewer's list");
    while (index < lines.length && !HEADING.test(lines[index])) {
      if (lines[index].trim() !== '') {
        problems.push(
          `${path}:${index + 1}: a line after the lists, before the next heading: ${lines[index]}`,
        );
      }
      index += 1;
    }
  }
  return problems;
}

describe('docs/functions.md', () => {
  it('departs from none of the checks of DOCS_CHECKS', async () => {
    expect(ADDED.length).toBeGreaterThan(0);
    const problems = await checkPage(DOCS);
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });
});

describe('the checks prove themselves', () => {
  it('has one fixture for each check of the table, and none for a check it does not hold', () => {
    expect(Object.keys(FIXTURES).sort()).toStrictEqual(DOCS_CHECKS.map((check) => check.id).sort());
  });

  for (const check of DOCS_CHECKS) {
    it(`${check.id}: turns its fixture red`, async () => {
      const before = new Set(await checkPage(SMALL_PAGE));
      const after = await checkPage(edited(FIXTURES[check.id]));
      const found = after.filter((text) => !before.has(text) && text.includes(`${check.id}: `));
      expect(found, `${check.id}: no problem of its own on its fixture`).not.toStrictEqual([]);
    });
  }
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

  it('is listed by every file of the repository that names this spec, by the grammar of a claim site', () => {
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

  it('refuses a claim site that lists more than the table or claims a check in prose', () => {
    const site = (tail: string) =>
      [
        '# A site',
        '',
        LEAD_IN,
        '',
        ...DOCS_CHECKS.map((check) => `- ${check.sentence}`),
        '',
        REVIEW_LEAD_IN,
        '',
        ...REVIEWER_CHECKS.map((check) => `- ${check.sentence}`),
        tail,
      ].join('\n');
    expect(claimProblems('site', site(''))).toStrictEqual([]);
    expect(claimProblems('site', site('\n## Next\n\nAnything.'))).toStrictEqual([]);
    expect(claimProblems('site', site('\n- Whether a rule is true.'))).not.toStrictEqual([]);
    expect(
      claimProblems('site', site('\nIt also checks that the examples sit on either side.')),
    ).not.toStrictEqual([]);
  });
});
