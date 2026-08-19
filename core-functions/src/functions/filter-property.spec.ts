import { evalOk } from '../test-helpers/eval-formula';

describe('FILTER_PROPERTY', () => {
  it('filters objects by nested property', async () => {
    const items = [{ a: { b: 1 } }, { a: { b: 2 } }, { a: null }];
    expect(await evalOk('FILTER_PROPERTY(value; "a.b"; "="; 2)', { value: items })).toStrictEqual([
      items[1],
    ]);
  });
});
