import type { FormulaLimits, FunctionImplementationResolver } from '@formulang/definitions';
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

export function estimateCallCostUnits(
  resolver: FunctionImplementationResolver,
  signatureId: string,
  args: unknown[],
): number {
  const impl = resolver.get(signatureId);
  const raw =
    typeof impl?.estimateCostsInSeconds === 'function' ? impl.estimateCostsInSeconds(args) : NaN;
  // Safe default worst-case cost when estimator is missing/unreliable.
  const v = Number.isFinite(raw) && raw >= 0 ? raw : 0.05;
  return v;
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
