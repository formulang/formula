import { evalOk } from '../test-helpers/eval-formula';

describe('STARTS_WITH', () => {
  it('checks prefix match', async () => {
    expect(await evalOk('STARTS_WITH("abc"; "a")')).toBe(true);
    expect(await evalOk('STARTS_WITH("abc"; "x")')).toBe(false);
  });

  it('supports prefix list overload', async () => {
    expect(await evalOk('STARTS_WITH("xyz123"; LIST("abc";"xyz"))')).toBe(true);
  });
});
