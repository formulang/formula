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
 * once, under "Shared rules". This spec reads the page once into a model (its headings, the sections
 * of its functions and the shared rules, each read by a closed grammar of its lines, their bullets,
 * code blocks and example statements, and every line that calls an example helper), and makes the
 * checks of `DOCS_CHECKS` over that model. Each check is one function of its own, which reports
 * every problem it finds from one place, and the table states beside it, in one sentence, what it
 * decides. Each check has a fixture, an edit of a small page built from the real one, on which its
 * function must report a problem the unedited page does not have: a check that stops checking turns
 * its own fixture red. What the checks cannot decide is in `REVIEWER_CHECKS`. Every file of the
 * repository that names this spec lists exactly those sentences, which the functions of
 * `CLAIM_CHECKS` hold it to, each with a fixture of its own as well.
 */

/** A problem a check reports: the line of the page it stands on (0 for the page) and what it is. */
type Problem = { line: number; text: string };

type Check<Subject> = {
  id: string;
  sentence: string;
  check: (subject: Subject) => Problem[] | Promise<Problem[]>;
};

/** docs/functions.md, as the repository holds it. */
const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

/** The title of the rules every added function follows, and the one sentence that opens them. */
const SHARED_TITLE = 'Shared rules';
const SHARED_INTRO =
  'These rules hold in every section that states its function as rules, for each argument but a mode and the operator of `FILTER_BY`, which a formula writes as literals.';

/**
 * The example statements of 1.0.0's sections that this spec does not run, each with the reason, by
 * the whole statement.
 */
const NOT_RUN: Record<string, string> = {
  "await evalOk('ROUND(EXP(1); 8)'); // ~2.71828183 (≈ e)": 'the comment marks its value with `~`',
  'await evalOk(\'NOW().date.iso\'); // e.g. "2026-07-03"': 'the value is the current date',
  'await evalOk(\'TODAY().iso\'); // e.g. "2026-07-03"': 'the value is the current date',
  'await evalOk(\'SORT_BY_PROPERTY(value; "a")\', { value }); // [{a:1},{a:2},{a:3}]':
    'the variable is named, not given',
  'await evalOk(\'SORT_BY_PROPERTY(value; "a.b")\', { value: nested });':
    'the variable is named, not given',
  'await evalOk(\'FILTER_PROPERTY(value; "a.b"; "="; 2)\', { value }); // [{ a: { b: 2 } }]':
    'the variable is named, not given',
};

// The page model.

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

/** A heading line of the page, its `#`s and the text after them. */
const HEADING = /^(#{1,6}) (.*)$/;

/** The productions of a rules section, besides a blank line, as they read a normalised line. */
const BULLET = /^- \S/;
const FENCE_OPEN = /^ {2}(`{3,})ts$/;
const CLOSING = /^Unspecified:( |$)/;
const EXAMPLE_START = /^\s*await (evalOk|evalErrors)\(/;
const HELPER_CALL = /\b(evalOk|evalErrors)\(/;

type Heading = { level: number; text: string; line: number };

type Example = {
  helper: 'evalOk' | 'evalErrors';
  /** The whole statement, its lines trimmed and joined by one space. */
  statement: string;
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

/**
 * The rules of a section, or of the shared rules, as the grammar reads them, and where its lines
 * depart from it, each kind of departure recorded in one place, for the one check that reports it.
 */
type Rules = {
  title: string;
  line: number;
  opening: string | undefined;
  bullets: Bullet[];
  closing: Problem | undefined;
  /** Lines before the closing line that are no production the grammar takes there. */
  unexpected: Problem[];
  /** Lines that are not blank after the closing line. */
  afterClosing: Problem[];
  /** Bullets that no code block follows. */
  noBlock: Problem[];
  /** Code blocks that do not close. */
  unclosed: Problem[];
  /** Lines of a code block that belong to no example. */
  stray: Problem[];
};

/** A section of a function: a `### NAME` heading, as written, up to the next heading of level 1 to 3. */
type Section = {
  name: string;
  heading: Heading;
  added: boolean;
  /** For a function the baseline does not name, its rules. */
  rules: Rules | undefined;
  examples: Example[];
};

type Page = {
  lines: string[];
  headings: Heading[];
  sections: Section[];
  /** The rules under the first heading of level 2 that reads `Shared rules`. */
  shared: Rules | undefined;
  /** Every line that calls `evalOk(` or `evalErrors(` outside a code span. */
  statements: Problem[];
};

/** A heading's text as the checks compare it: NFKC-normalised, whitespace one space, trimmed. */
function headingText(text: string): string {
  return normalLine(text).replace(/ +/g, ' ').trim();
}

/** A line with each code span taken out. */
function withoutCodeSpans(line: string): string {
  return line.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, ' ');
}

/** The source and the variables of an example's call, read as JavaScript reads its literals. */
function readCall(call: string): { source: string; variables?: Record<string, unknown> } | null {
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
    if (literal === null) return null;
    return { source: new Function(`return ${literal[1]};`)() as string };
  }
}

/**
 * The example statements of `lines` (numbered from `first`): `await evalOk(source, variables?);`
 * or `await evalErrors(source, variables?);`, followed by `// ` and what it gives, written on one
 * line or across several. A statement that does not end, or whose call does not read, is none.
 */
function readExamples(lines: string[], first: number): Example[] {
  const found: Example[] = [];
  for (let index = 0; index < lines.length; index++) {
    const start = EXAMPLE_START.exec(lines[index]);
    if (start === null) continue;
    let end = index;
    while (end < lines.length && !/\);\s*(\/\/ .*)?$/.test(lines[end])) end += 1;
    if (end >= lines.length) continue;
    const statement = lines.slice(index, end + 1).join('\n');
    const split = /^\s*await ((?:evalOk|evalErrors)\([\s\S]*\));\s*(?:\/\/ (.*))?$/.exec(statement);
    const call = split === null ? null : readCall(split[1]);
    if (split === null || call === null) continue;
    found.push({
      helper: start[1] as Example['helper'],
      statement: lines
        .slice(index, end + 1)
        .map((line) => line.trim())
        .join(' '),
      ...call,
      comment: (split[2] ?? '').trim(),
      line: first + index,
      first: index,
      last: end,
    });
    index = end;
  }
  return found;
}

/**
 * The rules of a section, read by the grammar of its lines: after blank lines, its opening line
 * (a function's signature line, or the shared rules' one sentence); then, separated by blank lines
 * only, rules, each a top-level bullet of one line followed by one code block of examples, and one
 * closing line. Each line the grammar does not take where it stands is recorded with its kind.
 */
function readRules(title: string, heading: Heading, raw: string[]): Rules {
  const lines = raw.map(normalLine);
  const at = (index: number) => heading.line + 1 + index;
  const rules: Rules = {
    title,
    line: heading.line,
    opening: undefined,
    bullets: [],
    closing: undefined,
    unexpected: [],
    afterClosing: [],
    noBlock: [],
    unclosed: [],
    stray: [],
  };
  let index = 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index].trim() === '') index += 1;
  };
  skipBlank();
  rules.opening = index < lines.length ? raw[index] : undefined;
  index += 1;
  for (;;) {
    skipBlank();
    if (index >= lines.length) break;
    const line = lines[index];
    if (rules.closing !== undefined) {
      rules.afterClosing.push({ line: at(index), text: raw[index] });
      index += 1;
      continue;
    }
    if (CLOSING.test(line)) {
      rules.closing = { line: at(index), text: raw[index] };
      index += 1;
      continue;
    }
    if (!BULLET.test(line)) {
      rules.unexpected.push({ line: at(index), text: raw[index] });
      index += 1;
      continue;
    }
    const bullet: Bullet = { line: at(index), prose: line.slice(2), examples: [] };
    rules.bullets.push(bullet);
    index += 1;
    skipBlank();
    const fence = index < lines.length ? FENCE_OPEN.exec(lines[index]) : null;
    if (fence === null) {
      rules.noBlock.push({ line: bullet.line, text: `- ${bullet.prose}` });
      continue;
    }
    const open = index;
    index += 1;
    while (index < lines.length && lines[index] !== `  ${fence[1]}`) index += 1;
    if (index >= lines.length) rules.unclosed.push({ line: at(open), text: raw[open] });
    const block = raw.slice(open + 1, index);
    bullet.examples = readExamples(block, at(open + 1));
    const covered = new Set<number>();
    for (const example of bullet.examples) {
      for (let line = example.first; line <= example.last; line++) covered.add(line);
    }
    block.forEach((text, line) => {
      if (!covered.has(line)) rules.stray.push({ line: at(open + 1 + line), text });
    });
    index += 1;
  }
  return rules;
}

/** The page read once: its headings, its functions' sections, the shared rules, its statements. */
function readPage(text: string): Page {
  const lines = text.split('\n');
  const headings: Heading[] = [];
  lines.forEach((line, index) => {
    const found = HEADING.exec(line);
    if (found !== null) {
      headings.push({ level: found[1].length, text: headingText(found[2]), line: index + 1 });
    }
  });
  // The lines under a heading, up to the next heading of level 1 to 3.
  const body = (heading: Heading) => {
    const next = headings.find((other) => other.line > heading.line && other.level <= 3);
    return lines.slice(heading.line, next === undefined ? lines.length : next.line - 1);
  };
  const sections: Section[] = headings.flatMap((heading) => {
    const name = /^### ([A-Z0-9_]+)$/.exec(lines[heading.line - 1])?.[1];
    if (name === undefined) return [];
    const added = ADDED.includes(name);
    const rules = added ? readRules(name, heading, body(heading)) : undefined;
    return [
      {
        name,
        heading,
        added,
        rules,
        examples:
          rules === undefined
            ? readExamples(body(heading), heading.line + 1)
            : rules.bullets.flatMap((bullet) => bullet.examples),
      },
    ];
  });
  const sharedHeading = headings.find(
    (heading) => heading.level === 2 && heading.text === SHARED_TITLE,
  );
  return {
    lines,
    headings,
    sections,
    shared:
      sharedHeading === undefined
        ? undefined
        : readRules(SHARED_TITLE, sharedHeading, body(sharedHeading)),
    statements: lines.flatMap((line, index) =>
      HELPER_CALL.test(withoutCodeSpans(line)) ? [{ line: index + 1, text: line }] : [],
    ),
  };
}

/** The rules of every added function's section, and the shared rules. */
function rulesOf(page: Page): Rules[] {
  const sections = page.sections.flatMap((section) =>
    section.rules === undefined ? [] : [section.rules],
  );
  return page.shared === undefined ? sections : [...sections, page.shared];
}

/** The bullets of every added function's section, each with the names its examples must call. */
function bulletsOf(page: Page): { bullet: Bullet; calls: readonly string[]; shared: boolean }[] {
  return rulesOf(page).flatMap((rules) =>
    rules.bullets.map((bullet) => ({
      bullet,
      calls: rules === page.shared ? ADDED : [rules.title],
      shared: rules === page.shared,
    })),
  );
}

/** The prose of every bullet and closing line, read as `words` reads it, with its line. */
function proseOf(page: Page): { line: number; text: string; closing: boolean }[] {
  return rulesOf(page).flatMap((rules) => [
    ...rules.bullets.map((bullet) => ({
      line: bullet.line,
      text: words(bullet.prose),
      closing: false,
    })),
    ...(rules.closing === undefined || rules === page.shared
      ? []
      : [{ line: rules.closing.line, text: words(normalLine(rules.closing.text)), closing: true }]),
  ]);
}

// The readings the checks share.

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

/**
 * Prose as it reads once its markdown is rendered: each code span as its text, each link as its
 * text, NFKC-normalised, every whitespace character one space.
 */
function rendered(prose: string): string {
  return prose
    .replace(/(`+)(?!`)\s?([\s\S]*?[^`])\s?\1(?!`)/g, '$2')
    .replace(/\[([^[\]]*)\]\([^)\s]*\)/g, '$1')
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

/**
 * A rule's words for comparison: the target of each link a `[` opens out, NFKC-normalised, format
 * characters, code and emphasis marks dropped, every other punctuation mark or symbol read as a
 * space, and case folded (upper case, then lower case, which folds `ß` to `ss` as well).
 */
function normal(prose: string): string {
  const list = prose
    .replace(/\[([^[\]]*)\]\([^)\s]*\)/g, '[$1]')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .toUpperCase()
    .toLowerCase()
    .split(/[\s\p{White_Space}]+/u)
    .filter((word) => word !== '');
  return ` ${list.join(' ')} `;
}

/** Whether `rule`, read as `normal` reads it, holds all the words of `other` in a row. */
function holds(rule: string, other: string): boolean {
  return normal(rule).includes(normal(other));
}

/** The first four words of a rule, read as `normal` reads it. */
function firstFour(rule: string): string {
  return normal(rule).trim().split(' ').slice(0, 4).join(' ');
}

/** The prose of each shared rule. */
function sharedRules(page: Page): string[] {
  return (page.shared?.bullets ?? []).map((bullet) => bullet.prose);
}

/** The bullets of the added functions' own sections. */
function sectionBullets(page: Page): Bullet[] {
  return bulletsOf(page).flatMap(({ bullet, shared }) => (shared ? [] : [bullet]));
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

/** The value a comment states as JSON, or nothing when it is not JSON. */
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

/** A value as one text, the keys of each object in order, so that the order they are written in is none. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}

/** The call an example makes, whichever helper makes it: its source and its variables. */
function callKey(example: Example): string {
  return canonical([example.source, example.variables ?? null]);
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

/** What an example of 1.0.0 gives, in the shape its comment states it, read as JSON. */
async function baselineGiven(example: Example): Promise<unknown> {
  return example.helper === 'evalErrors'
    ? await evalErrors(example.source, example.variables)
    : (await evalOkWithOutput(example.source, example.variables)).value;
}

/** The examples of 1.0.0's sections. */
function baselineExamples(page: Page): Example[] {
  return page.sections.flatMap((section) => (section.added ? [] : section.examples));
}

// The checks of the page, one function each, each reporting from one place.

function checkHeadings(page: Page): Problem[] {
  return page.headings
    .filter(
      (heading, index) => page.headings.findIndex((other) => other.text === heading.text) !== index,
    )
    .map((heading) => ({ line: heading.line, text: `the heading "${heading.text}" again` }));
}

function checkSections(page: Page): Problem[] {
  return ADDED.flatMap((name) => {
    const count = page.sections.filter((section) => section.name === name).length;
    return count === 1 ? [] : [{ line: 0, text: `${name}: ${count} section(s), one wanted` }];
  });
}

function checkSignature(page: Page): Problem[] {
  return page.sections.flatMap((section) =>
    section.rules === undefined || section.rules.opening === signatureLine(section.name)
      ? []
      : [
          {
            line: section.heading.line,
            text: `${section.rules.opening}, not ${signatureLine(section.name)}`,
          },
        ],
  );
}

function checkClosingLines(page: Page): Problem[] {
  const closings = new Set(
    page.sections.flatMap((section) =>
      section.rules?.closing === undefined ? [] : [section.rules.closing.line],
    ),
  );
  return page.lines.flatMap((line, index) =>
    CLOSING.test(normalLine(line)) && !closings.has(index + 1)
      ? [{ line: index + 1, text: `"Unspecified:" outside a closing line: ${line}` }]
      : [],
  );
}

function checkLines(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) => rules.unexpected);
}

function checkAfterClosing(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) => rules.afterClosing);
}

function checkBlocks(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) => rules.noBlock);
}

function checkClosedBlocks(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) => rules.unclosed);
}

function checkBlockLines(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) => rules.stray);
}

function checkHasRules(page: Page): Problem[] {
  return rulesOf(page).flatMap((rules) =>
    rules.bullets.length > 0 ? [] : [{ line: rules.line, text: `${rules.title}: no bullets` }],
  );
}

function checkHasClosing(page: Page): Problem[] {
  return page.sections.flatMap((section) =>
    section.rules === undefined || section.rules.closing !== undefined
      ? []
      : [{ line: section.heading.line, text: `${section.name}: no closing line` }],
  );
}

function checkCharacters(page: Page): Problem[] {
  return proseOf(page).flatMap(({ line, text, closing }) => {
    const stray = strayCharacters(text, closing);
    return stray.length === 0 ? [] : [{ line, text: `it holds ${stray.map(named).join(', ')}` }];
  });
}

function checkPeriod(page: Page): Problem[] {
  return proseOf(page).flatMap(({ line, text }) =>
    text.endsWith('.') ? [] : [{ line, text: 'it does not end with "."' }],
  );
}

function checkLinkTargets(page: Page): Problem[] {
  return proseOf(page).flatMap(({ line, text }) =>
    text.includes('](') ? [{ line, text: 'a "](" that no "[" opens' }] : [],
  );
}

function checkConjunction(page: Page): Problem[] {
  return bulletsOf(page).flatMap(({ bullet }) =>
    JOINED.test(rendered(bullet.prose))
      ? [{ line: bullet.line, text: 'a comma and a conjunction join two clauses' }]
      : [],
  );
}

function checkSharedHeld(page: Page): Problem[] {
  return sectionBullets(page).flatMap((bullet) =>
    sharedRules(page).flatMap((rule) =>
      holds(bullet.prose, rule)
        ? [{ line: bullet.line, text: `holds the shared rule "${rule}"` }]
        : [],
    ),
  );
}

function checkSharedHolding(page: Page): Problem[] {
  return sectionBullets(page).flatMap((bullet) =>
    sharedRules(page).flatMap((rule) =>
      holds(rule, bullet.prose)
        ? [{ line: bullet.line, text: `is held in the shared rule "${rule}"` }]
        : [],
    ),
  );
}

function checkSharedFirstWords(page: Page): Problem[] {
  return sectionBullets(page).flatMap((bullet) =>
    sharedRules(page).flatMap((rule) =>
      firstFour(bullet.prose) === firstFour(rule)
        ? [{ line: bullet.line, text: `starts with the four words of the shared rule "${rule}"` }]
        : [],
    ),
  );
}

function checkSharedEachOther(page: Page): Problem[] {
  const rules = sharedRules(page);
  return rules.flatMap((rule, index) =>
    rules.flatMap((other, at) =>
      at !== index && holds(rule, other)
        ? [{ line: 0, text: `the shared rule "${rule}" holds "${other}"` }]
        : [],
    ),
  );
}

function checkSharedHeading(page: Page): Problem[] {
  const count = page.headings.filter(
    (heading) => heading.level === 2 && heading.text === SHARED_TITLE,
  ).length;
  return count === 1
    ? []
    : [{ line: 0, text: `${count} headings "## ${SHARED_TITLE}", one wanted` }];
}

function checkSharedOpening(page: Page): Problem[] {
  return page.shared?.opening === SHARED_INTRO
    ? []
    : [{ line: page.shared?.line ?? 0, text: `the opening sentence: ${page.shared?.opening}` }];
}

function checkExampleCount(page: Page): Problem[] {
  return bulletsOf(page).flatMap(({ bullet }) =>
    bullet.examples.length >= 2
      ? []
      : [{ line: bullet.line, text: `${bullet.examples.length} example(s), two needed` }],
  );
}

function checkExampleCalls(page: Page): Problem[] {
  return bulletsOf(page).flatMap(({ bullet, calls }) =>
    bullet.examples.flatMap((example) =>
      callsFunction(example.source, calls)
        ? []
        : [{ line: example.line, text: `${example.source} calls none of ${calls.join(', ')}` }],
    ),
  );
}

async function checkExampleResults(page: Page): Promise<Problem[]> {
  const found: Problem[] = [];
  for (const { bullet } of bulletsOf(page)) {
    for (const example of bullet.examples) {
      const expected = stated(example);
      const actual = example.variables === undefined ? undefined : await given(example);
      if (!(expected.ok && isDeepStrictEqual(actual, expected.value))) {
        found.push({
          line: example.line,
          text: `${example.source} gives ${JSON.stringify(actual)}, not ${example.comment}`,
        });
      }
    }
  }
  return found;
}

function checkExamplesDiffer(page: Page): Problem[] {
  return bulletsOf(page).flatMap(({ bullet }) => {
    const results = new Set(
      bullet.examples.map((example) => {
        const expected = stated(example);
        return expected.ok ? canonical(expected.value) : example.comment;
      }),
    );
    return bullet.examples.length < 2 || results.size >= 2
      ? []
      : [{ line: bullet.line, text: 'every example states the same result' }];
  });
}

function checkExamplesUnique(page: Page): Problem[] {
  return bulletsOf(page).flatMap(({ bullet }) =>
    bullet.examples.flatMap((example, index) =>
      bullet.examples.findIndex((other) => callKey(other) === callKey(example)) === index
        ? []
        : [{ line: example.line, text: `${example.source}: the same call shown again` }],
    ),
  );
}

function checkStatementsRead(page: Page): Problem[] {
  const read = new Set(
    page.sections
      .flatMap((section) => section.examples)
      .concat(page.shared?.bullets.flatMap((bullet) => bullet.examples) ?? [])
      .flatMap((example) =>
        Array.from({ length: example.last - example.first + 1 }, (_, k) => example.line + k),
      ),
  );
  return page.statements.flatMap((statement) =>
    read.has(statement.line)
      ? []
      : [
          {
            line: statement.line,
            text: `a call of an example helper no example reads: ${statement.text}`,
          },
        ],
  );
}

async function checkBaseline(page: Page): Promise<Problem[]> {
  const found: Problem[] = [];
  for (const example of baselineExamples(page)) {
    if (example.statement in NOT_RUN) continue;
    const json = readJson(
      example.helper === 'evalErrors' ? example.comment : example.comment.replace(/\s+\(.*\)$/, ''),
    );
    const actual = example.variables === undefined ? undefined : await baselineGiven(example);
    if (!(json.ok && isDeepStrictEqual(actual, json.value))) {
      found.push({
        line: example.line,
        text: `${example.source} gives ${JSON.stringify(actual)}, not ${example.comment}`,
      });
    }
  }
  return found;
}

function checkNotRun(page: Page): Problem[] {
  const statements = baselineExamples(page).map((example) => example.statement);
  return Object.keys(NOT_RUN).flatMap((statement) => {
    const count = statements.filter((other) => other === statement).length;
    return count === 1 ? [] : [{ line: 0, text: `${statement}: ${count} on the page, one wanted` }];
  });
}

/** What this spec checks of docs/functions.md, one function and one sentence per check. */
export const DOCS_CHECKS: readonly Check<Page>[] = [
  {
    id: 'headings',
    sentence:
      'No two headings of the page, at any level, read the same once NFKC-normalised, with every whitespace character read as one space and the ends trimmed.',
    check: checkHeadings,
  },
  {
    id: 'sections',
    sentence:
      'Each function the 1.0.0 baseline does not name has one section, under a line `### NAME` of its name as written, which runs to the next heading of level one to three.',
    check: checkSections,
  },
  {
    id: 'signature',
    sentence:
      'Such a section opens with its signature line, the whole line as the live registry renders it.',
    check: checkSignature,
  },
  {
    id: 'closing-lines',
    sentence:
      'A line of the page that, read with every whitespace character as one space, starts with `Unspecified:` is the closing line of such a section.',
    check: checkClosingLines,
  },
  {
    id: 'lines',
    sentence:
      'Read line by line after NFKC normalisation, with every whitespace character as one space and format characters dropped, each line of such a section after its signature line, and of the shared rules after their opening sentence, up to its closing line is blank, a top-level bullet or a line of the code block that follows a bullet.',
    check: checkLines,
  },
  {
    id: 'after-closing',
    sentence:
      'Read so, no line but a blank one follows the closing line of such a section, up to the next heading of level one to three.',
    check: checkAfterClosing,
  },
  {
    id: 'blocks',
    sentence:
      'Each bullet is followed, after blank lines only, by a code block that opens with two spaces, three or more backticks and `ts`.',
    check: checkBlocks,
  },
  {
    id: 'closed-blocks',
    sentence: 'Each code block closes with a line of its own fence inside its section.',
    check: checkClosedBlocks,
  },
  {
    id: 'block-lines',
    sentence:
      'Every line of a code block belongs to an example statement, `await evalOk(` or `await evalErrors(`, the call and `);`, with what it gives after `// `, on one line or across several.',
    check: checkBlockLines,
  },
  {
    id: 'has-rules',
    sentence: 'Such a section, and the shared rules, have at least one bullet.',
    check: checkHasRules,
  },
  {
    id: 'has-closing',
    sentence: 'Such a section has a closing line, one that starts with `Unspecified:`.',
    check: checkHasClosing,
  },
  {
    id: 'characters',
    sentence:
      'With its code spans taken out, the target of each link that a `[` opens taken out with it, every whitespace character read as one space and after NFKC normalisation, a bullet or a closing line holds only letters, marks, numbers, spaces, `,`, `(`, `)`, `[`, `]`, a hyphen-minus, an apostrophe or an underscore after a letter, mark or number and before a letter or number, a `+` inside a `U+` code point in capitals, a final `.` and, in a closing line, the colon of `Unspecified:` at its start.',
    check: checkCharacters,
  },
  {
    id: 'period',
    sentence: 'Read so, a bullet or a closing line ends with `.`.',
    check: checkPeriod,
  },
  {
    id: 'link-targets',
    sentence: 'Read so, no bullet or closing line holds a `](` that no `[` opens.',
    check: checkLinkTargets,
  },
  {
    id: 'conjunction',
    sentence:
      'Read with each code span and each link as its text, after NFKC normalisation and with every whitespace character as one space, no bullet holds a comma followed, after any whitespace or none, by "and", "or", "but", "nor", "so", "yet" or "then".',
    check: checkConjunction,
  },
  {
    id: 'shared-held',
    sentence:
      'Read with the target of each link that a `[` opens taken out, after NFKC normalisation, with format characters and the marks `` ` ``, `*`, `_` and `~` dropped, every other punctuation mark or symbol read as a space and case folded by upper then lower case, no bullet of a section holds all the words of a shared rule in a row.',
    check: checkSharedHeld,
  },
  {
    id: 'shared-holding',
    sentence: 'Read so, no bullet of a section has all its words in a row inside a shared rule.',
    check: checkSharedHolding,
  },
  {
    id: 'shared-first-words',
    sentence: 'Read so, no bullet of a section starts with the same four words as a shared rule.',
    check: checkSharedFirstWords,
  },
  {
    id: 'shared-each-other',
    sentence: 'Read so, no shared rule holds all the words of another in a row.',
    check: checkSharedEachOther,
  },
  {
    id: 'shared-heading',
    sentence:
      'One heading of the page, and no other, stands at level two and reads `Shared rules` once NFKC-normalised, with every whitespace character read as one space and the ends trimmed.',
    check: checkSharedHeading,
  },
  {
    id: 'shared-opening',
    sentence: 'The shared rules open with their one sentence, the one this spec states.',
    check: checkSharedOpening,
  },
  {
    id: 'example-count',
    sentence: 'Each bullet has at least two examples.',
    check: checkExampleCount,
  },
  {
    id: 'example-calls',
    sentence:
      'The parser, reading each example against the live registry, finds a call of the function of its section in it, or in the shared rules a call of a function the baseline does not name, and a name inside a string literal is no call.',
    check: checkExampleCalls,
  },
  {
    id: 'example-results',
    sentence:
      'Each example of a bullet, run with the variables it gives, gives what its comment states, the value and the warning for `evalOk` and the error codes for `evalErrors`.',
    check: checkExampleResults,
  },
  {
    id: 'examples-differ',
    sentence:
      'At least two of the examples of a bullet state different results, compared as values in which the keys of an object may stand in any order.',
    check: checkExamplesDiffer,
  },
  {
    id: 'examples-unique',
    sentence:
      'No code block shows one call twice, the same source with the same variables, compared as values in which the keys of an object may stand in any order, under either helper.',
    check: checkExamplesUnique,
  },
  {
    id: 'statements-read',
    sentence:
      'Every line of the page that, with its code spans taken out, calls `evalOk` or `evalErrors` belongs to an example statement read in the section of a function or in the shared rules.',
    check: checkStatementsRead,
  },
  {
    id: 'baseline',
    sentence:
      'Every example statement of a function the baseline names gives the value its comment states, read as JSON less a note in brackets after it, but six statements this spec names, each as a whole.',
    check: checkBaseline,
  },
  {
    id: 'not-run',
    sentence:
      'Each of those six statements stands on the page once: two whose value is the current date, three that name a variable they do not give and one whose comment marks its value with `~`.',
    check: checkNotRun,
  },
];

/** What the checks of `DOCS_CHECKS` cannot decide: the reviewer's. */
export const REVIEWER_CHECKS: readonly { id: string; sentence: string }[] = [
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

/**
 * A file that names this spec, read once by the grammar of a claim site: the one line that names
 * the spec is the lead-in, then a blank line, the table's sentences as one list of one line each, a
 * blank line, the reviewer's lead-in, a blank line, the reviewer's sentences as one list, and
 * nothing but blank lines after them up to the next heading or the end of the file, all at the
 * lead-in's indent.
 */
type ClaimSite = {
  path: string;
  /** The lines that name this spec, from 1. */
  naming: number[];
  /** Whether the first of them is the lead-in. */
  leadIn: boolean;
  blankAfterLeadIn: boolean;
  checks: string[];
  blankAfterChecks: boolean;
  reviewLeadIn: string | undefined;
  blankAfterReviewLeadIn: boolean;
  reviewer: string[];
  /** The lines after the reviewer's list, before the next heading, that are not blank. */
  after: Problem[];
};

function readClaimSite(path: string, text: string): ClaimSite {
  const lines = text.split('\n');
  const naming = lines.flatMap((line, index) =>
    line.includes('function-docs.spec.ts') ? [index] : [],
  );
  const start = naming[0] ?? -1;
  const site: ClaimSite = {
    path,
    naming: naming.map((index) => index + 1),
    leadIn: start >= 0 && lines[start].trim() === LEAD_IN,
    blankAfterLeadIn: false,
    checks: [],
    blankAfterChecks: false,
    reviewLeadIn: undefined,
    blankAfterReviewLeadIn: false,
    reviewer: [],
    after: [],
  };
  if (!site.leadIn) return site;
  const indent = lines[start].length - lines[start].trimStart().length;
  const pad = ' '.repeat(indent);
  let index = start + 1;
  const blank = () => {
    const found = lines[index]?.trim() === '';
    index += 1;
    return found;
  };
  const list = () => {
    const items: string[] = [];
    while (index < lines.length && lines[index].startsWith(`${pad}- `)) {
      items.push(lines[index].slice(indent + 2));
      index += 1;
    }
    return items;
  };
  site.blankAfterLeadIn = blank();
  site.checks = list();
  site.blankAfterChecks = blank();
  site.reviewLeadIn = lines[index]?.startsWith(pad) ? lines[index].slice(indent) : lines[index];
  index += 1;
  site.blankAfterReviewLeadIn = blank();
  site.reviewer = list();
  for (; index < lines.length && !/^#{1,6} /.test(lines[index]); index++) {
    if (lines[index].trim() !== '') site.after.push({ line: index + 1, text: lines[index] });
  }
  return site;
}

function checkClaimNaming(site: ClaimSite): Problem[] {
  return site.naming.length === 1 && site.leadIn
    ? []
    : [
        {
          line: site.naming[0] ?? 0,
          text: `names this spec on lines ${site.naming.join(', ')}, the lead-in alone wanted`,
        },
      ];
}

function checkClaimChecks(site: ClaimSite): Problem[] {
  return site.blankAfterLeadIn &&
    isDeepStrictEqual(
      site.checks,
      DOCS_CHECKS.map((check) => check.sentence),
    )
    ? []
    : [
        {
          line: site.naming[0] ?? 0,
          text: "the list of checks is not one blank line after the lead-in, the table's sentences in its order",
        },
      ];
}

function checkClaimReviewLeadIn(site: ClaimSite): Problem[] {
  return site.blankAfterChecks && site.reviewLeadIn === REVIEW_LEAD_IN
    ? []
    : [
        {
          line: 0,
          text: `"${REVIEW_LEAD_IN}" not one blank line after the list: ${site.reviewLeadIn}`,
        },
      ];
}

function checkClaimReviewer(site: ClaimSite): Problem[] {
  return site.blankAfterReviewLeadIn &&
    isDeepStrictEqual(
      site.reviewer,
      REVIEWER_CHECKS.map((check) => check.sentence),
    )
    ? []
    : [
        {
          line: 0,
          text: "the reviewer's list is not one blank line after its lead-in, the table's sentences in its order",
        },
      ];
}

function checkClaimAfter(site: ClaimSite): Problem[] {
  return site.after.map((line) => ({
    line: line.line,
    text: `a line after the lists: ${line.text}`,
  }));
}

/** What this spec checks of each file that lists the checks, one function and one sentence each. */
const CLAIM_CHECKS: readonly Check<ClaimSite>[] = [
  {
    id: 'claim-naming',
    sentence: 'Such a file names this spec on one line, the lead-in.',
    check: checkClaimNaming,
  },
  {
    id: 'claim-checks',
    sentence:
      "After one blank line the lead-in is followed by the table's sentences as a list in its order, one item per line, at the lead-in's indent.",
    check: checkClaimChecks,
  },
  {
    id: 'claim-review-lead-in',
    sentence: "After one blank line that list is followed by the reviewer's lead-in.",
    check: checkClaimReviewLeadIn,
  },
  {
    id: 'claim-reviewer',
    sentence:
      "After one blank line the reviewer's lead-in is followed by the reviewer's sentences as a list in its order.",
    check: checkClaimReviewer,
  },
  {
    id: 'claim-after',
    sentence:
      "Nothing but blank lines follows the reviewer's list up to the next heading or the end of the file.",
    check: checkClaimAfter,
  },
];

/** Every problem of a page by the checks of `DOCS_CHECKS`, each under its id. */
async function checkPage(text: string): Promise<string[]> {
  const page = readPage(text);
  const found: string[] = [];
  for (const { id, check } of DOCS_CHECKS) {
    for (const { line, text: what } of await check(page))
      found.push(`${id}: line ${line}: ${what}`);
  }
  return found;
}

/** Every problem of a claim site by the checks of `CLAIM_CHECKS`, each under its id. */
function checkClaimSite(path: string, text: string): string[] {
  const site = readClaimSite(path, text);
  return CLAIM_CHECKS.flatMap(({ id, check }) =>
    (check(site) as Problem[]).map(({ line, text: what }) => `${id}: ${path}:${line}: ${what}`),
  );
}

// The fixtures.

/**
 * The text of a section of the real page, from its heading up to the next heading, for the small
 * page the fixtures edit.
 */
function sectionText(heading: string): string {
  const lines = DOCS.split('\n');
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && !/^#{1,6} /.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

/**
 * A small page built from the real one: the shared rules, the section of one added function
 * (`TAKE`), and sections of 1.0.0: `LEN`, and those that hold the statements this spec does not
 * run. Each fixture edits it, and the check it belongs to must report a problem the unedited page
 * does not have.
 */
const SMALL_PAGE = [
  '# Functions',
  '',
  sectionText(`## ${SHARED_TITLE}`),
  '## Lists',
  '',
  sectionText('### TAKE'),
  sectionText('### LEN'),
  sectionText('### ROUND'),
  sectionText('### SORT_BY_PROPERTY'),
  sectionText('### FILTER_PROPERTY'),
  sectionText('### NOW'),
  sectionText('### TODAY'),
].join('\n');

/** A fixture: text to find once in a page and what to put in its place. */
type Fixture = { find: string; replace: string };

const TAKE_SIGNATURE = '`TAKE(list: list<T>, count: number, start?: number) -> list<T>`';
const TAKE_RULE = '- Items are taken as they are, `null` and `""` included.';
const TAKE_EXAMPLE =
  "  await evalOk('TAKE(value; 2)', { value: [null, '', 'a'] }); // [null, \"\"]";
const TAKE_CLOSING = 'Unspecified: nothing.';
const LEN_EXAMPLE = 'await evalOk(\'LEN("abc")\'); // 3';
const SHARED_RULE = '- A `null` given for an argument the function requires returns `null`.';
const block = (...examples: string[]) =>
  ['', '  ```ts', ...examples.map((example) => `  ${example}`), '  ```', ''].join('\n');

/** One fixture for each check of `DOCS_CHECKS`: an edit of the small page its function reports. */
const FIXTURES: Record<string, Fixture> = {
  headings: { find: '## Lists', replace: '## TAKE\n\n## Lists' },
  sections: { find: '### TAKE', replace: `${sectionText('### TAKE')}\n### TAKE` },
  signature: {
    find: TAKE_SIGNATURE,
    replace: '`TAKE(list: list<T>, count: number, start: number) -> list<T>`',
  },
  'closing-lines': { find: '## Lists', replace: '## Lists\n\nUnspecified: lists.' },
  lines: { find: TAKE_CLOSING, replace: `---\n\n${TAKE_CLOSING}` },
  'after-closing': {
    find: TAKE_CLOSING,
    replace: `${TAKE_CLOSING}\n\n#### Notes\n\nA count of 9 gives every item.`,
  },
  blocks: { find: TAKE_RULE, replace: `- A rule with no examples.\n\n${TAKE_RULE}` },
  'closed-blocks': { find: `  \`\`\`\n\n${TAKE_CLOSING}`, replace: `\n${TAKE_CLOSING}` },
  'block-lines': {
    find: TAKE_EXAMPLE,
    replace: `  const list = [null, '', 'a'];\n${TAKE_EXAMPLE}`,
  },
  'has-rules': {
    find: '## Lists',
    replace: `## Lists\n\n### INDEX_OF\n\n\`INDEX_OF(list: list<T>, value: T) -> number\`\n\n${TAKE_CLOSING}\n`,
  },
  'has-closing': { find: `\n\n${TAKE_CLOSING}`, replace: '' },
  characters: {
    find: TAKE_RULE,
    replace: '- Items are taken as they are; `null` and `""` included.',
  },
  period: { find: TAKE_RULE, replace: '- Items are taken as they are, `null` and `""` included' },
  'link-targets': {
    find: TAKE_RULE,
    replace: '- Items are taken](x) as they are, `null` and `""` included.',
  },
  conjunction: {
    find: TAKE_RULE,
    replace: '- Items are taken as they are, [and](#take) `null` and `""` are included.',
  },
  'shared-held': {
    find: TAKE_RULE,
    replace: '- A `null` given for an argument the function requires returns `null` as stated.',
  },
  'shared-holding': {
    find: TAKE_RULE,
    replace: '- An argument the function requires returns `null`.',
  },
  'shared-first-words': { find: TAKE_RULE, replace: '- A `null` given for nothing else is kept.' },
  'shared-each-other': {
    find: SHARED_INTRO,
    replace: `${SHARED_INTRO}\n\n${SHARED_RULE}${block(
      "await evalOk('TAKE(value; 1)', { value: null }); // null",
      "await evalOk('TAKE(value; 1)', { value: [1] }); // [1]",
    )}`,
  },
  'shared-heading': { find: '## Lists', replace: `## ${SHARED_TITLE} \n\n## Lists` },
  'shared-opening': {
    find: SHARED_INTRO,
    replace: 'These rules hold in the sections that state their function as rules.',
  },
  'example-count': {
    find: TAKE_RULE,
    replace: `- A list of one item gives that item.${block("await evalOk('TAKE(LIST(1); 1)'); // [1]")}\n${TAKE_RULE}`,
  },
  'example-calls': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.${block("await evalOk('TAKE(LIST(1; 2); 2)'); // [1, 2]", 'await evalOk(\'LEN("ab")\'); // 2')}\n${TAKE_RULE}`,
  },
  'example-results': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.${block("await evalOk('TAKE(LIST(1; 2); 2)'); // [2, 1]", "await evalOk('TAKE(LIST(1; 2); 1)'); // [1]")}\n${TAKE_RULE}`,
  },
  'examples-differ': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.${block('await evalOk(\'TAKE(value; 2)\', { value: [{ a: 1, b: 2 }] }); // [{"a": 1, "b": 2}]', 'await evalOk(\'TAKE(value; 3)\', { value: [{ a: 1, b: 2 }] }); // [{"b": 2, "a": 1}]')}\n${TAKE_RULE}`,
  },
  'examples-unique': {
    find: TAKE_RULE,
    replace: `- A list of two items gives two.${block("await evalOk('TAKE(value; 2)', { value: [1, 2], other: 1 }); // [1, 2]", "await evalErrors('TAKE(value; 2)', { other: 1, value: [1, 2] }); // []")}\n${TAKE_RULE}`,
  },
  'statements-read': {
    find: LEN_EXAMPLE,
    replace: `${LEN_EXAMPLE}\n> await evalOk('LEN("abcd")'); // 3`,
  },
  baseline: { find: LEN_EXAMPLE, replace: 'await evalOk(\'LEN("abc")\'); // 4' },
  'not-run': {
    find: 'await evalOk(\'TODAY().iso\'); // e.g. "2026-07-03"',
    replace:
      'await evalOk(\'TODAY().iso\'); // e.g. "2026-07-03"\nawait evalOk(\'TODAY().iso\'); // e.g. "2026-07-03"',
  },
};

/** A claim site of the repository's grammar, then `tail`. */
function claimSite(tail = ''): string {
  return [
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
}

/** One fixture for each check of `CLAIM_CHECKS`: an edit of a claim site its function reports. */
const CLAIM_FIXTURES: Record<string, Fixture> = {
  'claim-naming': {
    find: '# A site',
    replace: '# A site\n\nRead `core-functions/src/functions/function-docs.spec.ts`.',
  },
  'claim-checks': { find: `- ${DOCS_CHECKS[0].sentence}\n`, replace: '' },
  'claim-review-lead-in': { find: REVIEW_LEAD_IN, replace: 'The reviewer decides these:' },
  'claim-reviewer': {
    find: `- ${REVIEWER_CHECKS[0].sentence}`,
    replace: `- ${REVIEWER_CHECKS[0].sentence}\n- Whether a rule is true.`,
  },
  'claim-after': {
    find: `- ${REVIEWER_CHECKS[REVIEWER_CHECKS.length - 1].sentence}`,
    replace: `- ${REVIEWER_CHECKS[REVIEWER_CHECKS.length - 1].sentence}\nIt also checks that the examples sit on either side.`,
  },
};

/** `text` with one fixture applied, its text found there once. */
function edited(text: string, fixture: Fixture): string {
  expect(text.split(fixture.find).length, `${fixture.find}: found once`).toBe(2);
  return text.replace(fixture.find, () => fixture.replace);
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

describe('docs/functions.md', () => {
  it('departs from none of the checks of DOCS_CHECKS', async () => {
    expect(ADDED.length).toBeGreaterThan(0);
    const problems = await checkPage(DOCS);
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });
});

describe('the checks prove themselves', () => {
  it('has one fixture for each check of the tables, and none for a check they do not hold', () => {
    expect(Object.keys(FIXTURES).sort()).toStrictEqual(DOCS_CHECKS.map((check) => check.id).sort());
    expect(Object.keys(CLAIM_FIXTURES).sort()).toStrictEqual(
      CLAIM_CHECKS.map((check) => check.id).sort(),
    );
  });

  it('gives each check an id and a function of its own', () => {
    const ids = [...DOCS_CHECKS, ...REVIEWER_CHECKS, ...CLAIM_CHECKS].map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    const functions = [...DOCS_CHECKS, ...CLAIM_CHECKS].map((check) => check.check);
    expect(new Set(functions).size).toBe(functions.length);
  });

  for (const { id } of DOCS_CHECKS) {
    it(`${id}: turns its fixture red`, async () => {
      const before = new Set(await checkPage(SMALL_PAGE));
      const after = await checkPage(edited(SMALL_PAGE, FIXTURES[id]));
      const found = after.filter((text) => !before.has(text) && text.startsWith(`${id}: `));
      expect(found, `${id}: no problem of its own on its fixture`).not.toStrictEqual([]);
    });
  }

  for (const { id } of CLAIM_CHECKS) {
    it(`${id}: turns its fixture red`, () => {
      expect(checkClaimSite('site', claimSite())).toStrictEqual([]);
      const found = checkClaimSite('site', edited(claimSite(), CLAIM_FIXTURES[id])).filter((text) =>
        text.startsWith(`${id}: `),
      );
      expect(found, `${id}: no problem of its own on its fixture`).not.toStrictEqual([]);
    });
  }
});

describe('the checks, as the repository lists them', () => {
  it('is listed by every file of the repository that names this spec, by the grammar of a claim site', () => {
    const root = new URL('../../../', import.meta.url);
    const naming = markdownFiles(root).filter((path) =>
      readFileSync(new URL(path, root), 'utf8').includes('function-docs.spec.ts'),
    );
    expect(naming.sort()).toStrictEqual([...CLAIM_SITES].sort());
    const problems = naming.flatMap((path) =>
      checkClaimSite(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(problems, problems.join('\n')).toStrictEqual([]);
  });

  it('accepts a claim site whose lists end the file or a heading follows', () => {
    expect(checkClaimSite('site', claimSite())).toStrictEqual([]);
    expect(checkClaimSite('site', claimSite('\n## Next\n\nAnything.'))).toStrictEqual([]);
  });
});
