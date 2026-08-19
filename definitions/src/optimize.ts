import type { RuleNode } from './ast';
import type { FormulaRegistry } from './registry';
import { emptyRequirements } from './requirements';
import type { TypedRule } from './rule';

export interface OptimizeOptions {
  registry: FormulaRegistry;
}

/**
 * Portable optimization step: constant folding and rewriting static references.
 *
 * Note: This is intentionally conservative. It only folds nodes when the parser
 * already computed `predictableValue`.
 */
export function optimizeRule(rule: TypedRule, options: OptimizeOptions): TypedRule {
  const extraExternalData: Array<{ kind: string; value: unknown }> = [];

  const rewritten = rewriteNode(rule.root, options.registry, extraExternalData);

  const requirements = rule.requirements ?? emptyRequirements();
  if (extraExternalData.length > 0) {
    requirements.externalData = uniqExternalData([
      ...(requirements.externalData ?? []),
      ...extraExternalData,
    ]);
  }

  return {
    ...rule,
    root: rewritten,
    requirements,
    static: rule.static || isFullyStatic(rewritten),
  };
}

function isFullyStatic(node: RuleNode): boolean {
  if (node.kind === 'literal') return true;
  if (node.kind === 'variable') return false;
  if (node.kind === 'property' || node.kind === 'wildcard')
    return isFullyStatic(node.object) && node.predictableValue !== undefined;
  if (node.kind === 'call')
    return node.predictableValue !== undefined && node.args.every(isFullyStatic);
  return false;
}

function rewriteNode(
  node: RuleNode,
  registry: FormulaRegistry,
  externalDataAcc: Array<{ kind: string; value: unknown }>,
): RuleNode {
  switch (node.kind) {
    case 'literal':
      return node;
    case 'variable':
      return node;
    case 'property': {
      const object = rewriteNode(node.object, registry, externalDataAcc);
      return { ...node, object };
    }
    case 'wildcard': {
      const object = rewriteNode(node.object, registry, externalDataAcc);
      return { ...node, object };
    }
    case 'call': {
      const args = node.args.map((a) => rewriteNode(a, registry, externalDataAcc));
      const out: RuleNode = { ...node, args };

      if (out.predictableValue !== undefined && isFullyStatic(out)) {
        return {
          id: out.id,
          kind: 'literal',
          value: out.predictableValue,
          span: out.span,
          type: out.type,
          predictableValue: out.predictableValue,
        };
      }
      return out;
    }
  }
}

function uniqExternalData(
  items: Array<{ kind: string; value: unknown }>,
): Array<{ kind: string; value: unknown }> {
  const seen = new Set<any>();
  const out: Array<{ kind: string; value: unknown }> = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    out.push(item);
  }
  return out;
}
