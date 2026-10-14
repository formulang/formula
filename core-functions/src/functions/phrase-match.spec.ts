import { BuiltinSignatureIds, FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  createTestRuntime,
  evalFormula,
  evalOk,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';
import { PHRASE_MATCH_MODES, PHRASE_NORMALISATIONS } from './phrase-match';

async function errorCodes(source: string, vars: Record<string, unknown> = {}) {
  const { parsed, compiled, res } = await evalFormula(source, vars);
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}

async function warningCodes(source: string, vars: Record<string, unknown> = {}) {
  const { output, value } = await evalOkWithOutput(source, vars);
  return { value, codes: (output.warnings ?? []).map((w) => w.code) };
}

describe('Phrase matching', () => {
  describe('FIRST_CONTAINED and CONTAINS_ANY', () => {
    it('answers the first phrase in list order, not text order', async () => {
      const text = 'Das passt, oder? Ganz sicher, richtig?';
      expect(
        await evalOk('FIRST_CONTAINED(value; LIST("richtig?"; "oder?"))', { value: text }),
      ).toBe('richtig?');
      expect(await evalOk('FIRST_CONTAINED(value; LIST("nein"; "oder?"))', { value: text })).toBe(
        'oder?',
      );
      expect(await evalOk('FIRST_CONTAINED(value; LIST("nein"))', { value: text })).toBe(null);
      expect(
        await evalOk('FIRST_CONTAINED("Gut, oder? Richtig?"; LIST("Richtig?"; "oder?"))'),
      ).toBe('Richtig?');
      expect(await evalOk('CONTAINS_ANY(value; LIST("nein"; "oder?"))', { value: text })).toBe(
        true,
      );
      expect(await evalOk('CONTAINS_ANY(value; LIST("nein"))', { value: text })).toBe(false);
    });

    it('compares lower-cased sides with ignoreCase and answers the listed phrase', async () => {
      expect(await evalOk('FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"))')).toBe(null);
      expect(
        await evalOk(
          'FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; TRUE)',
        ),
      ).toBe('kennst du das?');
      expect(
        await evalOk('CONTAINS_ANY("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; TRUE)'),
      ).toBe(true);
    });

    it('requires word boundaries on both sides in word mode', async () => {
      expect(await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"))')).toBe(true);
      expect(await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"); "word")')).toBe(false);
      expect(await evalOk('CONTAINS_ANY("our Product Owner, Kim"; LIST("owner"); "word")')).toBe(
        false,
      );
      expect(
        await evalOk('FIRST_CONTAINED("our Product Owner, Kim"; LIST("owner"); "word"; TRUE)'),
      ).toBe('owner');
      expect(await evalOk('CONTAINS_ANY("Der Geschäftsführer"; LIST("führer"))')).toBe(true);
      expect(await evalOk('CONTAINS_ANY("Der Geschäftsführer"; LIST("führer"); "word")')).toBe(
        false,
      );
      // An occurrence further on can satisfy the boundaries where the first one does not.
      expect(await evalOk('CONTAINS_ANY("homeowner and owner"; LIST("owner"); "word")')).toBe(true);
    });

    it('treats an empty list as no match and skips empty phrases', async () => {
      expect(await evalOk('FIRST_CONTAINED("abc"; LIST())')).toBe(null);
      expect(await evalOk('CONTAINS_ANY("abc"; LIST())')).toBe(false);
      expect(await evalOk('CONTAINS_ANY("abc"; LIST(""))')).toBe(false);
      expect(await evalOk('FIRST_CONTAINED("abc"; LIST(""; "b"))')).toBe('b');
    });

    it('follows the null convention and bounds the phrase list', async () => {
      expect(await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: null })).toBe(null);
      expect(await evalOk('CONTAINS_ANY(value; LIST("a"))', { value: null })).toBe(null);
      expect(await evalOk('CONTAINS_ANY("abc"; value)', { value: null })).toBe(null);
      expect(await warningCodes('CONTAINS_ANY("abc"; value)', { value: 'a' })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await warningCodes('CONTAINS_ANY("abc"; value)', { value: ['a', 1] })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(
        await warningCodes('CONTAINS_ANY("abc"; LIST("a"); "substring"; value)', { value: 'yes' }),
      ).toStrictEqual({ value: null, codes: ['TYPE'] });
      const phrases = Array.from({ length: 1_001 }, (_, i) => `p${i}`);
      expect(await errorCodes('CONTAINS_ANY("abc"; value)', { value: phrases })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
    });

    it('refuses a misspelt match mode at parse time', async () => {
      expect(await errorCodes('CONTAINS_ANY("abc"; LIST("a"); "words")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
    });

    it('maps over a list of texts with EACH', async () => {
      expect(
        await evalOk('EACH(value; "FIRST_CONTAINED"; LIST("oder?"; "ne?"))', {
          value: ['Gut, oder?', 'Klar, ne?', 'Ja.'],
        }),
      ).toStrictEqual(['oder?', 'ne?', null]);
    });
  });

  describe('MISSING_FROM', () => {
    it('collapses whitespace on both sides by default', async () => {
      const text = 'Wir liefern\n  schnell und  sauber.';
      expect(
        await evalOk('MISSING_FROM(LIST("liefern schnell"; " und sauber"; "billig"); value)', {
          value: text,
        }),
      ).toStrictEqual(['billig']);
      expect(
        await evalOk('MISSING_FROM(LIST("liefern schnell"); value; "exact")', { value: text }),
      ).toStrictEqual(['liefern schnell']);
    });

    it('answers the documented examples', async () => {
      expect(
        await evalOk('MISSING_FROM(LIST("liefern schnell"; "billig"); value)', {
          value: 'Wir liefern\n  schnell.',
        }),
      ).toStrictEqual(['billig']);
      expect(
        await evalOk('MISSING_FROM(LIST("\\"hallo\\""); value; "loose")', {
          value: 'Er sagte „Hallo“.',
        }),
      ).toStrictEqual([]);
    });

    it('folds case, typographic quotes and dashes in loose mode', async () => {
      const text = 'Er sagte „Hallo“ – und ging.';
      expect(
        await evalOk('MISSING_FROM(LIST("\\"hallo\\""; "- und"); value; "loose")', { value: text }),
      ).toStrictEqual([]);
      expect(
        await evalOk('MISSING_FROM(LIST("\\"Hallo\\""; "- und"); value; "exact")', { value: text }),
      ).toStrictEqual(['"Hallo"', '- und']);
      expect(
        await evalOk('MISSING_FROM(LIST("don\'t"); value; "loose")', { value: 'I DON\u2019T' }),
      ).toStrictEqual([]);
    });

    it('keeps the listed order and skips empty items', async () => {
      expect(await evalOk('MISSING_FROM(LIST("c"; ""; "a"; "  "; "x"); "a b")')).toStrictEqual([
        'c',
        'x',
      ]);
      expect(await evalOk('MISSING_FROM(LIST(); "a b")')).toStrictEqual([]);
    });

    it('follows the null convention and bounds the item list', async () => {
      expect(await evalOk('MISSING_FROM(value; "a")', { value: null })).toBe(null);
      expect(await evalOk('MISSING_FROM(LIST("a"); value)', { value: null })).toBe(null);
      expect(await warningCodes('MISSING_FROM(value; "a")', { value: 'a' })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      const items = Array.from({ length: 1_001 }, (_, i) => `i${i}`);
      expect(await errorCodes('MISSING_FROM(value; "a")', { value: items })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
      expect(await errorCodes('MISSING_FROM(LIST("a"); "a"; "lose")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
    });
  });

  it('declares exactly the modes the implementations accept', () => {
    const { registry } = createTestRuntime();
    const literalValuesOf = (signatureId: string, param: string) =>
      registry.getFunction(signatureId)?.params.find((p) => p.name === param)?.literalValues;

    expect(literalValuesOf(BuiltinSignatureIds.FIRST_CONTAINED, 'match')).toStrictEqual([
      ...PHRASE_MATCH_MODES,
    ]);
    expect(literalValuesOf(BuiltinSignatureIds.CONTAINS_ANY, 'match')).toStrictEqual([
      ...PHRASE_MATCH_MODES,
    ]);
    expect(literalValuesOf(BuiltinSignatureIds.MISSING_FROM, 'normalise')).toStrictEqual([
      ...PHRASE_NORMALISATIONS,
    ]);
  });
});
