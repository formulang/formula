import { evalOk } from '../test-helpers/eval-formula';

describe('NEQ', () => {
  it('is false when values are equal (after coercion)', async () => {
    expect(await evalOk('1 <> "1"')).toBe(false);
  });

  it('returns null when either side is empty', async () => {
    expect(await evalOk('"" <> 0')).toBeNull();
  });
});
