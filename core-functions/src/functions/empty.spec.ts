import { evalOk } from '../test-helpers/eval-formula';

describe('EMPTY', () => {
  it('returns null', async () => {
    expect(await evalOk('EMPTY()')).toBe(null);
  });

  it('supports BLANK() alias', async () => {
    expect(await evalOk('BLANK()')).toBe(null);
  });
});
