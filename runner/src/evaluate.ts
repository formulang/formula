import type {
  FormulaError,
  FormulaRegistry,
  FormulaType,
  FunctionImplementationResolver,
  RuleNode,
  TypedRule,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaEvaluationBudget,
  FormulaTypes,
  emptyRequirements,
  formatType,
  makeError,
  makeFormulaError,
  resolveFormulaLimits,
} from '@formulang/definitions';
import type {
  EvaluateContext,
  EvaluateResult,
  EvaluateResultAsync,
  EvaluateResultOutputAsync,
  EvaluateVariableContext,
  PerNodeMap,
} from './evaluate-types';
import { evalNodeOutputAsync } from './internal/eval-node';
import { deepFreezeLimited } from './internal/immutability';
import { writeNodeError } from './internal/per-node';
import type { RunnerState } from './internal/state';
import { nodeName, toExecutionErrorKind, valueSatisfiesType } from './internal/value-utils';

/**
 * Runner entrypoint (backend-only).
 *
 * @deprecated Synchronous evaluation is not supported; this always throws.
 * Use {@link evaluateRuleAsync} instead.
 */
export function evaluateRule(rule: TypedRule, ctx: EvaluateContext): EvaluateResult {
  throw new Error('Synchronous formula execution is deprecated; use evaluateRuleAsync');
}

/**
 * Async runner entrypoint (backend-only).
 *
 * This is the preferred entrypoint going forward; it supports async variables and functions.
 */
export async function evaluateRuleAsync(
  rule: TypedRule,
  ctx: EvaluateContext & { expectedReturnType?: FormulaType },
): Promise<EvaluateResultAsync> {
  const { output, errors, perNode } = await evaluateRuleOutputAsync(rule, ctx);
  return { value: output.value ?? null, perNode, errors };
}

/**
 * Async runner entrypoint that returns the structured execution output tree.
 *
 * This is the source-of-truth representation.
 */
export async function evaluateRuleOutputAsync(
  rule: TypedRule,
  ctx: EvaluateContext & { expectedReturnType?: FormulaType },
): Promise<EvaluateResultOutputAsync> {
  const limits = resolveFormulaLimits(ctx.limits);
  const budget = ctx.budget ?? new FormulaEvaluationBudget(limits.maxEvaluationSteps);
  const perNode: PerNodeMap = {};
  const errors: FormulaError[] = [];

  // Shared caches are for `pure` calls only. `run_cached` is kept run-local.
  const sharedCache = ctx.cache ?? new Map<string, unknown>();
  const sharedPending = ctx.pending ?? new Map<string, Promise<unknown>>();

  const startedAt = Date.now();
  const state: RunnerState = {
    startedAt,
    limits,
    budget,
    pureCache: sharedCache,
    purePending: sharedPending,
    runCache: new Map<string, unknown>(),
    runPending: new Map<string, Promise<unknown>>(),
    totalCostUnits: 0,
  };

  // Best-effort immutability guarantees: freeze the top-level variables and the context.
  try {
    if (ctx.variables && typeof ctx.variables === 'object')
      deepFreezeLimited(ctx.variables, 6, 2000);
  } catch {
    // ignore
  }

  const output = await evalNodeOutputAsync(
    rule.root,
    ctx,
    state,
    perNode,
    errors,
    ctx.expectedReturnType,
  );

  if (ctx.expectedReturnType && output.ok) {
    const expected = ctx.expectedReturnType;
    const actual = output.value ?? null;
    if (!valueSatisfiesType(actual, expected)) {
      const err = makeFormulaError({
        kind: 'runtime',
        code: FormulaErrorCodes.OUTPUT_TYPE_NOT_ALLOWED,
        message: `Output does not match expected type (${formatType(expected)})`,
        span: rule.root.span,
      });
      errors.push(err);
      writeNodeError(rule.root, err.code, err.message, perNode);
      return {
        output: makeError(nodeName(rule.root), {
          kind: toExecutionErrorKind(err.kind),
          code: err.code,
          message: err.message,
          signatureId: rule.root.kind === 'call' ? rule.root.signatureId : undefined,
          nodeId: rule.root.id,
          span: rule.root.span,
          children: output.children,
        }),
        errors,
        perNode,
      };
    }
  }

  return { output, errors, perNode };
}

/**
 * Async runner entrypoint for variable-only ASTs.
 *
 * This evaluates a compiled AST node that is expected to contain only:
 * - variable
 * - property
 * - wildcard
 *
 * It intentionally does not require a function resolver.
 */
export async function evaluateVariableOutputAsync(
  compiled: RuleNode,
  ctx: EvaluateVariableContext,
): Promise<EvaluateResultOutputAsync> {
  const noopResolver: FunctionImplementationResolver = {
    get: () => undefined,
  };

  // Adapt a variable-only registry to the full FormulaRegistry shape expected by the runner.
  // This is safe because variable-only ASTs never require function/operator lookups.
  const registryAdapter: FormulaRegistry = {
    getVariable: (name: string) => ctx.registry.getVariable(name),
    listVariables: () => ctx.registry.listVariables(),
    getFunction: () => undefined,
    listFunctionsByName: () => [],
    getOperator: () => undefined,
    listFunctions: () => [],
    listOperators: () => [],
  };

  const rule: TypedRule = {
    root: compiled,
    returnType: FormulaTypes.any(true),
    static: false,
    requirements: emptyRequirements(),
    errors: [],
  };

  return await evaluateRuleOutputAsync(rule, {
    registry: registryAdapter,
    resolver: noopResolver,
    variables: ctx.variables,
    limits: ctx.limits,
    budget: ctx.budget,
    cache: ctx.cache,
    pending: ctx.pending,
    expectedReturnType: ctx.expectedReturnType,
  });
}
