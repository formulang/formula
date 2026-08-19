import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('RANGE_SCORE', () => {
  it('returns 1 inside warn range', async () => {
    const { value } = await evalOkWithOutput('RANGE_SCORE(5; 0; 3; 7; 10)');
    expect(value).toBe(1);
  });

  it('returns 0 outside bad bounds', async () => {
    const { value } = await evalOkWithOutput('RANGE_SCORE(-1; 0; 3; 7; 10)');
    expect(value).toBe(0);
  });

  it('returns null with RANGE warning for invalid ranges', async () => {
    const { output, value } = await evalOkWithOutput('RANGE_SCORE(5; 10; 0; 7; 3)');
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'RANGE')).toBe(true);
  });
});
