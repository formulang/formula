import type { FunctionParamDefinition } from './registry';

/*
 * Where a literal written as an argument is checked, and against what. The parser checks a call
 * written in the formula at the parameters `literalCheckAt` answers; it follows a callable that a
 * higher-order call passes on, and checks what that callable receives, at the same parameters; and
 * registration takes a `literalValues` list only on a parameter `literalCheckAt` answers, whose
 * type a string literal fits by both of the parser's checks of an argument's type: choosing among
 * the overloads (`argumentSelects`) and checking the call once it binds (`argumentFits`). All
 * three read this one rule for a definition, so a list registration takes is checked in a call
 * of that definition written in the formula and wherever a literal is passed on to it, and a
 * string literal's own type never keeps the parser from reading the list. Which definitions a
 * literal meets is the parser's: a call written directly binds the overload its types select,
 * and a literal passed on meets every definition of the name that lists values at its
 * position, so beside an overload that a call also binds, or one that lists other values
 * there, a literal written directly can be taken where the same literal passed on is refused.
 */

/** A literal check: the parameter the argument binds, and what it admits. */
export type LiteralCheck<Admitted> = {
  readonly param: FunctionParamDefinition;
  /** The admitted values, or undefined where the parameter lists none: any string literal passes. */
  readonly admitted: Admitted | undefined;
};

/**
 * The values a literal-only parameter admits: its `literalValues`, a list of texts; undefined where
 * it lists none. Registration refuses any other value, but a registry that is not an
 * `InMemoryFormulaRegistry` may hand the parser a definition as written: `null` there lists nothing,
 * as on the other optional fields, and so does a value that is not a list of texts, which the
 * parser reads rather than throws on: a literal written there reaches the function when the call
 * runs, as any literal of a literal-only parameter without a list does.
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
 * where the call checks no literal there: a `literalOnly` parameter at its own position and, past
 * the list, a variadic `literalOnly` parameter that lists admitted values (one that lists none is
 * checked at its first argument only, as 1.0.0 checks it). `read` answers what a parameter admits,
 * undefined where it lists nothing: `admittedValues`, or the same values as a reader holds them (a
 * parser reads each list once per parse). Whether the argument is given at all is the caller's
 * part: an optional parameter may be left out, and a callable may be passed fewer arguments.
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
