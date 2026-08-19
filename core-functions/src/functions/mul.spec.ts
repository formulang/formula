import { evalOk } from '../test-helpers/eval-formula';

describe('MUL', () => {
  it('multiplies numbers via operator', async () => {
    expect(await evalOk('2 * 3')).toBe(6);
  });

  it('returns null when an arg is empty', async () => {
    expect(await evalOk('MUL(1/0; 2)')).toBeNull();
  });
});
