import type {
  FormulaExecutionErrorKind,
  FormulaLimits,
  FormulaNodeOutput,
  FunctionDefinition,
} from '@formulang/definitions';
import { makeError, readCallOutput } from '@formulang/definitions';

import { isCacheableByArgs } from './cache';
import { toKnownFormulaErrorCode } from './value-utils';

/**
 * Whether the runner answers a call written in a formula through its cache: a call of a pure or
 * run-cached function that is not control flow, with arguments it can key. `invokeFunctionBatch`
 * takes that path exactly where this holds.
 */
export function answeredThroughCache(
  def: Pick<FunctionDefinition, 'purity' | 'controlFlow'> | undefined,
  args: unknown[],
  limits: FormulaLimits,
): boolean {
  if (def === undefined || def.controlFlow) return false;
  if (def.purity !== 'pure' && def.purity !== 'run_cached') return false;
  return isCacheableByArgs(args, limits);
}

/** The value a call's output carries, as the runner reads it: a number that is not finite is `null`. */
export function readCallValue(value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

/**
 * The error of a call whose output is not ok, as the runner reads it: the output's kind (`runtime`
 * where it gives none), its code where the runner knows it (`EVAL_CRASH` for any other, and for an
 * answer that is no output at all) and its message (`Evaluation error` where it gives none).
 */
export function readCallError(output: unknown): {
  kind: FormulaExecutionErrorKind;
  code: ReturnType<typeof toKnownFormulaErrorCode>;
  message: string;
} {
  const { error } = { ...(output as object) } as {
    error?: { kind?: FormulaExecutionErrorKind; code?: string; message?: string };
  };
  return {
    kind: error?.kind ?? 'runtime',
    code: toKnownFormulaErrorCode(error?.code),
    message: error?.message ?? 'Evaluation error',
  };
}

/**
 * What a call written in a formula gives, read from what its implementation answered for it, as
 * the runner reads it: on a call it answers through its cache an answer that is no output is
 * `null` (`readCallOutput`); an ok output gives its value (`readCallValue`); any other answer,
 * on any path, is the error `readCallError` reads. The runner gives this reading to an
 * implementation through the execution context's `readCall`, for the calls it makes itself.
 */
export function readWrittenCall(
  def: Pick<FunctionDefinition, 'name' | 'purity' | 'controlFlow'> | undefined,
  signatureId: string,
  args: unknown[],
  limits: FormulaLimits,
  answer: unknown,
): FormulaNodeOutput {
  const name = def?.name ?? signatureId;
  const output = answeredThroughCache(def, args, limits)
    ? readCallOutput(name, signatureId, answer as FormulaNodeOutput | null | undefined)
    : answer;
  const read = { ...(output as object) } as Partial<FormulaNodeOutput>;
  if (read.ok) return { ...(read as FormulaNodeOutput), value: readCallValue(read.value) };
  return makeError(name, { ...readCallError(read), signatureId });
}
