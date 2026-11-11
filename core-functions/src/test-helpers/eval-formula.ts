import type {
  FormulaError,
  FormulaLimits,
  MutableFormulaRegistry,
  TypedRule,
} from '@formulang/definitions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import {
  evaluateRuleAsync,
  evaluateRuleOutputAsync,
  type EvaluateResultAsync,
  type EvaluateResultOutputAsync,
} from '@formulang/runner';
import { createCoreFormulaRuntime } from '../index';

type RegistrySetup = (registry: MutableFormulaRegistry) => void;

type EvalOptions = {
  setup?: RegistrySetup;
  limits?: Partial<FormulaLimits>;
};

export function createTestRuntime(setup?: RegistrySetup) {
  const { registry, implementations } = createCoreFormulaRuntime();
  // Common test variable used across many formulas.
  registry.registerVariable({
    name: 'value',
    description: 'A test input value.',
    type: FormulaTypes.any(true),
  });
  setup?.(registry);
  return { registry, implementations };
}

export async function evalFormulaOutput(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<
  {
    parsed: TypedRule;
    compiled: TypedRule;
  } & EvaluateResultOutputAsync
> {
  const { registry, implementations } = createTestRuntime(options?.setup);
  const parsed = parseFormula(source, { registry, limits: options?.limits });
  const compiled = optimizeRule(parsed, { registry });
  const out = await evaluateRuleOutputAsync(compiled, {
    registry,
    resolver: implementations,
    variables: vars,
    limits: options?.limits,
  });
  return { parsed, compiled, ...out };
}

export async function evalFormula(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<{
  parsed: TypedRule;
  compiled: TypedRule;
  res: EvaluateResultAsync;
}> {
  const { registry, implementations } = createTestRuntime(options?.setup);
  const parsed = parseFormula(source, { registry, limits: options?.limits });
  const compiled = optimizeRule(parsed, { registry });
  const res = await evaluateRuleAsync(compiled, {
    registry,
    resolver: implementations,
    variables: vars,
    limits: options?.limits,
  });
  return { parsed, compiled, res };
}

export function collectAllErrors(
  parsed: TypedRule,
  compiled: TypedRule,
  runtimeErrors: FormulaError[],
): FormulaError[] {
  return [...parsed.errors, ...compiled.errors, ...runtimeErrors];
}

export async function evalOk(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<unknown> {
  const { parsed, compiled, res } = await evalFormula(source, vars, options);
  const all = collectAllErrors(parsed, compiled, res.errors);
  expect(all).toStrictEqual([]);
  return res.value;
}

/**
 * The codes of the errors a formula reports: those its compiled form carries (the parser's, which
 * optimisation keeps), then those its evaluation reports.
 */
export async function evalErrors(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<string[]> {
  const { compiled, res } = await evalFormula(source, vars, options);
  return [...compiled.errors, ...res.errors].map((error) => error.code);
}

/** Registers `other`, a second test input next to `value` (an `EvalOptions` setup). */
export function withOther(registry: MutableFormulaRegistry): void {
  registry.registerVariable({
    name: 'other',
    description: 'A second test input value.',
    type: FormulaTypes.any(true),
  });
}

export async function evalOkWithOutput(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
) {
  const { parsed, compiled, output, errors, perNode } = await evalFormulaOutput(
    source,
    vars,
    options,
  );
  const all = collectAllErrors(parsed, compiled, errors);
  expect(all).toStrictEqual([]);
  return { output, perNode, value: output.value ?? null };
}
