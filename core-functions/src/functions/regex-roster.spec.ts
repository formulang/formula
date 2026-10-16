import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * Every regular expression core-functions compiles is listed here with how it reads its input.
 * The list is a maintainer's guard against a pattern added, changed or removed without its
 * listing; the project's review owns code written to slip past it. Each listing says how its
 * pattern reads its input, so a pattern a formula can drive past the limits is in view:
 * `SECURITY.md` counts bypassing resource limits as a vulnerability. How a function's own loops
 * read their input, and how often a function runs a listed pattern, are stated in
 * `docs/functions.md` from the code; no spec checks them.
 *
 * The spec reads every module under `src` with the TypeScript type checker and reconciles the list
 * with what it finds, both ways. A reference by name below is an identifier, a property name, or
 * the literal key of an element access or of a destructuring, outside a type (a class's `extends`
 * clause, and the operand of an instantiation expression `f<T>`, are not types); a name a
 * declaration declares (a variable, a parameter, a member, a property of an object literal, an
 * enum member, an import) is no reference. It reads:
 * - every regular expression literal;
 * - every construction, a call or `new` by the name `RegExp` or one the checker resolves to
 *   `RegExpConstructor`, keyed by what it writes: its pattern and flags are folded through string
 *   and template literals, `+` of texts, `String.raw`, conditionals (a key per branch), constants,
 *   imports and re-exports; a construction written in full is keyed as a literal, and one with
 *   parts a value fills by the function that builds it and what it writes, each such part a hole
 *   `${source}` named by its source, so a change to a written character, to where a hole is or to
 *   what it names changes the key;
 * - every other reference by the name `RegExp`: as the right side of `instanceof`, nothing; as a
 *   member of a receiver declared in the repository, a site; anything else is a problem;
 * - every site named like a method that compiles or runs a pattern (`match`, `matchAll`, `search`,
 *   `replace`, `replaceAll`, `split`, `test`, `exec`, `compile`, or a `Symbol.match`, `matchAll`,
 *   `replace`, `search` or `split` key), on any receiver: a call of a `String` or `RegExp` method
 *   is classified (a pattern a string `match`, `matchAll` or `search` compiles must be written in
 *   full; a pattern a call runs is followed through constants, imports, parameters at every call,
 *   returned values, object properties, destructuring, conditionals and maps to the literal or
 *   construction it comes from); a `compile` on a receiver that is a `RegExp`, the `RegExp`
 *   interface's own, or one the checker cannot resolve, and a `String` or `RegExp` method used as a
 *   value (`call`, `apply`, `bind`, an assignment, a destructuring), are problems; any other such
 *   site is a problem unless `NOT_PATTERNS` lists it by module, line, column and name;
 * - every reference by the name `eval`, `Function` or `Reflect`: as a member of a receiver
 *   declared in the repository, and not the global object, a site; anything else is a problem;
 * - every `prototype` of `String`, `RegExp` or `Function`: a problem;
 * - every receiver of a site so named, and every callee, that the checker types `any` or
 *   `unknown`: a problem.
 * Also a problem: an element access whose key is not a literal, where it is called or its value
 * can be; a cast that makes a value callable; a spec file a module imports; a file under `src`
 * that is not a TypeScript module. A problem has no listing. Each site is reported once, and the
 * spec's own cases check each rule above.
 *
 * The spec does not decide a spelling that hides the construct from the type checker (a value
 * made callable through a type annotation or a type predicate, an alias typed with its own
 * construct signature, code run by any other route such as `node:vm`), what a value filling a
 * hole holds, or code outside core-functions' `src`: the program type-checks the packages
 * core-functions imports, and a pattern followed into one is reported as a value from outside
 * core-functions, but a helper there that compiles a pattern itself, such as one
 * `@formulang/definitions` exports, is not read. `compileSafeRegex`, 1.0.0's helper for a
 * formula's own pattern, is listed with the gap its rules leave.
 */

const SRC = path.join(__dirname, '..');
const REPO = path.join(SRC, '..', '..');

/** A pattern, as `RegExp.prototype.toString` writes it, and how it reads its input. */
type PatternEntry = { readonly regex: string; readonly reads: string };
/**
 * A pattern built at run time from a value: the function that builds it, what its construction
 * writes (`/pattern/flags`, each part a value fills written `${source}`), and what bounds it.
 */
type BuiltEntry = { readonly builtIn: string; readonly from: string; readonly reads: string };
type Entry = PatternEntry | BuiltEntry;

const ROSTER: Readonly<Record<string, readonly Entry[]>> = {
  'functions/date-time-helpers.ts': [
    {
      regex:
        '/^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?$/',
      reads:
        'Anchored; every part is fixed-width but the fraction digits, which stop at the first other character and give each one back once.',
    },
    {
      regex: '/[T ]([0-9]{2}:[0-9]{2}(?::[0-9]{2})?)(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$/',
      reads:
        'Starts only at a `T` or a space, which no fraction digit is, so no digit is read by two attempts, and each attempt is fixed-width but the fraction.',
    },
    {
      regex: '/^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/',
      reads: 'Anchored and fixed-width: at most eight code units.',
    },
  ],
  'functions/helpers.ts': [{ regex: '/^[\\p{L}\\p{M}\\p{N}]$/u', reads: 'Tests one character.' }],
  'functions/markup-text.ts': [
    {
      regex: '/\\s+/gu',
      reads: 'One class repeated, in a global replace: each code unit read once.',
    },
    {
      regex: '/<\\/script(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    {
      regex: '/<\\/style(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    {
      regex: '/<\\/title(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    {
      regex: '/<\\/noframes(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    {
      regex: '/<\\/noscript(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    {
      regex: '/<\\/template(?=[\\t\\n\\f\\r />])/gi',
      reads:
        'A fixed end tag, case-insensitive, then a one-character lookahead: each attempt reads at most the tag and one code unit.',
    },
    { regex: '/^[A-Za-z]$/', reads: 'Tests one character.' },
    {
      regex: '/[A-Z]+/g',
      reads: 'One class repeated, in a global replace over a tag name: each code unit read once.',
    },
    {
      regex: '/[^\\t\\n\\f\\r ]/',
      reads: 'One character class, unanchored: each code unit tested once.',
    },
    {
      regex: '/&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g',
      reads:
        'Starts only at `&`, which no alternative can take again, and every alternative is bounded: at most 34 code units an attempt.',
    },
    { regex: '/\\r\\n|\\r|\\n/g', reads: 'Fixed alternatives of at most two code units.' },
    {
      regex: '/\\r\\n|\\r|\\n/',
      reads: 'Fixed alternatives of at most two code units, in a split.',
    },
    {
      regex: '/ {0,3}> ?/y',
      reads:
        'Sticky and bounded: at most five code units an attempt, one attempt per marker the scan moves past.',
    },
    {
      regex: '/^ {0,3}(#{1,6})(?:[ \\t]+([\\s\\S]*))?$/',
      reads:
        'Anchored; after at most nine code units the spaces stop at the first other character, and the tail takes the rest of the line, where `$` holds.',
    },
    {
      regex: '/^([ \\t]*)(`{3,}|~{3,})([\\s\\S]*)/',
      reads:
        'Anchored; the spaces stop at a fence character they cannot match, giving one back tests one character, and the tail takes the rest of the line.',
    },
    {
      regex: '/^[ \\t]*(`{3,}|~{3,})[ \\t]*$/',
      reads:
        'Anchored; each run stops at a character it cannot match, so giving one code unit back tests one character.',
    },
    {
      regex: '/^ {0,3}([-*_])(?:[ \\t]*\\1){2,}[ \\t]*$/',
      reads:
        'Anchored; a repetition is spaces then the marker, so giving a space back leaves a character the marker cannot match, and each repetition is undone once.',
    },
    {
      regex: '/^[ \\t]*(?:[-*+]|([0-9]{1,9})[.)])(?:[ \\t]+([\\s\\S]*))?$/',
      reads:
        'Anchored; the spaces stop at the marker they cannot match, the number is bounded, and the tail takes the rest of the line.',
    },
    {
      regex: '/^:?-+:?$/',
      reads:
        'Anchored over one table cell: the dashes stop at a colon or the end, so giving one back tests one character.',
    },
    { regex: '/^[!-\\/:-@[-`{-~]$/', reads: 'Tests one character.' },
    { regex: '/^\\s$/u', reads: 'Tests one character.' },
    { regex: '/^[\\p{P}\\p{S}]$/u', reads: 'Tests one character.' },
    {
      regex:
        '/!?\\[((?:[^[\\]\\n]|\\[[^[\\]\\n]{0,500}\\]){0,1000})\\]\\((?:[^()\\n]|\\([^()\\n]{0,500}\\)){0,2000}\\)/y',
      reads:
        "Sticky at a `[`; an item is a code unit or a pair its first character decides, every repetition is bounded, and an attempt that starts inside another's text ends at the pair's `]`, so a code unit is read by at most two attempts.",
    },
    {
      regex:
        '/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]{0,2000}|[^\\s<>@]{1,256}@[^\\s<>@]{1,256})>/y',
      reads:
        'Sticky at a `<`; every repetition is bounded and stops at whitespace, `<` or `>`, so an attempt reads at most to the next `<`, twice.',
    },
  ],
  'functions/phrase-match.ts': [
    {
      regex: '/\\s+/gu',
      reads: 'One class repeated, in a global replace: each code unit read once.',
    },
    {
      regex: '/[\\u2018\\u2019\\u201A\\u201B\\u2039\\u203A]/gu',
      reads: 'One character class, in a global replace: each code unit tested once.',
    },
    {
      regex: '/[\\u201C\\u201D\\u201E\\u201F\\u00AB\\u00BB]/gu',
      reads: 'One character class, in a global replace: each code unit tested once.',
    },
    {
      regex: '/[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]/gu',
      reads: 'One character class, in a global replace: each code unit tested once.',
    },
  ],
  'functions/regex.ts': [
    {
      regex: '/\\([^)]*[+*{][^)]*\\)[+*{]/',
      reads:
        "Runs on the author's pattern after its length check (`maxRegexPatternLength`, 100 by default): two `[^)]*` after each `(`, so cubic in that length.",
    },
    {
      regex: '/\\([^)]*\\|[^)]*\\)[+*{]/',
      reads:
        "Runs on the author's pattern after its length check (`maxRegexPatternLength`, 100 by default): two `[^)]*` after each `(`, so cubic in that length.",
    },
    {
      regex: '/^\\/(.*)\\/([a-z]*)$/',
      reads:
        "Runs on the author's pattern after its length check; anchored: `(.*)` gives back one code unit per try, and `([a-z]*)` runs only after a slash, over the letters up to the next code unit that is not one, so no code unit is read by two tries: linear in that length.",
    },
    {
      regex: '/\\\\[1-9]/',
      reads: 'Two fixed code units, unanchored: each code unit tested once.',
    },
    { regex: '/(\\(\\?<=|\\(\\?<!)/', reads: 'Fixed alternatives of four code units.' },
    {
      builtIn: 'compileSafeRegex',
      from: '/${pattern}/${authoredFlags}g',
      reads:
        "The formula's own pattern, made global, under 1.0.0's safe-regex rules (length limits, no backreferences or lookbehind, no quantified nested quantifier or alternation); patterns they accept can still read in polynomial time: on the 8,000 code units `maxRegexTextLength` admits, `\\s*\\s*!` runs for minutes, and the wall-time limit is read only when the call returns.",
    },
    {
      builtIn: 'compileSafeRegex',
      from: '/${pattern}/${authoredFlags}',
      reads:
        "The formula's own pattern with the flags its author wrote, under the same rules and with the same gap: polynomial time on the 8,000 code units `maxRegexTextLength` admits.",
    },
    { regex: '/^[imsu]*$/', reads: 'Anchored; one class repeated over the flags of a pattern.' },
    { regex: '/^[gimsu]*$/', reads: 'Anchored; one class repeated over the flags of a pattern.' },
    { regex: '/^[gimsu]*$/', reads: 'Anchored; one class repeated over the flags of a pattern.' },
  ],
  'functions/text-extra.ts': [
    {
      regex: '/[ \\t\\r\\n]+/g',
      reads: 'One class repeated, in a global replace: each code unit read once.',
    },
    { regex: '/^[a-z]{2,63}$/', reads: 'Anchored and bounded: at most 63 code units.' },
    { regex: '/^[a-z0-9-]+$/', reads: 'Anchored; one class repeated, then the end.' },
    {
      regex: '/^([a-z][a-z0-9+.-]*):(.*)$/i',
      reads:
        'Anchored; the scheme class cannot match `:`, so giving a code unit back tests one character, and `(.*)` takes the rest of the line.',
    },
    {
      regex: '/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/',
      reads:
        "Quadratic in the text after `@` when no split of it fits, as each `.` makes the last class re-read the rest (a run of 16,000 dots takes 125 ms, best of three): ISURL's check of a `mailto:` address, which ISURL does not bound.",
    },
    { regex: '/[/?#]/', reads: 'One character class, unanchored: each code unit tested once.' },
    { regex: '/^\\/\\//', reads: 'Anchored, two fixed code units.' },
    {
      regex: '/\\s+/g',
      reads: 'One class repeated, in a global replace: each code unit read once.',
    },
  ],
  'functions/text-segmentation.ts': [
    { regex: '/\\S+/gu', reads: 'One class repeated, matched globally: each code unit read once.' },
    {
      regex:
        "/[\\p{L}\\p{M}\\p{N}]+(?:(?:['\\u2019\\u2010\\u2011\\u00AD-]|(?<=\\p{N})[.,](?=\\p{N}))[\\p{L}\\p{M}\\p{N}]+)*/gu",
      reads:
        'Each repetition starts with a joining character the letter class cannot match, so a code unit has one place in a match; the lookarounds read one character.',
    },
    {
      regex: '/(?<=[.!?])\\s+/gu',
      reads: 'A one-character lookbehind, then one class repeated, matched globally.',
    },
    {
      regex: '/[.!?\\u3002\\uFF01\\uFF1F]+/gu',
      reads: 'One class repeated, matched globally: each code unit read once.',
    },
    {
      regex: '/[^\\s.!?\\u3002\\uFF01\\uFF1F]/u',
      reads: 'One character class, unanchored: each code unit tested once.',
    },
    {
      regex: '/\\r\\n|[\\n\\r\\u000B\\u000C\\u0085\\u2028\\u2029]/u',
      reads: 'Fixed alternatives of at most two code units, in a split.',
    },
    { regex: '/^[imsu]*$/', reads: 'Anchored; one class repeated over the flags of a pattern.' },
  ],
};

/** Where a pattern comes from: its module, and the pattern or the function that builds it. */
type Origin = { readonly module: string; readonly key: string };

/** A site the walk reports by its module, the line and column of its name, and the name. */
type Site = {
  readonly module: string;
  readonly line: number;
  readonly column: number;
  readonly name: string;
};

/** A part of what a construction writes: text, or a hole a value fills, named by its source. */
type Piece = { readonly text: string } | { readonly hole: string };
/** One way a written text reads, part by part: a conditional reads one way per branch. */
type Reading = readonly Piece[];

/**
 * The sites named like a pattern method that hold no pattern, and the element accesses by a key
 * this spec cannot read whose receiver is typed `any` but whose value is never called: each with
 * what it is. Every one the walk finds must be listed at its module, line, column and name, and
 * every one listed must be found there.
 */
const NOT_PATTERNS: readonly (Site & { readonly is: string })[] = [
  {
    module: 'functions/helpers.ts',
    line: 68,
    column: 23,
    name: '(computed key)',
    is: 'readOwnProperty reads an own property of a formula value by a path segment, after hasOwnProperty: no String or RegExp method is an own property.',
  },
  {
    module: 'functions/phrase-match.ts',
    line: 115,
    column: 38,
    name: 'match',
    is: 'The name of the `match` parameter of FIRST_CONTAINED and CONTAINS_ANY, which readOptionalMode prints in its messages.',
  },
  {
    module: 'functions/phrase-match.ts',
    line: 136,
    column: 28,
    name: 'match',
    is: "FIRST_CONTAINED's `match` mode, a text, destructured from its read arguments.",
  },
  {
    module: 'functions/phrase-match.ts',
    line: 154,
    column: 28,
    name: 'match',
    is: "CONTAINS_ANY's `match` mode, a text, destructured from its read arguments.",
  },
];

/** The names of the `String` and `RegExp` methods that compile or run a pattern. */
const PATTERN_METHODS: ReadonlySet<string> = new Set([
  'match',
  'matchAll',
  'search',
  'replace',
  'replaceAll',
  'split',
  'test',
  'exec',
  'compile',
]);
/** The well-known symbols by which a pattern runs, written `Symbol.<name>`. */
const PATTERN_SYMBOLS: ReadonlySet<string> = new Set([
  'match',
  'matchAll',
  'replace',
  'search',
  'split',
]);
/** The globals that run code from a text (`eval`, `Function`) or call by a value (`Reflect`). */
const DYNAMIC_NAMES: ReadonlySet<string> = new Set(['eval', 'Function', 'Reflect']);

/** A pattern the spec cannot follow to its origin. */
class Unresolved extends Error {}

/** Every file under `dir`. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

function moduleName(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

function repositoryName(file: string): string {
  return path.relative(REPO, file).split(path.sep).join('/');
}

function keyOfPattern(source: string, flags: string): string {
  return new RegExp(source, flags).toString();
}

function keyOfLiteral(text: string): string {
  const last = text.lastIndexOf('/');
  return keyOfPattern(text.slice(1, last), text.slice(last + 1));
}

function skipOuter(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/** `node` with the parentheses, non-null assertions and casts around it. */
function outermost(node: ts.Node, casts: boolean): ts.Node {
  let current = node;
  while (
    current.parent !== undefined &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      (casts &&
        (ts.isAsExpression(current.parent) ||
          ts.isTypeAssertionExpression(current.parent) ||
          ts.isSatisfiesExpression(current.parent))))
  ) {
    current = current.parent;
  }
  return current;
}

/** The call whose callee is `node`, through parentheses and non-null assertions only. */
function callOf(node: ts.Node): ts.CallExpression | undefined {
  const callee = outermost(node, false);
  const parent = callee.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === callee
    ? parent
    : undefined;
}

/** Whether `node`, through parentheses, non-null assertions and casts, is called or tagged. */
function isCalled(node: ts.Node): boolean {
  const callee = outermost(node, true);
  const parent = callee.parent;
  return (
    parent !== undefined &&
    (((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === callee) ||
      (ts.isTaggedTemplateExpression(parent) && parent.tag === callee))
  );
}

/** The source text of `node`, on one line. */
function sourceOf(node: ts.Node): string {
  return node.getText().replace(/\s+/g, ' ');
}

/**
 * The name a function, class, object or member is held under: its own name, or its variable's,
 * its property's or its field's, after the name of the object or class holding it; or the target
 * of the assignment it is the value of. Undefined for a value held by nothing named.
 */
function heldName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)) &&
    node.name !== undefined
  ) {
    return node.name.text;
  }
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node)
  ) {
    const own = ts.isConstructorDeclaration(node) ? 'constructor' : sourceOf(node.name);
    const owner = heldName(node.parent);
    return owner === undefined ? own : `${owner}.${own}`;
  }
  const value = outermost(node, true);
  const parent = value.parent;
  if (parent === undefined) return undefined;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return heldName(parent);
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === value
  ) {
    return sourceOf(parent.left);
  }
  return undefined;
}

/** The function a construction is in, named as it is held, or `(module)`. */
function enclosingFunction(node: ts.Node): string {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isFunctionLike(current) ||
      (ts.isPropertyDeclaration(current) && current.initializer !== undefined)
    ) {
      const name = heldName(current);
      if (name !== undefined) return name;
    }
  }
  return '(module)';
}

/** What the walk finds on the modules under `src`. */
type Found = {
  modules: string[];
  origins: Origin[];
  /** Patterns run, each followed to its origins. */
  uses: number;
  /** Calls of `String` and `RegExp` pattern methods, by name, classified. */
  named: number;
  /** Sites only `NOT_PATTERNS` can account for. */
  unlisted: Site[];
  problems: string[];
  diagnostics: string[];
};

/**
 * Every regular expression of the modules under `src`, and every problem following them; given
 * `modules` (a name under `src/self-test` to its text), of those modules instead.
 */
function enumerate(modules?: Readonly<Record<string, string>>): Found {
  const virtual = new Map(
    Object.entries(modules ?? {}).map(
      ([name, text]) => [path.join(SRC, 'self-test', name), text] as const,
    ),
  );
  const everyFile = modules === undefined ? filesUnder(SRC) : [...virtual.keys()];
  const files = everyFile
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .sort();
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts', 'lib.es2022.intl.d.ts'],
    types: ['node', 'vitest/globals'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    paths: {
      '@formulang/definitions': [path.join(REPO, 'definitions/src/index.ts')],
      '@formulang/parser': [path.join(REPO, 'parser/src/index.ts')],
      '@formulang/runner': [path.join(REPO, 'runner/src/index.ts')],
    },
  };
  // Type libraries resolve from the repository, wherever the spec runs from.
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => REPO;
  if (modules !== undefined) {
    const onDisk = { ...host };
    const held = (file: string): string | undefined => virtual.get(path.resolve(file));
    host.fileExists = (file) => held(file) !== undefined || onDisk.fileExists(file);
    host.readFile = (file) => held(file) ?? onDisk.readFile(file);
    host.directoryExists = (directory) =>
      path.resolve(directory) === path.join(SRC, 'self-test') ||
      (onDisk.directoryExists?.(directory) ?? true);
    host.realpath = (file) => (held(file) !== undefined ? file : (onDisk.realpath?.(file) ?? file));
  }
  const program = ts.createProgram({ rootNames: files, options, host });
  const checker = program.getTypeChecker();
  const sources = files.map((file) => program.getSourceFile(file) as ts.SourceFile);
  const walked = new Set(files.map((file) => path.resolve(file)));
  const origins: Origin[] = [];
  const unlisted: Site[] = [];
  const problems: string[] = [
    // A file under `src` the walk does not read could hold code; only specs and declarations may.
    ...everyFile
      .filter((file) => !file.endsWith('.ts'))
      .map((file) => `a file this spec does not read: ${moduleName(file)}`),
    // The walk skips specs, so no module may import one: a spec in the program is an import.
    ...program
      .getSourceFiles()
      .filter(
        (source) =>
          source.fileName.endsWith('.spec.ts') &&
          !source.fileName.split(/[\\/]/).includes('node_modules'),
      )
      .map((source) => `a spec file a module imports: ${repositoryName(source.fileName)}`),
  ];
  let uses = 0;
  let named = 0;

  const positionOf = (node: ts.Node): ts.LineAndCharacter =>
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());

  const where = (node: ts.Node): string =>
    `${moduleName(node.getSourceFile().fileName)}:${positionOf(node).line + 1} ${node.getText().slice(0, 80)}`;

  const notAPattern = (node: ts.Node, name: string): void => {
    const { line, character } = positionOf(node);
    unlisted.push({
      module: moduleName(node.getSourceFile().fileName),
      line: line + 1,
      column: character + 1,
      name,
    });
  };

  const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  const ownerOf = (node: ts.CallExpression | ts.NewExpression): string | undefined => {
    const parent = checker.getResolvedSignature(node)?.getDeclaration()?.parent;
    return parent !== undefined && ts.isInterfaceDeclaration(parent) ? parent.name.text : undefined;
  };

  const symbolConstructor = checker.resolveName('Symbol', undefined, ts.SymbolFlags.Value, false);

  /** The name an expression is written with: an identifier, a property name or a literal key. */
  const writtenName = (expression: ts.Expression): string | undefined => {
    const node = skipOuter(expression);
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) {
      const key = skipOuter(node.argumentExpression);
      if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) return key.text;
    }
    return undefined;
  };
  /** A call or `new` by the name `RegExp`, or one the checker resolves to `RegExpConstructor`. */
  const isConstruction = (node: ts.CallExpression | ts.NewExpression): boolean =>
    writtenName(node.expression) === 'RegExp' || ownerOf(node) === 'RegExpConstructor';

  /**
   * Whether `node` is in a type, where it names no value. A heritage clause names a type, but a
   * class's `extends` names a value; an expression with type arguments anywhere else is an
   * instantiation expression, `f<T>`, whose operand is a value.
   */
  const inType = (node: ts.Node): boolean => {
    for (let current = node.parent; current !== undefined; current = current.parent) {
      if (ts.isExpressionWithTypeArguments(current)) {
        const clause = current.parent;
        if (!ts.isHeritageClause(clause)) continue;
        return !(clause.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(clause.parent));
      }
      if (
        ts.isTypeNode(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isTypeAliasDeclaration(current)
      ) {
        return true;
      }
    }
    return false;
  };

  /**
   * Whether an identifier names what a declaration declares (a variable, a parameter, a function,
   * a class or enum, a member, a property of an object literal, an import or export, a label),
   * rather than referring to a value. A destructuring's key reads the value's property, and its
   * name does too when it has no key.
   */
  const isDeclarationName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (ts.isBindingElement(parent)) {
      return (
        parent.name === node &&
        (parent.propertyName !== undefined || ts.isArrayBindingPattern(parent.parent))
      );
    }
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
    if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
    return (
      (ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isClassExpression(parent) ||
        ts.isEnumDeclaration(parent) ||
        ts.isEnumMember(parent) ||
        ts.isModuleDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isImportEqualsDeclaration(parent)) &&
      parent.name === node
    );
  };

  /** Whether `reference`, through parentheses and non-null assertions, is called or constructed. */
  const constructed = (reference: ts.Node): boolean => {
    const outer = outermost(reference, false);
    const parent = outer.parent;
    return (
      parent !== undefined &&
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === outer
    );
  };

  /** A reference written with the name `RegExp`, `eval`, `Function` or `Reflect`. */
  const byName = (name: string, reference: ts.Node): void => {
    const outer = outermost(reference, false);
    const parent = outer.parent;
    if (DYNAMIC_NAMES.has(name)) {
      problems.push(`${name}, which runs code by name: ${where(parent)}`);
    } else if (
      name === 'RegExp' &&
      !constructed(reference) &&
      !(
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        parent.right === outer
      )
    ) {
      problems.push(`the RegExp constructor used as a value: ${where(parent)}`);
    }
  };

  const globalThisSymbol = checker.resolveName(
    'globalThis',
    undefined,
    ts.SymbolFlags.Value,
    false,
  );
  const globalObject =
    globalThisSymbol === undefined || sources[0] === undefined
      ? undefined
      : checker.getTypeOfSymbolAtLocation(globalThisSymbol, sources[0]);
  /** Whether a source file is the repository's own: not a library's, not a dependency's. */
  const ownSource = (source: ts.SourceFile): boolean =>
    !program.isSourceFileDefaultLibrary(source) &&
    !source.fileName.split(/[\\/]/).includes('node_modules') &&
    path.resolve(source.fileName).startsWith(REPO + path.sep);
  /**
   * Whether a receiver is declared in the repository and is not the global object: every part of
   * its type has declarations, all in the repository's own source, and it is not written
   * `globalThis`, `global`, `self` or `window`.
   */
  const ownReceiver = (type: ts.Type, written: ts.Expression | undefined): boolean => {
    const name = written === undefined ? undefined : writtenName(written);
    if (name !== undefined && ['globalThis', 'global', 'self', 'window'].includes(name)) {
      return false;
    }
    const present = parts(type).filter(
      (part) => (part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
    );
    return (
      present.length > 0 &&
      present.every((part) => {
        if (anyOrUnknown(part) || part === globalObject) return false;
        const declarations = part.getSymbol()?.declarations ?? [];
        return (
          declarations.length > 0 &&
          declarations.every((declaration) => ownSource(declaration.getSourceFile()))
        );
      })
    );
  };

  /**
   * A member named `RegExp`, `eval`, `Function` or `Reflect`: on a receiver declared in the
   * repository, a site to list (a construction by the name `RegExp` is an origin instead); on any
   * other receiver, read as the name is.
   */
  const byMember = (
    name: string,
    reference: ts.Node,
    nameNode: ts.Node,
    receiver: ts.Type,
    written: ts.Expression | undefined,
  ): void => {
    if (!ownReceiver(receiver, written)) byName(name, reference);
    else if (!(name === 'RegExp' && constructed(reference))) notAPattern(nameNode, name);
  };

  const parts = (type: ts.Type): readonly ts.Type[] => (type.isUnion() ? type.types : [type]);
  const isRegExp = (type: ts.Type): boolean => {
    const present = parts(type).filter(
      (part) => (part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
    );
    return present.length > 0 && present.every((part) => part.getSymbol()?.getName() === 'RegExp');
  };
  const isText = (type: ts.Type): boolean =>
    parts(type).every((part) => (part.flags & ts.TypeFlags.StringLike) !== 0);
  const anyOrUnknown = (type: ts.Type): boolean =>
    parts(type).some((part) => (part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0);
  const callable = (type: ts.Type): boolean =>
    parts(type).some(
      (part) => part.getCallSignatures().length > 0 || part.getConstructSignatures().length > 0,
    );
  /** Whether a part of `type` has `name` as a member of the `String` or `RegExp` interface. */
  const textOrPatternMember = (type: ts.Type, name: string): boolean =>
    parts(type).some((part) =>
      (checker.getApparentType(part).getProperty(name)?.declarations ?? []).some(
        (declaration) =>
          ts.isInterfaceDeclaration(declaration.parent) &&
          ['String', 'RegExp'].includes(declaration.parent.name.text),
      ),
    );
  const regExpSymbol = checker.resolveName('RegExp', undefined, ts.SymbolFlags.Type, false);
  const regExpType =
    regExpSymbol === undefined ? undefined : checker.getDeclaredTypeOfSymbol(regExpSymbol);
  /** Whether a part of `type` is a `RegExp`: assignable to the library's `RegExp` interface. */
  const aRegExp = (type: ts.Type): boolean =>
    parts(type).some(
      (part) =>
        regExpType !== undefined &&
        (part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) === 0 &&
        checker.isTypeAssignableTo(part, regExpType),
    );

  /** The calls and constructions of each function and method, across the modules. */
  const calls = new Map<ts.Symbol, (ts.CallExpression | ts.NewExpression)[]>();
  for (const source of sources) {
    const index = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = skipOuter(node.expression);
        const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        const symbol = symbolOf(named);
        if (symbol !== undefined) calls.set(symbol, [...(calls.get(symbol) ?? []), node]);
      }
      ts.forEachChild(node, index);
    };
    index(source);
  }

  /** The constant an identifier names, when it is a `const` declared with a value. */
  const constantOf = (node: ts.Expression): ts.VariableDeclaration | undefined => {
    if (!ts.isIdentifier(node)) return undefined;
    const declaration = symbolOf(node)?.valueDeclaration;
    return declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const &&
      declaration.initializer !== undefined
      ? declaration
      : undefined;
  };

  /** Every way of following one reading of each part with one reading of the next. */
  const joined = (first: readonly Reading[], second: readonly Reading[]): Reading[] =>
    first.flatMap((head) => second.map((tail) => [...head, ...tail]));

  /** The raw text of a template part, as `String.raw` reads it. */
  const rawOf = (part: ts.TemplateLiteralLikeNode): string => {
    if (part.rawText !== undefined) return part.rawText;
    const text = part.getText();
    return text.slice(1, ts.isTemplateHead(part) || ts.isTemplateMiddle(part) ? -2 : -1);
  };

  const isStringRaw = (tag: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(tag) &&
    tag.name.text === 'raw' &&
    writtenName(tag.expression) === 'String';

  /**
   * Every reading of what a text expression writes: string and template literals, `+` of texts,
   * `String.raw`, conditionals (one reading per branch), and constants and imports followed to
   * what they hold are folded; any other part is a hole named by its source. A constant whose value
   * is one hole is the hole, named by the constant.
   */
  const readingsOf = (expression: ts.Expression, seen: ReadonlySet<ts.Node>): Reading[] => {
    const node = skipOuter(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return [[{ text: node.text }]];
    }
    if (ts.isNumericLiteral(node)) return [[{ text: String(Number(node.text)) }]];
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce<Reading[]>(
        (found, span) =>
          joined(joined(found, readingsOf(span.expression, seen)), [[{ text: span.literal.text }]]),
        [[{ text: node.head.text }]],
      );
    }
    if (ts.isTaggedTemplateExpression(node) && isStringRaw(node.tag)) {
      const template = node.template;
      if (ts.isNoSubstitutionTemplateLiteral(template)) return [[{ text: rawOf(template) }]];
      return template.templateSpans.reduce<Reading[]>(
        (found, span) =>
          joined(joined(found, readingsOf(span.expression, seen)), [
            [{ text: rawOf(span.literal) }],
          ]),
        [[{ text: rawOf(template.head) }]],
      );
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      isText(checker.getTypeAtLocation(node))
    ) {
      return joined(readingsOf(node.left, seen), readingsOf(node.right, seen));
    }
    if (ts.isConditionalExpression(node)) {
      return [...readingsOf(node.whenTrue, seen), ...readingsOf(node.whenFalse, seen)];
    }
    const hole: Reading[] = [[{ hole: sourceOf(node) }]];
    const constant = constantOf(node);
    if (constant === undefined || constant.initializer === undefined || seen.has(constant)) {
      return hole;
    }
    const held = readingsOf(constant.initializer, new Set([...seen, constant]));
    const single = held.length === 1 && held[0].length === 1 ? held[0][0] : undefined;
    return single !== undefined && 'hole' in single ? hole : held;
  };

  /** The regular expression literal a pattern argument is, or names through constants. */
  const literalOf = (
    expression: ts.Expression,
    seen: ReadonlySet<ts.Node>,
  ): ts.Node | undefined => {
    const node = skipOuter(expression);
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) return node;
    const constant = constantOf(node);
    return constant === undefined || constant.initializer === undefined || seen.has(constant)
      ? undefined
      : literalOf(constant.initializer, new Set([...seen, constant]));
  };

  /** A reading as its text, when it has no hole. */
  const textIn = (reading: Reading): string | undefined =>
    reading.every((piece) => 'text' in piece)
      ? reading.map((piece) => ('text' in piece ? piece.text : '')).join('')
      : undefined;
  /** A reading written out, each hole as `${source}`. */
  const written = (reading: Reading): string =>
    reading.map((piece) => ('text' in piece ? piece.text : `\${${piece.hole}}`)).join('');

  /** The key of a pattern written in full, or a problem when it does not compile. */
  const patternKey = (source: string, flags: string, at: ts.Node): string | undefined => {
    try {
      return keyOfPattern(source, flags);
    } catch {
      problems.push(`a pattern that does not compile: ${where(at)}`);
      return undefined;
    }
  };

  /**
   * The origins of a construction, one per reading of its pattern and flags: a reading written in
   * full is keyed as a literal; one with holes by the function that builds it and what it writes.
   */
  const constructions = new Map<ts.Node, Origin[]>();
  const construction = (node: ts.CallExpression | ts.NewExpression): Origin[] => {
    const known = constructions.get(node);
    if (known !== undefined) return known;
    const found = originsOf(node);
    constructions.set(node, found);
    return found;
  };
  const originsOf = (node: ts.CallExpression | ts.NewExpression): Origin[] => {
    const [patternArgument, flagsArgument] = node.arguments ?? [];
    const module = moduleName(node.getSourceFile().fileName);
    const literal =
      patternArgument === undefined ? undefined : literalOf(patternArgument, new Set());
    let patterns: Reading[] = [[]];
    // A pattern built from another keeps its flags unless the call gives its own.
    let ownFlags: Reading[] = [[]];
    if (literal !== undefined) {
      const text = literal.getText();
      const last = text.lastIndexOf('/');
      patterns = [[{ text: text.slice(1, last) }]];
      ownFlags = [[{ text: text.slice(last + 1) }]];
    } else if (
      patternArgument !== undefined &&
      isRegExp(checker.getTypeAtLocation(patternArgument))
    ) {
      const source = sourceOf(skipOuter(patternArgument));
      patterns = [[{ hole: source }]];
      ownFlags = [[{ hole: `${source}.flags` }]];
    } else if (patternArgument !== undefined) {
      patterns = readingsOf(patternArgument, new Set());
    }
    const flagReadings =
      flagsArgument === undefined ? ownFlags : readingsOf(flagsArgument, new Set());
    return patterns.flatMap((pattern) =>
      flagReadings.flatMap((flags): Origin[] => {
        const source = textIn(pattern);
        const flagText = textIn(flags);
        if (source === undefined || flagText === undefined) {
          const from = `/${written(pattern)}/${written(flags)}`;
          return [{ module, key: `built in ${enclosingFunction(node)} from ${from}` }];
        }
        const key = patternKey(source, flagText, node);
        return key === undefined ? [] : [{ module, key }];
      }),
    );
  };

  const functionOf = (symbol: ts.Symbol | undefined): ts.FunctionLikeDeclaration | undefined => {
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined) return undefined;
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
      return declaration;
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      return declaration.initializer;
    }
    return undefined;
  };

  const returnsOf = (fn: ts.FunctionLikeDeclaration): ts.Expression[] => {
    if (fn.body === undefined) throw new Unresolved('a function without a body');
    if (!ts.isBlock(fn.body)) return [fn.body];
    const found: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
    return found;
  };

  /**
   * The origins of the value `expression` holds, after following `property` names into it (the
   * value of `a.b` is `b` of the value of `a`).
   */
  const valuesOf = (
    expression: ts.Expression,
    property: readonly string[],
    seen: Set<string>,
  ): Origin[] => {
    const node = skipOuter(expression);
    const visit = `${node.getSourceFile().fileName}:${node.pos}:${property.join('.')}`;
    if (seen.has(visit)) return [];
    seen.add(visit);
    if (!walked.has(path.resolve(node.getSourceFile().fileName))) {
      throw new Unresolved(`a value from outside core-functions: ${where(node)}`);
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) return [];
    if (ts.isIdentifier(node) && node.text === 'undefined') return [];
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && property.length === 0) {
      return [
        { module: moduleName(node.getSourceFile().fileName), key: keyOfLiteral(node.getText()) },
      ];
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...valuesOf(node.whenTrue, property, seen),
        ...valuesOf(node.whenFalse, property, seen),
      ];
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      return [...valuesOf(node.left, property, seen), ...valuesOf(node.right, property, seen)];
    }
    if (ts.isPropertyAccessExpression(node)) {
      return valuesOf(node.expression, [node.name.text, ...property], seen);
    }
    if (ts.isObjectLiteralExpression(node) && property.length > 0) {
      const [name, ...rest] = property;
      const found: Origin[] = [];
      for (const member of node.properties) {
        if (ts.isSpreadAssignment(member)) throw new Unresolved(`a spread: ${where(member)}`);
        if (ts.isPropertyAssignment(member) && member.name.getText() === name) {
          found.push(...valuesOf(member.initializer, rest, seen));
        } else if (ts.isShorthandPropertyAssignment(member) && member.name.text === name) {
          found.push(...valuesOf(member.name, rest, seen));
        }
      }
      return found;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (isConstruction(node)) {
        if (property.length > 0) throw new Unresolved(`a property of a pattern: ${where(node)}`);
        return construction(node);
      }
      const callee = skipOuter(node.expression);
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'get' &&
        (ownerOf(node) === 'Map' || ownerOf(node) === 'ReadonlyMap')
      ) {
        return mapValuesOf(callee.expression, property, seen);
      }
      const fn = functionOf(symbolOf(ts.isPropertyAccessExpression(callee) ? callee.name : callee));
      if (fn === undefined) throw new Unresolved(`a call this spec cannot follow: ${where(node)}`);
      return returnsOf(fn).flatMap((returned) => valuesOf(returned, property, seen));
    }
    if (ts.isIdentifier(node)) {
      const declaration = symbolOf(node)?.valueDeclaration;
      if (declaration === undefined) throw new Unresolved(`no declaration: ${where(node)}`);
      if (ts.isVariableDeclaration(declaration)) {
        if (!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)) {
          throw new Unresolved(`not a constant: ${where(declaration)}`);
        }
        if (declaration.initializer === undefined) {
          throw new Unresolved(`no initializer: ${where(declaration)}`);
        }
        return valuesOf(declaration.initializer, property, seen);
      }
      if (ts.isBindingElement(declaration)) {
        const pattern = declaration.parent;
        const holder = pattern.parent;
        if (
          !ts.isObjectBindingPattern(pattern) ||
          !ts.isVariableDeclaration(holder) ||
          !(ts.getCombinedNodeFlags(holder) & ts.NodeFlags.Const) ||
          holder.initializer === undefined ||
          declaration.dotDotDotToken !== undefined
        ) {
          throw new Unresolved(`a binding this spec cannot follow: ${where(declaration)}`);
        }
        const name = (declaration.propertyName ?? declaration.name).getText();
        return valuesOf(holder.initializer, [name, ...property], seen);
      }
      if (ts.isParameter(declaration)) {
        const fn = declaration.parent;
        const at = fn.parameters.indexOf(declaration);
        if (declaration.dotDotDotToken !== undefined) {
          throw new Unresolved(`a rest parameter: ${where(declaration)}`);
        }
        const name =
          ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)
            ? fn.name
            : ts.isVariableDeclaration(fn.parent)
              ? fn.parent.name
              : undefined;
        const sites = name === undefined ? [] : (calls.get(symbolOf(name) as ts.Symbol) ?? []);
        if (sites.length === 0) {
          throw new Unresolved(`a parameter of a function no module calls: ${where(declaration)}`);
        }
        return sites.flatMap((site) => {
          const argument = site.arguments?.[at];
          if (argument === undefined) {
            return declaration.initializer === undefined
              ? []
              : valuesOf(declaration.initializer, property, seen);
          }
          if (ts.isSpreadElement(argument)) throw new Unresolved(`a spread: ${where(argument)}`);
          return valuesOf(argument, property, seen);
        });
      }
      throw new Unresolved(`a declaration this spec cannot follow: ${where(declaration)}`);
    }
    throw new Unresolved(`an expression this spec cannot follow: ${where(node)}`);
  };

  const mapValuesOf = (map: ts.Expression, property: readonly string[], seen: Set<string>) => {
    const node = skipOuter(map);
    const declaration = ts.isIdentifier(node) ? symbolOf(node)?.valueDeclaration : undefined;
    const initializer =
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const
        ? declaration.initializer
        : undefined;
    const built = initializer === undefined ? undefined : skipOuter(initializer);
    const entries =
      built !== undefined && ts.isNewExpression(built) && ownerOf(built) === 'MapConstructor'
        ? built.arguments?.[0]
        : undefined;
    if (entries === undefined || !ts.isArrayLiteralExpression(entries)) {
      throw new Unresolved(`a map this spec cannot follow: ${where(map)}`);
    }
    return entries.elements.flatMap((entry) => {
      if (!ts.isArrayLiteralExpression(entry) || entry.elements.length !== 2) {
        throw new Unresolved(`a map entry this spec cannot follow: ${where(entry)}`);
      }
      return valuesOf(entry.elements[1] as ts.Expression, property, seen);
    });
  };

  const run = (holder: ts.Expression): void => {
    uses += 1;
    try {
      const found = valuesOf(holder, [], new Set());
      if (found.length === 0) problems.push(`no pattern reaches ${where(holder)}`);
    } catch (error) {
      if (!(error instanceof Unresolved)) throw error;
      problems.push(`${error.message}, from ${where(holder)}`);
    }
  };

  /** A call of a method named like a pattern method, on any receiver. */
  const classifyCall = (
    call: ts.CallExpression,
    member: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    name: string,
    bySymbol: boolean,
    nameNode: ts.Node,
  ): void => {
    const module = moduleName(call.getSourceFile().fileName);
    if (anyOrUnknown(checker.getTypeAtLocation(member.expression))) {
      problems.push(`a receiver typed any or unknown: ${where(call)}`);
      return;
    }
    const owner = ownerOf(call);
    if (bySymbol) {
      if (owner === 'RegExp') {
        named += 1;
        run(member.expression);
      } else notAPattern(nameNode, `[Symbol.${name}]`);
      return;
    }
    if (name === 'compile') {
      // `compile` on a receiver that is a `RegExp`, wherever the method is declared, the `RegExp`
      // interface's own, and one the checker cannot resolve recompile a pattern at run time; a
      // `compile` declared anywhere else, on a receiver that is no `RegExp`, is a site like any
      // other.
      if (
        aRegExp(checker.getTypeAtLocation(member.expression)) ||
        owner === 'RegExp' ||
        checker.getResolvedSignature(call)?.getDeclaration() === undefined
      ) {
        problems.push(
          `a pattern recompiled at run time (RegExp.prototype.compile): ${where(call)}`,
        );
      } else notAPattern(nameNode, name);
      return;
    }
    const argument = call.arguments[0];
    const type = argument === undefined ? undefined : checker.getTypeAtLocation(argument);
    if (owner === 'String' && ['match', 'matchAll', 'search'].includes(name)) {
      named += 1;
      if (argument === undefined || type === undefined) {
        problems.push(`a pattern compiled from nothing: ${where(call)}`);
      } else if (isRegExp(type)) {
        run(argument);
      } else if (isText(type)) {
        // The text must be written in full, through the readings a construction folds.
        const texts = readingsOf(argument, new Set()).map(textIn);
        if (texts.includes(undefined)) {
          problems.push(`a pattern compiled from a value: ${where(call)}`);
        } else {
          for (const text of texts) {
            const key = patternKey(text ?? '', name === 'matchAll' ? 'g' : '', call);
            if (key !== undefined) origins.push({ module, key });
          }
        }
      } else {
        problems.push(`an argument this spec cannot classify: ${where(call)}`);
      }
    } else if (owner === 'String' && ['replace', 'replaceAll', 'split'].includes(name)) {
      named += 1;
      if (argument !== undefined && type !== undefined) {
        if (isRegExp(type)) run(argument);
        else if (!isText(type))
          problems.push(`an argument this spec cannot classify: ${where(call)}`);
      }
    } else if (owner === 'RegExp' && (name === 'test' || name === 'exec')) {
      named += 1;
      run(member.expression);
    } else {
      notAPattern(nameNode, name);
    }
  };

  /** A property or element access: by name, by a well-known symbol, or by a key it cannot read. */
  const member = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): void => {
    let name: string;
    let nameNode: ts.Node;
    let bySymbol = false;
    if (ts.isPropertyAccessExpression(node)) {
      name = node.name.text;
      nameNode = node.name;
    } else {
      const key = skipOuter(node.argumentExpression);
      if (ts.isNumericLiteral(key)) return;
      if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
        name = key.text;
        nameNode = key;
        // A literal key names a member as a property name does.
        if (DYNAMIC_NAMES.has(name) || name === 'RegExp') {
          byMember(name, node, key, checker.getTypeAtLocation(node.expression), node.expression);
        }
      } else if (
        ts.isPropertyAccessExpression(key) &&
        symbolConstructor !== undefined &&
        symbolOf(key.expression) === symbolConstructor
      ) {
        name = key.name.text;
        nameNode = key;
        bySymbol = true;
      } else {
        // A key this spec cannot read names any member: one called, or whose value can be,
        // is a problem; one read from a receiver typed `any` is listed.
        const outer = outermost(node, true);
        if (
          isCalled(node) ||
          callable(checker.getTypeAtLocation(node)) ||
          callable(checker.getTypeAtLocation(outer))
        ) {
          problems.push(`a member by a key this spec cannot read, called: ${where(node)}`);
        } else if (anyOrUnknown(checker.getTypeAtLocation(node.expression))) {
          notAPattern(key, '(computed key)');
        }
        return;
      }
    }
    if (!bySymbol && name === 'prototype') {
      const receiver = checker.getTypeAtLocation(node.expression).getSymbol()?.getName();
      if (
        receiver === 'StringConstructor' ||
        receiver === 'RegExpConstructor' ||
        receiver === 'FunctionConstructor'
      ) {
        problems.push(`a prototype of String, RegExp or Function: ${where(node)}`);
      }
      return;
    }
    if (bySymbol ? !PATTERN_SYMBOLS.has(name) : !PATTERN_METHODS.has(name)) return;
    const call = callOf(node);
    if (call !== undefined) {
      classifyCall(call, node, name, bySymbol, nameNode);
      return;
    }
    const receiver = checker.getTypeAtLocation(node.expression);
    if (anyOrUnknown(receiver)) {
      problems.push(`a receiver typed any or unknown: ${where(node)}`);
    } else if (
      bySymbol ||
      textOrPatternMember(receiver, name) ||
      (name === 'compile' && aRegExp(receiver))
    ) {
      problems.push(`a String or RegExp method used as a value: ${where(node.parent)}`);
    } else {
      notAPattern(nameNode, name);
    }
  };

  /** The expression a destructuring takes its members from, when it is written there. */
  const destructured = (pattern: ts.BindingPattern): ts.Expression | undefined =>
    ts.isVariableDeclaration(pattern.parent) ? pattern.parent.initializer : undefined;

  /** A member taken out of a value by object destructuring. */
  const binding = (element: ts.BindingElement): void => {
    const pattern = element.parent;
    const property = element.propertyName ?? element.name;
    let name: string | undefined;
    if (ts.isIdentifier(property) || ts.isStringLiteral(property)) name = property.text;
    else if (ts.isComputedPropertyName(property)) {
      const key = skipOuter(property.expression);
      if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) name = key.text;
      else {
        const value = checker.getTypeAtLocation(element);
        if (callable(value) || anyOrUnknown(value)) {
          problems.push(`a member by a key this spec cannot read, destructured: ${where(element)}`);
        }
        return;
      }
    }
    // A key written as an identifier is read with the other identifiers.
    const source = checker.getTypeAtLocation(pattern);
    if (
      name !== undefined &&
      !ts.isIdentifier(property) &&
      (DYNAMIC_NAMES.has(name) || name === 'RegExp')
    ) {
      byMember(name, property, property, source, destructured(pattern));
    }
    if (name === undefined || !PATTERN_METHODS.has(name)) return;
    if (anyOrUnknown(source)) {
      problems.push(`a receiver typed any or unknown: ${where(pattern)}`);
    } else if (textOrPatternMember(source, name) || (name === 'compile' && aRegExp(source))) {
      problems.push(`a String or RegExp method used as a value: ${where(pattern)}`);
    } else {
      notAPattern(property, name);
    }
  };

  /** Whether `node` is the key of an element access or a destructuring, or a literal type. */
  const isKeyOrType = (node: ts.Node): boolean => {
    const outer = outermost(node, true);
    const parent = outer.parent;
    return (
      parent !== undefined &&
      ((ts.isElementAccessExpression(parent) && parent.argumentExpression === outer) ||
        (ts.isBindingElement(parent) && parent.propertyName === outer) ||
        ts.isComputedPropertyName(parent) ||
        ts.isLiteralTypeNode(parent))
    );
  };

  for (const source of sources) {
    const module = moduleName(source.fileName);
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
        origins.push({ module, key: keyOfLiteral(node.getText()) });
      }
      if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        if (isConstruction(node)) origins.push(...construction(node));
        if (anyOrUnknown(checker.getTypeAtLocation(node.expression))) {
          problems.push(`a call of a value typed any or unknown: ${where(node)}`);
        }
      }
      if (
        ts.isTaggedTemplateExpression(node) &&
        anyOrUnknown(checker.getTypeAtLocation(node.tag))
      ) {
        problems.push(`a call of a value typed any or unknown: ${where(node)}`);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) member(node);
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) binding(node);
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        PATTERN_METHODS.has(node.text) &&
        !isKeyOrType(node)
      ) {
        notAPattern(node, node.text);
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const operand = checker.getTypeAtLocation(node.expression);
        if (
          callable(checker.getTypeAtLocation(node)) &&
          (anyOrUnknown(operand) || !callable(operand))
        ) {
          problems.push(`a cast that makes a value callable: ${where(node)}`);
        }
      }
      // An identifier outside a type that refers to a value: a property name, and a destructuring's
      // key, read the member of their receiver.
      if (
        ts.isIdentifier(node) &&
        (DYNAMIC_NAMES.has(node.text) || node.text === 'RegExp') &&
        !inType(node) &&
        !isDeclarationName(node)
      ) {
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
          byMember(
            node.text,
            parent,
            node,
            checker.getTypeAtLocation(parent.expression),
            parent.expression,
          );
        } else if (ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent)) {
          const pattern = parent.parent;
          byMember(
            node.text,
            node,
            node,
            checker.getTypeAtLocation(pattern),
            destructured(pattern),
          );
        } else {
          byName(node.text, node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...sources.flatMap((source) => [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]),
  ].map((diagnostic) => {
    const at =
      diagnostic.file !== undefined && diagnostic.start !== undefined
        ? `${moduleName(diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
        : '';
    return `${at} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
  });
  return { modules: files.map(moduleName), origins, uses, named, unlisted, problems, diagnostics };
}

const siteKey = (site: Site): string => `${site.module}:${site.line}:${site.column} ${site.name}`;

/** A case of the spec's own: a module, the rule of the header it checks, and what it gives. */
type Case = {
  readonly rule: string;
  readonly lines: readonly string[];
  /** The keys of the patterns it compiles. */
  readonly origins?: readonly string[];
  /** Each problem's reason and the line it is reported at; line 0 for a problem about a file. */
  readonly problems?: readonly (readonly [string, number])[];
  /** Each site's line, the text before its name on that line, and its name. */
  readonly sites?: readonly (readonly [number, string, string])[];
  /** The files it brings in beside it, by name. */
  readonly beside?: Readonly<Record<string, readonly string[]>>;
};

/** One module per rule of the header, read in place of `src`, each with what it must give. */
const SELF_TEST: Readonly<Record<string, Case>> = {
  'literal.ts': {
    rule: 'every regular expression literal is an origin',
    lines: ['export const word = /\\w+/g;'],
    origins: ['/\\w+/g'],
  },
  'construction.ts': {
    rule: 'a call or new by the name RegExp, or one resolved to RegExpConstructor, is an origin; the right side of instanceof is nothing',
    lines: [
      "export const plain = new RegExp('a+', 'g');",
      "export const called = RegExp('b+');",
      'declare const host: { RegExp: new (source: string) => object };',
      "export const viaHost = new host.RegExp('c+');",
      'declare const Make: RegExpConstructor;',
      "export const resolved = new Make('d+');",
      'export const isPattern = (value: unknown): boolean => value instanceof RegExp;',
    ],
    origins: ['/a+/g', '/b+/', '/c+/', '/d+/'],
  },
  'flagged.ts': {
    rule: "a construction from a literal, or from a constant naming one, keeps the literal's flags unless it gives its own",
    lines: [
      "export const spaces = new RegExp(/\\s+/u, 'gu');",
      'export const letters = new RegExp(/[a-z]+/i);',
      'const BASE = /x+/m;',
      "export const copy = new RegExp(BASE, 'g');",
    ],
    origins: ['/\\s+/u', '/\\s+/gu', '/[a-z]+/i', '/[a-z]+/i', '/x+/m', '/x+/g'],
  },
  'folded.ts': {
    rule: 'a construction written in full through templates, +, String.raw, constants, imports and re-exports is keyed as a literal',
    lines: [
      "import { HASH } from './folded-reexport';",
      "const WORD = '[a-z]';",
      'export const tail = new RegExp(`${WORD}${HASH}+$`);',
      "export const joined = new RegExp('^' + WORD + '*', 'g');",
      'export const raw = new RegExp(String.raw`\\d+`);',
    ],
    origins: ['/[a-z]#+$/', '/^[a-z]*/g', '/\\d+/'],
    beside: {
      'folded-parts.ts': ["export const HASH = '#';"],
      'folded-reexport.ts': ["export { HASH } from './folded-parts';"],
    },
  },
  'conditional.ts': {
    rule: 'a conditional pattern reads one way per branch, each its own key',
    lines: ["export const pick = (loose: boolean): RegExp => new RegExp(loose ? 'a*' : 'a+');"],
    origins: ['/a*/', '/a+/'],
  },
  'holes.ts': {
    rule: 'a construction with parts a value fills is keyed by its function and what it writes, each hole named by its source',
    lines: [
      'export function wrapped(pattern: string, flags: string): RegExp {',
      '  return new RegExp(`(?:${pattern})+`, flags);',
      '}',
      'export const table = {',
      "  build: (source: string) => new RegExp(source + '$'),",
      '};',
      'export class Matcher {',
      "  readonly pattern = (source: string) => new RegExp(source, 'i');",
      '}',
    ],
    origins: [
      'built in wrapped from /(?:${pattern})+/${flags}',
      'built in table.build from /${source}$/',
      'built in Matcher.pattern from /${source}/i',
    ],
  },
  'string-pattern.ts': {
    rule: 'a pattern a string match or search compiles is written in full; one built from a value is a problem',
    lines: [
      "export const found = 'a1'.match('[0-9]');",
      "export const where = 'a1'.search(`${'[a-z]'}`);",
      "export const at = (value: string): number => 'a1'.search(value);",
    ],
    origins: ['/[0-9]/', '/[a-z]/'],
    problems: [['a pattern compiled from a value', 3]],
  },
  'runs.ts': {
    rule: 'a pattern a call runs is followed to where it comes from; one it cannot follow is a problem',
    lines: [
      'const DIGITS = /[0-9]/;',
      'export const has = (text: string): boolean => DIGITS.test(text);',
      'export const run = (pattern: RegExp, text: string): boolean => pattern.test(text);',
    ],
    origins: ['/[0-9]/'],
    problems: [['a parameter of a function no module calls', 3]],
  },
  'compile.ts': {
    rule: "a compile on a RegExp, the RegExp interface's own or one unresolved is a problem; any other is a site",
    lines: [
      'class FailureTable {',
      '  compile(phrase: string): number[] {',
      '    return [...phrase].map(() => 0);',
      '  }',
      '}',
      "export const table = new FailureTable().compile('#');",
      "export const recompiled = /a/.compile('b');",
      'interface Recompilable extends RegExp {',
      '  compile(pattern: string, flags?: string): this;',
      '}',
      'const RECOMPILABLE: Recompilable = /c/;',
      "export const again = RECOMPILABLE.compile('d');",
    ],
    origins: ['/a/', '/c/'],
    problems: [
      ['a pattern recompiled at run time (RegExp.prototype.compile)', 7],
      ['a pattern recompiled at run time (RegExp.prototype.compile)', 12],
    ],
    sites: [[6, 'FailureTable().', 'compile']],
  },
  'method-value.ts': {
    rule: 'a String or RegExp method used as a value, read or destructured, is a problem',
    lines: [
      'const DIGIT = /[0-9]/;',
      'export const check = DIGIT.test;',
      'export const { exec } = DIGIT;',
    ],
    origins: ['/[0-9]/'],
    problems: [
      ['a String or RegExp method used as a value', 2],
      ['a String or RegExp method used as a value', 3],
    ],
  },
  'dynamic.ts': {
    rule: 'a reference by the name eval, Function or Reflect is a problem: an identifier, a property name, a literal key of an access or a destructuring, an instantiation expression',
    lines: [
      'export const apply = Reflect.apply;',
      'export const make = globalThis.Function;',
      "export const run = globalThis['eval'];",
      "export const { 'Function': Build } = globalThis;",
      "export const read = Reflect.get<{ length: number }, 'length'>;",
    ],
    problems: [
      ['Reflect, which runs code by name', 1],
      ['Function, which runs code by name', 2],
      ['eval, which runs code by name', 3],
      ['Function, which runs code by name', 4],
      ['Reflect, which runs code by name', 5],
    ],
  },
  'instantiation.ts': {
    rule: 'a reference inside the operand of an instantiation expression is read: the operand is no type',
    lines: [
      'const keep = <T>(value: T) => <U>(tag?: U) => value;',
      'export const run = keep(eval)<string>;',
    ],
    problems: [['eval, which runs code by name', 2]],
  },
  'by-name.ts': {
    rule: 'a reference by the name RegExp that neither constructs nor is the right side of instanceof is a problem, a class extends clause included',
    lines: ['export const Pattern = globalThis.RegExp;', 'export class Tail extends RegExp {}'],
    problems: [
      ['the RegExp constructor used as a value', 1],
      ['the RegExp constructor used as a value', 2],
    ],
  },
  'declarations.ts': {
    rule: 'a declaration named eval, Function or RegExp is no reference; a member so named on a receiver declared in the repository is a site',
    lines: [
      "const KIND_OF = { Function: 'callable', RegExp: 'pattern' } as const;",
      'export const kind = KIND_OF.Function;',
      'const CLOSING = {',
      '  eval(text: string): number {',
      '    return text.length;',
      '  },',
      '};',
      "export const at = CLOSING.eval('#');",
      'enum ValueKind {',
      '  Text,',
      '  Function,',
      '}',
      'export const member = ValueKind.Function;',
    ],
    sites: [
      [2, 'KIND_OF.', 'Function'],
      [8, 'CLOSING.', 'eval'],
      [13, 'ValueKind.', 'Function'],
    ],
  },
  'prototype.ts': {
    rule: 'a prototype of String, RegExp or Function is a problem',
    lines: ['export const size = String.prototype.length;'],
    problems: [['a prototype of String, RegExp or Function', 1]],
  },
  'loose.ts': {
    rule: 'a receiver of a site so named, or a callee, typed any is a problem',
    lines: [
      'declare const loose: any;',
      "export const called = loose('x');",
      "export const matched = loose.match('y');",
    ],
    problems: [
      ['a call of a value typed any or unknown', 2],
      ['a call of a value typed any or unknown', 3],
      ['a receiver typed any or unknown', 3],
    ],
  },
  'cast.ts': {
    rule: 'a cast that makes a value callable is a problem',
    lines: ['export const run = (0 as unknown) as () => void;'],
    problems: [['a cast that makes a value callable', 1]],
  },
  'keys.ts': {
    rule: 'an element access by a key that is no literal, called, is a problem',
    lines: ["declare const key: 'trim' | 'toUpperCase';", "export const shouted = 'a'[key]();"],
    problems: [['a member by a key this spec cannot read, called', 2]],
  },
  'same-line.ts': {
    rule: 'a site is keyed by module, line, column and name: two sites on one line are two, and one site is one',
    lines: [
      'const first = { test: (text: string) => text.length > 0 };',
      'const second = { test: (text: string) => text.length > 1 };',
      "export const both = first.test('a') && second.test('b');",
      "export const { 'match': mode } = { match: 'word' };",
    ],
    sites: [
      [3, 'first.', 'test'],
      [3, 'second.', 'test'],
      [4, 'export const { ', 'match'],
    ],
  },
  'imports-a-spec.ts': {
    rule: 'a spec file a module imports is a problem',
    lines: ["import { tail } from './tail.spec';", 'export const tailOf = tail;'],
    problems: [['a spec file a module imports: core-functions/src/self-test/tail.spec.ts', 0]],
    beside: { 'tail.spec.ts': ["export const tail = 'x';"] },
  },
  'stray.cts': {
    rule: 'a file under src that is not a TypeScript module is a problem',
    lines: ["export const hidden = 'x'.match('[a-z]');"],
    problems: [['a file this spec does not read: self-test/stray.cts', 0]],
  },
};

const CASES = Object.entries(SELF_TEST).map(
  ([name, expected]) => [`${name}: ${expected.rule}`, name, expected] as const,
);

/** The files of a case: its module, and the files it brings in beside it. */
const filesOf = (name: string, expected: Case): readonly string[] => [
  `self-test/${name}`,
  ...Object.keys(expected.beside ?? {}).map((file) => `self-test/${file}`),
];

/** A problem as its reason and where it is reported, without the source text after it. */
const located = (problem: string): string =>
  problem.replace(/^(.*?: self-test\/[^\s:]+:\d+) .*$/s, '$1');

/** What a case must give: its origins, problems and sites, as the walk reports them. */
function expectedOf(name: string, expected: Case) {
  const module = `self-test/${name}`;
  const columnAfter = (line: number, before: string): number =>
    (expected.lines[line - 1] ?? '').indexOf(before) + before.length + 1;
  return {
    origins: (expected.origins ?? []).map((key) => `${module} ${key}`).sort(),
    problems: (expected.problems ?? [])
      .map(([reason, line]) => (line === 0 ? reason : `${reason}: ${module}:${line}`))
      .sort(),
    sites: (expected.sites ?? [])
      .map(([line, before, name]) =>
        siteKey({ module, line, column: columnAfter(line, before), name }),
      )
      .sort(),
  };
}

describe('the regular expressions of core-functions', () => {
  const found = enumerate();
  const own = enumerate(
    Object.fromEntries(
      Object.entries(SELF_TEST).flatMap(([name, expected]) => [
        [name, expected.lines.join('\n')],
        ...Object.entries(expected.beside ?? {}).map(([file, lines]) => [file, lines.join('\n')]),
      ]),
    ),
  );

  it('reads every module under src with the type checker, and classifies every pattern site', () => {
    expect(found.diagnostics).toStrictEqual([]);
    expect(found.problems).toStrictEqual([]);
    // Not vacuous: the walk reads the modules, finds patterns, the calls that compile or run them
    // by name, and the places they run.
    expect(found.modules).toEqual(
      expect.arrayContaining(['functions/markup-text.ts', 'functions/regex.ts', 'index.ts']),
    );
    expect(found.modules.length).toBeGreaterThanOrEqual(50);
    expect(found.origins.length).toBeGreaterThanOrEqual(50);
    expect(found.named).toBeGreaterThanOrEqual(50);
    expect(found.uses).toBeGreaterThanOrEqual(40);
  });

  it('lists every pattern with how it reads its input, both ways', () => {
    const byModule = new Map<string, string[]>();
    for (const origin of found.origins) {
      byModule.set(origin.module, [...(byModule.get(origin.module) ?? []), origin.key]);
    }
    expect(Object.keys(ROSTER).sort()).toStrictEqual([...byModule.keys()].sort());
    for (const [module, entries] of Object.entries(ROSTER)) {
      const listed = entries.map((entry) =>
        'regex' in entry ? entry.regex : `built in ${entry.builtIn} from ${entry.from}`,
      );
      expect([...(byModule.get(module) ?? [])].sort(), module).toStrictEqual(listed.sort());
      for (const entry of entries) expect(entry.reads.length, module).toBeGreaterThan(10);
    }
  });

  it('lists every site named like a pattern method that holds no pattern, both ways', () => {
    expect(found.unlisted.map(siteKey).sort()).toStrictEqual(NOT_PATTERNS.map(siteKey).sort());
    // Each site is reported once.
    expect(new Set(found.unlisted.map(siteKey)).size).toBe(found.unlisted.length);
    for (const entry of NOT_PATTERNS) expect(entry.is.length, siteKey(entry)).toBeGreaterThan(10);
  });

  it.each(CASES)('reads its own case %s', (_title, name, expected) => {
    const files = filesOf(name, expected);
    const mine = (text: string): boolean =>
      files.some((file) => text.includes(`${file}:`) || text.endsWith(file));
    expect({
      origins: own.origins
        .filter((origin) => files.includes(origin.module))
        .map((origin) => `${origin.module} ${origin.key}`)
        .sort(),
      problems: own.problems.filter(mine).map(located).sort(),
      sites: own.unlisted
        .filter((site) => files.includes(site.module))
        .map(siteKey)
        .sort(),
    }).toStrictEqual(expectedOf(name, expected));
  });

  it('reads its own cases with no diagnostic, and reports nothing no case states', () => {
    expect(own.diagnostics).toStrictEqual([]);
    const stated = CASES.map(([, name, expected]) => expectedOf(name, expected));
    expect(own.origins.map((origin) => `${origin.module} ${origin.key}`).sort()).toStrictEqual(
      stated.flatMap((each) => each.origins).sort(),
    );
    expect(own.problems.map(located).sort()).toStrictEqual(
      stated.flatMap((each) => each.problems).sort(),
    );
    expect(own.unlisted.map(siteKey).sort()).toStrictEqual(
      stated.flatMap((each) => each.sites).sort(),
    );
    // Each site is reported once.
    expect(new Set(own.unlisted.map(siteKey)).size).toBe(own.unlisted.length);
  });
});
