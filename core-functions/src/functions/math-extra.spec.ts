import { FormulaErrorCodes } from '@formulang/definitions';
import { collectAllErrors, evalFormula, evalOk } from '../test-helpers/eval-formula';

describe('Math extras', () => {
  it('computes trig and inverse trig', async () => {
    expect(await evalOk('ROUND(SIN(0); 8)')).toBe(0);
    expect(await evalOk('ROUND(COS(0); 8)')).toBe(1);
    expect(await evalOk('ROUND(TAN(0); 8)')).toBe(0);

    expect(await evalOk('ROUND(ASIN(0); 8)')).toBe(0);
    expect(await evalOk('ROUND(ACOS(1); 8)')).toBe(0);
    expect(await evalOk('ROUND(ATAN(0); 8)')).toBe(0);

    // Domain errors return null.
    expect(await evalOk('ASIN(2)')).toBe(null);
    expect(await evalOk('ACOS(-2)')).toBe(null);

    // Type mismatch is a type error.
    const sinType = await evalFormula('SIN("x")');
    const sinAll = collectAllErrors(sinType.parsed, sinType.compiled, sinType.res.errors);
    expect(sinAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
  });

  it('rounds consistently', async () => {
    expect(await evalOk('CEILING(1.2)')).toBe(2);
    expect(await evalOk('FLOOR(1.8)')).toBe(1);

    expect(await evalOk('ROUND(1.4; 0)')).toBe(1);
    expect(await evalOk('ROUND(1.5; 0)')).toBe(2);
    expect(await evalOk('ROUND(-1.5; 0)')).toBe(-2);

    expect(await evalOk('ROUNDDOWN(1.29; 1)')).toBe(1.2);
    expect(await evalOk('ROUNDUP(1.21; 1)')).toBe(1.3);
  });

  it('computes exp/log/log10/sqrt', async () => {
    expect(await evalOk('ROUND(EXP(1); 8)')).toBeCloseTo(Math.E, 6);
    expect(await evalOk('LOG(8; 2)')).toBe(3);
    expect(await evalOk('LOG(100)')).toBe(2);
    expect(await evalOk('LOG(0.1)')).toBeCloseTo(-1);
    expect(await evalOk('LOG10(1000)')).toBe(3);
    expect(await evalOk('SQRT(9)')).toBe(3);

    expect(await evalOk('LOG(-1; 10)')).toBe(null);
    expect(await evalOk('LOG(-1)')).toBe(null);
    expect(await evalOk('LOG(10; 1)')).toBe(null);
    expect(await evalOk('LOG10(-1)')).toBe(null);
    expect(await evalOk('SQRT(-1)')).toBe(null);
  });

  it('computes mod/pi/product and parity', async () => {
    expect(await evalOk('PI()')).toBeCloseTo(Math.PI);
    expect(await evalOk('MOD(10; 3)')).toBe(1);
    expect(await evalOk('MOD(-10; 3)')).toBe(2);
    expect(await evalOk('MOD(1; 0)')).toBe(null);
    const modType = await evalFormula('MOD("x"; 3)');
    const modAll = collectAllErrors(modType.parsed, modType.compiled, modType.res.errors);
    expect(modAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);

    expect(await evalOk('PRODUCT()')).toBe(null);
    expect(await evalOk('PRODUCT(2; 3; 4)')).toBe(24);
    expect(await evalOk('PRODUCT(2; INDEX(LIST(1); 0); 3)')).toBe(6);
    const productType = await evalFormula('PRODUCT(2; "x")');
    const productAll = collectAllErrors(
      productType.parsed,
      productType.compiled,
      productType.res.errors,
    );
    expect(productAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);

    expect(await evalOk('ISEVEN(2)')).toBe(true);
    expect(await evalOk('ISEVEN(3)')).toBe(false);
    expect(await evalOk('ISEVEN(-2)')).toBe(true);
    expect(await evalOk('ISEVEN(2.2)')).toBe(false);
    expect(await evalOk('ISODD(3)')).toBe(true);
    expect(await evalOk('ISODD(2)')).toBe(false);
    expect(await evalOk('ISODD(-3)')).toBe(true);
    // Null inputs are allowed by type and should return false.
    expect(await evalOk('ISODD(INDEX(LIST(1); 0))')).toBe(false);
  });
});
