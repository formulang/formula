import { evalOk } from '../test-helpers/eval-formula';

describe('UPPER', () => {
  it('uppercases text', async () => {
    expect(await evalOk('UPPER("AbC")')).toBe('ABC');
  });
});
