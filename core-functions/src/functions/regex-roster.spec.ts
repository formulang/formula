import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * A regular expression is where a text function can read its input in more than linear time, so
 * every one core-functions compiles is listed here with how it reads its input, and this spec
 * reconciles the list, both ways, with what the TypeScript type checker finds on every module
 * under `src`: each regular expression literal; each `RegExp` construction, however the
 * constructor is reached; each string that `match`, `matchAll` or `search` compiles into a
 * pattern; and, wherever a pattern runs (`test`, `exec`, or a regular expression given to `match`,
 * `matchAll`, `search`, `replace`, `replaceAll` or `split`), the expression that holds it,
 * followed through constants, imports, parameters (to every call of the function), returned
 * values, object properties, destructuring, conditionals and maps to the literal or construction
 * it comes from. A pattern it cannot follow to one, or an argument it cannot classify, is a
 * problem the spec reports; a pattern built at run time from a value that is not a literal is
 * listed by the function that builds it.
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
        "The formula's own pattern, under the safe-regex rules (length limits, no backreferences or lookbehind, no quantified nested quantifier or alternation); patterns they accept can still read in polynomial time, bounded only by `maxRegexTextLength` (8,000).",
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

/** A pattern the spec cannot follow to its origin. */
class Unresolved extends Error {}

function modulesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...modulesUnder(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

function moduleName(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
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

/** Every regular expression of the modules under `src`, and every problem following them. */
function enumerate(): {
  modules: string[];
  origins: Origin[];
  uses: number;
  problems: string[];
  diagnostics: string[];
} {
  const files = modulesUnder(SRC).sort();
  const program = ts.createProgram(files, {
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
  });
  const checker = program.getTypeChecker();
  const sources = files.map((file) => program.getSourceFile(file) as ts.SourceFile);
  const walked = new Set(files.map((file) => path.resolve(file)));
  const origins: Origin[] = [];
  const problems: string[] = [];
  let uses = 0;

  const where = (node: ts.Node): string => {
    const source = node.getSourceFile();
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    return `${moduleName(source.fileName)}:${line} ${node.getText().slice(0, 80)}`;
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

  const regExpConstructor = checker.resolveName('RegExp', undefined, ts.SymbolFlags.Value, false);
  const isRegExpConstructor = (callee: ts.Expression): boolean => {
    const node = skipOuter(callee);
    const named = ts.isPropertyAccessExpression(node) ? node.name : node;
    return regExpConstructor !== undefined && symbolOf(named) === regExpConstructor;
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
    const pattern =
      patternArgument === undefined
        ? ''
        : skipOuter(patternArgument).kind === ts.SyntaxKind.RegularExpressionLiteral
          ? new RegExp(keyOfLiteral(skipOuter(patternArgument).getText()).slice(1, -1)).source
          : textOf(patternArgument, new Set());
    const flags = flagsArgument === undefined ? '' : textOf(flagsArgument, new Set());
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
      if (ownerOf(node) === 'RegExpConstructor' || isRegExpConstructor(node.expression)) {
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

  for (const source of sources) {
    const module = moduleName(source.fileName);
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
        origins.push({ module, key: keyOfLiteral(node.getText()) });
      } else if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        const owner = ownerOf(node);
        if (owner === 'RegExpConstructor' || isRegExpConstructor(node.expression)) {
          origins.push(construction(node));
        } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          const argument = node.arguments[0];
          const type = argument === undefined ? undefined : checker.getTypeAtLocation(argument);
          if (owner === 'String' && ['match', 'matchAll', 'search'].includes(method)) {
            if (argument === undefined || type === undefined) {
              problems.push(`a pattern compiled from nothing: ${where(node)}`);
            } else if (isRegExp(type)) {
              run(argument);
            } else if (isText(type)) {
              const text = textOf(argument, new Set());
              if (text === undefined)
                problems.push(`a pattern compiled from a value: ${where(node)}`);
              else
                origins.push({ module, key: keyOfPattern(text, method === 'matchAll' ? 'g' : '') });
            } else {
              problems.push(`an argument this spec cannot classify: ${where(node)}`);
            }
          } else if (owner === 'String' && ['replace', 'replaceAll', 'split'].includes(method)) {
            if (argument !== undefined && type !== undefined) {
              if (isRegExp(type)) run(argument);
              else if (!isText(type))
                problems.push(`an argument this spec cannot classify: ${where(node)}`);
            }
          } else if (owner === 'RegExp' && (method === 'test' || method === 'exec')) {
            run(node.expression.expression);
          }
        }
      } else if (
        ts.isIdentifier(node) &&
        regExpConstructor !== undefined &&
        symbolOf(node) === regExpConstructor &&
        !ts.isTypeReferenceNode(node.parent) &&
        !ts.isExpressionWithTypeArguments(node.parent) &&
        !(
          ts.isBinaryExpression(node.parent) &&
          node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
        ) &&
        !(
          (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) &&
          node.parent.expression === node
        ) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      ) {
        problems.push(`the RegExp constructor used as a value: ${where(node.parent)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const diagnostics = sources
    .flatMap((source) => [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ])
    .map((diagnostic) => {
      const at =
        diagnostic.file !== undefined && diagnostic.start !== undefined
          ? `${moduleName(diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
          : '';
      return `${at} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
    });
  return { modules: files.map(moduleName), origins, uses, problems, diagnostics };
}

describe('the regular expressions of core-functions', () => {
  const found = enumerate();

  it('reads every module under src with the type checker, and finds every pattern', () => {
    expect(found.diagnostics).toStrictEqual([]);
    expect(found.problems).toStrictEqual([]);
    // Not vacuous: the walk reads the modules, and finds patterns and the places they run.
    expect(found.modules).toEqual(
      expect.arrayContaining(['functions/markup-text.ts', 'functions/regex.ts', 'index.ts']),
    );
    expect(found.modules.length).toBeGreaterThanOrEqual(50);
    expect(found.origins.length).toBeGreaterThanOrEqual(50);
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
});
