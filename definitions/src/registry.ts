import type { FormulaExecutionContext } from './execution-context';
import type { FormulaNodeOutput } from './execution-output';
import type { FormulaType } from './types';
import type { FormulaValueProvider } from './value-provider';

export type FunctionPurity = 'pure' | 'run_cached' | 'uncached';

export interface FunctionParamDefinition {
  name: string;
  description?: string;
  type: FormulaType;
  optional?: boolean;

  /** If true, the argument must be a literal at parse-time (semantic validation). */
  literalOnly?: boolean;
  /**
   * The values a `literalOnly` argument may take. A literal outside the list is the parse-time
   * error `LITERAL_VALUE_NOT_ALLOWED`, whose message names the admitted values. Registration
   * requires the list to be non-empty and the parameter to be `literalOnly`.
   */
  literalValues?: string[];
  /** If set, validates the literal string against the registry. */
  reference?: 'function' | 'operator' | 'function_or_operator';
  /** If true, this parameter can repeat (must be the last param). */
  variadic?: boolean;
}

/**
 * One argument a higher-order function passes to the function its callable parameter names, by
 * where the value comes from. Every index is the position of an argument in a call of the
 * higher-order function, written before or after the callable, or the callable itself.
 * - `item`: an item of the list the call passes at `of`.
 * - `argument`: the call's argument at `at`, passed on unchanged; nothing when the call omits it.
 * - `arguments`: every call argument from `from` on, each passed on unchanged.
 * - `value`: a value the function supplies when it runs, typed as the call's argument at `typeOf`,
 *   or of any type without it.
 */
export type InvokedArgumentDeclaration =
  | { kind: 'item'; of: number }
  | { kind: 'argument'; at: number }
  | { kind: 'arguments'; from: number }
  | { kind: 'value'; typeOf?: number };

export interface TemplateParamDefinition {
  /** Template/type-variable name (e.g. "T"). */
  name: string;
  /** Optional one-sentence summary for non-technical readers. */
  description?: string;
  /** Optional constraint for downstream tooling. */
  constraint?: FormulaType;
}

export interface StaticEvaluationContext {
  /** Inputs are guaranteed to be static literals when provided here. */
  args: unknown[];
}

export interface StaticEvaluationResult {
  /** A static value that can replace the call. */
  value: unknown;
  /** Optional return type refinement. */
  returnType?: FormulaType;

  /**
   * External references discovered while folding.
   * Example: references resolved from a static literal argument.
   */
  externalData?: Array<{ kind: string; value: unknown }>;
}

export interface FunctionDefinition {
  /** The most recent signature identifier for this function definition. */
  signatureId: string;
  name: string;
  /** Optional additional names that resolve to this same function definition. */
  aliases?: string[];

  /**
   * If true, this definition is retired from authoring: excluded from name/alias resolution
   * and listFunctions(), but still resolvable via getFunction(signatureId).
   * Use this to evolve a function (register NAME/vN+1) without breaking persisted rules
   * pinned to the old signature id.
   */
  legacy?: boolean;
  /** Category for config/editor consumers. The host application owns the allowed set and may override it. */
  category?: string;
  description: string;

  /** Optional template/type-parameter declarations used by params/returnType. */
  templates?: TemplateParamDefinition[];

  params: FunctionParamDefinition[];
  returnType: FormulaType;
  purity: FunctionPurity;
  batching?: boolean;
  redaction?: 'none' | 'mask';

  /** If true, the function controls evaluation of arguments (lazy short-circuit). */
  controlFlow?: boolean;

  /**
   * For a higher-order function: the arguments it passes, in order, to the function its callable
   * parameter names. With it, the parser checks that function against them as it does for the
   * core higher-order functions — arity, overload, result type, and the literal rules of the
   * parameters they reach — under any name and signature id; a definition without it under a name
   * 1.0.0 checked this way (EACH, FILTER, FILTER_PROPERTY, REDUCE) keeps 1.0.0's checks. `null`
   * stands for absent, as for the other optional fields, here and for `typeOf`.
   *
   * Registration refuses a declaration the parser could not apply as written: the definition needs
   * exactly one callable parameter, `literalOnly`; every index must be a position at which a call
   * can pass an argument (an integer from 0, below the number of parameters unless the last one is
   * variadic), and `item` must name a list parameter; and an `arguments` entry may appear once,
   * from an index no smaller than the number of other entries, so the callable never receives more
   * arguments than the call has or the declaration lists.
   */
  callableInvocation?: InvokedArgumentDeclaration[];

  /**
   * Optional explicit cast declarations provided by this function.
   *
   * Example: COUNT can be treated as a cast from List<Any> -> Number.
   *
   * This is primarily used for registration-time ambiguity checks and for
   * passing cast expectations to downstream calls.
   */
  casts?: Array<{ from: FormulaType; to: FormulaType }>;
}

/**
 * Execution contracts.
 *
 * The formula runtime is batch-first (`evaluateMultiple`) and produces structured
 * per-node outputs rather than returning raw values.
 */
export interface BatchEvaluationCall {
  args: FormulaValueProvider[];
  expectedCast?: FormulaType;
  /** Optional identifier for internal batching observability (e.g. EACH item index). */
  callId?: string;
}

export interface FunctionImplementation {
  evaluateMultiple: (
    calls: BatchEvaluationCall[],
    ctx: FormulaExecutionContext,
  ) => Array<FormulaNodeOutput> | Promise<Array<FormulaNodeOutput>>;
  estimateCostsInSeconds?: (args: unknown[]) => number;
  tryStaticEvaluate?: (ctx: StaticEvaluationContext) => StaticEvaluationResult | null;
}

export interface FunctionImplementationResolver {
  get(signatureId: string): FunctionImplementation | undefined;
}

export type OperatorAssociativity = 'left' | 'right';

export interface OperatorDefinition {
  token: string;
  precedence: number;
  associativity: OperatorAssociativity;
  /** The most recent signature identifier for this function definition. */
  functionSignatureId: string;

  /** Optional metadata for editor/config consumers. */
  inputTypes?: FormulaType[];
  outputType?: FormulaType;
  /** True when the operator allows implicit coercion (e.g. comparisons). */
  implicitCastsAllowed?: boolean;
}

export interface VariableDefinition {
  name: string;
  description?: string;
  type: FormulaType;
  redaction?: 'none' | 'mask';
}

/**
 * Minimal registry surface required for variable-only parsing/evaluation.
 *
 * This intentionally excludes functions/operators so callers can depend on a smaller contract.
 */
export interface VariableOnlyRegistry {
  getVariable(name: string): VariableDefinition | undefined;
  listVariables(): VariableDefinition[];
}

export interface FormulaRegistry extends VariableOnlyRegistry {
  /**
   * Lookup by signature id.
   * For name-based lookup (overloads), use listFunctionsByName().
   * Legacy definitions resolve here so persisted rules keep evaluating.
   */
  getFunction(signatureId: string): FunctionDefinition | undefined;
  /** Name/alias lookup used for authoring; legacy definitions are excluded. */
  listFunctionsByName(name: string): FunctionDefinition[];
  getOperator(token: string): OperatorDefinition | undefined;

  /** Authoring/editor surface; legacy definitions are excluded. */
  listFunctions(): FunctionDefinition[];
  listOperators(): OperatorDefinition[];
}

export interface MutableFormulaRegistry extends FormulaRegistry {
  registerFunction(def: FunctionDefinition): void;
  registerOperator(def: OperatorDefinition): void;
  registerVariable(def: VariableDefinition): void;

  /**
   * Marks an already-registered definition as legacy: it is removed from name/alias
   * resolution and listFunctions(), but stays resolvable via getFunction(signatureId).
   *
   * The registry stores a legacy-marked copy; the originally registered object is not
   * mutated. Retiring an already-legacy id is a no-op; unknown ids throw.
   */
  retireFunction(signatureId: string): void;
}
