import { evalOk } from '../test-helpers/eval-formula';

describe('EQ', () => {
  it('coerces numeric strings in equality', async () => {
    expect(await evalOk('1 = "1"')).toBe(true);
  });

  it('treats empty string as no value (returns null)', async () => {
    expect(await evalOk('"" = 0')).toBeNull();
  });
});
