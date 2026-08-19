import { evalOk } from '../test-helpers/eval-formula';

describe('LOWER', () => {
  it('lowercases text', async () => {
    expect(await evalOk('LOWER("AbC")')).toBe('abc');
  });
});
