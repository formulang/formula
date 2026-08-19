import { evalOk } from '../test-helpers/eval-formula';

describe('LT', () => {
  it('supports basic comparisons', async () => {
    expect(await evalOk('1 < 2')).toBe(true);
  });

  it('coerces lists to their COUNT for comparisons', async () => {
    expect(await evalOk('value < 2', { value: [1, 2] })).toBe(false);
    expect(await evalOk('value < 3', { value: [1, 2] })).toBe(true);
  });
});
