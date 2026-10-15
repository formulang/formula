import { BuiltinSignatureIds, FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  createTestRuntime,
  evalFormula,
  evalOk,
  evalOkWithOutput,
  withOther,
} from '../test-helpers/eval-formula';
import {
  LINE_SPLIT_MODES,
  SENTENCE_SPLIT_MODES,
  splitSentences,
  splitWords,
  WORD_SPLIT_MODES,
} from './text-segmentation';

/** The distinct error codes of a formula (a parse error is reported by parse and optimize). */
async function errorCodes(source: string, vars: Record<string, unknown> = {}) {
  const { parsed, compiled, res } = await evalFormula(source, vars);
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}

async function warningCodes(source: string, vars: Record<string, unknown> = {}) {
  const { output, value } = await evalOkWithOutput(source, vars);
  return { value, codes: (output.warnings ?? []).map((w) => w.code) };
}

describe('Text segmentation', () => {
  describe('WORDS and WORD_COUNT', () => {
    it('follows the null convention', async () => {
      expect(await evalOk('WORD_COUNT("")')).toBe(0);
      expect(await evalOk('WORD_COUNT(""; "whitespace")')).toBe(0);
      expect(await evalOk('WORDS("")')).toStrictEqual([]);
      expect(await evalOk('WORD_COUNT(value)', { value: null })).toBe(null);
      expect(await evalOk('WORDS(INDEX(LIST("a"); 0))')).toBe(null);

      // Literal EMPTY() and literal numbers are refused at parse time, as for every typed
      // parameter; the same values arriving at run time answer null (+ TYPE for the number).
      expect(await errorCodes('WORD_COUNT(EMPTY())')).toStrictEqual([
        FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
      ]);
      expect(await errorCodes('WORD_COUNT(5)')).toStrictEqual([
        FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
      ]);
      expect(await warningCodes('WORD_COUNT(value)', { value: 5 })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
    });

    it('splits on whitespace by default', async () => {
      expect(await evalOk('WORDS("  Kennst du   das? ")')).toStrictEqual(['Kennst', 'du', 'das?']);
      expect(await evalOk('WORD_COUNT("  Kennst du   das? ")')).toBe(3);
      expect(await evalOk('WORD_COUNT("  Kennst du   das? "; "whitespace")')).toBe(3);
      // Tabs, line breaks and the no-break space U+00A0 all separate words.
      expect(await evalOk('WORDS(value)', { value: 'a\tb\u00A0c\nd' })).toStrictEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      // JavaScript's whitespace, not Python's: U+FEFF separates, U+0085 and U+001F do not.
      expect(await evalOk('WORD_COUNT(value)', { value: 'a\uFEFFb' })).toBe(2);
      expect(await evalOk('WORD_COUNT(value)', { value: 'a\u0085b\u001Fc' })).toBe(1);
      expect(await evalOk('COUNT(SENTENCES(value))', { value: 'Ja.\uFEFFNein.' })).toBe(2);
      expect(await evalOk('COUNT(SENTENCES(value))', { value: 'Ja.\u0085Nein.' })).toBe(1);
    });

    it('joins letter runs on apostrophes, hyphens and digit separators in letters mode', async () => {
      expect(await evalOk('WORD_COUNT("Don\'t re-enter the e-mail, oder?"; "letters")')).toBe(5);
      expect(await evalOk('WORDS("Don\'t re-enter the e-mail, oder?"; "letters")')).toStrictEqual([
        "Don't",
        're-enter',
        'the',
        'e-mail',
        'oder',
      ]);
      expect(await evalOk('WORDS("Für 3,5 Mio. Kund:innen"; "letters")')).toStrictEqual([
        'Für',
        '3,5',
        'Mio',
        'Kund',
        'innen',
      ]);
      expect(
        await evalOk('WORDS(value; "letters")', { value: 'Don\u2019t E-Mail-Adresse' }),
      ).toStrictEqual(['Don\u2019t', 'E-Mail-Adresse']);
    });

    it('segments with Intl.Segmenter in locale mode', async () => {
      expect(await evalOk('WORDS("Kund:innen"; "locale"; "de")')).toStrictEqual(['Kund:innen']);
      expect(await evalOk('WORD_COUNT("Don\'t"; "locale"; "en")')).toBe(1);
      expect(await evalOk('WORD_COUNT(value; "locale"; "de")', { value: 'E-Mail-Adressen' })).toBe(
        3,
      );

      expect(await warningCodes('WORDS("abc"; "locale"; "x-invalid-")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      // A valid tag without segmentation data would fall back to the host locale: refused.
      expect(await warningCodes('WORDS("abc"; "locale"; "tlh")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await warningCodes('WORDS("abc"; "locale")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      // An empty tag is no language tag.
      expect(await warningCodes('WORDS("abc"; "locale"; "")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
    });

    it('returns every non-empty match in pattern mode', async () => {
      expect(
        await evalOk('WORDS(LOWER("Für 50$ – sofort!"); "pattern"; "[A-Za-z0-9$\']+")'),
      ).toStrictEqual(['f', 'r', '50$', 'sofort']);
      expect(await evalOk('WORDS("Ab aB ba"; "pattern"; "/ab/i")')).toStrictEqual(['Ab', 'aB']);
      expect(await evalOk('WORDS("abc"; "pattern"; "x*")')).toStrictEqual([]);

      // `g` is implied, so it is not an admitted flag; other refusals mirror MATCH_EXPRESSION.
      expect(await warningCodes('WORDS("ab"; "pattern"; "/ab/g")')).toStrictEqual({
        value: null,
        codes: ['REGEX'],
      });
      expect(await warningCodes('WORDS("ab"; "pattern"; "[a")')).toStrictEqual({
        value: null,
        codes: ['REGEX'],
      });
      expect(await warningCodes('WORDS("ab"; "pattern")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });

      expect(await errorCodes('WORDS("aaaa"; "pattern"; "(a+)+")')).toContain(
        FormulaErrorCodes.REGEX_UNSAFE,
      );
      expect(
        await errorCodes('WORD_COUNT(value; "pattern"; "a")', { value: 'a'.repeat(8_001) }),
      ).toContain(FormulaErrorCodes.REGEX_INPUT_TOO_LONG);
    });

    it('bounds the WORDS list but counts past the bound', async () => {
      const value = 'a '.repeat(5_001);
      expect(await errorCodes('WORDS(value)', { value })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
      expect(await evalOk('WORD_COUNT(value)', { value })).toBe(5_001);
      expect(await evalOk('COUNT(WORDS(value))', { value: 'a '.repeat(5_000) })).toBe(5_000);
    });

    it('refuses a misspelt mode at parse time and an option outside locale and pattern', async () => {
      expect(await errorCodes('WORD_COUNT(value; "whitespce")', { value: 'a' })).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(await warningCodes('WORD_COUNT("a b"; "whitespace"; "de")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await warningCodes('WORD_COUNT("a b"; "letters"; "x")')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
    });

    it('answers null with TYPE for an empty option in every mode', async () => {
      // The empty text is an option: refused outside locale and pattern, an empty tag or pattern
      // inside them.
      for (const mode of WORD_SPLIT_MODES) {
        for (const source of [
          `WORDS("a b"; "${mode}"; "")`,
          `WORD_COUNT("a b"; "${mode}"; "")`,
          `LEADING_WORDS("a b"; 1; "${mode}"; "")`,
          `WORD_COUNT("a b"; "${mode}"; value)`,
        ]) {
          expect(await warningCodes(source, { value: '' }), source).toStrictEqual({
            value: null,
            codes: ['TYPE'],
          });
        }
        expect(() => splitWords('a b', mode, ''), mode).toThrow(TypeError);
      }
      // A null option is no option, as an omitted one is.
      expect(await evalOk('WORD_COUNT("a b"; "whitespace"; value)', { value: null })).toBe(2);
      expect(
        await warningCodes('WORD_COUNT("a b"; "locale"; value)', { value: null }),
      ).toStrictEqual({ value: null, codes: ['TYPE'] });
    });

    it('refuses a misspelt or non-literal mode passed on by a higher-order call', async () => {
      // EACH passes its extra arguments to the callable's parameters, whose literal rules hold.
      expect(
        await errorCodes('EACH(LIST("a b"; "c d e"); "WORD_COUNT"; "whitespce")'),
      ).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
      expect(await errorCodes('EACH(LIST("a b"); "LEADING_WORDS"; 2; "whitspace")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(
        await errorCodes('EACH(LIST("a b"); "WORD_COUNT"; value)', { value: 'letters' }),
      ).toStrictEqual([FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE]);
      expect(await evalOk('EACH(LIST("a b"; "c"); "WORD_COUNT"; "letters")')).toStrictEqual([2, 1]);
    });
  });

  describe('LEADING_WORDS', () => {
    it('joins the first words by one space and answers null when the text has fewer', async () => {
      expect(
        await evalOk('LEADING_WORDS("eins zwei  drei vier fünf sechs sieben acht neun"; 8)'),
      ).toBe('eins zwei drei vier fünf sechs sieben acht');
      expect(await evalOk('LEADING_WORDS("eins zwei drei vier fünf sechs sieben"; 8)')).toBe(null);
      expect(await evalOk('LEADING_WORDS("eins zwei  drei vier"; 2)')).toBe('eins zwei');
      expect(await evalOk('LEADING_WORDS("eins zwei"; 3)')).toBe(null);
      expect(await evalOk('LEADING_WORDS(value; 2)', { value: null })).toBe(null);
      expect(await evalOk('LEADING_WORDS("a b"; INDEX(LIST(1); 0))')).toBe(null);
    });

    it('refuses a count that is not a positive whole number', async () => {
      expect(await warningCodes('LEADING_WORDS("a b c"; 0)')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await warningCodes('LEADING_WORDS("a b c"; 2.5)')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await warningCodes('LEADING_WORDS("a b c"; -1)')).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
    });

    it('maps over a list and takes the word modes', async () => {
      expect(await evalOk('EACH(LIST("a b"; "c d e"); "LEADING_WORDS"; 2)')).toStrictEqual([
        'a b',
        'c d',
      ]);
      expect(
        await evalOk(
          'LEADING_WORDS(LOWER("Kennst du das? Du willst mehr!"); 3; "pattern"; "[A-Za-z0-9$\']+")',
        ),
      ).toBe('kennst du das');
    });
  });

  describe('SENTENCES', () => {
    it('splits at a whitespace run after . ! or ? in punctuation mode', async () => {
      expect(await evalOk('SENTENCES("Hi. Ok!  Next? end")')).toStrictEqual([
        'Hi.',
        'Ok!',
        'Next?',
        'end',
      ]);
      expect(await evalOk('COUNT(SENTENCES("3.5 Uhr. Gut."))')).toBe(2);
      // An ellipsis is not a terminator.
      expect(await evalOk('SENTENCES("Na ja… Gut.")')).toStrictEqual(['Na ja… Gut.']);
      expect(await evalOk('SENTENCES("")')).toStrictEqual([]);
      expect(await evalOk('SENTENCES(value)', { value: null })).toBe(null);
    });

    it('ends a sentence at every terminator run in terminators mode', async () => {
      expect(await evalOk('SENTENCES("3.5 Uhr. Gut."; "terminators")')).toStrictEqual([
        '3.',
        '5 Uhr.',
        'Gut.',
      ]);
      expect(
        await evalOk('SENTENCES(value; "terminators")', { value: '你好。再见！好吗？' }),
      ).toStrictEqual(['你好。', '再见！', '好吗？']);
      // A piece holding nothing but terminators is not a sentence.
      expect(await evalOk('SENTENCES("Hello. ... World"; "terminators")')).toStrictEqual([
        'Hello.',
        'World',
      ]);
    });

    it('never ends a sentence inside or at the end of a keep token', async () => {
      expect(await evalOk('COUNT(SENTENCES("Wir helfen z. B. Handwerkern."))')).toBe(3);
      expect(
        await evalOk('SENTENCES("Wir helfen z. B. Handwerkern."; "punctuation"; LIST("z. B."))'),
      ).toStrictEqual(['Wir helfen z. B. Handwerkern.']);
      expect(
        await evalOk('SENTENCES("Wir helfen z. B. Handwerkern."; "terminators"; LIST("z. B."))'),
      ).toStrictEqual(['Wir helfen z. B. Handwerkern.']);
      expect(
        await evalOk('SENTENCES("Dr. Smith agreed. Done."; "punctuation"; LIST("Dr."))'),
      ).toStrictEqual(['Dr. Smith agreed.', 'Done.']);
      // A token counts only where it starts at a word boundary ("ca." inside "Africa." does not).
      expect(
        await evalOk(
          'COUNT(SENTENCES("We flew to Africa. Then home."; "punctuation"; LIST("ca.")))',
        ),
      ).toBe(2);
      // A token that starts with punctuation starts at a boundary even right after a word.
      expect(await evalOk('SENTENCES("Na ja... Gut."; "terminators"; LIST("..."))')).toStrictEqual([
        'Na ja... Gut.',
      ]);
      expect(await evalOk('SENTENCES("Na ja ... Gut."; "terminators"; LIST("..."))')).toStrictEqual(
        ['Na ja ... Gut.'],
      );
      // Empty keep entries are skipped; a non-text entry is null + TYPE.
      expect(await evalOk('COUNT(SENTENCES("Dr. A. B."; "punctuation"; LIST("Dr."; "")))')).toBe(2);
      expect(
        await warningCodes('SENTENCES("a. b."; "punctuation"; value)', { value: [1] }),
      ).toStrictEqual({ value: null, codes: ['TYPE'] });
    });

    it('protects only the keep tokens that start at a word boundary', async () => {
      // A run of one letter holds the half-length token at every position; only the one at the
      // start begins at a word boundary, and its range ends before the full stop.
      const options = { setup: withOther };
      const value = `${'a'.repeat(4_000)}. Next.`;
      expect(
        await evalOk(
          'SENTENCES(value; "punctuation"; other)',
          { value, other: ['a'.repeat(2_000)] },
          options,
        ),
      ).toStrictEqual([`${'a'.repeat(4_000)}.`, 'Next.']);
      // The occurrence that starts at a word boundary protects its range: `aa.` here.
      expect(
        await evalOk(
          'SENTENCES(value; "punctuation"; other)',
          { value: 'aa. aa. b.', other: ['aa. a'] },
          options,
        ),
      ).toStrictEqual(['aa. aa.', 'b.']);
      expect(
        await evalOk('COUNT(SENTENCES(value; "punctuation"; LIST("aa")))', {
          value: 'a'.repeat(1_000),
        }),
      ).toBe(1);
    });

    it('bounds the keep list and the sentence list', async () => {
      const keep = Array.from({ length: 1_001 }, (_, i) => `t${i}.`);
      expect(
        await errorCodes('SENTENCES("a. b."; "punctuation"; value)', { value: keep }),
      ).toContain(FormulaErrorCodes.LIST_TOO_LARGE);
      const { res } = await evalFormula(
        'SENTENCES("a. b. c.")',
        {},
        { limits: { maxWildcardOutputLength: 2 } },
      );
      expect(res.errors.map((e) => e.code)).toContain(FormulaErrorCodes.LIST_TOO_LARGE);
    });
  });

  describe('LINES and LINE_COUNT', () => {
    it('ends a line at every mandatory break', async () => {
      expect(await evalOk('LINES(value)', { value: 'a\r\nb\rc\u2028d' })).toStrictEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      expect(await evalOk('LINE_COUNT(value)', { value: 'a\u000bb\u000cc\u0085d\u2029e' })).toBe(5);
    });

    it('drops blank lines unless the mode is all', async () => {
      expect(await evalOk('LINES(value)', { value: 'a\n\n b' })).toStrictEqual(['a', ' b']);
      expect(await evalOk('LINE_COUNT(value; "non-blank")', { value: 'a\n\n b' })).toBe(2);
      expect(await evalOk('LINES(value; "all")', { value: 'a\n\n b' })).toStrictEqual([
        'a',
        '',
        ' b',
      ]);
      expect(await evalOk('LINE_COUNT(value; "all")', { value: 'a\n  \n b' })).toBe(3);
      // A final break ends the last line; it does not start an empty one.
      expect(await evalOk('LINE_COUNT(value; "all")', { value: 'a\nb\n' })).toBe(2);
      expect(await evalOk('LINE_COUNT(value)', { value: 'a\r\nb\rc' })).toBe(3);
      expect(await evalOk('LINE_COUNT("")')).toBe(0);
      expect(await evalOk('LINE_COUNT(""; "all")')).toBe(0);
      expect(await evalOk('LINES(value)', { value: null })).toBe(null);
    });

    it('bounds the line list', async () => {
      const { res } = await evalFormula(
        'LINES(value)',
        { value: 'a\nb\nc' },
        { limits: { maxWildcardOutputLength: 2 } },
      );
      expect(res.errors.map((e) => e.code)).toContain(FormulaErrorCodes.LIST_TOO_LARGE);
      expect(
        await evalOk(
          'LINE_COUNT(value)',
          { value: 'a\nb\nc' },
          { limits: { maxWildcardOutputLength: 2 } },
        ),
      ).toBe(3);
    });
  });

  describe('exported tokenisers', () => {
    it('splitWords counts the same words as WORDS', async () => {
      const samples = [
        '  Kennst du   das? ',
        "Don't re-enter the e-mail, oder?",
        'a\u00A0b\tc',
        '',
      ];
      for (const sample of samples) {
        expect(splitWords(sample)).toStrictEqual(await evalOk('WORDS(value)', { value: sample }));
        expect(splitWords(sample, 'letters')).toStrictEqual(
          await evalOk('WORDS(value; "letters")', { value: sample }),
        );
        // The whitespace mode is the trim-and-split rule: `text.trim().split(/\s+/u)`, empties dropped.
        expect(splitWords(sample, 'whitespace')).toStrictEqual(
          sample
            .trim()
            .split(/\s+/u)
            .filter((word) => word.length > 0),
        );
      }
      expect(splitWords('Kund:innen', 'locale', 'de')).toStrictEqual(['Kund:innen']);
      expect(splitWords('a1 b2', 'pattern', '[a-z]')).toStrictEqual(['a', 'b']);
      expect(() => splitWords('a', 'whitespace', 'de')).toThrow(TypeError);
      expect(() => splitWords('a', 'locale')).toThrow(TypeError);
      expect(() => splitWords('a', 'pattern', '(a')).toThrow(TypeError);
    });

    it('splitSentences splits as SENTENCES does', async () => {
      const samples = ['Hi. Ok!  Next? end', '3.5 Uhr. Gut.', 'Hello. ... World', '?!', ''];
      for (const sample of samples) {
        expect(splitSentences(sample)).toStrictEqual(
          await evalOk('SENTENCES(value)', { value: sample }),
        );
        // The terminators mode counts what `text.split(/[.!?。！？]+/u)` counts, blanks dropped.
        expect(splitSentences(sample, 'terminators')).toHaveLength(
          sample
            .split(/[.!?。！？]+/u)
            .map((piece) => piece.trim())
            .filter((piece) => piece.length > 0).length,
        );
      }
      expect(
        splitSentences('Wir helfen z. B. Handwerkern.', 'punctuation', ['z. B.']),
      ).toHaveLength(1);
      expect(() => splitSentences('a', 'locale' as never)).toThrow(TypeError);
    });
  });

  it('declares exactly the modes the implementations accept', () => {
    const { registry } = createTestRuntime();
    const literalValuesOf = (signatureId: string) =>
      registry.getFunction(signatureId)?.params.find((p) => p.name === 'mode')?.literalValues;

    expect(literalValuesOf(BuiltinSignatureIds.WORDS)).toStrictEqual([...WORD_SPLIT_MODES]);
    expect(literalValuesOf(BuiltinSignatureIds.WORD_COUNT)).toStrictEqual([...WORD_SPLIT_MODES]);
    expect(literalValuesOf(BuiltinSignatureIds.LEADING_WORDS)).toStrictEqual([...WORD_SPLIT_MODES]);
    expect(literalValuesOf(BuiltinSignatureIds.SENTENCES)).toStrictEqual([...SENTENCE_SPLIT_MODES]);
    expect(literalValuesOf(BuiltinSignatureIds.LINES)).toStrictEqual([...LINE_SPLIT_MODES]);
    expect(literalValuesOf(BuiltinSignatureIds.LINE_COUNT)).toStrictEqual([...LINE_SPLIT_MODES]);
  });
});
