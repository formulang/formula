import { FormulaErrorCodes, FormulaRuntimeError } from '@formulang/definitions';
import type { EvaluateContext } from '../evaluate-types';

import { resolveMaybeAsync } from './async';
import type { RunnerState } from './state';
import { checkWallTime } from './state';

function readOwnProperty(obj: object, property: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(obj, property)) return null;
  return (obj as any)[property] ?? null;
}

export async function resolvePropertyValue(
  obj: unknown,
  property: string,
  ctx: EvaluateContext,
  state: RunnerState,
): Promise<unknown> {
  if (obj == null) return null;
  if (typeof obj !== 'object') return null;

  const raw = readOwnProperty(obj as object, property);
  if (typeof raw !== 'function') return raw;

  // Variable resolver function.
  checkWallTime(state);
  const started = Date.now();
  const res = (raw as any)({ registry: ctx.registry, limits: state.limits, budget: state.budget });
  const awaited = await resolveMaybeAsync(res);
  const elapsed = Date.now() - started;
  if (elapsed > state.limits.maxFunctionWallTimeMs) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED,
      'Variable resolver wall time exceeded',
      'security',
    );
  }
  // Normalize invalid numbers.
  if (typeof awaited === 'number' && !Number.isFinite(awaited)) return null;
  return awaited;
}

export async function resolveRootVariableValueAsync(
  name: string,
  raw: unknown,
  ctx: EvaluateContext,
  state: RunnerState,
): Promise<unknown> {
  if (typeof raw !== 'function') return raw;

  checkWallTime(state);
  const started = Date.now();
  const res = (raw as any)({ registry: ctx.registry, limits: state.limits, budget: state.budget });
  const awaited = await resolveMaybeAsync(res);
  const elapsed = Date.now() - started;
  if (elapsed > state.limits.maxFunctionWallTimeMs) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED,
      'Variable resolver wall time exceeded',
      'security',
    );
  }

  if (typeof awaited === 'number' && !Number.isFinite(awaited)) return null;
  return awaited;
}
