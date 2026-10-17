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

    it('ends head at </head> or where the body starts', async () => {
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

    it('ends head at </head>, </body>, </html> or </br>, and at no other end tag', async () => {
      for (const end of ['</head>', '</body>', '</html>', '</br>', '</HEAD>']) {
        expect(await html(`<head>${end}<noscript>N</noscript>`), end).toBe('N');
      }
      for (const end of ['</p>', '</div>', '</title>', '</noscript>']) {
        expect(await html(`<head>${end}<noscript>N</noscript>`), end).toBe('');
      }
    });

    it('starts the body at text written with anything but HTML whitespace', async () => {
      expect(await html('<head>text<noscript>N</noscript>')).toBe('textN');
      expect(await html('<head> \n\t\r\f<noscript>N</noscript>')).toBe('');
      expect(await html('<head>\u00A0<noscript>N</noscript>')).toBe('N');
      expect(await html('<head>&#32;<noscript>N</noscript>')).toBe('N');
      // Nor at an html start tag.
      expect(await html('<head><html><noscript>N</noscript>')).toBe('');
    });

    it('starts the body whether head opened or not, and opens no head after it', async () => {
      expect(await html('</body><noscript>N</noscript>')).toBe('N');
      expect(await html('</p><noscript>N</noscript>')).toBe('');
      expect(await html('x<head><noscript>N</noscript>')).toBe('xN');
      expect(await html('<p>x</p><meta><noscript>N</noscript>')).toBe('x\nN');
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
      // Nor at anything else inside it: a comment opener changes nothing.
      expect(await html('<script><!--<script></script>x--></script>shown')).toBe('x-->shown');
    });

    it.each([
      ['a space', ' '],
      ['a tab', '\t'],
      ['a line feed', '\n'],
      ['a carriage return', '\r'],
      ['a form feed', '\f'],
      ['a slash', '/'],
    ])('ends a tag name at %s', async (_name, after) => {
      expect(await html(`a<p${after}>b</p${after}>c`)).toBe('a\nb\nc');
    });

    it('opens a quoted value only after an attribute name and =, spaces allowed', async () => {
      expect(await html('<a title = "x>y">z</a>')).toBe('z');
      expect(await html("<a title= 'x>y'>z</a>")).toBe('z');
      expect(await html('<a ="x>y">z')).toBe('y">z');
      expect(await html('<a b=c>d>e')).toBe('d>e');
      // Inside an unquoted value a quote is an ordinary character.
      expect(await html('<a b=c"x>y">z')).toBe('y">z');
    });

    it('reads the ASCII letters of a tag name in either case, and folds no other letter', async () => {
      expect(await html('<head><LINK><noscript>N</noscript>')).toBe('');
      // U+212A KELVIN SIGN lower-cases to k, but a tag name folds ASCII letters only.
      expect(await html('<head><lin\u212A><noscript>N</noscript>')).toBe('N');
    });

    it('drops other markup up to the next >, and keeps any other < as text', async () => {
      expect(await html('a</1 b=">">c')).toBe('a">c');
      expect(await html('a</ b>c')).toBe('ac');
      expect(await html('a<!x>b<?y>c')).toBe('abc');
      expect(await html('a<1>b <+c')).toBe('a<1>b <+c');
      // A letter that is not ASCII starts no tag.
      expect(await html('a<\u00E9>b')).toBe('a<\u00E9>b');
    });

    it.each(['textarea', 'xmp', 'iframe', 'noembed', 'plaintext'])(
      'reads the content of <%s> as markup like any other',
      async (name) => {
        expect(await html(`a<${name}><b>x</b> &lt;y&gt;</${name}>z`)).toBe('ax <y>z');
      },
    );

    it('removes other tags and skips > inside quoted attributes', async () => {
      expect(await html('<p class="x">Hello <b>bold</b> <a title="a > b">link</a></p>')).toBe(
        'Hello bold link',
      );
      expect(await html('a < b and b > c')).toBe('a < b and b > c');
      expect(await html("<a title='a > b' href=x>link</a>")).toBe('link');
    });

    it('opens a quoted value only after =, and drops </> and each form of comment', async () => {
      expect(await html('<a title=">" x">link</a>')).toBe('link');
      expect(await html('<a " > b">text')).toBe('b">text');
      expect(await html('<a/b>c<br/>d')).toBe('c\nd');
      expect(await html('x </ y> z')).toBe('x z');
      expect(await html('a</>b')).toBe('ab');
      expect(await html('<!-->A<!--->B<!-- c --!>C')).toBe('ABC');
    });

    it('drops a tag, comment, other markup or dropped content the markup ends inside', async () => {
      expect(await evalOk('PLAIN_TEXT("Hello <b"; "html")')).toBe('Hello');
      expect(await html('<p>A</p><p title="x>B')).toBe('A');
      expect(await html('<p>A</p><script>if (a < b) {')).toBe('A');
      expect(await html('<p>A</p><!DOCTYPE')).toBe('A');
      expect(await html('a<?x b')).toBe('a');
      expect(await html('a</1 b')).toBe('a');
      expect(await html('a<!')).toBe('a');
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

    it('decodes a numeric reference of one digit or more to its character', async () => {
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
      // The no-break space is whitespace; inside pre, a line break a reference gives ends a line.
      expect(await html('a&nbsp;&nbsp; b')).toBe('a b');
      expect(await html('<pre>a&#13;b&#10;c</pre>')).toBe('a\nb\nc');
      expect(await html('<p>a&#13;b&#10;c</p>')).toBe('a b c');
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
      // At the end of a paragraph line, a backslash is a hard line break, and is dropped; at the
      // end of the paragraph's last line it is none, and stays.
      expect(await markdown('a\\\nb')).toBe('a b');
      expect(await markdown('a\\\nb\\')).toBe('a b\\');
      expect(await blocks('a\\', 'paragraph')).toStrictEqual(['a\\']);
    });

    it('pairs a run of backticks with the next run of as many', async () => {
      expect(await markdown('``a`b``')).toBe('a`b');
      expect(await markdown('`` `x` ``')).toBe('`x`');
      expect(await markdown('a ` b')).toBe('a ` b');
      // One space at each end is dropped when both ends have one and the span holds more.
      expect(await markdown('a`` b ``c')).toBe('abc');
      expect(await markdown('a`` b``c')).toBe('a bc');
      expect(await markdown('a`  `b')).toBe('a b');
      expect(await markdown('a``  b  ``c')).toBe('a b c');
    });

    it('removes a closing emphasis run with the nearest opening run of its character', async () => {
      // Whatever their lengths.
      expect(await markdown('*a** and __b_')).toBe('a and b');
      // The runs of the other character opened between the two pair no more.
      expect(await markdown('*a _b* c_')).toBe('a _b c_');
      // The nearest opening run, not the farthest.
      expect(await markdown('*a *b*')).toBe('*a b');
    });

    it('lets an underscore inside a word neither open nor close, as the flanking rules say', async () => {
      expect(await markdown('foo_bar_')).toBe('foo_bar_');
      expect(await markdown('_foo_bar')).toBe('_foo_bar');
      expect(await markdown('_foo_bar_')).toBe('foo_bar');
      // An asterisk inside a word can do both.
      expect(await markdown('foo*bar*')).toBe('foobar');
    });

    it('classifies emphasis runs by the characters on either side', async () => {
      // Whitespace after a run, or before it, keeps it from opening, or from closing.
      expect(await markdown('x * a* b *c *')).toBe('x * a* b *c *');
      expect(await markdown('*\u00A0a*')).toBe('* a*');
      // Punctuation after a run lets it open only after whitespace, punctuation or the start,
      // and in the mirror case close.
      expect(await markdown('*"a"*')).toBe('"a"');
      expect(await markdown('a*"b"*')).toBe('a*"b"*');
      expect(await markdown('"*"a"*"')).toBe('""a""');
      // After punctuation and before a letter, a run cannot close.
      expect(await markdown('*"a"*b')).toBe('*"a"*b');
      // Symbols count as punctuation.
      expect(await markdown('a*\u20ACb\u20AC*')).toBe('a*\u20ACb\u20AC*');
      // An underscore run that could open and close opens after punctuation, closes before it.
      expect(await markdown('"_"a_')).toBe('""a');
      expect(await markdown('_a"_"')).toBe('a""');
    });

    it('keeps each line of a fenced code block a line, and a backslash inside a code span', async () => {
      expect(await markdown('```\na\n  b c\n```\nafter')).toBe('a\nb c\nafter');
      expect(await markdown('a `\\*` b')).toBe('a \\* b');
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
      expect(await blocks('# x\t##\n# y\t#\t', 'heading')).toStrictEqual(['x', 'y']);
    });

    it('reads quote markers after at most three spaces, nested ones included', async () => {
      expect(await blocks('   > x', 'paragraph')).toStrictEqual(['x']);
      expect(await blocks('    > x', 'paragraph')).toStrictEqual(['> x']);
      expect(await blocks('>x', 'paragraph')).toStrictEqual(['x']);
      expect(await blocks('> > ## x', 'heading')).toStrictEqual(['x']);
      // One space after `>` belongs to the marker and the rest to the line: in a fence opened
      // with no indentation, the content keeps every space but that one.
      expect(await blocks('>```\n> a\n>  b\n>c\n>```', 'code')).toStrictEqual(['a\n b\nc']);
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
      // A tab before the fence counts as a space does; only leading spaces are removed.
      expect(await blocks(' \t```\n   a\n\tb\n```', 'code')).toStrictEqual([' a\n\tb']);
      expect(await blocks('```\na\n      ```   ', 'code')).toStrictEqual(['a']);
      expect(await blocks('> ```\n> code\n> ```', 'code')).toStrictEqual(['code']);
      // Tabs count as spaces or tabs around a closing fence.
      expect(await blocks('```\na\n```\t\nb', 'code')).toStrictEqual(['a']);
      expect(await blocks('```\na\n```\t\nb', 'paragraph')).toStrictEqual(['b']);
      expect(await blocks('```\na\n\t```\nb', 'code')).toStrictEqual(['a']);
      expect(await blocks('```\na\n\t```\nb', 'paragraph')).toStrictEqual(['b']);
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
      // A list item, a fence or a thematic break ends it too.
      expect(await blocks('| a |\n|---|\n- item', 'table-row')).toStrictEqual(['a']);
      expect(await blocks('| a |\n|---|\n- item', 'list-item')).toStrictEqual(['item']);
      expect(await blocks('| a |\n|---|\n```\ncode\n```', 'table-row')).toStrictEqual(['a']);
      expect(await blocks('| a |\n|---|\n```\ncode\n```', 'code')).toStrictEqual(['code']);
      expect(await blocks('| a |\n|---|\n---\nb', 'table-row')).toStrictEqual(['a']);
      expect(await blocks('| a |\n|---|\n---\nb', 'paragraph')).toStrictEqual(['b']);
      // A table starts inside a paragraph too, and ends it.
      const inParagraph = 'intro\n| a | b |\n|---|---|\n| 1 | 2 |';
      expect(await blocks(inParagraph, 'table-row')).toStrictEqual(['a b', '1 2']);
      expect(await blocks(inParagraph, 'paragraph')).toStrictEqual(['intro']);
      // A row's empty cells are left out.
      expect(await blocks('| a |  | b |\n|---|---|---|', 'table-row')).toStrictEqual(['a b']);
      // `\|` is a pipe inside a cell, the last cell's included.
      expect(await blocks('| a \\| b | c \\|\n|---|---|', 'table-row')).toStrictEqual([
        'a | b c |',
      ]);
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

    /** Reads `name hex name hex ...` pairs into [name, character] entries. */
    const pairs = (table: string): Array<[string, string]> => {
      const words = table.trim().split(/\s+/u);
      return Array.from({ length: words.length / 2 }, (_, i) => [
        words[2 * i],
        String.fromCodePoint(Number.parseInt(words[2 * i + 1], 16)),
      ]);
    };
    /** What PLAIN_TEXT gives a character: whitespace collapses to one space. */
    const shown = (char: string) => (/\s/u.test(char) ? ' ' : char);

    it('decodes each of the 252 HTML 4 names to the character of the WHATWG table', async () => {
      // From the WHATWG named character reference table (as Python's html.entities.html5
      // holds it), for the names of HTML 4 (html.entities.name2codepoint).
      const expected = pairs(`
Aacute C1 aacute E1 Acirc C2 acirc E2 acute B4 AElig C6 aelig E6 Agrave C0 agrave E0
alefsym 2135 Alpha 391 alpha 3B1 amp 26 and 2227 ang 2220 Aring C5 aring E5 asymp 2248 Atilde C3
atilde E3 Auml C4 auml E4 bdquo 201E Beta 392 beta 3B2 brvbar A6 bull 2022 cap 2229 Ccedil C7
ccedil E7 cedil B8 cent A2 Chi 3A7 chi 3C7 circ 2C6 clubs 2663 cong 2245 copy A9 crarr 21B5
cup 222A curren A4 Dagger 2021 dagger 2020 dArr 21D3 darr 2193 deg B0 Delta 394 delta 3B4
diams 2666 divide F7 Eacute C9 eacute E9 Ecirc CA ecirc EA Egrave C8 egrave E8 empty 2205
emsp 2003 ensp 2002 Epsilon 395 epsilon 3B5 equiv 2261 Eta 397 eta 3B7 ETH D0 eth F0 Euml CB
euml EB euro 20AC exist 2203 fnof 192 forall 2200 frac12 BD frac14 BC frac34 BE frasl 2044
Gamma 393 gamma 3B3 ge 2265 gt 3E hArr 21D4 harr 2194 hearts 2665 hellip 2026 Iacute CD
iacute ED Icirc CE icirc EE iexcl A1 Igrave CC igrave EC image 2111 infin 221E int 222B Iota 399
iota 3B9 iquest BF isin 2208 Iuml CF iuml EF Kappa 39A kappa 3BA Lambda 39B lambda 3BB lang 27E8
laquo AB lArr 21D0 larr 2190 lceil 2308 ldquo 201C le 2264 lfloor 230A lowast 2217 loz 25CA
lrm 200E lsaquo 2039 lsquo 2018 lt 3C macr AF mdash 2014 micro B5 middot B7 minus 2212 Mu 39C
mu 3BC nabla 2207 nbsp A0 ndash 2013 ne 2260 ni 220B not AC notin 2209 nsub 2284 Ntilde D1
ntilde F1 Nu 39D nu 3BD Oacute D3 oacute F3 Ocirc D4 ocirc F4 OElig 152 oelig 153 Ograve D2
ograve F2 oline 203E Omega 3A9 omega 3C9 Omicron 39F omicron 3BF oplus 2295 or 2228 ordf AA
ordm BA Oslash D8 oslash F8 Otilde D5 otilde F5 otimes 2297 Ouml D6 ouml F6 para B6 part 2202
permil 2030 perp 22A5 Phi 3A6 phi 3C6 Pi 3A0 pi 3C0 piv 3D6 plusmn B1 pound A3 Prime 2033
prime 2032 prod 220F prop 221D Psi 3A8 psi 3C8 quot 22 radic 221A rang 27E9 raquo BB rArr 21D2
rarr 2192 rceil 2309 rdquo 201D real 211C reg AE rfloor 230B Rho 3A1 rho 3C1 rlm 200F
rsaquo 203A rsquo 2019 sbquo 201A Scaron 160 scaron 161 sdot 22C5 sect A7 shy AD Sigma 3A3
sigma 3C3 sigmaf 3C2 sim 223C spades 2660 sub 2282 sube 2286 sum 2211 sup 2283 sup1 B9 sup2 B2
sup3 B3 supe 2287 szlig DF Tau 3A4 tau 3C4 there4 2234 Theta 398 theta 3B8 thetasym 3D1
thinsp 2009 THORN DE thorn FE tilde 2DC times D7 trade 2122 Uacute DA uacute FA uArr 21D1
uarr 2191 Ucirc DB ucirc FB Ugrave D9 ugrave F9 uml A8 upsih 3D2 Upsilon 3A5 upsilon 3C5 Uuml DC
uuml FC weierp 2118 Xi 39E xi 3BE Yacute DD yacute FD yen A5 Yuml 178 yuml FF Zeta 396 zeta 3B6
zwj 200D zwnj 200C
`);
      expect(expected).toHaveLength(252);
      const decoded = (await html(
        `x|${expected.map(([name]) => `&${name};`).join('|')}|x`,
      )) as string;
      expect(decoded.split('|').slice(1, -1)).toStrictEqual(
        expected.map(([, char]) => shown(char)),
      );
      // Names are case-sensitive: an upper-case spelling HTML 4 does not list stays as written.
      expect(await html('&AMP; &Amp; &LT;')).toBe('&AMP; &Amp; &LT;');
    });

    it('decodes each numeric reference from 128 to 159 as the WHATWG table maps it', async () => {
      // As Python's html.unescape gives &#n;, which follows the WHATWG remapping table.
      const expected = pairs(`
80 20AC 81 81 82 201A 83 192 84 201E 85 2026 86 2020 87 2021 88 2C6 89 2030 8A 160 8B 2039
8C 152 8D 8D 8E 17D 8F 8F 90 90 91 2018 92 2019 93 201C 94 201D 95 2022 96 2013 97 2014 98 2DC
99 2122 9A 161 9B 203A 9C 153 9D 9D 9E 17E 9F 178
`);
      expect(expected).toHaveLength(32);
      const markup = expected.map(([hex]) => `&#${Number.parseInt(hex, 16)};`).join('|');
      const decoded = (await html(`x|${markup}|x`)) as string;
      expect(decoded.split('|').slice(1, -1)).toStrictEqual(
        expected.map(([, char]) => shown(char)),
      );
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
