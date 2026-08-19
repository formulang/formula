import { evalOk } from '../test-helpers/eval-formula';

describe('INCLUDES', () => {
  it('returns true when list contains value', async () => {
    expect(await evalOk('INCLUDES(LIST("a";"b"); "b")')).toBe(true);
  });

  it('returns false when list does not contain value', async () => {
    expect(await evalOk('INCLUDES(LIST("a"); "b")')).toBe(false);
  });
});
