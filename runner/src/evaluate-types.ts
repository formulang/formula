import type {
  FormulaError,
  FormulaEvaluationBudget,
  FormulaLimits,
  FormulaNodeOutput,
  FormulaRegistry,
  FormulaType,
  FunctionImplementationResolver,
  VariableOnlyRegistry,
} from '@formulang/definitions';

export interface EvaluateContext {
  registry: FormulaRegistry;
  resolver: FunctionImplementationResolver;
  variables: Record<string, unknown>;
  /** Optional evaluation limits override (defaults to DEFAULT_FORMULA_LIMITS). */
  limits?: Partial<FormulaLimits>;
  /** Optional shared budget; primarily used by tests or higher-level batching. */
  budget?: FormulaEvaluationBudget;

  /**
   * Optional shared cache for `pure` function results.
   *
   * Note: `run_cached` results are cached only within a single evaluation run.
   */
  cache?: Map<string, unknown>;
  /** Optional shared pending cache (in-flight promises) for `pure` calls. */
  pending?: Map<string, Promise<unknown>>;
}

export interface PerNodeEntry {
  span?: { start: number; end: number };
  value?: unknown;
  error?: { code: string; message: string };
  skipped?: true;
  redacted?: true;
  truncated?: true;
}

export type PerNodeMap = Record<string, PerNodeEntry>;

export interface EvaluateResult {
  value: unknown;
  errors: FormulaError[];
  perNode: PerNodeMap;
}

export interface EvaluateResultAsync extends EvaluateResult {
  value: unknown;
}

export interface EvaluateResultOutputAsync {
  output: FormulaNodeOutput;
  errors: FormulaError[];
  perNode: PerNodeMap;
}

export interface EvaluateVariableContext {
  registry: VariableOnlyRegistry;
  variables: Record<string, unknown>;
  limits?: Partial<FormulaLimits>;
  budget?: FormulaEvaluationBudget;
  cache?: Map<string, unknown>;
  pending?: Map<string, Promise<unknown>>;
  expectedReturnType?: FormulaType;
}
