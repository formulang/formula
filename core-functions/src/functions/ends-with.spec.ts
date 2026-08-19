import { evalOk } from '../test-helpers/eval-formula';

describe('ENDS_WITH', () => {
  it('checks suffix match', async () => {
    expect(await evalOk('ENDS_WITH("abc"; "bc")')).toBe(true);
    expect(await evalOk('ENDS_WITH("abc"; "d")')).toBe(false);
  });
});
