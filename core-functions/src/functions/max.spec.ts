import { evalOk } from '../test-helpers/eval-formula';

describe('MAX', () => {
  it('returns the highest number in a list', async () => {
    expect(await evalOk('MAX(LIST(3;1;2))')).toBe(3);
  });

  it('ignores empty values', async () => {
    expect(await evalOk('MAX(LIST(3; 1/0; 2))')).toBe(3);
  });
});
