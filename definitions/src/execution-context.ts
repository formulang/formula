import type { FormulaEvaluationBudget } from './exceptions';
import type { FormulaLimits } from './limits';
import type { FormulaRegistry, FunctionImplementationResolver } from './registry';
import type { FormulaType } from './types';

export interface FormulaExecutionContext {
  registry: FormulaRegistry;
  resolver: FunctionImplementationResolver;
  variables: Record<string, unknown>;

  /** Resolved limits (DEFAULT_FORMULA_LIMITS applied). */
  limits: FormulaLimits;
  /** Shared evaluation budget. */
  budget: FormulaEvaluationBudget;

  /** Optional expected cast/return-type hint for the current evaluation. */
  expectedReturnType?: FormulaType;

  /** Shared caches for `pure` calls (value-only; runner derives outputs). */
  cache?: Map<string, unknown>;
  pending?: Map<string, Promise<unknown>>;
}
