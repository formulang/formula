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
