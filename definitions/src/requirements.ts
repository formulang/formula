export interface FormulaRequirements {
  variablesRead: string[];
  functionsUsed: string[];
  externalData: Array<{ kind: string; value: unknown }>;
  estimatedCostUnits: number;
}

export function emptyRequirements(): FormulaRequirements {
  return {
    variablesRead: [],
    functionsUsed: [],
    externalData: [],
    estimatedCostUnits: 0,
  };
}
