import { evalOk, evalOkWithOutput } from '../test-helpers/eval-formula';

describe('COUNT', () => {
  it('counts non-empty items in a list', async () => {
    expect(await evalOk('COUNT(LIST(1; 1/0; 2))')).toBe(2);
  });

  it('counts non-empty values in variadic overload', async () => {
    expect(await evalOk('COUNT(1; ""; 1/0; "x")')).toBe(2);
  });

  it('returns null with TYPE warning for non-list list-overload inputs', async () => {
    const { value } = await evalOkWithOutput('COUNT(value)', { value: { a: 1 } });
    expect(value).toBeNull();
  });
});
