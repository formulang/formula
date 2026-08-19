import type { SourceSpan } from './span';
import type { FormulaType } from './types';

export type RuleNodeKind = 'literal' | 'variable' | 'call' | 'property' | 'wildcard';

export interface RuleNodeBase {
  id: string;
  kind: RuleNodeKind;
  span?: SourceSpan;
  type?: FormulaType;

  /**
   * If the value is fully predictable at parse-time, this can be set.
   * Otherwise it should be omitted.
   */
  predictableValue?: unknown;
}

export interface LiteralNode extends RuleNodeBase {
  kind: 'literal';
  value: unknown;
}

export interface VariableNode extends RuleNodeBase {
  kind: 'variable';
  name: string;
}

export interface CallNode extends RuleNodeBase {
  kind: 'call';
  name: string;
  /**
   * Bound stable signature id (e.g. ADD/v1). Set after semantic validation.
   */
  signatureId?: string;
  args: RuleNode[];
}

export interface PropertyAccessNode extends RuleNodeBase {
  kind: 'property';
  object: RuleNode;
  property: string;
}

export interface WildcardNode extends RuleNodeBase {
  kind: 'wildcard';
  object: RuleNode;
  property: string;
}

export type RuleNode = LiteralNode | VariableNode | CallNode | PropertyAccessNode | WildcardNode;
