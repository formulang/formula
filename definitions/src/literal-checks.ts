import type { FunctionParamDefinition } from './registry';

/**
 * Where the parser checks a literal-only argument, and against what. Registration and the parser
 * read the same rule, so a `literalValues` list the registry accepts is the list the parser checks.
 */

/**
 * A literal check: the parameter the argument binds, and the values it admits.
 *
 * @experimental May change in a minor release.
 */
export type LiteralCheck<Admitted> = {
  readonly param: FunctionParamDefinition;
  /** The admitted values, or undefined when the parameter lists none (any string literal passes). */
  readonly admitted: Admitted | undefined;
};

/**
 * The values a literal-only parameter admits: its `literalValues` when that is a list of texts,
 * otherwise undefined. Registration refuses any other value, but a registry that is not an
 * `InMemoryFormulaRegistry` may hand the parser a definition as written; the parser then treats
 * such a value as no list instead of throwing.
 *
 * @experimental May change in a minor release.
 */
export function admittedValues(param: FunctionParamDefinition): readonly string[] | undefined {
  const values: unknown = param.literalValues;
  if (!Array.isArray(values)) return undefined;
  for (let index = 0; index < values.length; index++) {
    if (typeof values[index] !== 'string') return undefined;
  }
  return values as string[];
}

/**
 * The literal check at argument `position` of a call of a definition with `params`, or undefined
 * when that position checks no literal. A `literalOnly` parameter is checked at its own position.
 * Past the end of the list, a variadic `literalOnly` parameter is checked at every further argument
 * when it lists admitted values, and not at all when it lists none. `read` answers
 * what a parameter admits. Whether the argument is present at all is for the caller to decide.
 *
 * @experimental May change in a minor release.
 */
export function literalCheckAt<Admitted>(
  params: readonly FunctionParamDefinition[],
  position: number,
  read: (param: FunctionParamDefinition) => Admitted | undefined,
): LiteralCheck<Admitted> | undefined {
  const last = params[params.length - 1];
  const param =
    position < params.length ? params[position] : last?.variadic === true ? last : undefined;
  if (param === undefined || param.literalOnly !== true) return undefined;
  const admitted = read(param);
  if (position >= params.length && admitted === undefined) return undefined;
  return { param, admitted };
}
