import { FormulaErrorCodes, type FormulaErrorCode } from './errors';

export class FormulaLimitError extends Error {
  /** Hard limit error raised during parsing/tokenization. */
  public readonly kind: 'security' = 'security';
  public readonly code: FormulaErrorCode;

  constructor(code: FormulaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class FormulaRuntimeError extends Error {
  /** Runtime/security error thrown by runner/builtins for structured reporting. */
  public readonly kind: 'runtime' | 'security';
  public readonly code: FormulaErrorCode;

  constructor(code: FormulaErrorCode, message: string, kind: 'runtime' | 'security' = 'runtime') {
    super(message);
    this.code = code;
    this.kind = kind;
  }
}

export class FormulaEvaluationBudget {
  /** Remaining evaluation steps. */
  private remaining: number;

  constructor(maxSteps: number) {
    this.remaining = Math.max(0, Math.floor(maxSteps));
  }

  consume(units: number): void {
    const u = Math.max(0, Math.floor(units));
    this.remaining -= u;
    if (this.remaining < 0) {
      throw new FormulaRuntimeError(
        FormulaErrorCodes.EVAL_LIMIT_EXCEEDED,
        'Formula evaluation limit exceeded',
        'security',
      );
    }
  }
}

export function consumeBudget(ctx: unknown, units: number): void {
  const budget = (ctx as any)?.budget as FormulaEvaluationBudget | undefined;
  if (!budget) return;
  budget.consume(units);
}
