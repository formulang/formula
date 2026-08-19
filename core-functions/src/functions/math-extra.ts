import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, isEmptyValue } from './helpers';

function nullType(fn: string, message: string) {
  return withWarnings(makeOkNull(fn), [{ code: 'TYPE', message }]);
}

function pow10(digits: number): number {
  if (!Number.isFinite(digits)) return 1;
  const d = Math.max(-15, Math.min(15, Math.trunc(digits)));
  return 10 ** d;
}

function roundHalfAwayFromZero(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

function roundWithDigits(value: number, digits: number): number {
  const p = pow10(digits);
  return roundHalfAwayFromZero(value * p) / p;
}

function roundDownWithDigits(value: number, digits: number): number {
  const p = pow10(digits);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(value * p))) / p;
}

function roundUpWithDigits(value: number, digits: number): number {
  const p = pow10(digits);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.ceil(Math.abs(value * p))) / p;
}

abstract class UnaryNumberFn extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  protected abstract readonly fnName: string;
  protected abstract readonly op: (n: number) => number;

  estimateCostsInSeconds(): number {
    return 0.00002;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const n = asNumber(raw);
    if (n == null) {
      if (!isEmptyValue(raw)) return nullType(this.fnName, `${this.fnName} expects a number`);
      return makeOkNull(this.fnName);
    }
    const out = this.op(n);
    return Number.isFinite(out) ? makeOkNumber(this.fnName, out) : makeOkNull(this.fnName);
  }
}

export class SinImplementation extends UnaryNumberFn {
  protected readonly fnName = 'SIN';
  protected readonly op = (n: number) => Math.sin(n);
}
export class CosImplementation extends UnaryNumberFn {
  protected readonly fnName = 'COS';
  protected readonly op = (n: number) => Math.cos(n);
}
export class TanImplementation extends UnaryNumberFn {
  protected readonly fnName = 'TAN';
  protected readonly op = (n: number) => Math.tan(n);
}
export class AsinImplementation extends UnaryNumberFn {
  protected readonly fnName = 'ASIN';
  protected readonly op = (n: number) => Math.asin(n);
}
export class AcosImplementation extends UnaryNumberFn {
  protected readonly fnName = 'ACOS';
  protected readonly op = (n: number) => Math.acos(n);
}
export class AtanImplementation extends UnaryNumberFn {
  protected readonly fnName = 'ATAN';
  protected readonly op = (n: number) => Math.atan(n);
}

export class CeilingImplementation extends UnaryNumberFn {
  protected readonly fnName = 'CEILING';
  protected readonly op = (n: number) => Math.ceil(n);
}

export class FloorImplementation extends UnaryNumberFn {
  protected readonly fnName = 'FLOOR';
  protected readonly op = (n: number) => Math.floor(n);
}

export class SqrtImplementation extends UnaryNumberFn {
  protected readonly fnName = 'SQRT';
  protected readonly op = (n: number) => Math.sqrt(n);
}

export class ExpImplementation extends UnaryNumberFn {
  protected readonly fnName = 'EXP';
  protected readonly op = (n: number) => Math.exp(n);
}

export class Log10Implementation extends UnaryNumberFn {
  protected readonly fnName = 'LOG10';
  protected readonly op = (n: number) => Math.log10(n);
}

export class RoundImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const rawDigits = args.length >= 2 ? args[1] : 0;
    const n = asNumber(raw);
    if (n == null) {
      if (!isEmptyValue(raw)) return nullType('ROUND', 'ROUND expects a number');
      return makeOkNull('ROUND');
    }
    const digits = rawDigits == null ? 0 : asNumber(rawDigits);
    if (digits == null) {
      if (!isEmptyValue(rawDigits)) return nullType('ROUND', 'ROUND digits must be a number');
      return makeOkNull('ROUND');
    }
    return makeOkNumber('ROUND', roundWithDigits(n, digits));
  }
}

export class RoundDownImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const rawDigits = args.length >= 2 ? args[1] : 0;
    const n = asNumber(raw);
    if (n == null) {
      if (!isEmptyValue(raw)) return nullType('ROUNDDOWN', 'ROUNDDOWN expects a number');
      return makeOkNull('ROUNDDOWN');
    }
    const digits = rawDigits == null ? 0 : asNumber(rawDigits);
    if (digits == null) {
      if (!isEmptyValue(rawDigits))
        return nullType('ROUNDDOWN', 'ROUNDDOWN digits must be a number');
      return makeOkNull('ROUNDDOWN');
    }
    return makeOkNumber('ROUNDDOWN', roundDownWithDigits(n, digits));
  }
}

export class RoundUpImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const rawDigits = args.length >= 2 ? args[1] : 0;
    const n = asNumber(raw);
    if (n == null) {
      if (!isEmptyValue(raw)) return nullType('ROUNDUP', 'ROUNDUP expects a number');
      return makeOkNull('ROUNDUP');
    }
    const digits = rawDigits == null ? 0 : asNumber(rawDigits);
    if (digits == null) {
      if (!isEmptyValue(rawDigits)) return nullType('ROUNDUP', 'ROUNDUP digits must be a number');
      return makeOkNull('ROUNDUP');
    }
    return makeOkNumber('ROUNDUP', roundUpWithDigits(n, digits));
  }
}

export class ModImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const aRaw = args[0];
    const bRaw = args[1];
    const a = asNumber(aRaw);
    const b = asNumber(bRaw);
    if (a == null || b == null) {
      if (!isEmptyValue(aRaw) || !isEmptyValue(bRaw)) return nullType('MOD', 'MOD expects numbers');
      return makeOkNull('MOD');
    }
    if (b === 0) return makeOkNull('MOD');
    const v = ((a % b) + b) % b;
    return makeOkNumber('MOD', v);
  }
}

export class LogImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const vRaw = args[0];
    const bRaw = args[1];

    const v = asNumber(vRaw);
    if (v == null) {
      if (!isEmptyValue(vRaw)) return nullType('LOG', 'LOG expects a number');
      return makeOkNull('LOG');
    }

    const base = isEmptyValue(bRaw) ? 10 : asNumber(bRaw);
    if (base == null) {
      if (!isEmptyValue(bRaw)) return nullType('LOG', 'LOG base must be a number');
      return makeOkNull('LOG');
    }

    if (v <= 0 || base <= 0 || base === 1) return makeOkNull('LOG');
    return makeOkNumber('LOG', Math.log(v) / Math.log(base));
  }
}

export class PiImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('PI', Math.PI);
  }
}

export class ProductImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00002 * Math.max(1, args.length);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    let prod = 1;
    let count = 0;
    for (const raw of args) {
      if (isEmptyValue(raw)) continue;
      const n = asNumber(raw);
      if (n == null) return nullType('PRODUCT', 'PRODUCT expects numbers');
      prod *= n;
      count++;
    }
    if (count === 0) {
      return withWarnings(makeOkNull('PRODUCT'), [
        { code: 'EMPTY', message: 'PRODUCT was called with no values' },
      ]);
    }
    return makeOkNumber('PRODUCT', prod);
  }
}

export class IsEvenImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const n = asNumber(raw);
    if (n == null || !Number.isInteger(n)) return makeOkBoolean('ISEVEN', false);
    return makeOkBoolean('ISEVEN', Math.abs(n) % 2 === 0);
  }
}

export class IsOddImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const n = asNumber(raw);
    if (n == null || !Number.isInteger(n)) return makeOkBoolean('ISODD', false);
    return makeOkBoolean('ISODD', Math.abs(n) % 2 === 1);
  }
}
