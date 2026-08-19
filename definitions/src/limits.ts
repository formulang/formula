/**
 * Resource limits for formula parsing and evaluation.
 *
 * These are security controls to keep evaluation predictable and prevent abuse
 * (e.g. overly long sources, deeply nested expressions, huge list expansions).
 */
export interface FormulaLimits {
  /** Maximum length of the formula source string (characters). */
  maxSourceLength: number;
  /** Maximum number of tokens produced by tokenization. */
  maxTokens: number;
  /** Maximum length of a single string literal token. */
  maxStringLiteralLength: number;
  /** Maximum identifier length (function/variable/property names). */
  maxIdentifierLength: number;
  /** Maximum parenthesis nesting depth during tokenization. */
  maxParenDepth: number;
  /** Maximum number of AST nodes built during parsing. */
  maxAstNodes: number;
  /** Maximum evaluation "steps" (rough budget) for a single evaluation. */
  maxEvaluationSteps: number;

  /** Maximum total cost units per evaluation (derived from function cost estimators). */
  maxTotalCostUnits: number;
  /** Maximum cost units per single function call (derived from function cost estimators). */
  maxFunctionCostUnits: number;
  /** Maximum wall time per evaluation (milliseconds). */
  maxWallTimeMs: number;
  /** Maximum wall time per function call (milliseconds). */
  maxFunctionWallTimeMs: number;

  /**
   * Do not cache results when any string argument exceeds this length.
   * This prevents large strings from ballooning cache memory.
   */
  maxCacheableStringLength: number;
  /** Maximum list length accepted for list-processing primitives (EACH/FILTER/wildcard). */
  maxListLength: number;
  /** Maximum size for wildcard/flatten expansions. */
  maxWildcardOutputLength: number;
  /** Maximum regex pattern length. */
  maxRegexPatternLength: number;
  /** Maximum input text length for regex matching. */
  maxRegexTextLength: number;

  /** Maximum depth for per-node value logging (debug output). */
  maxLoggedDepth: number;
  /** Maximum string length for per-node value logging (debug output). */
  maxLoggedStringLength: number;
  /** Maximum list length to include inline for per-node value logging (debug output). */
  maxLoggedListLength: number;
  /** Maximum number of object keys to include inline for per-node value logging (debug output). */
  maxLoggedObjectKeys: number;
}

// NOTE: These limits are security controls. Keep them centralized and conservative.
export const DEFAULT_FORMULA_LIMITS: FormulaLimits = {
  maxSourceLength: 16_000,
  maxTokens: 500,
  maxStringLiteralLength: 8_000,
  maxIdentifierLength: 64,
  maxParenDepth: 16,
  maxAstNodes: 500,
  maxEvaluationSteps: 30_000,
  maxTotalCostUnits: 5,
  maxFunctionCostUnits: 2,
  maxWallTimeMs: 15_000,
  maxFunctionWallTimeMs: 10_000,
  maxCacheableStringLength: 500,
  maxListLength: 1_000,
  maxWildcardOutputLength: 5_000,
  maxRegexPatternLength: 100,
  maxRegexTextLength: 8_000,
  maxLoggedDepth: 6,
  maxLoggedStringLength: 50,
  maxLoggedListLength: 10,
  maxLoggedObjectKeys: 10,
};

export function resolveFormulaLimits(overrides?: Partial<FormulaLimits>): FormulaLimits {
  // Shallow-merge so that callers can override specific limits.
  return { ...DEFAULT_FORMULA_LIMITS, ...(overrides ?? {}) };
}
