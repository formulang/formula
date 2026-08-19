import { FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  evalFormula,
  evalOk,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';

describe('Text extras', () => {
  it('extracts substrings', async () => {
    expect(await evalOk('LEFT("hello"; 2)')).toBe('he');
    expect(await evalOk('RIGHT("hello"; 2)')).toBe('lo');
    expect(await evalOk('MID("hello"; 2; 2)')).toBe('el');
    expect(await evalOk('LEFT("hello")')).toBe('h');
    expect(await evalOk('RIGHT("hello")')).toBe('o');

    // Edge cases
    expect(await evalOk('LEFT("hello"; 0)')).toBe('');
    expect(await evalOk('LEFT("hello"; -10)')).toBe('');
    expect(await evalOk('RIGHT("hello"; 0)')).toBe('');
    expect(await evalOk('RIGHT("hello"; -10)')).toBe('');
    expect(await evalOk('MID("hello"; 100; 2)')).toBe('');
    expect(await evalOk('MID("hello"; 1; 0)')).toBe('');

    // Type mismatches are type errors (not runtime null).
    const leftType = await evalFormula('LEFT(1; 2)');
    const leftAll = collectAllErrors(leftType.parsed, leftType.compiled, leftType.res.errors);
    expect(leftAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);

    const rightType = await evalFormula('RIGHT(1; 2)');
    const rightAll = collectAllErrors(rightType.parsed, rightType.compiled, rightType.res.errors);
    expect(rightAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
    const midType = await evalFormula('MID(1; 2; 3)');
    const midAll = collectAllErrors(midType.parsed, midType.compiled, midType.res.errors);
    expect(midAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
  });

  it('replaces text', async () => {
    expect(await evalOk('REPLACE("hello"; 2; 2; "xx")')).toBe('hxxlo');
    expect(await evalOk('REPLACE("hello"; 1; 0; "X")')).toBe('Xhello');
    expect(await evalOk('SUBSTITUTE("a a a"; "a"; "b"; 2)')).toBe('a b a');
    expect(await evalOk('SUBSTITUTE("a a a"; "a"; "b")')).toBe('b b b');
    expect(await evalOk('TRIM("  a   b  ")')).toBe('a b');

    // REPLACE beyond end just appends.
    expect(await evalOk('REPLACE("hi"; 10; 2; "X")')).toBe('hiX');

    // SUBSTITUTE behavior for empty search string.
    expect(await evalOk('SUBSTITUTE("abc"; ""; "X")')).toBe('abc');
    expect(await evalOk('SUBSTITUTE("abc"; ""; "X"; 2)')).toBe('abc');

    // Invalid occurrence returns null.
    expect(await evalOk('SUBSTITUTE("abc"; "a"; "b"; 0)')).toBe(null);

    // TRIM collapses whitespace (space/tab/newline).
    expect(await evalOk('TRIM("\n\t  a\r\n  b\t\t  ")')).toBe('a b');
  });

  it('supports regex helpers', async () => {
    expect(await evalOk('REGEXEXTRACT("abc123"; "([0-9]+)")')).toBe('123');
    expect(await evalOk('REGEXREPLACE("abc123def"; "[0-9]+"; "X")')).toBe('abcXdef');
    expect(await evalOk('REGEXEXTRACT("nope"; "([0-9]+)")')).toBe(null);

    // No capturing group: return full match.
    expect(await evalOk('REGEXEXTRACT("abc123"; "[0-9]+")')).toBe('123');

    // REGEXREPLACE is global.
    expect(await evalOk('REGEXREPLACE("a1a2a3"; "a"; "X")')).toBe('X1X2X3');
  });

  it('rejects disallowed regex constructs (backrefs/lookbehind/flags)', async () => {
    expect(await evalOk('REGEXEXTRACT("aba"; "(a)\\1")')).toBe(null);
    expect(await evalOk('REGEXEXTRACT("ab"; "(?<=a)b")')).toBe(null);

    const invalidFlags = await evalOkWithOutput('REGEXEXTRACT("a"; "/a/x")');
    expect(invalidFlags.value).toBe(null);
    expect(invalidFlags.output.warnings?.some((w) => w.code === 'REGEX')).toBe(true);
  });

  it('rejects unsafe regex patterns and overly long input', async () => {
    const unsafe = await evalFormula('REGEXEXTRACT("aaaaaaaaaaaaaaaaaaaa"; "(a+)+$")');
    expect(unsafe.res.errors.some((e) => e.code === FormulaErrorCodes.REGEX_UNSAFE)).toBe(true);

    const longText = 'a'.repeat(5000);
    const tooLong = await evalFormula(
      'REGEXREPLACE(value; "a"; "b")',
      { value: longText },
      {
        limits: { maxRegexTextLength: 10 },
      },
    );
    expect(tooLong.res.errors.some((e) => e.code === FormulaErrorCodes.REGEX_INPUT_TOO_LONG)).toBe(
      true,
    );
  });

  it('encodes urls and validates urls', async () => {
    expect(await evalOk('ENCODEURL("a b")')).toBe('a%20b');
    expect(await evalOk('ISURL("https://example.com")')).toBe(true);
    expect(await evalOk('ISURL("http://sub.example.com:8080/path?q=1#frag")')).toBe(true);
    expect(await evalOk('ISURL("ftp://example.com")')).toBe(true);
    expect(await evalOk('ISURL("gopher://example.com")')).toBe(true);
    expect(await evalOk('ISURL("telnet:example.com")')).toBe(true);
    expect(await evalOk('ISURL("news:comp.lang.javascript")')).toBe(true);
    expect(await evalOk('ISURL("aim:goim?screenname=test")')).toBe(true);
    expect(await evalOk('ISURL("mailto:test@example.com")')).toBe(true);

    expect(await evalOk('ISURL("example.com")')).toBe(true);
    expect(await evalOk('ISURL("www.example.technology")')).toBe(true);
    expect(await evalOk('ISURL("sub.example.co.uk/path?q=1")')).toBe(true);
    expect(await evalOk('ISURL("example")')).toBe(false);
    expect(await evalOk('ISURL("localhost")')).toBe(false);
    expect(await evalOk('ISURL("http://localhost")')).toBe(false);
    expect(await evalOk('ISURL("-bad.example")')).toBe(false);
    expect(await evalOk('ISURL("exa_mple.com")')).toBe(false);
    expect(await evalOk('ISURL("example.c")')).toBe(false);
    expect(await evalOk('ISURL("not a url")')).toBe(false);
  });

  it('converts values to text', async () => {
    expect(await evalOk('TO_TEXT(123)')).toBe('123');
    expect(await evalOk('TO_TEXT(true)')).toBe('true');
    expect(await evalOk('TO_TEXT(DATE(2024;2;29))')).toBe('2024-02-29');
    expect(await evalOk('TO_TEXT(TIME(1;2;3))')).toBe('01:02:03');
    expect(await evalOk('TO_TEXT(LIST(1;2;3))')).toBe(null);
    expect(await evalOk('TO_TEXT(INDEX(LIST(1); 0))')).toBe(null);
    expect(await evalOk('TO_TEXT(value)', { value: { secret: 1 } })).toBe(null);
    expect(await evalOk('CHAR(65)')).toBe('A');
    expect(await evalOk('CHAR(0)')).toBe(null);
    // Formula numbers are decimal literals (no 0x...).
    expect(await evalOk('CHAR(128512)')).toBe('😀');
    expect(await evalOk('CHAR(1114112)')).toBe(null);
  });
});
