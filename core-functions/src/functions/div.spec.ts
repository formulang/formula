import { evalOk } from '../test-helpers/eval-formula';

describe('DIV', () => {
  it('divides numbers via operator', async () => {
    expect(await evalOk('6 / 2')).toBe(3);
  });

  it('returns null on division by zero', async () => {
    expect(await evalOk('1 / 0')).toBeNull();
  });
});
