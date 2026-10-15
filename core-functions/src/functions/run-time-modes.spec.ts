import type { FormulaNodeOutput } from '@formulang/definitions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleOutputAsync } from '@formulang/runner';
import { createTestRuntime } from '../test-helpers/eval-formula';

/**
 * What a formula answers for a mode that reaches a function when the call runs, which the parser
 * does not see: a core function answers a mode it does not list with `null` and a `TYPE` warning,
 * wherever the mode comes from, and a core higher-order function that called it keeps the `null`
 * and drops the warning, as on 1.0.0. Every core definition with a parameter that lists admitted
 * values comes from the live registry, reconciled both ways with the calls below, and is run with
 * each admitted mode and with misspelt ones given as values when the call runs.
 */

const MODE = 'MODE';

/** One call of each such function: its arguments, with `MODE` where the mode goes. */
const CALLS: Record<string, unknown[]> = {
  'WORDS/v1': ['Hello, wide world', MODE],
  'WORD_COUNT/v1': ['Hello, wide world', MODE],
  'LEADING_WORDS/v1': ['Hello, wide world', 2, MODE],
  'SENTENCES/v1': ['One. Two! Three', MODE],
  'LINES/v1': ['a\n\nb', MODE],
  'LINE_COUNT/v1': ['a\n\nb', MODE],
  'FIRST_CONTAINED/v1': ['the cat sat', ['at', 'cat'], MODE],
  'CONTAINS_ANY/v1': ['concatenate', ['cat'], MODE],
  'MISSING_FROM/v1': [['Cat', 'dog'], 'the  cat', MODE],
  'PLAIN_TEXT/v1': ['<b>Hi</b> *there*', MODE],
  'MARKDOWN_BLOCKS/v1': ['# Title\n\ntext', MODE],
};

/** Values no definition lists, each standing for a mistake a run-time mode can carry. */
function misspellings(admitted: readonly string[]): unknown[] {
  const [first = ''] = admitted;
  const candidates = [
    first.slice(0, -1),
    `${first}x`,
    first.toUpperCase(),
    ` ${first}`,
    '',
    'x',
    1,
    true,
    [first],
  ];
  return candidates.filter((value) => typeof value !== 'string' || !admitted.includes(value));
}

function runtime() {
  const { registry, implementations } = createTestRuntime();
  for (const name of ['fn', 'mode', 'a0', 'a1', 'a2']) {
    registry.registerVariable({
      name,
      description: 'Run-time mode input.',
      type: FormulaTypes.any(true),
    });
  }
  // A host's higher-order function: calls the function the name resolves to, as the core
  // higher-order functions resolve it, and answers that call's own output, warnings included.
  registry.registerFunction({
    signatureId: 'APPLY/v1',
    name: 'APPLY',
    category: 'custom',
    description: 'Calls the named function with the other arguments and answers its output.',
    params: [
      { name: 'name', type: FormulaTypes.text(true) },
      { name: 'args', type: FormulaTypes.any(true), optional: true, variadic: true },
    ],
    returnType: FormulaTypes.any(true),
    purity: 'pure',
  });
  implementations.register('APPLY/v1', {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      const outs: FormulaNodeOutput[] = [];
      for (const call of calls) {
        const name = String(await call.args[0]?.value());
        const def = ctx.registry
          .listFunctionsByName(name)
          .find((candidate) => ctx.resolver.get(candidate.signatureId) !== undefined);
        const implementation = def && ctx.resolver.get(def.signatureId);
        if (!implementation) throw new Error(`no implementation of ${name}`);
        const [out] = await implementation.evaluateMultiple(
          [{ args: call.args.slice(1), callId: '0' }],
          ctx,
        );
        if (!out) throw new Error(`no output from ${name}`);
        outs.push(out);
      }
      return outs;
    },
  });
  return { registry, implementations };
}

async function run(source: string, variables: Record<string, unknown>) {
  const { registry, implementations } = runtime();
  const parsed = parseFormula(source, { registry });
  expect(parsed.errors, source).toStrictEqual([]);
  const compiled = optimizeRule(parsed, { registry });
  const out = await evaluateRuleOutputAsync(compiled, {
    registry,
    resolver: implementations,
    variables,
  });
  expect(out.errors, source).toStrictEqual([]);
  return { value: out.output.value ?? null, warnings: warningsIn(out.output) };
}

/** The codes of every warning in an output tree, at any node. */
function warningsIn(output: FormulaNodeOutput): string[] {
  return [
    ...(output.warnings ?? []).map((warning) => warning.code),
    ...output.children.flatMap(warningsIn),
  ];
}

const enumerated = runtime()
  .registry.listFunctions()
  .flatMap((def) =>
    def.params.flatMap((param, position) =>
      param.literalValues === undefined
        ? []
        : [{ def, position, admitted: param.literalValues, optional: param.optional === true }],
    ),
  );

describe('a mode received when the call runs', () => {
  it('calls a callable named by a value or an expression, and answers null for its misspelt mode', async () => {
    // The examples of docs/language.md, Callable references: the nested call resolves the name
    // when it runs.
    expect(
      await run('EACH(LIST(LIST("a b")); "EACH"; value)', { value: 'WORD_COUNT' }),
    ).toStrictEqual({ value: [[2]], warnings: [] });
    expect(await run('EACH(LIST(LIST("a b")); "EACH"; "WORD" & "_COUNT")', {})).toStrictEqual({
      value: [[2]],
      warnings: [],
    });
    // The higher-order functions keep a callee's value, not its warnings.
    const source = 'EACH(LIST(LIST("a b")); "EACH"; value; "whitespce")';
    expect(await run(source, { value: 'WORD_COUNT' })).toStrictEqual({
      value: [[null]],
      warnings: [],
    });
    expect(
      await run('EACH(LIST(LIST("a b")); "EACH"; value; "letters")', { value: 'WORD_COUNT' }),
    ).toStrictEqual({ value: [[2]], warnings: [] });
    expect(
      await run('EACH(LIST(LIST("a b")); "EACH"; "WORD" & "_COUNT"; "whitespce")', {}),
    ).toStrictEqual({ value: [[null]], warnings: [] });
  });

  it('answers null, with no error and no warning, for a mode past where the parser stops following', async () => {
    // A host's EACH overload with forty parameters makes the parser visit forty positions at every
    // level of a chain of EACH, so its walk reaches its limit (linear in the call) long before the
    // end of a chain of forty levels. The formula compiles, and WORD_COUNT receives the misspelt
    // mode at the end of the chain when the call runs: it answers null with a TYPE warning, which
    // the core EACH that called it drops while keeping the null, as on 1.0.0. With the core
    // definitions alone the same formula does not compile: the walk reaches the mode.
    const levels = 40;
    const list = `${'LIST('.repeat(levels + 1)}"a b"${')'.repeat(levels + 1)}`;
    const source = (mode: string) =>
      `EACH(${list}; ${'"EACH"; '.repeat(levels)}"WORD_COUNT"; "${mode}")`;
    const limits = { maxParenDepth: 2 * levels };
    const nested = (value: unknown): unknown => {
      let out = value;
      for (let level = 0; level <= levels; level++) out = [out];
      return out;
    };
    const wide = () => {
      const built = runtime();
      const [each] = built.registry.listFunctionsByName('EACH');
      if (each === undefined) throw new Error('no EACH');
      built.registry.registerFunction({
        ...each,
        signatureId: 'WIDE_EACH/v1',
        params: [
          { name: 'target', type: FormulaTypes.list(FormulaTypes.number(true)) },
          ...each.params.slice(1, 2),
          ...Array.from({ length: 38 }, (_, index) => ({
            name: `option${index}`,
            type: FormulaTypes.text(true),
            optional: true,
          })),
        ],
      });
      return built;
    };
    const outcome = async (built: ReturnType<typeof runtime>, mode: string) => {
      const parsed = parseFormula(source(mode), { registry: built.registry, limits });
      if (parsed.errors.length > 0) return { parse: parsed.errors.map((error) => error.code) };
      const out = await evaluateRuleOutputAsync(
        optimizeRule(parsed, { registry: built.registry }),
        {
          registry: built.registry,
          resolver: built.implementations,
          variables: {},
        },
      );
      return {
        value: out.output.value ?? null,
        errors: out.errors.map((error) => error.code),
        warnings: warningsIn(out.output),
      };
    };
    expect(await outcome(runtime(), 'whitespce')).toStrictEqual({
      parse: ['LITERAL_VALUE_NOT_ALLOWED'],
    });
    // The mode past the bound: the item is null, and the formula reports neither an error nor a
    // warning, at any node.
    const past = await outcome(wide(), 'whitespce');
    expect(past).toStrictEqual({ value: nested(null), errors: [], warnings: [] });
    // Not vacuous: an admitted mode answers through the same chain...
    expect(await outcome(wide(), 'letters')).toStrictEqual({
      value: nested(2),
      errors: [],
      warnings: [],
    });
    // ...and WORD_COUNT itself answers the misspelt mode with null and a TYPE warning, which the
    // chain drops.
    expect(
      await run('APPLY(fn; a0; mode)', { fn: 'WORD_COUNT', a0: 'a b', mode: 'whitespce' }),
    ).toStrictEqual({ value: null, warnings: ['TYPE'] });
  });

  it('answers null for a nested call that omits a required mode', async () => {
    const required = enumerated.filter(({ optional }) => !optional);
    // Not vacuous: PLAIN_TEXT and MARKDOWN_BLOCKS require theirs.
    expect(required.length).toBeGreaterThanOrEqual(2);
    for (const { def, position } of required) {
      const call = CALLS[def.signatureId] ?? [];
      const inputs = Object.fromEntries(call.map((value, index) => [`a${index}`, value]));
      const before = call.slice(1, position).map((_, index) => `; a${index + 1}`);
      const source = `EACH(LIST(LIST(a0)); "EACH"; "${def.name}"${before.join('')})`;
      expect(await run(source, inputs), source).toStrictEqual({ value: [[null]], warnings: [] });
      // Passed on by the call written in the formula, the callable must take what it is given.
      const forwarded = `EACH(LIST(a0); "${def.name}"${before.join('')})`;
      const { registry } = runtime();
      expect(
        parseFormula(forwarded, { registry }).errors.map((error) => error.code),
        forwarded,
      ).toStrictEqual(['NO_MATCHING_OVERLOAD']);
    }
    // The block kind omitted where the text is written in the formula.
    expect(await run('EACH(LIST(LIST("# T")); "EACH"; "MARKDOWN_BLOCKS")', {})).toStrictEqual({
      value: [[null]],
      warnings: [],
    });
  });

  it('has a call for every core definition that lists admitted values, and only those', () => {
    expect(enumerated.length).toBeGreaterThanOrEqual(11);
    expect(enumerated.map(({ def }) => def.signatureId).sort()).toStrictEqual(
      Object.keys(CALLS).sort(),
    );
    for (const { def, position } of enumerated) {
      expect(CALLS[def.signatureId]?.indexOf(MODE), def.signatureId).toBe(position);
    }
  });

  it.each(enumerated.map((entry) => [entry.def.name, entry] as const))(
    '%s answers each admitted mode as the literal does, and any other with null: a TYPE warning when called directly, none through EACH',
    async (name, { def, admitted, optional }) => {
      const call = CALLS[def.signatureId] ?? [];
      const inputs = Object.fromEntries(
        call.flatMap((value, index) => (value === MODE ? [] : [[`a${index}`, value]])),
      );
      // The arguments as formula text, the mode as given or, when undefined, omitted.
      const args = (mode?: string) =>
        call
          .flatMap((value, index) => {
            if (value !== MODE) return [`a${index}`];
            return mode === undefined ? [] : [mode];
          })
          .join('; ');
      // The outer EACH passes the function's name on to the inner EACH, which calls the function
      // with the item first and the rest after it.
      const rest = call
        .slice(1)
        .map((value, index) => (value === MODE ? 'mode' : `a${index + 1}`))
        .join('; ');
      const throughEach = `EACH(LIST(LIST(a0)); "EACH"; fn; ${rest})`;

      let answered = 0;
      for (const mode of admitted) {
        const literal = await run(`${name}(${args(JSON.stringify(mode))})`, inputs);
        const viaName = await run(`APPLY(fn; ${args('mode')})`, { ...inputs, fn: name, mode });
        expect(viaName, `${name} ${mode}`).toStrictEqual(literal);
        const viaEach = await run(throughEach, { ...inputs, fn: name, mode });
        expect(viaEach.value, `${name} ${mode} through EACH`).toStrictEqual([[literal.value]]);
        if (literal.value !== null) answered++;
      }
      // Not vacuous: an admitted mode answers, so the null below is the refusal.
      expect(answered, name).toBeGreaterThan(0);

      for (const mode of misspellings(admitted)) {
        const viaName = await run(`APPLY(fn; ${args('mode')})`, { ...inputs, fn: name, mode });
        expect(viaName, `${name} ${JSON.stringify(mode)}`).toStrictEqual({
          value: null,
          warnings: ['TYPE'],
        });
        const viaEach = await run(throughEach, { ...inputs, fn: name, mode });
        expect(viaEach, `${name} ${JSON.stringify(mode)} through EACH`).toStrictEqual({
          value: [[null]],
          warnings: [],
        });
      }

      // A null mode is an omitted one: the default where the mode is optional, refused otherwise.
      const viaNull = await run(`APPLY(fn; ${args('mode')})`, { ...inputs, fn: name, mode: null });
      if (optional) {
        expect(viaNull, `${name} null`).toStrictEqual(await run(`${name}(${args()})`, inputs));
      } else {
        expect(viaNull, `${name} null`).toStrictEqual({ value: null, warnings: ['TYPE'] });
      }
    },
  );
});
