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
   * Charges a call that an implementation makes itself, of the function `signatureId` with the
   * argument values `args`, exactly as the runner charges the same call written in a formula. It
   * throws `FUNCTION_COST_LIMIT_EXCEEDED` or `COST_LIMIT_EXCEEDED` past either cost limit. The
   * runner provides it; `FILTER_BY` charges each operator call through it.
   *
   * @experimental May change in a minor release.
   */
  chargeCall?: (signatureId: string, args: unknown[]) => void;

  /**
   * Reads an implementation's raw `answer` for a call of `signatureId` with `args` exactly as the
   * runner reads the same call written in a formula, so a function that calls another
   * implementation itself gets the same value or error a formula would. The runner provides it;
   * `FILTER_BY` reads each operator answer through it.
   *
   * @experimental May change in a minor release.
   */
  readCall?: (signatureId: string, args: unknown[], answer: unknown) => FormulaNodeOutput;
}
