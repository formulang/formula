import { describe, expect, it } from 'vitest';
import { collectAllErrors, evalFormula, evalOk } from '../test-helpers/eval-formula';

describe('POW / ^', () => {
  it('computes POW(base, exponent)', async () => {
    expect(await evalOk('POW(2; 3)')).toBe(8);
    expect(await evalOk('POW(9; 0.5)')).toBe(3);
    expect(await evalOk('POW(2; -3)')).toBe(0.125);
  });

  it('computes the ^ operator equivalent', async () => {
    expect(await evalOk('2 ^ 3')).toBe(8);
    expect(await evalOk('2 ^ -3')).toBe(0.125);
  });

  it('uses right associativity for ^', async () => {
    expect(await evalOk('2 ^ 3 ^ 2')).toBe(512);
    expect(await evalOk('(2 ^ 3) ^ 2')).toBe(64);
  });

  it('binds ^ tighter than * and +', async () => {
    expect(await evalOk('2 * 3 ^ 2')).toBe(18);
    expect(await evalOk('2 ^ 3 * 2')).toBe(16);
    expect(await evalOk('1 + 2 ^ 3')).toBe(9);
  });

  it('returns null for null inputs', async () => {
    expect(await evalOk('POW(INDEX(LIST(1); 9); 2)')).toBe(null);
    expect(await evalOk('2 ^ INDEX(LIST(1); 9)')).toBe(null);
  });

  it('surfaces argument type mismatch errors', async () => {
    const powType = await evalFormula('POW("x"; 2)');
    const powAll = collectAllErrors(powType.parsed, powType.compiled, powType.res.errors);
    expect(powAll.some((e) => (e.code as string) === 'ARGUMENT_TYPE_MISMATCH')).toBe(true);

    const opType = await evalFormula('2 ^ "x"');
    const opAll = collectAllErrors(opType.parsed, opType.compiled, opType.res.errors);
    expect(opAll.some((e) => (e.code as string) === 'ARGUMENT_TYPE_MISMATCH')).toBe(true);
  });
});
