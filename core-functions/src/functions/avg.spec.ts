import { evalOk } from '../test-helpers/eval-formula';

describe('AVG', () => {
  it('averages a list of numbers', async () => {
    expect(await evalOk('AVG(LIST(1;2;3))')).toBe(2);
  });

  it('ignores empty values', async () => {
    expect(await evalOk('AVG(LIST(1; 1/0; 3))')).toBe(2);
  });
});
