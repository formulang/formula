import type {
  FormulaLimits,
  FormulaNodeOutput,
  FormulaRegistry,
  RuleNode,
} from '@formulang/definitions';

import type { PerNodeMap } from '../evaluate-types';
import { nodeName } from './value-utils';

type RedactionHint = 'none' | 'mask';

function getBaseVariableName(node: RuleNode): string | null {
  if (node.kind === 'variable') return node.name;
  if (node.kind === 'property' || node.kind === 'wildcard') return getBaseVariableName(node.object);
  return null;
}

function getRedactionForNode(node: RuleNode, registry: FormulaRegistry): RedactionHint {
  if (node.kind === 'call') {
    const def = node.signatureId ? registry.getFunction(node.signatureId) : undefined;
    return def?.redaction === 'mask' ? 'mask' : 'none';
  }

  const baseVar = getBaseVariableName(node);
  if (!baseVar) return 'none';
  const v = registry.getVariable(baseVar);
  return v?.redaction === 'mask' ? 'mask' : 'none';
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function truncateForLog(
  value: unknown,
  limits: FormulaLimits,
  depth: number,
  seen: WeakSet<object>,
): { value: unknown; truncated: boolean } {
  if (value == null) return { value, truncated: false };
  if (depth > limits.maxLoggedDepth)
    return { value: { __truncated: true, kind: 'depth', depth }, truncated: true };

  if (typeof value === 'function') {
    return { value: { __truncated: true, kind: 'function' }, truncated: true };
  }
  if (typeof value === 'bigint') {
    return {
      value: { __truncated: true, kind: 'bigint', value: value.toString() },
      truncated: true,
    };
  }
  if (typeof value === 'symbol') {
    return { value: { __truncated: true, kind: 'symbol', value: String(value) }, truncated: true };
  }

  if (typeof value === 'string') {
    if (value.length <= limits.maxLoggedStringLength) return { value, truncated: false };
    return {
      value: {
        __truncated: true,
        kind: 'text',
        length: value.length,
        preview: value.slice(0, limits.maxLoggedStringLength),
        hash: fnv1a32(value),
      },
      truncated: true,
    };
  }

  if (typeof value !== 'object') return { value, truncated: false };
  const obj = value as object;
  if (seen.has(obj)) return { value: { __truncated: true, kind: 'cycle' }, truncated: true };
  seen.add(obj);

  if (Array.isArray(value)) {
    if (value.length <= limits.maxLoggedListLength) {
      let anyTruncated = false;
      const mapped = value.map((v) => {
        const r = truncateForLog(v, limits, depth + 1, seen);
        anyTruncated = anyTruncated || r.truncated;
        return r.value;
      });
      return { value: mapped, truncated: anyTruncated };
    }

    const preview = value
      .slice(0, limits.maxLoggedListLength)
      .map((v) => truncateForLog(v, limits, depth + 1, seen).value);
    return {
      value: {
        __truncated: true,
        kind: 'list',
        length: value.length,
        preview,
        hash: fnv1a32(JSON.stringify({ length: value.length, preview })),
      },
      truncated: true,
    };
  }

  const keys = Object.keys(value as any);
  if (keys.length <= limits.maxLoggedObjectKeys) {
    let anyTruncated = false;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const r = truncateForLog((value as any)[k], limits, depth + 1, seen);
      anyTruncated = anyTruncated || r.truncated;
      out[k] = r.value;
    }
    return { value: out, truncated: anyTruncated };
  }

  const previewKeys = keys.slice(0, limits.maxLoggedObjectKeys);
  const preview: Record<string, unknown> = {};
  for (const k of previewKeys)
    preview[k] = truncateForLog((value as any)[k], limits, depth + 1, seen).value;
  return {
    value: {
      __truncated: true,
      kind: 'object',
      keys: keys.length,
      preview,
      hash: fnv1a32(JSON.stringify({ keys: keys.length, previewKeys })),
    },
    truncated: true,
  };
}

function logValueForNode(
  node: RuleNode,
  rawValue: unknown,
  registry: FormulaRegistry,
  limits: FormulaLimits,
): { value: unknown; redacted: boolean; truncated: boolean } {
  const redaction = getRedactionForNode(node, registry);
  if (redaction === 'mask')
    return { value: { __redacted: true }, redacted: true, truncated: false };

  const { value, truncated } = truncateForLog(rawValue, limits, 0, new WeakSet<object>());
  return { value, redacted: false, truncated };
}

export function writeNodeValue(
  node: RuleNode,
  rawValue: unknown,
  registry: FormulaRegistry,
  limits: FormulaLimits,
  perNode: PerNodeMap,
): void {
  const logged = logValueForNode(node, rawValue, registry, limits);
  const entry = { span: node.span, value: logged.value } as any;
  if (logged.redacted) entry.redacted = true;
  if (logged.truncated) entry.truncated = true;
  perNode[node.id] = entry;
}

export function writeNodeError(
  node: RuleNode,
  code: string,
  message: string,
  perNode: PerNodeMap,
): void {
  perNode[node.id] = { span: node.span, error: { code, message } };
}

function writeNodeSkipped(node: RuleNode, perNode: PerNodeMap): void {
  perNode[node.id] = { span: node.span, skipped: true };
}

export function markSkippedSubtree(
  node: RuleNode | undefined,
  perNode: PerNodeMap,
  visited = new Set<string>(),
): void {
  if (!node) return;
  if (visited.has(node.id)) return;
  visited.add(node.id);

  if (!perNode[node.id]) writeNodeSkipped(node, perNode);

  switch (node.kind) {
    case 'literal':
    case 'variable':
      return;
    case 'property':
    case 'wildcard':
      markSkippedSubtree(node.object, perNode, visited);
      return;
    case 'call':
      for (const a of node.args) markSkippedSubtree(a, perNode, visited);
      return;
  }
}

export function makeSkippedSubtreeOutput(node: RuleNode): FormulaNodeOutput {
  const children: FormulaNodeOutput[] =
    node.kind === 'call'
      ? node.args.map((a) => makeSkippedSubtreeOutput(a))
      : node.kind === 'property'
        ? [makeSkippedSubtreeOutput(node.object)]
        : node.kind === 'wildcard'
          ? [makeSkippedSubtreeOutput(node.object)]
          : [];

  return {
    ok: true,
    name: nodeName(node),
    signatureId: node.kind === 'call' ? node.signatureId : undefined,
    children,
    nodeId: node.id,
    span: node.span,
    skipped: true,
  };
}
