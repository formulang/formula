import type { FormulaEvaluationBudget } from './exceptions';
import type { FormulaNodeOutput } from './execution-output';
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

  /**
   * Reads what the implementation of `signatureId` answered for one call with the argument values
   * `args` as the runner reads the same call written in a formula, on the path the runner would
   * take for it: where it answers the call through its cache (a pure or run-cached function that is
   * not control flow, with arguments it can key), an answer that is no output, any falsy value, is
   * `null`; an ok output gives its value; any other answer is a failed call, whose output carries
   * the error the runner raises for it (`EVAL_CRASH` for an answer that is no output). The runner
   * provides it; `FILTER_BY` reads each answer of its operator through it.
   */
  readCall?: (signatureId: string, args: unknown[], answer: unknown) => FormulaNodeOutput;
}
