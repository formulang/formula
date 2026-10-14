import { BuiltinSignatureIds, FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
  createTestRuntime,
  evalFormula,
  evalOk,
} from '../test-helpers/eval-formula';
import { HTML_NAMED_CHARACTER_REFERENCES, WINDOWS_1252_NUMERIC_REFERENCES } from './html-entities';
import { MARKDOWN_BLOCK_KINDS, MARKUP_FORMATS } from './markup-text';

async function errorCodes(source: string, vars: Record<string, unknown> = {}) {
  const { parsed, compiled, res } = await evalFormula(source, vars);
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}

const html = (value: string) => evalOk('PLAIN_TEXT(value; "html")', { value });
const markdown = (value: string) => evalOk('PLAIN_TEXT(value; "markdown")', { value });
const blocks = (value: string, kind: string) =>
  evalOk(`MARKDOWN_BLOCKS(value; "${kind}")`, { value });

describe('Markup text', () => {
  describe('PLAIN_TEXT from HTML', () => {
    it('keeps the text of each block on its own line', async () => {
      expect(
        await evalOk('PLAIN_TEXT("<p>A&amp;B</p><p>C&nbsp;D</p><script>x</script>"; "html")'),
      ).toBe('A&B\nC D');
      expect(await html('<h2>Title</h2><ul><li>One</li><li>Two</li></ul>')).toBe('Title\nOne\nTwo');
      expect(await html('First<br>Second<br/>Third')).toBe('First\nSecond\nThird');
      expect(await html('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('a\nb');
    });

    it('drops comments and the content of script, style and head', async () => {
      expect(
        await html(
          '<html><head><title>T</title></head><body><!-- note --><style>p{}</style>Hi</body></html>',
        ),
      ).toBe('Hi');
      expect(await html('<p>A</p><!-- unterminated <p>B</p>')).toBe('A');
      expect(await html('<SCRIPT type="text/javascript">if (a < b) {}</SCRIPT><P>Text</P>')).toBe(
        'Text',
      );
      expect(await html('<!DOCTYPE html><?xml version="1.0"?><p>Doc</p>')).toBe('Doc');
    });

    it('removes other tags and skips > inside quoted attributes', async () => {
      expect(await html('<p class="x">Hello <b>bold</b> <a title="a > b">link</a></p>')).toBe(
        'Hello bold link',
      );
      expect(await html('a < b and b > c')).toBe('a < b and b > c');
    });

    it('decodes numeric and named character references', async () => {
      expect(await html('M&auml;rz &#252;ber &#xFC;ber')).toBe('März über über');
      expect(await html('&lt;p&gt; is a tag')).toBe('<p> is a tag');
      expect(await html('a&#150;b &#8212; &euro;')).toBe('a–b — €');
      expect(await html('x&#0;y')).toBe('x\uFFFDy');
      expect(await html('&unknown; &amp')).toBe('&unknown; &amp');
    });

    it('collapses whitespace within lines, keeps pre line breaks and drops blank lines', async () => {
      expect(await html('<p>one\n   two</p>\n\n<p>  </p><div>three</div>')).toBe('one two\nthree');
      expect(await html('<pre>line 1\n  line 2</pre>')).toBe('line 1\nline 2');
    });
  });

  describe('PLAIN_TEXT from markdown', () => {
    it('removes block markers', async () => {
      expect(await evalOk('PLAIN_TEXT("## Titel"; "markdown")')).toBe('Titel');
      expect(
        await markdown('# Title #\n\n> quoted\n> text\n\n- one\n* two\n+ three\n1. four\n2) five'),
      ).toBe('Title\nquoted text\none\ntwo\nthree\nfour\nfive');
      expect(await markdown('| A | B |\n|---|:-:|\n| 1 | 2 |')).toBe('A B\n1 2');
      expect(await markdown('```js\nconst x = 1;\n```\n\n---\n\nAfter')).toBe(
        'const x = 1;\nAfter',
      );
    });

    it('removes inline markup', async () => {
      expect(await evalOk('PLAIN_TEXT("[Link](https://x)"; "markdown")')).toBe('Link');
      expect(await markdown('![Logo](logo.png) and <https://example.com>')).toBe(
        'Logo and https://example.com',
      );
      expect(await markdown('**bold**, *italic*, __strong__, _em_ and `code`')).toBe(
        'bold, italic, strong, em and code',
      );
      expect(await markdown('snake_case_name, 2 * 3 and 2*3')).toBe(
        'snake_case_name, 2 * 3 and 2*3',
      );
      expect(await markdown('\\*not emphasis\\* and \\# not a heading')).toBe(
        '*not emphasis* and # not a heading',
      );
      expect(await markdown('[![Badge](b.svg)](https://ci)')).toBe('Badge');
    });

    it('answers the documented examples', async () => {
      expect(await evalOk('PLAIN_TEXT("[Link](https://x) and **bold**"; "markdown")')).toBe(
        'Link and bold',
      );
      const value = '## 1. Erstens\n- item\n  - nested\n| A | B |\n|---|---|\n| 1 | 2 |';
      expect(await blocks(value, 'heading-2')).toStrictEqual(['1. Erstens']);
      expect(await blocks(value, 'list-item')).toStrictEqual(['item', 'nested']);
      expect(await blocks(value, 'table-row')).toStrictEqual(['A B', '1 2']);
    });

    it('joins paragraph lines with one space', async () => {
      expect(await markdown('First line\nsecond line\n\nNext paragraph')).toBe(
        'First line second line\nNext paragraph',
      );
    });
  });

  describe('MARKDOWN_BLOCKS', () => {
    const document = [
      '# Overview',
      '## 1. Erstens',
      'Text one',
      'continues.',
      '## 2. Zweitens ##',
      '- item',
      '  - nested item',
      '- last item',
      '## 3. Drittens',
      '| Name | Wert |',
      '| --- | --- |',
      '| a | 1 |',
      '| b \\| c | 2 |',
      '## 4. Viertens',
      '```',
      'code line 1',
      '  code line 2',
      '```',
      '## 5. Fünftens',
      '## 6. Sechstens',
    ].join('\n');

    it('selects headings by level', async () => {
      expect(await blocks(document, 'heading-2')).toStrictEqual([
        '1. Erstens',
        '2. Zweitens',
        '3. Drittens',
        '4. Viertens',
        '5. Fünftens',
        '6. Sechstens',
      ]);
      expect(await evalOk('COUNT(MARKDOWN_BLOCKS(value; "heading-2"))', { value: document })).toBe(
        6,
      );
      expect(await blocks(document, 'heading-3')).toStrictEqual([]);
      expect(await blocks(document, 'heading-1')).toStrictEqual(['Overview']);
      expect(await blocks(document, 'heading')).toHaveLength(7);
    });

    it('returns list items, table rows, paragraphs and code without their markers', async () => {
      expect(await blocks(document, 'list-item')).toStrictEqual([
        'item',
        'nested item',
        'last item',
      ]);
      // The delimiter row is not a row; an escaped pipe stays in its cell.
      expect(await blocks(document, 'table-row')).toStrictEqual(['Name Wert', 'a 1', 'b | c 2']);
      expect(await blocks(document, 'paragraph')).toStrictEqual(['Text one continues.']);
      expect(await blocks(document, 'code')).toStrictEqual(['code line 1\n  code line 2']);
    });

    it('removes inline markup from block text and reads blocks inside quotes', async () => {
      expect(await blocks('## **Bold** `code` heading', 'heading-2')).toStrictEqual([
        'Bold code heading',
      ]);
      expect(await blocks('> ## Quoted\n> - item', 'heading')).toStrictEqual(['Quoted']);
      expect(await blocks('> ## Quoted\n> - item', 'list-item')).toStrictEqual(['item']);
      expect(await blocks('~~~\n> not a quote\n~~~', 'code')).toStrictEqual(['> not a quote']);
      expect(await blocks('```\nunclosed fence', 'code')).toStrictEqual(['unclosed fence']);
    });

    it('needs a delimiter row to recognise a table', async () => {
      expect(await blocks('a | b\nc | d', 'table-row')).toStrictEqual([]);
      expect(await blocks('a | b\nc | d', 'paragraph')).toStrictEqual(['a | b c | d']);
    });

    it('follows the null convention, refuses an unknown kind and bounds the result', async () => {
      expect(await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: null })).toBe(null);
      expect(await evalOk('MARKDOWN_BLOCKS(""; "paragraph")')).toStrictEqual([]);
      expect(await errorCodes('MARKDOWN_BLOCKS("x"; "heading-7")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      // The kind is required: omitting it is a compile error.
      expect(await errorCodes('MARKDOWN_BLOCKS("x")')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
      const { res } = await evalFormula(
        'MARKDOWN_BLOCKS(value; "list-item")',
        { value: '- a\n- b\n- c' },
        { limits: { maxWildcardOutputLength: 2 } },
      );
      expect(res.errors.map((e) => e.code)).toContain(FormulaErrorCodes.LIST_TOO_LARGE);
    });
  });

  it('scans pathological markup in linear time', async () => {
    expect(await html(`${'<a "'.repeat(20_000)}>after`)).toBe('after');
    expect(await html('<a'.repeat(50_000))).toBe('<a'.repeat(50_000));
    expect(await html(`<p title="${'x'.repeat(100_000)}`)).toBe(`<p title="${'x'.repeat(100_000)}`);
    expect(await markdown(`${'['.repeat(50_000)}]`)).toBe(`${'['.repeat(50_000)}]`);
    expect(await markdown('`a'.repeat(30_000))).toBe('a'.repeat(30_000));
    expect(await markdown('*a'.repeat(30_000))).toBe('a'.repeat(30_000));
  });

  describe('reference tables', () => {
    it('holds the 252 HTML 4 named references', () => {
      expect(HTML_NAMED_CHARACTER_REFERENCES.size).toBe(252);
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('nbsp')).toBe('\u00A0');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('yuml')).toBe('\u00FF');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('Yuml')).toBe('\u0178');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('auml')).toBe('ä');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('Omega')).toBe('\u03A9');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('diams')).toBe('\u2666');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('lang')).toBe('\u27E8');
      expect(HTML_NAMED_CHARACTER_REFERENCES.get('euro')).toBe('€');
    });

    it('maps the 27 assigned C1 numeric references to Windows-1252', () => {
      expect(WINDOWS_1252_NUMERIC_REFERENCES.size).toBe(27);
      expect(WINDOWS_1252_NUMERIC_REFERENCES.get(0x96)).toBe('–');
      expect(WINDOWS_1252_NUMERIC_REFERENCES.has(0x81)).toBe(false);
    });
  });

  it('declares exactly the formats and kinds the implementations accept', () => {
    const { registry } = createTestRuntime();
    const literalValuesOf = (signatureId: string, param: string) =>
      registry.getFunction(signatureId)?.params.find((p) => p.name === param)?.literalValues;

    expect(literalValuesOf(BuiltinSignatureIds.PLAIN_TEXT, 'format')).toStrictEqual([
      ...MARKUP_FORMATS,
    ]);
    expect(literalValuesOf(BuiltinSignatureIds.MARKDOWN_BLOCKS, 'kind')).toStrictEqual([
      ...MARKDOWN_BLOCK_KINDS,
    ]);
  });
});
