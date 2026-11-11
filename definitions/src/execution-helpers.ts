import type {
  FormulaExecutionError,
  FormulaExecutionErrorKind,
  FormulaNodeOutput,
  FormulaValueKind,
  FormulaWarning,
} from './execution-output';
import type { SourceSpan } from './span';

type OutputBase = Omit<FormulaNodeOutput, 'children' | 'name' | 'ok'>;

export function withWarnings(
  output: FormulaNodeOutput,
  warnings: FormulaWarning[] | undefined,
): FormulaNodeOutput {
  if (!warnings || warnings.length === 0) return output;
  return { ...output, warnings: [...(output.warnings ?? []), ...warnings] };
}

export function makeOkOutput(
  name: string,
  input: {
    value: unknown;
    valueKind: FormulaValueKind;
    valueObjectKind?: string;
    signatureId?: string;
    nodeId?: string;
    span?: SourceSpan;
    warnings?: FormulaWarning[];
    children?: FormulaNodeOutput[];
  },
): FormulaNodeOutput {
  return {
    ok: true,
    name,
    signatureId: input.signatureId,
    value: input.value,
    valueKind: input.valueKind,
    valueObjectKind: input.valueObjectKind,
    warnings: input.warnings,
    children: input.children ?? [],
    nodeId: input.nodeId,
    span: input.span,
  };
}

export function makeOkNull(
  name: string,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, {
    value: null,
    valueKind: 'null',
    ...extra,
    children: extra?.children,
  });
}

export function makeOkBoolean(
  name: string,
  value: boolean,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, { value, valueKind: 'boolean', ...extra, children: extra?.children });
}

export function makeOkText(
  name: string,
  value: string,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, { value, valueKind: 'text', ...extra, children: extra?.children });
}

export function makeOkNumber(
  name: string,
  value: number,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  if (!Number.isFinite(value)) {
    // Never emit NaN/Infinity as a "valid number".
    return makeOkNull(name, extra);
  }
  return makeOkOutput(name, { value, valueKind: 'number', ...extra, children: extra?.children });
}

export function makeOkList(
  name: string,
  value: unknown[],
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, { value, valueKind: 'list', ...extra, children: extra?.children });
}

export function makeOkObject(
  name: string,
  value: Record<string, unknown>,
  valueObjectKind?: string,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, {
    value,
    valueKind: 'object',
    valueObjectKind,
    ...extra,
    children: extra?.children,
  });
}

export function makeOkUnknown(
  name: string,
  value: unknown,
  extra?: OutputBase & { warnings?: FormulaWarning[]; children?: FormulaNodeOutput[] },
): FormulaNodeOutput {
  return makeOkOutput(name, { value, valueKind: 'unknown', ...extra, children: extra?.children });
}

/**
 * How the runner reads an answer on its cached path: the output as given, or an ok `null` when
 * the implementation gave no output (any falsy answer).
 *
 * @experimental May change in a minor release.
 */
export function readCallOutput(
  name: string,
  signatureId: string,
  output: FormulaNodeOutput | null | undefined,
): FormulaNodeOutput {
  return output || makeOkUnknown(name, null, { signatureId });
}

export function makeError(
  name: string,
  input: {
    kind: FormulaExecutionErrorKind;
    code: string;
    message: string;
    signatureId?: string;
    nodeId?: string;
    span?: SourceSpan;
    meta?: Record<string, unknown>;
    warnings?: FormulaWarning[];
    children?: FormulaNodeOutput[];
  },
): FormulaNodeOutput {
  const error: FormulaExecutionError = {
    kind: input.kind,
    code: input.code,
    message: input.message,
    span: input.span,
    meta: input.meta,
  };
  return {
    ok: false,
    name,
    signatureId: input.signatureId,
    warnings: input.warnings,
    error,
    children: input.children ?? [],
    nodeId: input.nodeId,
    span: input.span,
  };
}

export type ExpectResult<T> = { ok: true; value: T } | { ok: false; error: FormulaExecutionError };

function err(
  kind: FormulaExecutionErrorKind,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): FormulaExecutionError {
  return { kind, code, message, meta };
}

export function expectNumber(
  value: unknown,
  options?: { allowNull?: boolean },
): ExpectResult<number | null> {
  if (value == null)
    return options?.allowNull
      ? { ok: true, value: null }
      : { ok: false, error: err('runtime', 'NULL', 'Value is null') };
  if (typeof value !== 'number')
    return { ok: false, error: err('runtime', 'TYPE', 'Expected number') };
  if (!Number.isFinite(value))
    return { ok: false, error: err('runtime', 'NUMBER', 'Invalid number') };
  return { ok: true, value };
}

export function expectText(
  value: unknown,
  options?: { allowNull?: boolean },
): ExpectResult<string | null> {
  if (value == null)
    return options?.allowNull
      ? { ok: true, value: null }
      : { ok: false, error: err('runtime', 'NULL', 'Value is null') };
  if (typeof value !== 'string')
    return { ok: false, error: err('runtime', 'TYPE', 'Expected text') };
  return { ok: true, value };
}

export function expectBoolean(
  value: unknown,
  options?: { allowNull?: boolean },
): ExpectResult<boolean | null> {
  if (value == null)
    return options?.allowNull
      ? { ok: true, value: null }
      : { ok: false, error: err('runtime', 'NULL', 'Value is null') };
  if (typeof value !== 'boolean')
    return { ok: false, error: err('runtime', 'TYPE', 'Expected boolean') };
  return { ok: true, value };
}

export function expectList(
  value: unknown,
  options?: { allowNull?: boolean },
): ExpectResult<unknown[] | null> {
  if (value == null)
    return options?.allowNull
      ? { ok: true, value: null }
      : { ok: false, error: err('runtime', 'NULL', 'Value is null') };
  if (!Array.isArray(value)) return { ok: false, error: err('runtime', 'TYPE', 'Expected list') };
  return { ok: true, value };
}

export function expectObject(
  value: unknown,
  options?: { allowNull?: boolean },
): ExpectResult<Record<string, unknown> | null> {
  if (value == null)
    return options?.allowNull
      ? { ok: true, value: null }
      : { ok: false, error: err('runtime', 'NULL', 'Value is null') };
  if (typeof value !== 'object' || Array.isArray(value))
    return { ok: false, error: err('runtime', 'TYPE', 'Expected object') };
  return { ok: true, value: value as Record<string, unknown> };
}

export function unwrapOrNull(
  output: FormulaNodeOutput | undefined,
  expectedKind: FormulaValueKind,
): unknown | null {
  if (!output || !output.ok) return null;
  return output.valueKind === expectedKind ? output.value : null;
}

export function expectOutputKind(
  output: FormulaNodeOutput,
  expectedKind: FormulaValueKind,
): ExpectResult<unknown> {
  if (!output.ok) {
    return { ok: false, error: output.error ?? err('runtime', 'UNKNOWN', 'Unknown error') };
  }

  if (output.valueKind !== expectedKind) {
    return {
      ok: false,
      error: err('runtime', 'TYPE', `Expected ${expectedKind}`, {
        expectedKind,
        gotKind: output.valueKind,
      }),
    };
  }

  return { ok: true, value: output.value };
}
