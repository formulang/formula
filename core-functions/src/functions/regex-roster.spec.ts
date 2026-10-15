import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * The step counts of the counted text functions see what their scans read, through a
 * `CountedText`, and nothing inside a regular expression. So every regular expression of the
 * modules those functions live in is listed here with why it reads its input in linear time, and
 * this spec reconciles the list, both ways, with the expressions it finds on each module's syntax
 * tree: a regular expression added, changed or removed in one of them turns it red until the list
 * says what it reads. The modules are the ones that import `./work-count`, and `helpers.ts`, whose
 * word test reads the characters they hand it.
 */

const DIR = __dirname;

/** A regular expression as written in its module, and why it reads its input in linear time. */
type Entry = { readonly regex: string; readonly linear: string };

const ONE_CHARACTER = 'Tests one character.';

const ROSTER: Readonly<Record<string, readonly Entry[]>> = {
  'markup-text.ts': [
    {
      regex: String.raw`/\s+/gu`,
      linear: 'One class repeated, in a global replace over a line: each code unit read once.',
    },
    { regex: String.raw`/^[A-Za-z]$/`, linear: ONE_CHARACTER },
    {
      regex: String.raw`/[A-Z]+/g`,
      linear: 'One class repeated, in a global replace over a tag name: each code unit read once.',
    },
    {
      regex: String.raw`/[^\t\n\f\r ]/`,
      linear: 'One character class, unanchored: each code unit tested once.',
    },
    {
      regex: String.raw`/&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g`,
      linear:
        'Starts only at `&`, and every alternative is bounded: at most 34 code units an attempt.',
    },
    {
      regex: String.raw`/\r\n|\r|\n/g`,
      linear: 'Fixed alternatives of at most two code units.',
    },
    {
      regex: String.raw`/ {0,3}> ?/y`,
      linear:
        'Sticky and bounded: at most five code units an attempt, at a marker the scan moves past.',
    },
    {
      regex: String.raw`/^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*))?$/`,
      linear:
        'Anchored; after at most nine code units, the spaces are followed by a tail that takes the rest of the line, where `$` holds.',
    },
    {
      regex: String.raw`/^([ \t]*)(` + '`' + String.raw`{3,}|~{3,})([\s\S]*)/`,
      linear:
        'Anchored; the spaces stop at a fence character they cannot match, and the tail takes the rest of the line.',
    },
    {
      regex: String.raw`/^[ \t]*(` + '`' + String.raw`{3,}|~{3,})[ \t]*$/`,
      linear:
        'Anchored; each repetition stops at a character it cannot match: a fence character, a space, the end.',
    },
    {
      regex: String.raw`/^[ \t]*(?:[-*+]|([0-9]{1,9})[.)])(?:[ \t]+([\s\S]*))?$/`,
      linear:
        'Anchored; the spaces stop at a marker they cannot match, the number is bounded, the tail takes the rest of the line.',
    },
    {
      regex: String.raw`/^:?-+:?$/`,
      linear: 'Anchored over one cell: the run of dashes stops at a colon or the end.',
    },
    { regex: String.raw`/^[!-\/:-@[-` + '`' + String.raw`{-~]$/`, linear: ONE_CHARACTER },
    { regex: String.raw`/^\s$/u`, linear: ONE_CHARACTER },
    { regex: String.raw`/^[\p{P}\p{S}]$/u`, linear: ONE_CHARACTER },
    {
      regex: String.raw`/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]{0,2000}|[^\s<>@]{1,256}@[^\s<>@]{1,256})>/y`,
      linear:
        'Sticky at a `<`; every repetition is bounded and stops at whitespace, `<` or `>`: an attempt reads up to the next `<`, twice at most.',
    },
  ],
  'phrase-match.ts': [
    {
      regex: String.raw`/\s+/gu`,
      linear: 'One class repeated, in a global replace: each code unit read once.',
    },
    {
      regex: String.raw`/[\u2018\u2019\u201A\u201B\u2039\u203A]/gu`,
      linear: 'One character class, in a global replace: each code unit tested once.',
    },
    {
      regex: String.raw`/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/gu`,
      linear: 'One character class, in a global replace: each code unit tested once.',
    },
    {
      regex: String.raw`/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu`,
      linear: 'One character class, in a global replace: each code unit tested once.',
    },
  ],
  'text-search.ts': [],
  'text-segmentation.ts': [
    {
      regex: String.raw`/\S+/gu`,
      linear: 'One class repeated, matched globally: each code unit read once.',
    },
    {
      regex: String.raw`/[\p{L}\p{M}\p{N}]+(?:(?:['\u2019\u2010\u2011\u00AD-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*/gu`,
      linear:
        'Each repetition starts with a joining character the letter class cannot match, so a code unit has one place in a match; the lookarounds read one character.',
    },
    {
      regex: String.raw`/(?<=[.!?])\s+/gu`,
      linear: 'A one-character lookbehind, then one class repeated, matched globally.',
    },
    {
      regex: String.raw`/[.!?\u3002\uFF01\uFF1F]+/gu`,
      linear: 'One class repeated, matched globally: each code unit read once.',
    },
    {
      regex: String.raw`/[^\s.!?\u3002\uFF01\uFF1F]/u`,
      linear: 'One character class, unanchored: each code unit tested once.',
    },
    {
      regex: '/\\r\\n|[\\n\\r\\u000B\\u000C\\u0085\\u2028\\u2029]/u',
      linear: 'Fixed alternatives of at most two code units, in a split.',
    },
    {
      regex: String.raw`/^[imsu]*$/`,
      linear: "Anchored; one class repeated over a pattern's flags.",
    },
  ],
  'helpers.ts': [{ regex: String.raw`/^[\p{L}\p{M}\p{N}]$/u`, linear: ONE_CHARACTER }],
  'work-count.ts': [],
};

function syntaxTree(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(DIR, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** The modules of the counted functions: those that import `./work-count`, and `helpers.ts`. */
function countedModules(): string[] {
  const modules = readdirSync(DIR).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
  );
  const counting = modules.filter((file) =>
    syntaxTree(file).statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === './work-count',
    ),
  );
  return [...counting, 'helpers.ts', 'work-count.ts'].sort();
}

/** The regular expressions on the syntax tree of `file`: literals, and `RegExp` constructions. */
function regexesOf(file: string): string[] {
  const source = syntaxTree(file);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) found.push(node.getText(source));
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RegExp'
    ) {
      found.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the regular expressions of the counted text functions', () => {
  it('lists the modules of the counted functions, both ways', () => {
    const modules = countedModules();
    // Not vacuous: the markup, segmentation and phrase functions count their work.
    expect(modules).toEqual(
      expect.arrayContaining(['markup-text.ts', 'phrase-match.ts', 'text-segmentation.ts']),
    );
    expect(modules).toStrictEqual(Object.keys(ROSTER).sort());
  });

  it('lists every regular expression of those modules with why it is linear, both ways', () => {
    let listed = 0;
    for (const [file, entries] of Object.entries(ROSTER)) {
      expect(regexesOf(file).sort(), file).toStrictEqual(
        entries.map((entry) => entry.regex).sort(),
      );
      for (const entry of entries) expect(entry.linear.length, entry.regex).toBeGreaterThan(10);
      listed += entries.length;
    }
    // Not vacuous: the syntax trees hold regular expressions to reconcile.
    expect(listed).toBeGreaterThanOrEqual(20);
  });
});
