import type {
  FormulaLimits,
  FunctionDefinition,
  FunctionImplementationResolver,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaEvaluationBudget,
  FormulaRuntimeError,
} from '@formulang/definitions';

export type RunnerState = {
  startedAt: number;
  limits: FormulaLimits;
  budget: FormulaEvaluationBudget;
  pureCache: Map<string, unknown>;
  purePending: Map<string, Promise<unknown>>;
  runCache: Map<string, unknown>;
  runPending: Map<string, Promise<unknown>>;
  totalCostUnits: number;
};

export function checkWallTime(state: RunnerState): void {
  const elapsed = Date.now() - state.startedAt;
  if (elapsed > state.limits.maxWallTimeMs) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED,
      'Formula wall time limit exceeded',
      'security',
    );
  }
}

/** The flat charge of a call of a control-flow function, and of one whose estimate is unusable. */
const FLAT_CALL_UNITS = 0.05;

/**
 * What one call costs, the one rule by which the runner charges every call, written in the
 * formula or made by an implementation through `chargeCall`: a control-flow function a flat 0.05,
 * whatever its arguments, which it need not evaluate (`args` is then not read); every other
 * function its implementation's estimate for the arguments, or 0.05 where it has no estimator or
 * the estimate is no finite, non-negative number.
 */
export function callChargeUnits(
  def: Pick<FunctionDefinition, 'controlFlow'> | undefined,
  resolver: FunctionImplementationResolver,
  signatureId: string,
  args: unknown[],
): number {
  if (def?.controlFlow) return FLAT_CALL_UNITS;
  const impl = resolver.get(signatureId);
  const raw =
    typeof impl?.estimateCostsInSeconds === 'function' ? impl.estimateCostsInSeconds(args) : NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : FLAT_CALL_UNITS;
}

export function addCostOrThrow(state: RunnerState, callCost: number): void {
  if (callCost > state.limits.maxFunctionCostUnits) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.FUNCTION_COST_LIMIT_EXCEEDED,
      'Formula function cost limit exceeded',
      'security',
    );
  }
  state.totalCostUnits += callCost;
  if (state.totalCostUnits > state.limits.maxTotalCostUnits) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.COST_LIMIT_EXCEEDED,
      'Formula cost limit exceeded',
      'security',
    );
  }
}
