import type {
  FormulaError,
  FormulaLimits,
  FunctionImplementation,
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
import type { WorkCount, WorkCountingConfig } from '../functions/work-count';
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

/** Registers `other`, a second test input next to `value`. */
function withOther(registry: MutableFormulaRegistry): void {
  registry.registerVariable({
    name: 'other',
    description: 'A second test input value.',
    type: FormulaTypes.any(true),
  });
}

/**
 * Evaluates `source` as `evalOk` does, with the implementation the core runtime registers for
 * `signatureId` rebuilt from the same class with a work counter, and answers the value with the
 * steps that evaluation counted. The class must be exactly the one the core runtime registers, so
 * the count is the work of the public function as embedders run it. `value` and `other` are the
 * inputs.
 */
export async function evalCountingWork(
  source: string,
  signatureId: string,
  implementationClass: new (config: WorkCountingConfig) => FunctionImplementation,
  vars: Record<string, unknown> = {},
): Promise<{ value: unknown; steps: number }> {
  const { registry, implementations } = createTestRuntime(withOther);
  expect(implementations.get(signatureId)?.constructor).toBe(implementationClass);
  const work: WorkCount = { steps: 0 };
  implementations.register(signatureId, new implementationClass({ signatureId, work }));
  const parsed = parseFormula(source, { registry });
  const compiled = optimizeRule(parsed, { registry });
  const res = await evaluateRuleAsync(compiled, {
    registry,
    resolver: implementations,
    variables: vars,
  });
  expect(collectAllErrors(parsed, compiled, res.errors)).toStrictEqual([]);
  return { value: res.value, steps: work.steps };
}

/**
 * Evaluates `source` as `evalOk` does and answers the value with the milliseconds the evaluation
 * took. `value` and `other` are the inputs.
 */
export async function evalTimed(
  source: string,
  vars: Record<string, unknown> = {},
): Promise<{ value: unknown; milliseconds: number }> {
  const { registry, implementations } = createTestRuntime(withOther);
  const parsed = parseFormula(source, { registry });
  const compiled = optimizeRule(parsed, { registry });
  const started = performance.now();
  const res = await evaluateRuleAsync(compiled, {
    registry,
    resolver: implementations,
    variables: vars,
  });
  const milliseconds = performance.now() - started;
  expect(collectAllErrors(parsed, compiled, res.errors)).toStrictEqual([]);
  return { value: res.value, milliseconds };
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
