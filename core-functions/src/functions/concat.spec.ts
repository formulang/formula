import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('CONCAT', () => {
  it('concatenates text values', async () => {
    const { value } = await evalOkWithOutput('CONCAT("a";"b")');
    expect(value).toBe('ab');
  });

  it('returns null with TYPE warning on non-text input', async () => {
    const { output, value } = await evalOkWithOutput('CONCAT(1; "a")');
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'TYPE')).toBe(true);
  });
});
