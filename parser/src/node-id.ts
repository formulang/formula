import type { RuleNode } from '@formulang/definitions';

/**
 * Assign stable node IDs based on AST structure instead of source spans.
 *
 * Goal: IDs should remain stable across edits that only shift character offsets
 * (e.g. inserting whitespace at the beginning) and should minimize cascading
 * changes when siblings are inserted/removed.
 *
 * Format: a '/'-separated hierarchy of segments. Each segment is:
 *   <LABEL>-<N>
 * where <N> is a per-parent counter for nodes with the same (slot + label + fingerprint).
 *
 * Example: COUNT-0/LIST-0/TEXT-0
 */
export type StableNodeIdOptions = {
  /**
   * Controls whether literal values participate in sibling disambiguation.
   *
   * - 'type': IDs stay stable when a user edits a literal value (e.g. 2 -> 3).
   *           Downside: inserting a new literal may renumber later same-typed siblings.
   * - 'type+value': IDs stay stable under sibling insertions when values differ,
   *                but editing a literal value changes that literal's ID.
   */
  literalFingerprint?: 'type' | 'type+value';
};

export function assignStableNodeIds(root: RuleNode, options?: StableNodeIdOptions): void {
  const assigner = new StableNodeIdAssigner({ literalFingerprint: 'type', ...options });
  assigner.assign(root);
}

class StableNodeIdAssigner {
  private readonly counters = new Map<string, number>();

  constructor(private readonly options: Required<StableNodeIdOptions>) {}

  assign(root: RuleNode): void {
    this.visit(root, '', 'root');
  }

  private visit(node: RuleNode, parentId: string, slot: string): void {
    const { label, fingerprint } = this.describeNode(node);
    const occ = this.nextOccurrence(parentId, slot, label, fingerprint);
    const id = parentId ? `${parentId}/${label}-${occ}` : `${label}-${occ}`;
    node.id = id;

    switch (node.kind) {
      case 'call':
        for (const arg of node.args) {
          if (!arg) continue;
          // Treat the argument list as a single slot so siblings get a stable
          // per-label index (e.g. LIST-0, LIST-1; NUMBER-0, NUMBER-1).
          this.visit(arg, id, 'arg');
        }
        return;
      case 'property':
      case 'wildcard':
        this.visit(node.object, id, 'object');
        return;
      case 'literal':
      case 'variable':
        return;
      default: {
        // Exhaustiveness guard for future node kinds.
        const _exhaustive: never = node;
        return _exhaustive;
      }
    }
  }

  private nextOccurrence(
    parentId: string,
    slot: string,
    label: string,
    fingerprint: string,
  ): number {
    // The counter is per parent, per slot, per semantic fingerprint.
    // This keeps IDs stable when earlier siblings are inserted, as long as the
    // insertion has a different fingerprint.
    const key = `${parentId}|${slot}|${label}|${fingerprint}`;
    const n = this.counters.get(key) ?? 0;
    this.counters.set(key, n + 1);
    return n;
  }

  private describeNode(node: RuleNode): { label: string; fingerprint: string } {
    switch (node.kind) {
      case 'call': {
        // Prefer the parsed function name (user input). Fall back to signatureId if needed.
        const name = (node.name || node.signatureId || 'CALL').toString();
        const label = sanitizeSegment(name.toUpperCase());
        const fingerprint = `call:${label}`;
        return { label, fingerprint };
      }
      case 'variable': {
        const label = sanitizeSegment(`VAR_${node.name}`);
        const fingerprint = `var:${node.name}`;
        return { label, fingerprint };
      }
      case 'property': {
        const label = sanitizeSegment(`PROP_${node.property}`);
        const fingerprint = `prop:${node.property}`;
        return { label, fingerprint };
      }
      case 'wildcard': {
        const label = sanitizeSegment(`WILD_${node.property}`);
        const fingerprint = `wild:${node.property}`;
        return { label, fingerprint };
      }
      case 'literal': {
        const { typeLabel, valueFingerprint } = describeLiteral(node.value);
        const label = typeLabel;
        const fingerprint =
          this.options.literalFingerprint === 'type+value'
            ? `lit:${typeLabel}:${valueFingerprint}`
            : `lit:${typeLabel}`;
        return { label, fingerprint };
      }
      default: {
        const _exhaustive: never = node;
        return _exhaustive;
      }
    }
  }
}

function sanitizeSegment(raw: string): string {
  // Keep it URL/path friendly and predictable.
  // - Replace non [A-Z0-9_] with '_'
  // - Collapse consecutive underscores
  // - Trim underscores
  const upper = raw.toUpperCase();
  const replaced = upper.replace(/[^A-Z0-9_]+/g, '_');
  const collapsed = replaced.replace(/_+/g, '_');
  const trimmed = collapsed.replace(/^_+|_+$/g, '');
  return trimmed || 'NODE';
}

function describeLiteral(value: unknown): { typeLabel: string; valueFingerprint: string } {
  if (value === null || value === undefined) return { typeLabel: 'NULL', valueFingerprint: 'null' };
  if (typeof value === 'string') {
    // Don't embed raw user strings in IDs; use a stable short hash.
    return { typeLabel: 'TEXT', valueFingerprint: `h${hashToBase36(value)}l${value.length}` };
  }
  if (typeof value === 'number') {
    return {
      typeLabel: 'NUMBER',
      valueFingerprint: Number.isFinite(value) ? String(value) : 'NaN',
    };
  }
  if (typeof value === 'boolean') {
    return { typeLabel: 'BOOLEAN', valueFingerprint: value ? 'true' : 'false' };
  }
  return { typeLabel: 'LITERAL', valueFingerprint: typeof value };
}

function hashToBase36(input: string): string {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned and base36 for compactness.
  return (hash >>> 0).toString(36);
}
