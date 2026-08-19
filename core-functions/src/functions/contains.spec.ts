import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('CONTAINS', () => {
  it('checks substring inclusion', async () => {
    const { value } = await evalOkWithOutput('CONTAINS("abc"; "b")');
    expect(value).toBe(true);
  });

  it('returns null with TYPE warning on non-text input', async () => {
    const { output, value } = await evalOkWithOutput('CONTAINS(value; "a")', { value: 1 });
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'TYPE')).toBe(true);
  });
});
