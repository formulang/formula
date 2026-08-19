import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('MATCH_EXPRESSION', () => {
  it('matches safe regex patterns', async () => {
    const { value } = await evalOkWithOutput('MATCH_EXPRESSION("abc123"; "^abc")');
    expect(value).toBe(true);
  });

  it('returns null with REGEX warning on invalid pattern', async () => {
    const { output, value } = await evalOkWithOutput('MATCH_EXPRESSION("abc"; "(")');
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'REGEX')).toBe(true);
  });
});
