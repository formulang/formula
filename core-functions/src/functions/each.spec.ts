import { evalOk } from '../test-helpers/eval-formula';

describe('EACH', () => {
  it('maps over list items', async () => {
    expect(await evalOk('EACH(LIST("a";"bb"); "LEN")')).toStrictEqual([1, 2]);
  });

  it('returns null when target is not a list', async () => {
    expect(await evalOk('EACH(value; "LEN")', { value: 1 })).toBeNull();
  });
});
