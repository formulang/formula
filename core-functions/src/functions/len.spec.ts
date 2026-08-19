import { evalOk } from '../test-helpers/eval-formula';

describe('LEN', () => {
  it('returns length of text', async () => {
    expect(await evalOk('LEN("abc")')).toBe(3);
  });

  it('returns length of list', async () => {
    expect(await evalOk('LEN(LIST(1;2))')).toBe(2);
  });

  it('supports LENGTH alias', async () => {
    expect(await evalOk('LENGTH("abcd")')).toBe(4);
  });
});
