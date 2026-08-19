import { FormulaTypes, type FormulaType } from './types';

export interface RuleTypeSeed {
  primitives: {
    Any: FormulaType;
    Boolean: FormulaType;
    Number: FormulaType;
    Text: FormulaType;
    Null: FormulaType;
  };
}

/**
 * Creates the built-in, portable rule types owned by this package.
 */
export function createDefaultRuleTypes(): RuleTypeSeed {
  return {
    primitives: {
      Any: FormulaTypes.any(false, 'Any value.'),
      Boolean: FormulaTypes.boolean(false, 'True or false.'),
      Number: FormulaTypes.number(false, 'A number.'),
      Text: FormulaTypes.text(false, 'Text.'),
      Null: FormulaTypes.null('No value.'),
    },
  };
}
