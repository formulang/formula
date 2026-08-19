import { evalOkWithOutput } from '../test-helpers/eval-formula';

describe('JOIN', () => {
  it('joins text values using the separator', async () => {
    const { value } = await evalOkWithOutput('JOIN(LIST("a";"b";"c"); "-")');
    expect(value).toBe('a-b-c');
  });

  it('returns empty text for an empty list', async () => {
    const { value } = await evalOkWithOutput('JOIN(LIST(); "-")');
    expect(value).toBe('');
  });

  it('returns null with TYPE warning on non-list first argument', async () => {
    const { output, value } = await evalOkWithOutput('JOIN(value; "-")', { value: 'a' });
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'TYPE')).toBe(true);
  });

  it('returns null with TYPE warning when list contains non-text values', async () => {
    const { output, value } = await evalOkWithOutput('JOIN(value; "-")', {
      value: ['a', 1],
    });
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'TYPE')).toBe(true);
  });

  it('returns null with TYPE warning on non-text separator', async () => {
    const { output, value } = await evalOkWithOutput('JOIN(LIST("a"; "b"); value)', {
      value: 1,
    });
    expect(value).toBeNull();
    expect(output.warnings?.some((w) => w.code === 'TYPE')).toBe(true);
  });
});
