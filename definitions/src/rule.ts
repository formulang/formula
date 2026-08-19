import type { RuleNode } from './ast';
import type { FormulaError } from './errors';
import type { FormulaRequirements } from './requirements';
import type { FormulaType } from './types';

export interface TypedRule {
  root: RuleNode;
  returnType: FormulaType;
  static: boolean;
  requirements: FormulaRequirements;
  errors: FormulaError[];
}
