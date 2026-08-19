import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('OR', () => {
  it('returns false when all args are false', async () => {
    const { value } = await evalOkWithOutput('OR(FALSE; "false")');
    expect(value).toBe(false);
  });

  it('short-circuits (skips later args)', async () => {
    const { output, value } = await evalOkWithOutput('OR(TRUE; NOT(1))');
    expect(value).toBe(true);
    expect(output.children[1]?.skipped).toBe(true);
  });
});
