import type {
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FunctionDefinition,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeError,
  makeOkUnknown,
  readCallOutput,
} from '@formulang/definitions';

import { resolveMaybeAsync } from './async';
import { cacheKey, isCacheableByArgs } from './cache';
import type { RunnerState } from './state';
import { addCostOrThrow, callChargeUnits, checkWallTime } from './state';

export async function invokeFunctionBatch(
  signatureId: string,
  def: FunctionDefinition,
  calls: BatchEvaluationCall[],
  execCtx: FormulaExecutionContext,
  state: RunnerState,
): Promise<FormulaNodeOutput[]> {
  checkWallTime(state);

  const impl = execCtx.resolver.get(signatureId);
  if (!impl) {
    return calls.map(() =>
      makeError(def.name, {
        kind: 'runtime',
        code: FormulaErrorCodes.UNBOUND_FUNCTION,
        message: `Implementation not found: ${signatureId}`,
        signatureId: signatureId,
      }),
    );
  }

  // Cache only for non-control-flow functions where all args are evaluated (so keys are stable).
  const useCache = def.purity === 'pure' || def.purity === 'run_cached';
  const canCache = useCache && !def.controlFlow;
  const cache =
    def.purity === 'pure'
      ? state.pureCache
      : def.purity === 'run_cached'
        ? state.runCache
        : undefined;
  const pendingCache =
    def.purity === 'pure'
      ? state.purePending
      : def.purity === 'run_cached'
        ? state.runPending
        : undefined;

  if (calls.length === 1 && canCache && cache && pendingCache) {
    const c = calls[0];
    const argOutputs = await Promise.all(c.args.map((p) => p.output()));
    const argValues = argOutputs.map((o) => o.value);
    if (!isCacheableByArgs(argValues, state.limits)) {
      // Too-large/unbounded args: skip caching.
    } else {
      const k = cacheKey(signatureId, argValues, c.expectedCast, state.limits);
      if (cache.has(k)) {
        return [makeOkUnknown(def.name, cache.get(k), { signatureId: signatureId })];
      }
      const pending = pendingCache.get(k) as unknown as Promise<FormulaNodeOutput[]> | undefined;
      if (pending) {
        return await pending;
      }

      const p = (async (): Promise<FormulaNodeOutput[]> => {
        const started = Date.now();
        addCostOrThrow(state, callChargeUnits(def, execCtx.resolver, signatureId, argValues));
        const outArr = await resolveMaybeAsync(impl.evaluateMultiple(calls, execCtx));
        const elapsed = Date.now() - started;
        if (elapsed > state.limits.maxFunctionWallTimeMs) {
          throw new FormulaRuntimeError(
            FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED,
            'Function wall time limit exceeded',
            'security',
          );
        }
        return outArr;
      })();

      pendingCache.set(k, p as unknown as Promise<unknown>);
      try {
        const outArr = await p;
        // What the implementation gives, read as every reader of a call's output reads it: a
        // missing output is `null` (readCallOutput, which FILTER_BY reads its operator's with).
        const out0 = readCallOutput(def.name, signatureId, outArr[0]);
        if (!outArr[0]) return [out0];
        if (!out0.ok) return outArr;

        // Only cache warning-free outputs so cache hits never lose warning evidence.
        const warnings = out0.warnings;
        if (!warnings || warnings.length === 0) {
          cache.set(k, out0.value ?? null);
        }
        return outArr;
      } finally {
        pendingCache.delete(k);
      }
    }
  }

  const started = Date.now();
  // Charge each call; a control-flow function's arguments are not evaluated for its charge.
  for (const call of calls) {
    const argValues = def.controlFlow
      ? []
      : (await Promise.all(call.args.map((p) => p.output()))).map((o) => o.value);
    addCostOrThrow(state, callChargeUnits(def, execCtx.resolver, signatureId, argValues));
  }

  const out = await resolveMaybeAsync(impl.evaluateMultiple(calls, execCtx));
  const elapsed = Date.now() - started;
  if (elapsed > state.limits.maxFunctionWallTimeMs) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED,
      'Function wall time limit exceeded',
      'security',
    );
  }
  return out;
}
