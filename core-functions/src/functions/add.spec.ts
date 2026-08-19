import { evalOk } from '../test-helpers/eval-formula';

describe('ADD', () => {
  it('adds numbers via operator', async () => {
    expect(await evalOk('1 + 2')).toBe(3);
  });

  it('returns null when an arg is empty', async () => {
    expect(await evalOk('ADD(1/0; 2)')).toBeNull();
  });
});
