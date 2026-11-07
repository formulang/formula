import type {
  FunctionImplementation,
  FunctionImplementationResolver,
} from '@formulang/definitions';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { callChargeUnits } from './internal/state';

/**
 * The runner charges every call by one rule, `callChargeUnits`: a call written in a formula, on
 * either of its paths, and a call an implementation makes through `chargeCall`. This spec holds
 * the rule's answers, and holds the runner to having no second place that charges a call by its
 * types: `addCostOrThrow` takes a `CallCharge`, which only `callChargeUnits` makes, and the
 * total it adds to is read-only elsewhere. The TypeScript compiler checks a program that tries
 * each way around it, and the runner's invoke.ts with each of them written in.
 */

const RUNNER = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INVOKE = `${RUNNER}internal/invoke.ts`;
const CHECK = `${RUNNER}charge-brand-check.ts`;

// The program: the runner's compiler options, the packages read from their sources as the
// tests read them (no build needed), nothing emitted.
const OPTIONS: ts.CompilerOptions = {
  ...ts.parseJsonConfigFileContent(
    ts.readConfigFile(`${ROOT}runner/tsconfig.json`, ts.sys.readFile).config,
    ts.sys,
    `${ROOT}runner`,
  ).options,
  noEmit: true,
  declaration: false,
  declarationMap: false,
  sourceMap: false,
  rootDir: undefined,
  outDir: undefined,
  typeRoots: [`${ROOT}node_modules/@types`],
  paths: {
    '@formulang/definitions': [`${ROOT}definitions/src/index.ts`],
    '@formulang/parser': [`${ROOT}parser/src/index.ts`],
  },
};

const BRAND_CHECK = `import type { FunctionImplementationResolver } from '@formulang/definitions';
import { addCostOrThrow, callChargeUnits } from './internal/state';
import type { RunnerState } from './internal/state';

declare const state: RunnerState;
declare const resolver: FunctionImplementationResolver;

// A charge the rule makes is what addCostOrThrow takes.
addCostOrThrow(state, callChargeUnits({ controlFlow: true }, resolver, 'AND/v1', []));
const read: number = state.totalCostUnits;
export { read };

// @ts-expect-error a number is no charge
addCostOrThrow(state, 0.05);
const chargeAgain = addCostOrThrow;
// @ts-expect-error nor through an alias of addCostOrThrow
chargeAgain(state, 1);
// @ts-expect-error nor arithmetic on a charge
addCostOrThrow(state, callChargeUnits(undefined, resolver, 'X/v1', []) * 2);
// @ts-expect-error the total is addCostOrThrow's alone to write
state.totalCostUnits += 1;
`;

// A second place that charges a call, written into invoke.ts's uncached path.
const SECOND_CHARGES: readonly (readonly [string, string, string])[] = [
  [
    'an alias of addCostOrThrow',
    '  const out = await resolveMaybeAsync(',
    '  const chargeAgain = addCostOrThrow;\n  chargeAgain(state, 1);\n  const out = await resolveMaybeAsync(',
  ],
  [
    'the total written directly',
    '  const out = await resolveMaybeAsync(',
    '  state.totalCostUnits += 1;\n  const out = await resolveMaybeAsync(',
  ],
  [
    "twice the rule's answer",
    '    addCostOrThrow(state, callChargeUnits(def, execCtx.resolver, signatureId, argValues));\n  }',
    '    addCostOrThrow(state, callChargeUnits(def, execCtx.resolver, signatureId, argValues) * 2);\n  }',
  ],
  [
    'a number of its own',
    '  const out = await resolveMaybeAsync(',
    '  addCostOrThrow(state, 1);\n  const out = await resolveMaybeAsync(',
  ],
];

let previous: ts.Program | undefined;

/** The compiler's errors for a program of `root`, read as `text` where it is given. */
function diagnostics(root: string, text: string = BRAND_CHECK): string[] {
  const host = ts.createCompilerHost(OPTIONS);
  host.getCurrentDirectory = () => ROOT;
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, language, ...rest) =>
    fileName === root
      ? ts.createSourceFile(fileName, text, language)
      : getSourceFile(fileName, language, ...rest);
  host.readFile = (fileName) => (fileName === root ? text : readFile(fileName));
  host.fileExists = (fileName) => fileName === root || fileExists(fileName);
  const program = ts.createProgram({
    rootNames: [root],
    options: OPTIONS,
    host,
    oldProgram: previous,
  });
  previous = program;
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file
      ? `${d.file.fileName.replace(ROOT, '')}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}`
      : '';
    return `${where} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

function resolver(
  implementation?: Partial<FunctionImplementation>,
): FunctionImplementationResolver {
  return {
    get: () => implementation as FunctionImplementation | undefined,
  } as unknown as FunctionImplementationResolver;
}

describe('the charge of a call', () => {
  it('is a flat 0.05 for a control-flow function, whatever its estimate and its arguments', () => {
    const estimating = resolver({ estimateCostsInSeconds: () => 0.0001 });
    expect(callChargeUnits({ controlFlow: true }, estimating, 'AND/v1', [true, true])).toBe(0.05);
    expect(callChargeUnits({ controlFlow: true }, estimating, 'AND/v1', [])).toBe(0.05);
    expect(callChargeUnits({ controlFlow: false }, estimating, 'ADD/v1', [1, 2])).toBe(0.0001);
    expect(callChargeUnits(undefined, estimating, 'HOST/v1', [1])).toBe(0.0001);
  });

  it('is the estimate for any other function, or 0.05 where the estimate is unusable', () => {
    expect(
      callChargeUnits({}, resolver({ estimateCostsInSeconds: (args) => args.length }), 'X', [1, 2]),
    ).toBe(2);
    expect(callChargeUnits({}, resolver({}), 'X', [])).toBe(0.05);
    expect(callChargeUnits({}, resolver(undefined), 'X', [])).toBe(0.05);
    for (const raw of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(
        callChargeUnits({}, resolver({ estimateCostsInSeconds: () => raw }), 'X', []),
        String(raw),
      ).toBe(0.05);
    }
  });

  it('is computed in one place: no second place that charges a call compiles', () => {
    // The type-level check: each line under @ts-expect-error must fail to compile, and the rest
    // must compile, so the brand that makes a charge is what this program measures.
    expect(diagnostics(CHECK)).toStrictEqual([]);
    // The runner's own invoke.ts compiles as it is, and does not once a second place charges a
    // call: through an alias of addCostOrThrow, by writing the total, with arithmetic on the
    // rule's answer, or with a number of its own.
    expect(diagnostics(INVOKE, readFileSync(INVOKE, 'utf8'))).toStrictEqual([]);
    for (const [label, from, to] of SECOND_CHARGES) {
      const text = readFileSync(INVOKE, 'utf8');
      expect(text.split(from).length, `${label}: ${from}`).toBe(2);
      expect(diagnostics(INVOKE, text.replace(from, to)), label).not.toStrictEqual([]);
    }
  });

  it('is minted by callChargeUnits alone: no other source of the runner names the charge type', () => {
    // A second reading, by the text: a source that named CallCharge could cast a number to it.
    const sources = ['./', './internal/'].flatMap((path) => {
      const directory = new URL(path, import.meta.url);
      return readdirSync(directory)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
        .map((name) => ({
          name: `${path}${name}`,
          text: readFileSync(new URL(name, directory), 'utf8'),
        }));
    });
    expect(sources.length).toBeGreaterThan(10);
    const naming = sources
      .filter(({ text }) => /\bCallCharge\b/.test(text))
      .map(({ name }) => name);
    expect(naming).toStrictEqual(['./internal/state.ts']);
  });
});
