import { BuiltinSignatureIds, FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  createTestRuntime,
  evalCountingWork,
  evalFormula,
  evalOk,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';
import {
  ContainsAnyImplementation,
  FirstContainedImplementation,
  MissingFromImplementation,
  PHRASE_MATCH_MODES,
  PHRASE_NORMALISATIONS,
} from './phrase-match';

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

    it('matches a word phrase in work linear in the text and the phrase', async () => {
      // A run of one letter holds the half-length phrase at every position, never as a whole
      // word: re-checking each occurrence re-read half the text each time (seconds at 80,000).
      // The steps are counted through the public functions, as an embedder calls them, smallest
      // first. They are the code units the search reads: each one of the text once, the phrase
      // once per comparison (at most two a code unit of the text, two a code unit of the phrase
      // to prepare), and the characters on either side of an occurrence.
      const publicFunctions = [
        ['FIRST_CONTAINED', BuiltinSignatureIds.FIRST_CONTAINED, FirstContainedImplementation],
        ['CONTAINS_ANY', BuiltinSignatureIds.CONTAINS_ANY, ContainsAnyImplementation],
      ] as const;
      for (const [name, signatureId, implementation] of publicFunctions) {
        for (const n of [20_000, 80_000, 160_000]) {
          const value = 'a'.repeat(n);
          const phrase = 'a'.repeat(n / 2);
          const source = `${name}(value; other; "word")`;
          const counted = await evalCountingWork(source, signatureId, implementation, {
            value,
            other: [phrase],
          });
          expect(counted.value).toBe(name === 'CONTAINS_ANY' ? false : null);
          expect(counted.steps, `${name}, ${n} letters`).toBeGreaterThanOrEqual(value.length);
          expect(counted.steps, `${name}, ${n} letters`).toBeLessThanOrEqual(
            3 * (value.length + phrase.length),
          );
          const found = await evalCountingWork(source, signatureId, implementation, {
            value: `${value} ${phrase}`,
            other: [phrase],
          });
          expect(found.value).toBe(name === 'CONTAINS_ANY' ? true : phrase);
        }
      }
      expect(
        await evalOk('CONTAINS_ANY(value; LIST("aa"); "word")', { value: 'a'.repeat(1_000) }),
      ).toBe(false);
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
      // Also when EACH passes the mode on.
      expect(
        await errorCodes('EACH(LIST("a b"); "FIRST_CONTAINED"; LIST("a"); "wrd")'),
      ).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
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

    it('looks for an item in work linear in the text and the item', async () => {
      // A run of one letter holds a half-length run of it at every position, but never followed
      // by `b`: restarting the comparison after each near miss re-read half the text each time.
      // The steps are counted through the public function, as an embedder calls it, smallest
      // first: the code units the search reads, each one of the text once and the item once per
      // comparison (at most two a code unit of the text, two a code unit of the item to prepare).
      for (const n of [20_000, 80_000, 160_000]) {
        const value = 'a'.repeat(n);
        const item = `${'a'.repeat(n / 2)}b`;
        const counted = await evalCountingWork(
          'MISSING_FROM(other; value)',
          BuiltinSignatureIds.MISSING_FROM,
          MissingFromImplementation,
          { value, other: [item] },
        );
        expect(counted.value).toStrictEqual([item]);
        expect(counted.steps, `${n} letters`).toBeGreaterThanOrEqual(value.length);
        expect(counted.steps, `${n} letters`).toBeLessThanOrEqual(3 * (value.length + item.length));
        const found = await evalCountingWork(
          'MISSING_FROM(other; value)',
          BuiltinSignatureIds.MISSING_FROM,
          MissingFromImplementation,
          { value: `${value}b`, other: [item] },
        );
        expect(found.value).toStrictEqual([]);
      }
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
