import { FormulaErrorCodes, FormulaTypes } from '@formulang/definitions';
import { evalFormula, evalOkWithOutput } from '../test-helpers/eval-formula';

describe('IF', () => {
  it('evaluates only the then branch when condition is true', async () => {
    const { output, value } = await evalOkWithOutput('IF(TRUE; TRUE; NOT(1))');
    expect(value).toBe(true);
    expect(output.children[2]?.skipped).toBe(true);
  });

  it('evaluates only the else branch when condition is false', async () => {
    const { output, value } = await evalOkWithOutput('IF(FALSE; NOT(1); FALSE)');
    expect(value).toBe(false);
    expect(output.children[1]?.skipped).toBe(true);
  });

  it('rejects mismatched then/else branch types', async () => {
    const { parsed, compiled } = await evalFormula('IF(TRUE; "x"; 0)');
    expect(
      [...parsed.errors, ...compiled.errors].some(
        (e) => e.code === 'ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE',
      ),
    ).toBe(true);
  });

  it('rejects non-boolean-like condition types at compile time', async () => {
    const { parsed, compiled } = await evalFormula('IF(1; TRUE; FALSE)');
    expect(
      [...parsed.errors, ...compiled.errors].some(
        (e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
      ),
    ).toBe(true);
  });

  it('rejects non-boolean-like object property condition at compile time', async () => {
    const { parsed, compiled } = await evalFormula(
      'IF(obj.n; TRUE; FALSE)',
      {},
      {
        setup: (registry) => {
          registry.registerVariable({
            name: 'obj',
            description: 'A test input object.',
            type: FormulaTypes.object('Obj', { n: FormulaTypes.number(true) }),
          });
        },
      },
    );
    expect(
      [...parsed.errors, ...compiled.errors].some(
        (e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
      ),
    ).toBe(true);
  });
});
