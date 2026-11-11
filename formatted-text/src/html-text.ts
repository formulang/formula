import { HTML_NAMED_CHARACTER_REFERENCES, WINDOWS_1252_NUMERIC_REFERENCES } from './html-entities';
import { plainLines, spaceWhitespace } from './text-lines';

/**
 * Elements whose content is dropped wherever they appear: `script` and `style` hold code, and
 * `title` names the document without being part of its text.
 */
const HIDDEN_CONTENT_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'title']);

/** Elements whose content is dropped inside `head`, where it is head content. */
const HEAD_HIDDEN_CONTENT_ELEMENTS: ReadonlySet<string> = new Set([
  'noframes',
  'noscript',
  'template',
]);

/** The end tag that closes each element whose content is dropped. */
const HIDDEN_CONTENT_END_TAGS: ReadonlyMap<string, RegExp> = new Map([
  ['script', /<\/script(?=[\t\n\f\r />])/gi],
  ['style', /<\/style(?=[\t\n\f\r />])/gi],
  ['title', /<\/title(?=[\t\n\f\r />])/gi],
  ['noframes', /<\/noframes(?=[\t\n\f\r />])/gi],
  ['noscript', /<\/noscript(?=[\t\n\f\r />])/gi],
  ['template', /<\/template(?=[\t\n\f\r />])/gi],
]);

/** The elements that live in `head`; a start tag of any other but `html` starts the body. */
const HEAD_ELEMENTS: ReadonlySet<string> = new Set([
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
]);

/** The end tags that start the body; every other end tag leaves the head state as it is. */
const HEAD_ENDING_END_TAGS: ReadonlySet<string> = new Set(['body', 'br', 'head', 'html']);

/** Elements whose opening and closing tags end a line. */
const LINE_ENDING_ELEMENTS: ReadonlySet<string> = new Set([
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
]);

const ASCII_LETTER = /^[A-Za-z]$/;
const ASCII_UPPER_CASE = /[A-Z]+/g;
const NOT_HTML_SPACE = /[^\t\n\f\r ]/;
/**
 * A numeric reference of one digit or more, leading zeros included; a named one of 2 to 32
 * characters, the longest HTML 4 name being 8.
 */
const CHARACTER_REFERENCE = /&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]{1,31}));/g;
const SOURCE_LINE_BREAK = /\r\n|\r|\n/g;
const REPLACEMENT_CHARACTER = '\uFFFD';

type HtmlTag = {
  /** The tag name, ASCII letters lower-cased. */
  name: string;
  closing: boolean;
  /** The index after the tag's `>`; -1 when the markup ends inside the tag. */
  end: number;
};

/** Where the scan stands relative to `head`: before it, inside it, or past it. */
type HeadState = 'before' | 'in' | 'after';

/** The states a tag is read in between its name and its `>`, named as in the HTML standard. */
type TagState =
  | 'before-attribute-name'
  | 'attribute-name'
  | 'after-attribute-name'
  | 'before-attribute-value'
  | 'double-quoted-value'
  | 'single-quoted-value'
  | 'unquoted-value'
  | 'after-quoted-value'
  | 'self-closing';

function isHtmlSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';
}

/**
 * The character a numeric reference names: U+FFFD for zero, a surrogate or a value past U+10FFFF
 * (`Infinity` for a run of digits too long for a number), the windows-1252 character for
 * 0x80-0x9F where that encoding has one, otherwise the code point.
 */
function fromNumericReference(code: number): string {
  const windows1252 = WINDOWS_1252_NUMERIC_REFERENCES.get(code);
  if (windows1252 !== undefined) return windows1252;
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(code);
}

/** Decodes numeric references and the HTML 4 named references; unknown names stay as written. */
function decodeCharacterReferences(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    CHARACTER_REFERENCE,
    (
      reference: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      if (decimal !== undefined) return fromNumericReference(Number.parseInt(decimal, 10));
      if (hex !== undefined) return fromNumericReference(Number.parseInt(hex, 16));
      return (
        (name === undefined ? undefined : HTML_NAMED_CHARACTER_REFERENCES.get(name)) ?? reference
      );
    },
  );
}

/**
 * The index after the `>` that ends a tag whose attributes start at `from`: a quote opens a value
 * only after an attribute name and `=`, spaces allowed around the `=`, a quoted value may hold
 * `>`, and a quote anywhere else is an ordinary character. -1 when the markup ends inside the
 * tag.
 */
function endOfTag(markup: string, from: number): number {
  let state: TagState = 'before-attribute-name';
  for (let index = from; index < markup.length; index += 1) {
    const char = markup.charAt(index);
    switch (state) {
      case 'double-quoted-value':
        if (char === '"') state = 'after-quoted-value';
        break;
      case 'single-quoted-value':
        if (char === "'") state = 'after-quoted-value';
        break;
      case 'unquoted-value':
        if (char === '>') return index + 1;
        if (isHtmlSpace(char)) state = 'before-attribute-name';
        break;
      case 'before-attribute-value':
        if (char === '>') return index + 1;
        if (char === '"') state = 'double-quoted-value';
        else if (char === "'") state = 'single-quoted-value';
        else if (!isHtmlSpace(char)) state = 'unquoted-value';
        break;
      default: {
        if (char === '>') return index + 1;
        const inName: boolean = state === 'attribute-name' || state === 'after-attribute-name';
        if (char === '/') {
          state = 'self-closing';
        } else if (char === '=' && inName) {
          state = 'before-attribute-value';
        } else if (isHtmlSpace(char)) {
          state = inName ? 'after-attribute-name' : 'before-attribute-name';
        } else {
          state = 'attribute-name';
        }
      }
    }
  }
  return -1;
}

/** Reads the tag whose name starts at `nameStart`: the name runs to whitespace, `/` or `>`. */
function readTag(markup: string, nameStart: number, closing: boolean): HtmlTag {
  let nameEnd = nameStart;
  while (nameEnd < markup.length) {
    const char = markup.charAt(nameEnd);
    if (char === '>' || char === '/' || isHtmlSpace(char)) break;
    nameEnd += 1;
  }
  const name = markup
    .slice(nameStart, nameEnd)
    .replace(ASCII_UPPER_CASE, (upper) => upper.toLowerCase());
  return { name, closing, end: endOfTag(markup, nameEnd) };
}

/**
 * The index after the comment whose text starts at `from` (after `<!--`): after the first `-->`
 * or `--!>`, at once for `<!-->` and `<!--->`, and at the end of the markup when none follows.
 */
function endOfComment(markup: string, from: number): number {
  if (markup.startsWith('>', from)) {
    return from + 1;
  }
  if (markup.startsWith('->', from)) {
    return from + 2;
  }
  for (let search = from; ;) {
    const dashes = markup.indexOf('--', search);
    if (dashes < 0) {
      return markup.length;
    }
    if (markup.startsWith('>', dashes + 2)) return dashes + 3;
    if (markup.startsWith('!>', dashes + 2)) return dashes + 4;
    search = dashes + 1;
  }
}

/**
 * The index after the `>` that ends a declaration (`<!DOCTYPE html>`), a processing instruction
 * (`<?xml ...?>`) or another bogus comment; the end of the markup when no `>` follows.
 */
function endOfBogusComment(markup: string, from: number): number {
  const close = markup.indexOf('>', from);
  const end = close < 0 ? markup.length : close + 1;
  return end;
}

/**
 * The head state after a start or end tag: `head` opens at `<head>` or at a start tag of an
 * element that lives in it, unless the body has started; the body starts at `</head>`,
 * `</body>`, `</html>`, `</br>` or a start tag of any other element but `html`.
 */
function headStateAfterTag(state: HeadState, tag: HtmlTag): HeadState {
  if (state === 'after') return state;
  if (tag.closing) return HEAD_ENDING_END_TAGS.has(tag.name) ? 'after' : state;
  if (tag.name === 'html') return state;
  return tag.name === 'head' || HEAD_ELEMENTS.has(tag.name) ? 'in' : 'after';
}

/**
 * The index after the end tag that closes the dropped element `name` whose content starts at
 * `from`; the end of the markup when no end tag follows.
 */
function endOfHiddenContent(markup: string, name: string, from: number): number {
  const endTag = HIDDEN_CONTENT_END_TAGS.get(name);
  if (endTag === undefined) return from;
  endTag.lastIndex = from;
  const found = endTag.exec(markup);
  if (found === null) {
    return markup.length;
  }
  const nameEnd = found.index + found[0].length;
  const end = endOfTag(markup, nameEnd);
  return end < 0 ? markup.length : end;
}

/**
 * The text of an HTML document, read in one forward pass: comments, other markup, the content of
 * `script`, `style` and `title`, and in the head that of `noscript`, `noframes` and `template`
 * dropped, the line-ending elements ending a line, every other tag removed, character references
 * decoded, whitespace collapsed within each line (inside `pre`, each line break, a decoded one
 * included, ends a line) and blank lines dropped. A tag, comment, other markup or dropped content
 * that the markup ends inside is dropped with the rest of the markup.
 */
export function htmlToPlainText(markup: string): string {
  const out: string[] = [];
  // How many `pre` elements are open: a line break ends a line inside any of them.
  let preDepth = 0;
  let head: HeadState = 'before';
  let index = 0;

  const appendText = (raw: string): void => {
    if (raw.length === 0) return;
    // Text other than whitespace cannot live in `head`: it starts the body.
    if (head !== 'after' && NOT_HTML_SPACE.test(raw)) head = 'after';
    const decoded = decodeCharacterReferences(raw);
    out.push(preDepth > 0 ? decoded.replace(SOURCE_LINE_BREAK, '\n') : spaceWhitespace(decoded));
  };

  while (index < markup.length) {
    const lt = markup.indexOf('<', index);
    const textEnd = lt < 0 ? markup.length : lt;
    appendText(markup.slice(index, textEnd));
    if (lt < 0) break;
    const next = markup.charAt(lt + 1);
    if (markup.startsWith('!--', lt + 1)) {
      index = endOfComment(markup, lt + 4);
      continue;
    }
    if (next === '!' || next === '?') {
      index = endOfBogusComment(markup, lt + 2);
      continue;
    }
    let tag: HtmlTag;
    if (next === '/') {
      const afterSlash = markup.charAt(lt + 2);
      if (afterSlash === '>') {
        // `</>` is dropped.
        index = lt + 3;
        continue;
      }
      if (afterSlash === '') {
        appendText('</');
        index = lt + 2;
        continue;
      }
      if (!ASCII_LETTER.test(afterSlash)) {
        index = endOfBogusComment(markup, lt + 2);
        continue;
      }
      tag = readTag(markup, lt + 2, true);
    } else if (ASCII_LETTER.test(next)) {
      tag = readTag(markup, lt + 1, false);
    } else {
      // A `<` that starts no tag is text.
      appendText('<');
      index = lt + 1;
      continue;
    }
    if (tag.end < 0) break;
    index = tag.end;
    head = headStateAfterTag(head, tag);
    const hidden =
      HIDDEN_CONTENT_ELEMENTS.has(tag.name) ||
      (head === 'in' && HEAD_HIDDEN_CONTENT_ELEMENTS.has(tag.name));
    if (!tag.closing && hidden) {
      index = endOfHiddenContent(markup, tag.name, tag.end);
      continue;
    }
    if (tag.name === 'pre') preDepth = tag.closing ? Math.max(0, preDepth - 1) : preDepth + 1;
    if (LINE_ENDING_ELEMENTS.has(tag.name)) out.push('\n');
  }
  return plainLines(out.join('').split('\n'));
}
