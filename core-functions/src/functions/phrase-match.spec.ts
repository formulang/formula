import { BuiltinSignatureIds, FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  createTestRuntime,
  evalFormula,
  evalOk,
  evalOkWithOutput,
  withOther,
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

    it('lower-cases the phrase too with ignoreCase', async () => {
      expect(
        await evalOk(
          'FIRST_CONTAINED("kennst du das?"; LIST("KENNST DU DAS?"); "substring"; TRUE)',
        ),
      ).toBe('KENNST DU DAS?');
      expect(
        await evalOk('CONTAINS_ANY("kennst du das?"; LIST("Kennst Du"); "substring"; TRUE)'),
      ).toBe(true);
      expect(await evalOk('FIRST_CONTAINED("Der Owner, Kim"; LIST("OWNER"); "word"; TRUE)')).toBe(
        'OWNER',
      );
      expect(await evalOk('FIRST_CONTAINED("kennst du das?"; LIST("KENNST DU DAS?"))')).toBe(null);
      // As LOWER does: STRASSE lower-cases to strasse, which does not hold straße.
      expect(await evalOk('FIRST_CONTAINED("STRASSE"; LIST("straße"); "substring"; TRUE)')).toBe(
        null,
      );
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

    it('counts letters, marks and numbers as word characters in word mode, and nothing else', async () => {
      expect(await evalOk('CONTAINS_ANY("owner1"; LIST("owner"); "word")')).toBe(false);
      expect(
        await evalOk('CONTAINS_ANY(value; LIST("owner"); "word")', { value: 'owner\u0301' }),
      ).toBe(false);
      expect(await evalOk('CONTAINS_ANY("(owner)_"; LIST("owner"); "word")')).toBe(true);
      expect(
        await evalOk('CONTAINS_ANY(value; LIST("owner"); "word")', { value: '\u00A0owner\u2019s' }),
      ).toBe(true);
      // A letter outside the Basic Multilingual Plane is a letter, before or after the phrase; an
      // emoji is none of the three.
      for (const value of ['\u{1D400}owner', 'owner\u{1D400}']) {
        expect(await evalOk('CONTAINS_ANY(value; LIST("owner"); "word")', { value }), value).toBe(
          false,
        );
      }
      expect(
        await evalOk('CONTAINS_ANY(value; LIST("owner"); "word")', {
          value: '\u{1F600}owner\u{1F600}',
        }),
      ).toBe(true);
    });

    it('finds a word phrase in a run of one letter, which holds it at every position', async () => {
      // Every occurrence but none as a whole word, then one as a whole word after a space.
      const value = 'a'.repeat(4_000);
      const phrase = 'a'.repeat(250);
      const options = { setup: withOther };
      for (const name of ['FIRST_CONTAINED', 'CONTAINS_ANY']) {
        const source = `${name}(value; other; "word")`;
        expect(await evalOk(source, { value, other: [phrase] }, options), name).toBe(
          name === 'CONTAINS_ANY' ? false : null,
        );
        expect(
          await evalOk(source, { value: `${value} ${phrase}`, other: [phrase] }, options),
          name,
        ).toBe(name === 'CONTAINS_ANY' ? true : phrase);
      }
      expect(
        await evalOk('CONTAINS_ANY(value; LIST("aa"); "word")', { value: 'a'.repeat(1_000) }),
      ).toBe(false);
    });

    it('finds a long phrase only where it occurs, its mismatch at its start', async () => {
      // Up to the 250 code units the runtime's own substring search covers whole.
      const options = { setup: withOther };
      const text = 'a'.repeat(4_000);
      for (const length of [200, 249, 250]) {
        const phrase = `ab${'a'.repeat(length - 2)}`;
        for (const name of ['FIRST_CONTAINED', 'CONTAINS_ANY']) {
          const found = name === 'CONTAINS_ANY' ? true : phrase;
          const missing = name === 'CONTAINS_ANY' ? false : null;
          const source = `${name}(value; other)`;
          expect(await evalOk(source, { value: text, other: [phrase] }, options), name).toBe(
            missing,
          );
          expect(
            await evalOk(source, { value: `${text}${phrase}${text}`, other: [phrase] }, options),
            name,
          ).toBe(found);
          expect(
            await evalOk(
              `${name}(value; other; "substring"; TRUE)`,
              { value: `${text}${phrase.toUpperCase()}`, other: [phrase] },
              options,
            ),
            name,
          ).toBe(found);
        }
        expect(
          await evalOk(
            'MISSING_FROM(other; value; "exact")',
            { value: text, other: [phrase] },
            options,
          ),
        ).toStrictEqual([phrase]);
        expect(
          await evalOk(
            'MISSING_FROM(other; value; "loose")',
            { value: `${text}${phrase.toUpperCase()}`, other: [phrase] },
            options,
          ),
        ).toStrictEqual([]);
      }
    });

    it('refuses a phrase longer than 250 code units as searched for, wherever it is in the list', async () => {
      const options = { setup: withOther };
      const at = (length: number) => 'a'.repeat(length);
      for (const name of ['FIRST_CONTAINED', 'CONTAINS_ANY']) {
        for (const match of ['substring', 'word']) {
          const source = `${name}(value; other; "${match}")`;
          expect(
            await evalOk(source, { value: at(250), other: [at(250)] }, options),
            `${name} ${match}`,
          ).toBe(name === 'CONTAINS_ANY' ? true : at(250));
          for (const other of [[at(251)], ['a', at(251)], [at(251), 'a'], [at(2_000)]]) {
            const { parsed, compiled, res } = await evalFormula(
              source,
              { value: at(250), other },
              options,
            );
            expect(
              collectAllErrors(parsed, compiled, res.errors).map((error) => error.code),
              `${name} ${match} ${other.map((phrase) => phrase.length).join(',')}`,
            ).toStrictEqual([FormulaErrorCodes.PHRASE_TOO_LONG]);
          }
        }
        // With ignoreCase the phrase counts lower-cased: U+0130 lower-cases to two code units.
        const ignoring = `${name}(value; other; "substring"; TRUE)`;
        expect(
          await evalOk(ignoring, { value: 'x', other: ['\u0130'.repeat(125)] }, options),
          name,
        ).toBe(name === 'CONTAINS_ANY' ? false : null);
        const { parsed, compiled, res } = await evalFormula(
          ignoring,
          { value: 'x', other: ['\u0130'.repeat(126)] },
          options,
        );
        expect(
          collectAllErrors(parsed, compiled, res.errors).map((error) => error.code),
          name,
        ).toStrictEqual([FormulaErrorCodes.PHRASE_TOO_LONG]);
      }
      // MISSING_FROM counts an item once normalised: collapsed whitespace can bring it within.
      const spaced = `a${' '.repeat(300)}b`;
      expect(
        await evalOk('MISSING_FROM(other; value)', { value: 'a b', other: [spaced] }, options),
      ).toStrictEqual([]);
      for (const source of ['MISSING_FROM(other; value; "exact")', 'MISSING_FROM(other; value)']) {
        const other = source.includes('exact') ? [spaced] : [at(251)];
        const { parsed, compiled, res } = await evalFormula(
          source,
          { value: 'a b', other },
          options,
        );
        expect(
          collectAllErrors(parsed, compiled, res.errors).map((error) => error.code),
          source,
        ).toStrictEqual([FormulaErrorCodes.PHRASE_TOO_LONG]);
      }
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
      // A list of exactly maxListLength is taken.
      expect(await evalOk('CONTAINS_ANY("p999"; value)', { value: phrases.slice(0, 1_000) })).toBe(
        true,
      );
    });

    it('refuses a misspelt match mode at parse time', async () => {
      expect(await errorCodes('CONTAINS_ANY("abc"; LIST("a"); "words")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      // A mode EACH passes on is checked when the call runs: the item is null.
      expect(await evalOk('EACH(LIST("a b"); "FIRST_CONTAINED"; LIST("a"); "wrd")')).toStrictEqual([
        null,
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

    it('folds each documented quote and dash in loose mode, and no other character', async () => {
      const options = { setup: withOther };
      const missing = (normalise: string, text: string, item: string) =>
        evalOk(
          `MISSING_FROM(other; value; "${normalise}")`,
          { value: text, other: [item] },
          options,
        );
      const folds: Array<[string, string]> = [
        ["'", '\u2018\u2019\u201a\u201b\u2039\u203a'],
        ['"', '\u201c\u201d\u201e\u201f\u00ab\u00bb'],
        ['-', '\u2010\u2011\u2012\u2013\u2014\u2015\u2212'],
      ];
      for (const [plain, typographic] of folds) {
        for (const char of typographic) {
          const name = `U+${char.codePointAt(0)?.toString(16).toUpperCase()}`;
          expect(await missing('loose', `x${char}y`, `x${plain}y`), name).toStrictEqual([]);
          expect(await missing('exact', `x${char}y`, `x${plain}y`), name).toStrictEqual([
            `x${plain}y`,
          ]);
        }
      }
      // Look-alikes outside the table stay as they are.
      for (const [plain, char] of [
        ["'", '\uff07'],
        ["'", '\u2032'],
        ['"', '\uff02'],
        ['-', '\ufe58'],
        ['-', '\u2e3a'],
      ]) {
        expect(await missing('loose', `x${char}y`, `x${plain}y`), char).toStrictEqual([
          `x${plain}y`,
        ]);
      }
    });

    it('keeps the listed order and skips empty items', async () => {
      expect(await evalOk('MISSING_FROM(LIST("c"; ""; "a"; "  "; "x"); "a b")')).toStrictEqual([
        'c',
        'x',
      ]);
      expect(await evalOk('MISSING_FROM(LIST(); "a b")')).toStrictEqual([]);
      // An item comes back as listed, though it is compared trimmed and collapsed.
      expect(
        await evalOk('MISSING_FROM(LIST(" billig  jetzt "; " liefern "); "Wir liefern.")'),
      ).toStrictEqual([' billig  jetzt ']);
    });

    it('finds an item in a run of one letter only where the item occurs', async () => {
      // The run holds the item's run at every position, but never followed by `b`.
      const value = 'a'.repeat(4_000);
      const item = `${'a'.repeat(249)}b`;
      const options = { setup: withOther };
      expect(
        await evalOk('MISSING_FROM(other; value)', { value, other: [item] }, options),
      ).toStrictEqual([item]);
      expect(
        await evalOk('MISSING_FROM(other; value)', { value: `${value}b`, other: [item] }, options),
      ).toStrictEqual([]);
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
