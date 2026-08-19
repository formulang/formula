import { evalOk } from '../test-helpers/eval-formula';

describe('SUM', () => {
  it('sums a list of numbers', async () => {
    expect(await evalOk('SUM(LIST(1;2;3))')).toBe(6);
  });

  it('ignores empty values', async () => {
    expect(await evalOk('SUM(LIST(1; 1/0; 3))')).toBe(4);
  });
});
