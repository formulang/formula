import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * Every regular expression core-functions compiles is listed here with how it reads its input.
 * The list is a maintainer's guard: the spec fails when a pattern is added, changed or removed
 * without its listing. It is not a boundary against code written to slip past it. The trust
 * boundary is the one `SECURITY.md` draws: formulas are untrusted, and the library's source is
 * reviewed code. Review owns what this spec does not decide, as it owns how a function's own loops
 * read their input and how often a function runs a listed pattern (stated in `docs/functions.md`
 * from the code; no spec checks them).
 *
 * The spec reads every module under `src` with the TypeScript type checker and reconciles the list
 * with what it finds, both ways. A reference by name below is an identifier, a property name
 * included, or the literal key of an element access or of a destructuring, outside a type (a
 * class's `extends` clause is not one). It reads:
 * - every regular expression literal;
 * - every reference by the name `RegExp`: called or constructed, it is a construction, as is a
 *   call or `new` the checker resolves to `RegExpConstructor`; as the right side of `instanceof`,
 *   nothing; anything else is a problem;
 * - every site named like a method that compiles or runs a pattern (`match`, `matchAll`, `search`,
 *   `replace`, `replaceAll`, `split`, `test`, `exec`, `compile`, or a `Symbol.match`, `matchAll`,
 *   `replace`, `search` or `split` key), on any receiver: a call of a `String` or `RegExp` method
 *   is classified (a string `match`, `matchAll` or `search` compiles must be a literal; a pattern a
 *   call runs is followed through constants, imports, parameters at every call, returned values,
 *   object properties, destructuring, conditionals and maps to the literal or construction it
 *   comes from); a `compile` the checker resolves to the `RegExp` interface or cannot resolve, and
 *   a `String` or `RegExp` method used as a value (`call`, `apply`, `bind`, an assignment, a
 *   destructuring), are problems; any other such site is a problem unless `NOT_PATTERNS` lists it
 *   by module, line, column and name;
 * - every reference by the name `eval`, `Function` or `Reflect`, and every `prototype` of
 *   `String`, `RegExp` or `Function`: each is a problem;
 * - every receiver of a site so named, and every callee, that the checker types `any` or
 *   `unknown`: each is a problem.
 * Also a problem: an element access whose key is not a literal, where it is called or its value
 * can be; a cast that makes a value callable; a spec file a module imports; a file under `src`
 * that is not a TypeScript module. A problem has no listing. A pattern built at run time from a
 * value is listed by the function that builds it.
 *
 * The spec does not decide a spelling that hides the construct from the type checker: a value
 * made callable through a type annotation or a type predicate, an alias typed with its own
 * construct signature, code run by any other route (`node:vm` and the like), or a module outside
 * the spec's program, such as a helper another package (`@formulang/definitions`) exports.
 * `compileSafeRegex`, 1.0.0's helper for a formula's own pattern, is listed with the gap its rules
 * leave.
 */

const SRC = path.join(__dirname, '..');
const REPO = path.join(SRC, '..', '..');

/** A pattern, as `RegExp.prototype.toString` writes it, and how it reads its input. */
type PatternEntry = { readonly regex: string; readonly reads: string };
/** A pattern built at run time by the named function, and what bounds it. */
type BuiltEntry = { readonly builtIn: string; readonly reads: string };
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
        "Runs on the author's pattern after its length check: `(.*)` gives back one code unit per try and each try reads the flags, so quadratic in that length.",
    },
    {
      regex: '/\\\\[1-9]/',
      reads: 'Two fixed code units, unanchored: each code unit tested once.',
    },
    { regex: '/(\\(\\?<=|\\(\\?<!)/', reads: 'Fixed alternatives of four code units.' },
    {
      builtIn: 'compileSafeRegex',
      reads:
        "The formula's own pattern, under 1.0.0's safe-regex rules (length limits, no backreferences or lookbehind, no quantified nested quantifier or alternation); patterns they accept can still read in polynomial time: on the 8,000 code units `maxRegexTextLength` admits, `\\s*\\s*!` runs for minutes, and the wall-time limit is read only when the call returns.",
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
        "Quadratic in the text after `@` when no split of it fits, as each `.` makes the last class re-read the rest (16,000 code units take 0.4 s): ISURL's check of a `mailto:` address.",
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

/** The modules under `dir`: every `.ts` file but specs and declarations. */
function modulesUnder(dir: string): string[] {
  return filesUnder(dir).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'),
  );
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

function enclosingFunction(node: ts.Node): string {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name !== undefined
    ) {
      const owner =
        ts.isMethodDeclaration(current) && ts.isClassLike(current.parent) && current.parent.name
          ? `${current.parent.name.text}.`
          : '';
      return `${owner}${current.name.getText()}`;
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
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
  const files = (
    modules === undefined
      ? modulesUnder(SRC)
      : [...virtual.keys()].filter((file) => !file.endsWith('.spec.ts'))
  ).sort();
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
    ...(modules === undefined ? filesUnder(SRC) : [])
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

  /** Whether `node` is in a type, where it names no value (a class's `extends` names one). */
  const inType = (node: ts.Node): boolean => {
    for (let current = node.parent; current !== undefined; current = current.parent) {
      if (ts.isExpressionWithTypeArguments(current)) {
        const clause = current.parent;
        return !(
          ts.isHeritageClause(clause) &&
          clause.token === ts.SyntaxKind.ExtendsKeyword &&
          ts.isClassLike(clause.parent)
        );
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

  /** A reference written with the name `RegExp`, `eval`, `Function` or `Reflect`. */
  const byName = (name: string, reference: ts.Node): void => {
    const outer = outermost(reference, false);
    const parent = outer.parent;
    if (DYNAMIC_NAMES.has(name)) {
      problems.push(`${name}, which runs code by name: ${where(parent)}`);
    } else if (
      name === 'RegExp' &&
      !(
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.expression === outer
      ) &&
      !(
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        parent.right === outer
      )
    ) {
      problems.push(`the RegExp constructor used as a value: ${where(parent)}`);
    }
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

  /** The text a string expression holds, when it holds a literal; undefined otherwise. */
  const textOf = (expression: ts.Expression, seen: Set<ts.Node>): string | undefined => {
    const node = skipOuter(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (!ts.isIdentifier(node) || seen.has(node)) return undefined;
    seen.add(node);
    const declaration = symbolOf(node)?.valueDeclaration;
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const &&
      declaration.initializer !== undefined
    ) {
      return textOf(declaration.initializer, seen);
    }
    return undefined;
  };

  const construction = (node: ts.CallExpression | ts.NewExpression): Origin => {
    const [patternArgument, flagsArgument] = node.arguments ?? [];
    const argument = patternArgument === undefined ? undefined : skipOuter(patternArgument);
    let pattern: string | undefined = '';
    // A pattern built from a literal keeps the literal's flags unless the call gives its own.
    let literalFlags = '';
    if (argument !== undefined && argument.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = argument.getText();
      const last = text.lastIndexOf('/');
      pattern = text.slice(1, last);
      literalFlags = text.slice(last + 1);
    } else if (argument !== undefined) {
      pattern = textOf(argument, new Set());
    }
    const flags = flagsArgument === undefined ? literalFlags : textOf(flagsArgument, new Set());
    const module = moduleName(node.getSourceFile().fileName);
    return pattern !== undefined && flags !== undefined
      ? { module, key: keyOfPattern(pattern, flags) }
      : { module, key: `built in ${enclosingFunction(node)}` };
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
        return [construction(node)];
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
      // The `RegExp` interface's `compile`, or one the checker cannot resolve, recompiles a
      // pattern at run time; a `compile` declared anywhere else is a site like any other.
      if (
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
        const text = textOf(argument, new Set());
        if (text === undefined) problems.push(`a pattern compiled from a value: ${where(call)}`);
        else origins.push({ module, key: keyOfPattern(text, name === 'matchAll' ? 'g' : '') });
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
        if (DYNAMIC_NAMES.has(name) || name === 'RegExp') byName(name, node);
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
    } else if (bySymbol || textOrPatternMember(receiver, name)) {
      problems.push(`a String or RegExp method used as a value: ${where(node.parent)}`);
    } else {
      notAPattern(nameNode, name);
    }
  };

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
    if (
      name !== undefined &&
      !ts.isIdentifier(property) &&
      (DYNAMIC_NAMES.has(name) || name === 'RegExp')
    ) {
      byName(name, property);
    }
    if (name === undefined || !PATTERN_METHODS.has(name)) return;
    const source = checker.getTypeAtLocation(pattern);
    if (anyOrUnknown(source)) {
      problems.push(`a receiver typed any or unknown: ${where(pattern)}`);
    } else if (textOrPatternMember(source, name)) {
      problems.push(`a String or RegExp method used as a value: ${where(pattern)}`);
    } else {
      notAPattern(property, name);
    }
  };

  /** Whether `node` is the key of an element access, or a literal type. */
  const isKeyOrType = (node: ts.Node): boolean => {
    const outer = outermost(node, true);
    const parent = outer.parent;
    return (
      parent !== undefined &&
      ((ts.isElementAccessExpression(parent) && parent.argumentExpression === outer) ||
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
        if (isConstruction(node)) origins.push(construction(node));
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
      // An identifier or a property name, outside a type: a property name stands for its access.
      if (
        ts.isIdentifier(node) &&
        (DYNAMIC_NAMES.has(node.text) || node.text === 'RegExp') &&
        !inType(node)
      ) {
        byName(
          node.text,
          ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
            ? node.parent
            : node,
        );
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

/** Modules the walk reads in place of `src` in the spec's own cases, by name and line. */
const SELF_TEST: Readonly<Record<string, readonly string[]>> = {
  'keys.ts': [
    "export const spaces = new RegExp(/\\s+/u, 'gu');",
    'export const letters = new RegExp(/[a-z]+/i);',
    'declare const host: { RegExp: new (source: string) => object };',
    "export const pluses = new host.RegExp('x+');",
  ],
  'by-name.ts': [
    'export const Pattern = globalThis.RegExp;',
    'export const make = globalThis.Function;',
    "export const run = globalThis['eval'];",
  ],
  'compile.ts': [
    'class FailureTable {',
    '  compile(phrase: string): number[] {',
    '    return [...phrase].map(() => 0);',
    '  }',
    '}',
    "export const table = new FailureTable().compile('#');",
    "export const recompiled = /a/.compile('b');",
  ],
  'same-line.ts': [
    'const first = { test: (text: string) => text.length > 0 };',
    'const second = { test: (text: string) => text.length > 1 };',
    "export const both = first.test('a') && second.test('b');",
  ],
  'imports-a-spec.ts': ["import { tail } from './tail.spec';", 'export const tailOf = tail;'],
  'tail.spec.ts': ["export const tail = 'x';"],
};

/** The column of what follows `before` on a line of a module of `SELF_TEST`. */
const columnAfter = (module: string, line: number, before: string): number => {
  const text = SELF_TEST[module]?.[line - 1] ?? '';
  return text.indexOf(before) + before.length + 1;
};

describe('the regular expressions of core-functions', () => {
  const found = enumerate();

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
        'regex' in entry ? entry.regex : `built in ${entry.builtIn}`,
      );
      expect([...(byModule.get(module) ?? [])].sort(), module).toStrictEqual(listed.sort());
      for (const entry of entries) expect(entry.reads.length, module).toBeGreaterThan(10);
    }
  });

  it('lists every site named like a pattern method that holds no pattern, both ways', () => {
    expect(found.unlisted.map(siteKey).sort()).toStrictEqual(NOT_PATTERNS.map(siteKey).sort());
    for (const entry of NOT_PATTERNS) expect(entry.is.length, siteKey(entry)).toBeGreaterThan(10);
  });

  it('reads cases of its own as its header states', () => {
    const own = enumerate(
      Object.fromEntries(
        Object.entries(SELF_TEST).map(([name, lines]) => [name, lines.join('\n')]),
      ),
    );
    expect(own.diagnostics).toStrictEqual([]);
    expect(own.modules).toStrictEqual([
      'self-test/by-name.ts',
      'self-test/compile.ts',
      'self-test/imports-a-spec.ts',
      'self-test/keys.ts',
      'self-test/same-line.ts',
    ]);
    // A construction from a literal with flags keys as the pattern it compiles; one reached by a
    // property named `RegExp` is a construction whatever the property's type.
    expect(own.origins.map((origin) => `${origin.module} ${origin.key}`).sort()).toStrictEqual(
      [
        'self-test/compile.ts /a/',
        'self-test/keys.ts /[a-z]+/i',
        'self-test/keys.ts /[a-z]+/i',
        'self-test/keys.ts /\\s+/gu',
        'self-test/keys.ts /\\s+/u',
        'self-test/keys.ts /x+/',
      ].sort(),
    );
    expect([...own.problems].sort()).toStrictEqual(
      [
        'the RegExp constructor used as a value: self-test/by-name.ts:1 Pattern = globalThis.RegExp',
        'Function, which runs code by name: self-test/by-name.ts:2 make = globalThis.Function',
        "eval, which runs code by name: self-test/by-name.ts:3 run = globalThis['eval']",
        "a pattern recompiled at run time (RegExp.prototype.compile): self-test/compile.ts:7 /a/.compile('b')",
        'a spec file a module imports: core-functions/src/self-test/tail.spec.ts',
      ].sort(),
    );
    // A `compile` declared in the module is a site to list; two sites on one line are two keys.
    expect(own.unlisted.map(siteKey).sort()).toStrictEqual(
      [
        {
          module: 'self-test/compile.ts',
          line: 6,
          column: columnAfter('compile.ts', 6, 'FailureTable().'),
          name: 'compile',
        },
        {
          module: 'self-test/same-line.ts',
          line: 3,
          column: columnAfter('same-line.ts', 3, 'first.'),
          name: 'test',
        },
        {
          module: 'self-test/same-line.ts',
          line: 3,
          column: columnAfter('same-line.ts', 3, 'second.'),
          name: 'test',
        },
      ]
        .map(siteKey)
        .sort(),
    );
    expect(new Set(own.unlisted.map(siteKey)).size).toBe(own.unlisted.length);
  });
});
