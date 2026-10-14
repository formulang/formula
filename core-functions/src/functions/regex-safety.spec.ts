import { DEFAULT_FORMULA_LIMITS, FormulaErrorCodes } from '@formulang/definitions';
import { collectAllErrors, evalFormula } from '../test-helpers/eval-formula';
import { regexSafetyRefusal } from './regex-safety';

/** Every built-in that compiles an author's pattern under the shared safety rules. */
const CALLERS: Record<string, string> = {
  MATCH_EXPRESSION: 'MATCH_EXPRESSION(INDEX(value; 1); INDEX(value; 2))',
  REGEXEXTRACT: 'REGEXEXTRACT(INDEX(value; 1); INDEX(value; 2))',
  REGEXREPLACE: 'REGEXREPLACE(INDEX(value; 1); INDEX(value; 2); "-")',
  'WORD_COUNT pattern mode': 'WORD_COUNT(INDEX(value; 1); "pattern"; INDEX(value; 2))',
};

async function errorCodes(source: string, text: string, pattern: string) {
  const { parsed, compiled, res } = await evalFormula(source, { value: [text, pattern] });
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}

/**
 * Shapes whose backtracking grows faster than quadratically in the text length: each one ran
 * for seconds to hours on a text of at most 8,000 characters before the analysis refused it.
 */
const REFUSED: readonly string[] = [
  // A repeated group holding a quantifier or an alternation, at any depth.
  '((a)+)+b',
  '(a+)+$',
  '(x{1,3})+',
  '^(\\w+\\s?)*$',
  '(?=(a+)+b)',
  '(a|a)*',
  '(?:a|b)+',
  // Two unbounded quantifiers next to each other over a common character.
  'a*a*a*a*a*b',
  'a*a*',
  '\\w+\\w*',
  '.*.*',
  '.*\\d+',
  '[ab]*[ab]*',
  '(a+)?a+x',
  // Quantifiers competing for the same characters before a part that can fail.
  '\\d+\\s*\\d+x',
  '.*foo.*bar',
  '\\w+_\\w+$',
  '.+@.+\\..+',
  'a?a?a?a+x',
  'a{0,15}a+x',
  '.*\\d{16}',
  '.*\\d{1000}',
  `${'(a|a)'.repeat(19)}x`,
  `${'a?'.repeat(33)}${'a'.repeat(33)}`,
];

const text8000 = (unit: string, tail = '') =>
  unit.repeat(Math.floor((8_000 - tail.length) / unit.length)) + tail;

/** Patterns the analysis admits, each with the texts that drive its backtracking hardest. */
const ADMITTED: Record<string, readonly string[]> = {
  '\\w+@\\w+\\.\\w+': [text8000('a'), text8000('a@'), text8000('a@a.')],
  '\\d+\\s*\\d+': [text8000('1'), text8000('1 '), text8000('1x')],
  "[A-Za-z0-9$']+": [text8000("a'"), text8000(' ')],
  '.*foo.*': [text8000('a'), text8000('fo')],
  '.*foo': [text8000('a'), text8000('fo')],
  '^\\d+(\\.\\d+)?$': [text8000('1', 'x'), text8000('1.')],
  '^\\d+\\s*\\d+$': [text8000('1', 'x'), text8000('1 ', 'x')],
  '^\\s*\\w+\\s*=\\s*\\w+\\s*$': [text8000('a', '!'), text8000(' '), text8000('a =')],
  '\\S+\\s+\\S+': [text8000('a'), text8000(' ')],
  'https?://\\S+': [text8000('http:/')],
  '.+@.+': [text8000('a'), text8000('@')],
  '"[^"]*"': [`"${text8000('a').slice(1)}`],
  '\\s+$': [text8000(' ', 'x')],
  '\\b\\w+\\b': [text8000('a')],
  'a?a?a+x': [text8000('a')],
  '[a-z]+ing\\b': [text8000('in')],
  '(?=.*\\d).{8,}': [text8000('a')],
  '\\d{1,3}(?:,\\d{3})*': [text8000('1,')],
  '[^@]+@[^@]+\\.[a-z]{2,}$': [`x@${text8000('a.', '1').slice(2)}`],
  '.*\\d{4}': [text8000('111x')],
};

/** A generous bound: the admitted patterns take tens of milliseconds on these texts. */
const MAX_MILLISECONDS = 2_000;

describe('Regex safety analysis', () => {
  it.each(REFUSED)('refuses %s in every regex built-in', async (pattern) => {
    expect(pattern.length).toBeLessThanOrEqual(DEFAULT_FORMULA_LIMITS.maxRegexPatternLength);
    expect(() => new RegExp(pattern)).not.toThrow();
    for (const [caller, source] of Object.entries(CALLERS)) {
      expect(await errorCodes(source, 'x', pattern), caller).toStrictEqual([
        FormulaErrorCodes.REGEX_UNSAFE,
      ]);
    }
  });

  it.each(Object.entries(ADMITTED))(
    'admits %s and finishes on its worst-case texts',
    async (pattern, texts) => {
      expect(regexSafetyRefusal(pattern, '', DEFAULT_FORMULA_LIMITS.maxRegexTextLength)).toBe(null);
      for (const text of texts) {
        expect(text.length).toBeGreaterThan(7_990);
        expect(text.length).toBeLessThanOrEqual(DEFAULT_FORMULA_LIMITS.maxRegexTextLength);
        for (const [caller, source] of Object.entries(CALLERS)) {
          const started = performance.now();
          expect(await errorCodes(source, text, pattern), caller).toStrictEqual([]);
          expect(performance.now() - started, `${caller} on ${text.slice(0, 12)}...`).toBeLessThan(
            MAX_MILLISECONDS,
          );
        }
      }
    },
    60_000,
  );

  it('folds case under the i flag before comparing characters', async () => {
    expect(await errorCodes(CALLERS.REGEXEXTRACT, 'x', '/[a-z]+[A-Z]+x/i')).toStrictEqual([
      FormulaErrorCodes.REGEX_UNSAFE,
    ]);
    expect(await errorCodes(CALLERS.REGEXEXTRACT, 'x', '/[a-z]+[A-Z]+x/')).toStrictEqual([]);
  });

  it('names the rule a pattern breaks', () => {
    const refusal = (pattern: string) => regexSafetyRefusal(pattern, '', 8_000);
    expect(refusal('(a+)+')).toBe('a repeated group holds a quantifier or an alternation');
    expect(refusal('a*a*')).toBe(
      'two unbounded quantifiers next to each other can both take the character between them',
    );
    // Every repetition of the group starts with `-`, which `[a-z]+` cannot take.
    expect(refusal('[a-z]+(?:-x)*')).toBe(null);
    expect(refusal('\\d+\\s*\\d+x')).toBe(
      'quantifiers compete for the same characters before a part that can fail',
    );
    // Anchored at the text start, the same shape has one start position to try.
    expect(refusal('^\\d+\\s*\\d+x')).toBe(null);
    expect(refusal('\\(a+\\)+')).toBe(null);
  });
});
