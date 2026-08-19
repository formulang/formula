import { evalOk } from '../test-helpers/eval-formula';

describe('COUNT_UNIQUE', () => {
  it('counts unique non-empty values', async () => {
    expect(await evalOk('COUNT_UNIQUE("a";"a";"b";"";1/0)')).toBe(2);
  });
});
