import { evalOk } from '../test-helpers/eval-formula';

describe('GT', () => {
  it('supports basic comparisons', async () => {
    expect(await evalOk('2 > 1')).toBe(true);
  });

  it('coerces lists to their COUNT for comparisons', async () => {
    expect(await evalOk('value > 0', { value: [] })).toBe(false);
    expect(await evalOk('value > 0', { value: [null] })).toBe(true);
  });
});
