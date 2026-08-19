import { evalFormulaOutput, evalOk, evalOkWithOutput } from '../test-helpers/eval-formula';

describe('Type predicates', () => {
  it('checks numbers and text', async () => {
    expect(await evalOk('ISNUMBER(1)')).toBe(true);
    expect(await evalOk('ISNUMBER("1")')).toBe(false);
    expect(await evalOk('ISNUMBER(INDEX(LIST(1); 0))')).toBe(false);
    expect(await evalOk('ISNUMBER(true)')).toBe(false);
    expect(await evalOk('ISTEXT("a")')).toBe(true);
    expect(await evalOk('ISTEXT(1)')).toBe(false);
    expect(await evalOk('ISTEXT(INDEX(LIST(1); 0))')).toBe(false);
  });

  it('checks dates', async () => {
    expect(await evalOk('ISDATE(DATE(2024;2;29))')).toBe(true);
    const nowCompile = await evalFormulaOutput('ISDATE(NOW())');
    expect(nowCompile.compiled.root.kind).toBe('call');
    if (nowCompile.compiled.root.kind === 'call') {
      expect(nowCompile.compiled.root.name).toBe('ISDATE');
      expect(nowCompile.compiled.root.signatureId).toBe('ISDATE/v1');
      expect(nowCompile.compiled.root.args[0]?.kind).toBe('call');
      const arg0 = nowCompile.compiled.root.args[0];
      if (arg0 && arg0.kind === 'call') {
        expect(arg0.name).toBe('NOW');
        expect(arg0.signatureId).toBe('NOW/v1');
      }
    }

    const nowOut = await evalOkWithOutput('ISDATE(NOW())');
    expect(nowOut.output.name).toBe('ISDATE');
    expect(nowOut.output.signatureId).toBe('ISDATE/v1');
    expect(nowOut.output.children[0]?.name).toBe('NOW');
    expect(nowOut.output.children[0]?.signatureId).toBe('NOW/v1');
    expect((nowOut.output.children[0]?.value as any)?.__formula_object_kind).toBe('datetime');
    expect(nowOut.value).toBe(true);
    expect(await evalOk('ISDATE("2024-02-29")')).toBe(true);
    expect(await evalOk('ISDATE("2024-02-30")')).toBe(false);
  });
});
