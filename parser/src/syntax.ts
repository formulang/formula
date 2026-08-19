export interface FormulaSyntax {
  /** Single-character separator between function arguments (e.g. ';' or ','). */
  argumentSeparator: ';' | ',';
  /** Single-character decimal separator for numeric literals (e.g. '.' or ','). */
  decimalSeparator: '.' | ',';
}

export const DEFAULT_FORMULA_SYNTAX: FormulaSyntax = {
  argumentSeparator: ';',
  decimalSeparator: '.',
};

export function resolveFormulaSyntax(syntax?: Partial<FormulaSyntax>): FormulaSyntax {
  return {
    argumentSeparator: syntax?.argumentSeparator ?? DEFAULT_FORMULA_SYNTAX.argumentSeparator,
    decimalSeparator: syntax?.decimalSeparator ?? DEFAULT_FORMULA_SYNTAX.decimalSeparator,
  };
}
