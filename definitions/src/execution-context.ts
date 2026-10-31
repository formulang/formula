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

  /**
   * Charges a call that an implementation makes of the function with signature id `signatureId`,
   * with the argument values `args`, as the runner charges a call of a formula, by the one rule
   * it charges every call by: a control-flow callee a flat 0.05 units, any other its
   * `estimateCostsInSeconds(args)`, or 0.05 units when it has no estimator, against
   * `maxFunctionCostUnits` and `maxTotalCostUnits`, throwing `FUNCTION_COST_LIMIT_EXCEEDED` or
   * `COST_LIMIT_EXCEEDED` past either. The runner provides it; `FILTER_BY` charges each call it
   * makes of its operator through it, while the higher-order functions of 1.0.0 do not use it.
   */
  chargeCall?: (signatureId: string, args: unknown[]) => void;
}
