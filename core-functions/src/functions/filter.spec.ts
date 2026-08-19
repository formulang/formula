import { evalOk } from '../test-helpers/eval-formula';

describe('FILTER', () => {
  it('filters using operator token', async () => {
    expect(await evalOk('FILTER(LIST(1;2;3); ">"; 1)')).toStrictEqual([2, 3]);
  });

  it('filters using function reference', async () => {
    expect(await evalOk('FILTER(LIST("data:a";"x"); "STARTS_WITH"; "data:")')).toStrictEqual([
      'data:a',
    ]);
  });
});
