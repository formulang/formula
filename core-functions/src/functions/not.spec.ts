import { evalFormula, evalOk } from '../test-helpers/eval-formula';

describe('NOT', () => {
  it('negates boolean-like values', async () => {
    expect(await evalOk('NOT(TRUE)')).toBe(false);
    expect(await evalOk('NOT("false")')).toBe(true);
  });

  it('errors on non-boolean-like values', async () => {
    const { parsed, compiled, res } = await evalFormula('NOT(1)');
    expect([...parsed.errors, ...compiled.errors]).toStrictEqual([]);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.some((e) => e.kind === 'runtime')).toBe(true);
    expect(res.errors.some((e) => e.message.includes('Expected boolean-like value'))).toBe(true);
  });
});
