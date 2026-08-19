import { evalOk } from '../test-helpers/eval-formula';

describe('LTE', () => {
  it('supports basic comparisons', async () => {
    expect(await evalOk('2 <= 2')).toBe(true);
  });

  it('coerces lists to their COUNT for comparisons', async () => {
    expect(await evalOk('value <= 2', { value: [1, 2] })).toBe(true);
    expect(await evalOk('value <= 1', { value: [1, 2] })).toBe(false);
  });
});
