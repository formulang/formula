import { evalOk } from '../test-helpers/eval-formula';

describe('SUB', () => {
  it('subtracts numbers via operator', async () => {
    expect(await evalOk('5 - 2')).toBe(3);
  });

  it('returns null when an arg is empty', async () => {
    expect(await evalOk('SUB(1/0; 2)')).toBeNull();
  });
});
