import type { FormulaError, FormulaType, FormulaValueKind, RuleNode } from '@formulang/definitions';
import { BuiltinSignatureIds, FormulaErrorCodes, FormulaTypes } from '@formulang/definitions';

export function valueKindOf(value: unknown): FormulaValueKind {
  if (value == null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

export function valueSatisfiesType(value: unknown, expected: FormulaType): boolean {
  if (value == null)
    return expected.nullable === true || expected.kind === 'null' || expected.kind === 'any';

  switch (expected.kind) {
    case 'any':
      return true;
    case 'template':
      return expected.constraint ? valueSatisfiesType(value, expected.constraint) : true;
    case 'callable':
      return typeof value === 'string';
    case 'null':
      return false;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'text':
      return typeof value === 'string';
    case 'list':
      return Array.isArray(value);
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) return false;
      if (!expected.clarifier) return true;
      return (
        typeof (value as any).__formula_object_kind === 'string' &&
        (value as any).__formula_object_kind === expected.clarifier
      );
    case 'union':
      return expected.of.some((t) => valueSatisfiesType(value, t));
  }

  return false;
}

export function toExecutionErrorKind(
  kind: FormulaError['kind'],
): 'runtime' | 'security' | 'config' {
  if (kind === 'security') return 'security';
  if (kind === 'config') return 'config';
  return 'runtime';
}

export function toKnownFormulaErrorCode(code: string | undefined) {
  if (!code) return FormulaErrorCodes.EVAL_CRASH;
  const values = Object.values(FormulaErrorCodes) as string[];
  return values.includes(code)
    ? (code as (typeof FormulaErrorCodes)[keyof typeof FormulaErrorCodes])
    : FormulaErrorCodes.EVAL_CRASH;
}

export function nodeName(node: RuleNode): string {
  switch (node.kind) {
    case 'call':
      return node.name;
    case 'variable':
      return node.name;
    default:
      return node.kind;
  }
}

export function expectedCastForComparison(signatureId: string): FormulaType | undefined {
  if (
    signatureId === BuiltinSignatureIds.EQ ||
    signatureId === BuiltinSignatureIds.NEQ ||
    signatureId === BuiltinSignatureIds.GT ||
    signatureId === BuiltinSignatureIds.GTE ||
    signatureId === BuiltinSignatureIds.LT ||
    signatureId === BuiltinSignatureIds.LTE
  ) {
    return FormulaTypes.number(true);
  }
  return undefined;
}
