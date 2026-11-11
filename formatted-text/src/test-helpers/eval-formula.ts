import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type { FormulaError, FormulaLimits, TypedRule } from '@formulang/definitions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync, type EvaluateResultAsync } from '@formulang/runner';
import { registerFormattedTextFunctions } from '../index';

type EvalOptions = { limits?: Partial<FormulaLimits> };

/** The core runtime with the formatted-text functions opted in, and a `value` test variable. */
export function createTestRuntime() {
  const runtime = createCoreFormulaRuntime();
  registerFormattedTextFunctions(runtime);
  runtime.registry.registerVariable({
    name: 'value',
    description: 'A test input value.',
    type: FormulaTypes.any(true),
  });
  return runtime;
}

export async function evalFormula(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<{ parsed: TypedRule; compiled: TypedRule; res: EvaluateResultAsync }> {
  const { registry, implementations } = createTestRuntime();
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
  expect(collectAllErrors(parsed, compiled, res.errors)).toStrictEqual([]);
  return res.value;
}

/** The distinct codes of the errors a formula reports, at compile and at run time. */
export async function errorCodes(
  source: string,
  vars: Record<string, unknown> = {},
  options?: EvalOptions,
): Promise<string[]> {
  const { parsed, compiled, res } = await evalFormula(source, vars, options);
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}
