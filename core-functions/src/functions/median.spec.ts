import { evalOk } from '../test-helpers/eval-formula';

describe('MEDIAN', () => {
  it('returns the median (odd length)', async () => {
    expect(await evalOk('MEDIAN(LIST(1;3;2))')).toBe(2);
  });

  it('returns the median (even length)', async () => {
    expect(await evalOk('MEDIAN(LIST(1;2;3;4))')).toBe(2.5);
  });

  it('ignores empty values', async () => {
    expect(await evalOk('MEDIAN(LIST(1; 1/0; 3))')).toBe(2);
  });
});
