import { evalOk } from '../test-helpers/eval-formula';

describe('MIN', () => {
  it('returns the lowest number in a list', async () => {
    expect(await evalOk('MIN(LIST(3;1;2))')).toBe(1);
  });

  it('ignores empty values', async () => {
    expect(await evalOk('MIN(LIST(3; 1/0; 2))')).toBe(2);
  });
});
