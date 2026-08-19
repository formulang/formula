import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('AND', () => {
  it('returns true when all args are true', async () => {
    const { value } = await evalOkWithOutput('AND(TRUE; "true")');
    expect(value).toBe(true);
  });

  it('short-circuits (skips later args)', async () => {
    const { output, value } = await evalOkWithOutput('AND(FALSE; NOT(1))');
    expect(value).toBe(false);
    expect(output.children[1]?.skipped).toBe(true);
  });
});
