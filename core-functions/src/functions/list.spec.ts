import { evalFormula, evalOk } from '../test-helpers/eval-formula';

describe('LIST', () => {
  it('builds a list', async () => {
    expect(await evalOk('LIST(1;2;3)')).toStrictEqual([1, 2, 3]);
  });

  it('rejects mixed item types', async () => {
    const { parsed, compiled } = await evalFormula('LIST(1; "2")');
    expect(
      [...parsed.errors, ...compiled.errors].some(
        (e) => e.code === 'ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE',
      ),
    ).toBe(true);
  });
});
