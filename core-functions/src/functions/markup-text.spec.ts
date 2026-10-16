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

    it('ends head at </head> or where the body starts, as HTML does', async () => {
      const head =
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Angebot</title>';
      const body = '<body><h1>Hallo</h1><p>Text</p>';
      // With and without the optional end tag.
      expect(await html(`${head}</head>${body}`)).toBe('Hallo\nText');
      expect(await html(`${head}${body}`)).toBe('Hallo\nText');
      // Without `head` and `body` tags, the title is head content all the same.
      expect(await html('<title>Angebot</title><h1>Hallo</h1>')).toBe('Hallo');
      // An element that cannot live in head, or text, starts the body.
      expect(await html('<head><meta charset="utf-8"><p>Erster Absatz')).toBe('Erster Absatz');
      expect(await html('<head><title>T</title>Gleich Text</head><p>Mehr</p>')).toBe(
        'Gleich Text\nMehr',
      );
      // Inside head, noscript and template content is head content too.
      expect(
        await html(
          '<head><script>x()</script><noscript>Bitte JavaScript</noscript><template><p>T</p></template></head><body>Hallo',
        ),
      ).toBe('Hallo');
      // In the body, noscript keeps its text; a title (here an SVG title) never shows.
      expect(
        await html(
          '<body><noscript>Ohne JavaScript</noscript> <svg><title>Icon</title></svg> Text',
        ),
      ).toBe('Ohne JavaScript Text');
    });

    it.each([
      'base',
      'basefont',
      'bgsound',
      'link',
      'meta',
      'noframes',
      'noscript',
      'script',
      'style',
      'template',
      'title',
    ])('keeps head open at <%s>, which can live in head', async (name) => {
      // The noscript after it is head content only while head is open.
      expect(await html(`<head><${name}></${name}><noscript>N</noscript></head><p>Body`)).toBe(
        'Body',
      );
    });

    it('starts the body at an element that cannot live in head', async () => {
      for (const name of ['span', 'p', 'div', 'img']) {
        expect(
          await html(`<head><${name}></${name}><noscript>N</noscript></head><p>Body`),
          name,
        ).toBe('N\nBody');
      }
    });

    it.each([
      'address',
      'article',
      'aside',
      'blockquote',
      'br',
      'dd',
      'div',
      'dl',
      'dt',
      'figcaption',
      'figure',
      'footer',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'header',
      'hr',
      'li',
      'main',
      'nav',
      'ol',
      'p',
      'pre',
      'section',
      'table',
      'td',
      'th',
      'tr',
      'ul',
    ])('ends a line where <%s> opens and where it closes', async (name) => {
      expect(await html(`a<${name}>b</${name}>c`)).toBe('a\nb\nc');
    });

    it('removes every other tag without ending a line', async () => {
      for (const name of ['span', 'em', 'a', 'b', 'code', 'label', 'small']) {
        expect(await html(`a<${name}>b</${name}>c`), name).toBe('abc');
      }
    });

    it.each([
      ['a space', ' '],
      ['a tab', '\t'],
      ['a line feed', '\n'],
      ['a carriage return', '\r'],
      ['a form feed', '\f'],
      ['a slash', '/'],
      ['the closing >', ''],
    ])('ends the content of a dropped element at its end tag followed by %s', async (_n, after) => {
      for (const name of ['script', 'style', 'title']) {
        expect(await html(`<${name}>hidden</${name}${after}>shown`), name).toBe('shown');
      }
      for (const name of ['noframes', 'noscript', 'template']) {
        expect(await html(`<head><${name}>hidden</${name}${after}>shown`), name).toBe('shown');
      }
    });

    it('does not end dropped content at an end tag with a longer name', async () => {
      expect(await html('<script>hidden</scripts>still hidden')).toBe('');
      expect(await html('<style>hidden</style-x>still hidden</style>shown')).toBe('shown');
    });

    it('removes other tags and skips > inside quoted attributes', async () => {
      expect(await html('<p class="x">Hello <b>bold</b> <a title="a > b">link</a></p>')).toBe(
        'Hello bold link',
      );
      expect(await html('a < b and b > c')).toBe('a < b and b > c');
      expect(await html("<a title='a > b' href=x>link</a>")).toBe('link');
    });

    it('reads tags as the HTML tokenizer does: a quote opens a value only after =', async () => {
      expect(await html('<a title=">" x">link</a>')).toBe('link');
      expect(await html('<a " > b">text')).toBe('b">text');
      expect(await html('<a/b>c<br/>d')).toBe('c\nd');
      expect(await html('x </ y> z')).toBe('x z');
      expect(await html('a</>b')).toBe('ab');
      expect(await html('<!-->A<!--->B<!-- c --!>C')).toBe('ABC');
    });

    it('drops a tag, comment or dropped element that the markup ends inside', async () => {
      expect(await evalOk('PLAIN_TEXT("Hello <b"; "html")')).toBe('Hello');
      expect(await html('<p>A</p><p title="x>B')).toBe('A');
      expect(await html('<p>A</p><script>if (a < b) {')).toBe('A');
      expect(await html('<p>A</p><!DOCTYPE')).toBe('A');
      // A `<` or `</` at the very end starts no tag.
      expect(await html('a<')).toBe('a<');
      expect(await html('a</')).toBe('a</');
    });

    it('decodes numeric and named character references', async () => {
      expect(await html('M&auml;rz &#252;ber &#xFC;ber')).toBe('März über über');
      expect(await html('&lt;p&gt; is a tag')).toBe('<p> is a tag');
      expect(await html('a&#150;b &#8212; &euro;')).toBe('a–b — €');
      expect(await html('x&#0;y')).toBe('x\uFFFDy');
      expect(await html('&unknown; &amp')).toBe('&unknown; &amp');
      expect(await html('&lang;&thetasym;')).toBe('\u27E8\u03D1');
    });

    it('decodes a numeric reference as the HTML tokenizer does', async () => {
      // Any number of digits, leading zeros included.
      expect(await html('&#00000065;&#x0000041;&#X41;&#1114111;')).toBe('AAA\u{10FFFF}');
      // Zero, a surrogate and a value past U+10FFFF are U+FFFD, however many digits it takes.
      for (const reference of [
        '&#0;',
        '&#x0000;',
        '&#55296;',
        '&#xDFFF;',
        '&#1114112;',
        '&#x110000;',
        '&#11141110;',
        '&#x1100000;',
        `&#${'9'.repeat(400)};`,
        `&#x${'F'.repeat(400)};`,
      ]) {
        expect(await html(`[${reference}]`), reference.slice(0, 16)).toBe('[\uFFFD]');
      }
      // 128 to 159 are the windows-1252 characters, where that encoding has one.
      expect(await html('&#128;&#x82;&#150;&#x9F;')).toBe('\u20AC\u201A\u2013\u0178');
      expect(await html('[&#x81;&#141;]')).toBe('[\u0081\u008D]');
      // A reference needs its closing semicolon and at least one digit.
      expect(await html('&#65 &#x41 &#x; &#;')).toBe('&#65 &#x41 &#x; &#;');
    });

    it('collapses whitespace within lines, keeps pre line breaks and drops blank lines', async () => {
      expect(await html('<p>one\n   two</p>\n\n<p>  </p><div>three</div>')).toBe('one two\nthree');
      expect(await html('<pre>line 1\n  line 2</pre>')).toBe('line 1\nline 2');
      expect(await html('<pre>a\r\nb\rc</pre>')).toBe('a\nb\nc');
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

    it('removes a backslash before ASCII punctuation and keeps it before anything else', async () => {
      const punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
      expect(await markdown([...punctuation].map((char) => `\\${char}`).join(' '))).toBe(
        [...punctuation].join(' '),
      );
      expect(await markdown('C:\\Users\\a1 \\ä')).toBe('C:\\Users\\a1 \\ä');
      // At the end of a paragraph line, a backslash is a hard line break, and is dropped.
      expect(await markdown('a\\\nb')).toBe('a b');
    });

    it('pairs a run of backticks with the next run of as many', async () => {
      expect(await markdown('``a`b``')).toBe('a`b');
      expect(await markdown('`` `x` ``')).toBe('`x`');
      expect(await markdown('a ` b')).toBe('a ` b');
    });

    it('removes a closing emphasis run with the nearest opening run of its character', async () => {
      // Whatever their lengths.
      expect(await markdown('*a** and __b_')).toBe('a and b');
      // The runs of the other character opened between the two pair no more.
      expect(await markdown('*a _b* c_')).toBe('a _b c_');
    });

    it('reads links with one level of nested brackets and parentheses, within bounds', async () => {
      expect(await markdown('[see [the docs] here](https://x)')).toBe('see [the docs] here');
      expect(await markdown('[a](https://x/(1)) b')).toBe('a b');
      expect(await markdown('[a](u "title")')).toBe('a');
      // Only inline links: a reference link and its definition stay as written.
      expect(await markdown('[text][ref]\n\n[ref]: https://x')).toBe(
        '[text][ref]\n[ref]: https://x',
      );
      // A backslash-escaped bracket is a bracket all the same: this is no link.
      expect(await markdown('[a\\]b](u)')).toBe('[a]b](u)');
      const a = (count: number) => 'a'.repeat(count);
      const linked: Array<[string, string]> = [
        [`[${a(1_000)}](u)`, a(1_000)],
        [`[x [${a(500)}] y](u)`, `x [${a(500)}] y`],
        [`[a](${a(2_000)})`, 'a'],
        [`[a](u(${a(500)}))`, 'a'],
      ];
      for (const [source, text] of linked) {
        expect(await markdown(source), source.slice(0, 12)).toBe(text);
      }
      for (const source of [
        `[${a(1_001)}](u)`,
        `[x [${a(501)}] y](u)`,
        `[a](${a(2_001)})`,
        `[a](u(${a(501)}))`,
      ]) {
        expect(await markdown(source), source.slice(0, 12)).toBe(source);
      }
    });

    it('reads autolinks with a scheme of 2 to 32 characters, and email autolinks', async () => {
      expect(await markdown('<ab:c> <a1+.-:x> <name@host.de>')).toBe('ab:c a1+.-:x name@host.de');
      expect(await markdown('<a:b> <1b:c> <ab:c d> <a@b@c>')).toBe('<a:b> <1b:c> <ab:c d> <a@b@c>');
      const scheme = 'a'.repeat(32);
      expect(await markdown(`<${scheme}:x>`)).toBe(`${scheme}:x`);
      expect(await markdown(`<${scheme}a:x>`)).toBe(`<${scheme}a:x>`);
      const rest = 'x'.repeat(2_000);
      expect(await markdown(`<ab:${rest}>`)).toBe(`ab:${rest}`);
      expect(await markdown(`<ab:${rest}x>`)).toBe(`<ab:${rest}x>`);
      const side = 'a'.repeat(256);
      expect(await markdown(`<${side}@${side}>`)).toBe(`${side}@${side}`);
      expect(await markdown(`<${side}a@b>`)).toBe(`<${side}a@b>`);
      expect(await markdown(`<b@${side}a>`)).toBe(`<b@${side}a>`);
    });

    it('keeps HTML tags and character references as written', async () => {
      expect(await markdown('<b>x</b> <br> A &amp; B &#65;')).toBe('<b>x</b> <br> A &amp; B &#65;');
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

    it('drops a bare list marker; only an item with text, ordered from 1, interrupts a paragraph', async () => {
      expect(await blocks('-\n- a\n1.', 'list-item')).toStrictEqual(['a']);
      expect(await blocks('Sie sparen ab\n2025. weniger', 'paragraph')).toStrictEqual([
        'Sie sparen ab 2025. weniger',
      ]);
      expect(await blocks('Sie sparen ab\n2025. weniger', 'list-item')).toStrictEqual([]);
      expect(await blocks('Text\n-\nmehr', 'paragraph')).toStrictEqual(['Text - mehr']);
      expect(await blocks('Text\n1. eins\n2. zwei', 'list-item')).toStrictEqual(['eins', 'zwei']);
      expect(await blocks('Text\n- a', 'list-item')).toStrictEqual(['a']);
      // Outside a paragraph an ordered item may start at any number.
      expect(await blocks('# Kapitel\n2025. Jahr', 'list-item')).toStrictEqual(['Jahr']);
    });

    it('needs a delimiter row to recognise a table', async () => {
      expect(await blocks('a | b\nc | d', 'table-row')).toStrictEqual([]);
      expect(await blocks('a | b\nc | d', 'paragraph')).toStrictEqual(['a | b c | d']);
    });

    it('reads ATX headings of one to six #s after at most three spaces', async () => {
      const levels = '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n####### 7';
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(await blocks(levels, `heading-${level}`)).toStrictEqual([String(level)]);
      }
      expect(await blocks(levels, 'heading')).toStrictEqual(['1', '2', '3', '4', '5', '6']);
      expect(await blocks(levels, 'paragraph')).toStrictEqual(['####### 7']);
      // A space, a tab or the end of the line follows the #s; # alone is an empty heading.
      expect(await blocks('#x\n\n#\tx\n\n#', 'heading')).toStrictEqual(['x', '']);
      expect(await blocks('#x\n\n#\tx\n\n#', 'paragraph')).toStrictEqual(['#x']);
      expect(await blocks('   # x', 'heading')).toStrictEqual(['x']);
      expect(await blocks('    # x', 'heading')).toStrictEqual([]);
      expect(await blocks('    # x', 'paragraph')).toStrictEqual(['# x']);
      // A closing run of #s counts only after a space or a tab.
      expect(await blocks('# C#\n# x ##\n### ###\n# x \\#', 'heading')).toStrictEqual([
        'C#',
        'x',
        '',
        'x #',
      ]);
    });

    it('reads quote markers after at most three spaces, nested ones included', async () => {
      expect(await blocks('   > x', 'paragraph')).toStrictEqual(['x']);
      expect(await blocks('    > x', 'paragraph')).toStrictEqual(['> x']);
      expect(await blocks('>x', 'paragraph')).toStrictEqual(['x']);
      expect(await blocks('> > ## x', 'heading')).toStrictEqual(['x']);
      // One space after `>` belongs to the marker; the rest to the line.
      expect(await blocks('> ```\n>   code\n> ```', 'code')).toStrictEqual(['  code']);
    });

    it('reads a fence of three or more backticks or tildes, closed by as many of the same', async () => {
      expect(await blocks('``\ncode\n``', 'code')).toStrictEqual([]);
      expect(await blocks('``\ncode\n``', 'paragraph')).toStrictEqual(['code']);
      expect(await blocks('````\na\n```\nb\n````', 'code')).toStrictEqual(['a\n```\nb']);
      expect(await blocks('```\na\n~~~\n```', 'code')).toStrictEqual(['a\n~~~']);
      expect(await blocks('```\na\n``` x\n```', 'code')).toStrictEqual(['a\n``` x']);
      // A backtick fence's info string holds no backtick; a tilde fence's may.
      expect(await blocks('```a`b', 'code')).toStrictEqual([]);
      expect(await blocks('```a`b', 'paragraph')).toStrictEqual(['```a`b']);
      expect(await blocks('~~~ a`b\nx\n~~~', 'code')).toStrictEqual(['x']);
      // At any indentation; the content lines lose up to as many spaces as the fence is indented.
      expect(await blocks('    ```\n    a\n      b\n    ```', 'code')).toStrictEqual(['a\n  b']);
      expect(await blocks('```\na\n      ```   ', 'code')).toStrictEqual(['a']);
      expect(await blocks('> ```\n> code\n> ```', 'code')).toStrictEqual(['code']);
    });

    it('reads a thematic break of three or more of one marker, which yields no block', async () => {
      for (const line of ['---', '***', '___', ' - - -', '   *\t* *']) {
        expect(await blocks(`a\n${line}\nb`, 'paragraph'), line).toStrictEqual(['a', 'b']);
      }
      for (const line of ['--', '**', '-*-', '    ---']) {
        expect(await blocks(`a\n${line}\nb`, 'paragraph'), line).toStrictEqual([
          `a ${line.trim()} b`,
        ]);
      }
      expect(await blocks('* * *', 'list-item')).toStrictEqual([]);
      // No setext headings: an underline is paragraph text or a thematic break.
      expect(await blocks('Title\n===\nT2\n---', 'heading')).toStrictEqual([]);
      expect(await blocks('Title\n===\nT2\n---', 'paragraph')).toStrictEqual(['Title === T2']);
    });

    it('reads a list marker of a bullet or one to nine digits, then a space, a tab or nothing', async () => {
      expect(await blocks('123456789. x', 'list-item')).toStrictEqual(['x']);
      expect(await blocks('1234567890. x', 'list-item')).toStrictEqual([]);
      expect(await blocks('1234567890. x', 'paragraph')).toStrictEqual(['1234567890. x']);
      expect(await blocks('-x\n\n1.x\n\n+ y\n\n*\tz\n\n1) w', 'list-item')).toStrictEqual([
        'y',
        'z',
        'w',
      ]);
      expect(await blocks('-x\n\n1.x', 'paragraph')).toStrictEqual(['-x', '1.x']);
      expect(await blocks('        - deep', 'list-item')).toStrictEqual(['deep']);
      expect(await blocks('- a\n  continued\nlazy', 'list-item')).toStrictEqual([
        'a continued lazy',
      ]);
    });

    it('reads a table whose delimiter row has one cell of dashes per header cell', async () => {
      expect(await blocks('a | b\n:-- | --:', 'table-row')).toStrictEqual(['a b']);
      expect(await blocks('a | b\n: | -', 'table-row')).toStrictEqual([]);
      expect(await blocks('| a | b |\n|  | - |', 'table-row')).toStrictEqual([]);
      expect(await blocks('a | b\n--- | --- | ---', 'table-row')).toStrictEqual([]);
      expect(await blocks('| a |\n:-:', 'table-row')).toStrictEqual([]);
      expect(await blocks('| a |\n|:-:', 'table-row')).toStrictEqual(['a']);
      // Cells past the header's count are dropped; the table runs to a blank line or a block.
      expect(await blocks('| a |\n|---|\n| 1 | 2 |', 'table-row')).toStrictEqual(['a', '1']);
      expect(await blocks('| a |\n|---|\nplain\n\npara', 'table-row')).toStrictEqual([
        'a',
        'plain',
      ]);
      expect(await blocks('| a |\n|---|\n# h\nx', 'table-row')).toStrictEqual(['a']);
    });

    it('ends a line at a line feed, a carriage return or both, and reads no indented code', async () => {
      expect(await blocks('# a\r## b\r\n### c', 'heading')).toStrictEqual(['a', 'b', 'c']);
      expect(await blocks('# a\u2028## b', 'heading')).toStrictEqual(['a ## b']);
      expect(await blocks('    code', 'code')).toStrictEqual([]);
      expect(await blocks('    code', 'paragraph')).toStrictEqual(['code']);
    });

    it('follows the null convention, refuses an unknown kind and bounds the result', async () => {
      expect(await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: null })).toBe(null);
      expect(await evalOk('MARKDOWN_BLOCKS(""; "paragraph")')).toStrictEqual([]);
      expect(await errorCodes('MARKDOWN_BLOCKS("x"; "heading-7")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(await errorCodes('EACH(LIST("a"); "PLAIN_TEXT"; "htm")')).toStrictEqual([
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

  describe('inputs built against the scans', () => {
    // Markup shaped against each scan: quotes, comments and tags the markup ends inside, runs of
    // emphasis delimiters and backticks, nested markers, and space and backtick runs before a
    // line separator. Each gives the text below.
    type HardInput = {
      build: (size: number) => string;
      text: (size: number) => string;
      size: number;
    };

    /** The kinds of block a markdown input can be, each with its own selection. */
    const MARKDOWN_KINDS = ['paragraph', 'heading', 'list-item', 'table-row', 'code'] as const;
    type MarkdownKind = (typeof MARKDOWN_KINDS)[number];

    const backtickRuns = (lengths: readonly number[]) =>
      lengths.map((length) => `${'`'.repeat(length)} x `).join('');
    const rising = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

    const htmlInputs: Record<string, HardInput> = {
      'a quoted > after each tag name': {
        build: (m) => '<a ">"'.repeat(m),
        text: (m) => '"'.repeat(m),
        size: 1_000,
      },
      'unterminated double-quoted values': {
        build: (m) => '<a title="x'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'unterminated single-quoted values': {
        build: (m) => "<a title='x".repeat(m),
        text: () => '',
        size: 1_000,
      },
      'one unterminated quoted value': {
        build: (m) => `<p title="${'x'.repeat(m)}`,
        text: () => '',
        size: 10_000,
      },
      'tags without >': {
        build: (m) => '<a'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'quoted values holding >': {
        build: (m) => '<a b=">">x'.repeat(m),
        text: (m) => 'x'.repeat(m),
        size: 1_000,
      },
      'unterminated comments': {
        build: (m) => '<!-- x --'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'declarations without >': {
        build: (m) => '<!x'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'end tags with unterminated values': {
        build: (m) => '</a b="'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'script without its end tag': {
        build: (m) => '<script>'.repeat(m),
        text: () => '',
        size: 1_000,
      },
      'near-miss script end tags': {
        build: (m) => `<script>${'</scriptx'.repeat(m)}`,
        text: () => '',
        size: 1_000,
      },
      'a < that starts no tag': {
        build: (m) => 'a < b '.repeat(m),
        text: (m) => 'a < b '.repeat(m).trim(),
        size: 1_000,
      },
    };

    // Each markdown input is one block, of `kind`, whose text is the one PLAIN_TEXT gives.
    const markdownInputs: Record<string, HardInput & { kind: MarkdownKind }> = {
      'emphasis openers without closers': {
        kind: 'paragraph',
        build: (k) => '_a '.repeat(k) + 'a* '.repeat(k),
        text: (k) => ('_a '.repeat(k) + 'a* '.repeat(k)).trim(),
        size: 2_000,
      },
      'unmatched openers of both markers': {
        kind: 'paragraph',
        build: (k) => '*a _a '.repeat(k),
        text: (k) => '*a _a '.repeat(k).trim(),
        size: 2_000,
      },
      'emphasis pairs': {
        kind: 'paragraph',
        build: (k) => '*a* _b_ '.repeat(k),
        text: (k) => 'a b '.repeat(k).trim(),
        size: 2_000,
      },
      'backtick runs of rising lengths': {
        kind: 'paragraph',
        build: (k) => backtickRuns(rising(k)),
        text: (k) => backtickRuns(rising(k)).trim(),
        size: 100,
      },
      'backtick runs of falling lengths': {
        kind: 'paragraph',
        build: (k) => backtickRuns(rising(k).reverse()),
        text: (k) => backtickRuns(rising(k).reverse()).trim(),
        size: 100,
      },
      'unclosed brackets': {
        kind: 'paragraph',
        build: (k) => `${'['.repeat(k)}]`,
        text: (k) => `${'['.repeat(k)}]`,
        size: 10_000,
      },
      'nested quote markers': {
        kind: 'paragraph',
        build: (k) => `${'>'.repeat(k)} x`,
        text: () => 'x',
        size: 10_000,
      },
      'closing hashes after a space run': {
        kind: 'heading',
        build: (k) => `# a${' '.repeat(k)}b ##`,
        text: () => 'a b',
        size: 10_000,
      },
      'many short lines': {
        kind: 'paragraph',
        build: (k) => 'a\n'.repeat(k),
        text: (k) => 'a '.repeat(k).trim(),
        size: 10_000,
      },
      'a space run inside a heading': {
        kind: 'heading',
        build: (k) => `# a${' '.repeat(k)}b`,
        text: () => 'a b',
        size: 10_000,
      },
      'a space run before a line separator in a heading': {
        kind: 'heading',
        build: (k) => `# Title${' '.repeat(k)}\u2028more`,
        text: () => 'Title more',
        size: 10_000,
      },
      'a space run after a list marker before a line separator': {
        kind: 'list-item',
        build: (k) => `-${' '.repeat(k)}\u2028item`,
        text: () => 'item',
        size: 10_000,
      },
      'a backtick run before a line separator': {
        kind: 'code',
        build: (k) => `${'`'.repeat(k)}\u2028`,
        text: () => '',
        size: 10_000,
      },
    };

    it.each(Object.entries(htmlInputs))('reads HTML with %s', async (_name, input) => {
      expect(await html(input.build(input.size))).toBe(input.text(input.size));
    });

    it.each(Object.entries(markdownInputs))('reads markdown with %s', async (_name, input) => {
      const value = input.build(input.size);
      expect(await markdown(value)).toBe(input.text(input.size));
      // MARKDOWN_BLOCKS reads the same input: the one block of its kind, and none of another.
      for (const kind of MARKDOWN_KINDS) {
        expect(await blocks(value, kind), kind).toStrictEqual(
          kind === input.kind ? [input.text(input.size)] : [],
        );
      }
    });
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
