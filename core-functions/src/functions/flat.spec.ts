import { evalOk } from '../test-helpers/eval-formula';

describe('FLAT', () => {
  it('fully flattens nested lists', async () => {
    expect(await evalOk('FLAT(LIST(LIST(1;2); LIST(3)))')).toStrictEqual([1, 2, 3]);
  });

  it('flattens deeply nested lists', async () => {
    expect(await evalOk('FLAT(value)', { value: [1, [2, [3]]] })).toStrictEqual([1, 2, 3]);
  });
});
