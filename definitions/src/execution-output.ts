import type { SourceSpan } from './span';

export type FormulaValueKind =
  'null' | 'boolean' | 'number' | 'text' | 'list' | 'object' | 'unknown';

export interface FormulaWarning {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

export type FormulaExecutionErrorKind = 'runtime' | 'security' | 'config';

export interface FormulaExecutionError {
  kind: FormulaExecutionErrorKind;
  code: string;
  message: string;
  span?: SourceSpan;
  meta?: Record<string, unknown>;
}

/**
 * Evidence-grade execution output for a single node/call.
 *
 * - `children` is always ordered and always present.
 * - `skipped` marks nodes that were intentionally not evaluated (short-circuit).
 */
export interface FormulaNodeOutput {
  ok: boolean;
  /** Human-readable name (function/operator name, or node kind for non-call nodes). */
  name: string;
  /** Stable signature id for calls/operators (if applicable). */
  signatureId?: string;

  value?: unknown;
  valueKind?: FormulaValueKind;
  /** For `valueKind === "object"`, optionally record the object type clarifier/name. */
  valueObjectKind?: string;

  warnings?: FormulaWarning[];
  error?: FormulaExecutionError;

  children: FormulaNodeOutput[];

  nodeId?: string;
  span?: SourceSpan;
  skipped?: true;
}
