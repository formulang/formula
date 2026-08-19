import { evalOk } from '../test-helpers/eval-formula';

describe('IS_EMPTY', () => {
  it('treats null/empty string/empty list as empty', async () => {
    expect(await evalOk('IS_EMPTY(1/0)')).toBe(true);
    expect(await evalOk('IS_EMPTY("")')).toBe(true);
    expect(await evalOk('IS_EMPTY(value)', { value: [] })).toBe(true);
  });

  it('treats non-empty values as not empty', async () => {
    expect(await evalOk('IS_EMPTY(0)')).toBe(false);
    expect(await evalOk('IS_EMPTY("x")')).toBe(false);
  });
});
