import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaNodeOutput,
} from '@formulang/definitions';
import { makeOkList, makeOkText } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { boundedListResult, readRequiredMode, readText, textCost } from './argument-readers';
import { characterAt, characterBefore } from './helpers';
import { HTML_NAMED_CHARACTER_REFERENCES, WINDOWS_1252_NUMERIC_REFERENCES } from './html-entities';

/** The markup `PLAIN_TEXT` reads. */
export type MarkupFormat = 'html' | 'markdown';

/** The block kinds `MARKDOWN_BLOCKS` selects. */
export type MarkdownBlockKind =
  | 'heading'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'list-item'
  | 'table-row'
  | 'paragraph'
  | 'code';

/** The `format` literals of `PLAIN_TEXT`. */
export const MARKUP_FORMATS: readonly MarkupFormat[] = ['html', 'markdown'];

/** The `kind` literals of `MARKDOWN_BLOCKS`. */
export const MARKDOWN_BLOCK_KINDS: readonly MarkdownBlockKind[] = [
  'heading',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'list-item',
  'table-row',
  'paragraph',
  'code',
];

const WHITESPACE_RUN = /\s+/gu;

function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim();
}

/** Non-blank lines, each with its whitespace collapsed, joined by `\n`. */
function plainLines(lines: Iterable<string>): string {
  const out: string[] = [];
  for (const line of lines) {
    const collapsed = collapseWhitespace(line);
    if (collapsed.length > 0) out.push(collapsed);
  }
  return out.join('\n');
}

// HTML

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

/** The elements that live in `head`; any other start tag, and any text, starts the body. */
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

/** The end tags that end `head`; HTML ignores every other end tag there. */
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
const CHARACTER_REFERENCE =
  /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;
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

/** The states of the HTML tokenizer between a tag's name and its `>`. */
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
 * The index after the `>` that ends a tag whose attributes start at `from`, read with the HTML
 * tokenizer's attribute states: a quote opens a value only right after `=`, a quoted value may
 * hold `>`, and a quote anywhere else is an ordinary character. -1 when the markup ends inside
 * the tag.
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
 * The head state after a start or end tag, as HTML's insertion modes move it: `head` opens at
 * `<head>` or at the first element that lives in it, and ends at `</head>` or where the body
 * starts: at `<body>` or any other element that cannot live in `head`.
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
 * The text of an HTML document, read in one forward pass with the HTML tokenizer's rules for
 * tags, comments and declarations: comments and the content of `script`, `style`, `title` and
 * `head` dropped (`head` ends at `</head>` or where the body starts), the line-ending elements
 * ending a line, every other tag removed, character references decoded, whitespace collapsed
 * within each line (inside `pre`, each source line break ends a line) and blank lines dropped. A
 * tag, comment or dropped element that the markup ends inside is dropped with the rest of the
 * markup, as an HTML parser drops it.
 */
function htmlToPlainText(markup: string): string {
  const out: string[] = [];
  let inPre = false;
  let head: HeadState = 'before';
  let index = 0;

  const appendText = (raw: string): void => {
    if (raw.length === 0) return;
    // Text other than whitespace cannot live in `head`: it starts the body.
    if (head !== 'after' && NOT_HTML_SPACE.test(raw)) head = 'after';
    const decoded = decodeCharacterReferences(raw);
    out.push(
      inPre ? decoded.replace(SOURCE_LINE_BREAK, '\n') : decoded.replace(WHITESPACE_RUN, ' '),
    );
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
    if (tag.name === 'pre') inPre = !tag.closing;
    if (LINE_ENDING_ELEMENTS.has(tag.name)) out.push('\n');
  }
  return plainLines(out.join('').split('\n'));
}

// Markdown

type MarkdownBlock = {
  kind: 'heading' | 'list-item' | 'table-row' | 'paragraph' | 'code';
  /** The heading level; 0 for other blocks. */
  level: number;
  text: string;
};

type OpenFence = {
  marker: string;
  length: number;
  indent: number;
  quoteDepth: number;
  lines: string[];
};

// A line holds no CR or LF; `[\s\S]*` takes the rest of it, U+2028 and U+2029 included.
const MARKDOWN_LINE_BREAK = /\r\n|\r|\n/;
const QUOTE_MARKER = / {0,3}> ?/y;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*))?$/;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})([\s\S]*)/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A list marker: a bullet, or the start number of an ordered item (group 1); the text in group 2. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|([0-9]{1,9})[.)])(?:[ \t]+([\s\S]*))?$/;
const TABLE_DELIMITER_CELL = /^:?-+:?$/;

const ASCII_PUNCTUATION = /^[!-\/:-@[-`{-~]$/;
const UNICODE_WHITESPACE = /^\s$/u;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
/** `[text](destination)` or `![alt](destination)`; one level of nested brackets and parentheses. */
const INLINE_LINK =
  /!?\[((?:[^[\]\n]|\[[^[\]\n]{0,500}\]){0,1000})\]\((?:[^()\n]|\([^()\n]{0,500}\)){0,2000}\)/y;
/** `<scheme:...>` or `<name@host>`. */
const AUTOLINK =
  /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]{0,2000}|[^\s<>@]{1,256}@[^\s<>@]{1,256})>/y;

type DelimiterRun = {
  marker: '*' | '_';
  length: number;
  canOpen: boolean;
  canClose: boolean;
  matched: boolean;
  /** The run's position among the delimiter runs of its text. */
  order: number;
};

function endOfRun(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  let end = start;
  while (source.charCodeAt(end) === marker) end += 1;
  return end;
}

/** The emphasis delimiter run `[start, end)`, classified by the CommonMark flanking rules. */
function delimiterRun(
  source: string,
  start: number,
  end: number,
  marker: '*' | '_',
  order: number,
): DelimiterRun {
  const before = characterBefore(source, start);
  const after = characterAt(source, end);
  const spaceBefore = before === null || UNICODE_WHITESPACE.test(before);
  const spaceAfter = after === null || UNICODE_WHITESPACE.test(after);
  const punctuationBefore = before !== null && UNICODE_PUNCTUATION.test(before);
  const punctuationAfter = after !== null && UNICODE_PUNCTUATION.test(after);
  const leftFlanking = !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore);
  const rightFlanking = !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter);
  return {
    marker,
    length: end - start,
    canOpen: marker === '*' ? leftFlanking : leftFlanking && (!rightFlanking || punctuationBefore),
    canClose: marker === '*' ? rightFlanking : rightFlanking && (!leftFlanking || punctuationAfter),
    matched: false,
    order,
  };
}

/**
 * Pairs each closing delimiter run with the nearest open run of the same marker; the open runs
 * of the other marker between the two can then no longer pair. One stack per marker, so each run
 * is pushed and popped at most once.
 */
function pairDelimiterRuns(runs: readonly DelimiterRun[]): void {
  const open: Record<DelimiterRun['marker'], DelimiterRun[]> = { '*': [], _: [] };
  for (const run of runs) {
    const own = open[run.marker];
    const opener = run.canClose ? own.pop() : undefined;
    if (opener === undefined) {
      if (run.canOpen) own.push(run);
      continue;
    }
    opener.matched = true;
    run.matched = true;
    const other = open[run.marker === '*' ? '_' : '*'];
    while (other.length > 0 && other[other.length - 1].order > opener.order) {
      other.pop();
    }
  }
}

/**
 * The maximal backtick runs of a text by length, for finding the run that closes a code span:
 * one pass builds it, and one forward cursor per length answers, as the inline scan only moves
 * forward.
 */
class BacktickRuns {
  private readonly starts = new Map<number, number[]>();
  private readonly cursors = new Map<number, number>();

  constructor(source: string) {
    let at = source.indexOf('`');
    while (at >= 0) {
      const end = endOfRun(source, at);
      const starts = this.starts.get(end - at);
      if (starts === undefined) this.starts.set(end - at, [at]);
      else starts.push(at);
      at = source.indexOf('`', end);
    }
  }

  /** The start of the first run of exactly `length` backticks at or after `from`; -1 when none. */
  next(length: number, from: number): number {
    const starts = this.starts.get(length);
    if (starts === undefined) return -1;
    let cursor = this.cursors.get(length) ?? 0;
    while (cursor < starts.length && starts[cursor] < from) {
      cursor += 1;
    }
    this.cursors.set(length, cursor);
    return cursor < starts.length ? starts[cursor] : -1;
  }
}

/** Code span content: one surrounding space is stripped when both ends have one. */
function codeSpanContent(content: string): string {
  const padded = content.length >= 2 && content.startsWith(' ') && content.endsWith(' ');
  return padded && content.trim().length > 0 ? content.slice(1, -1) : content;
}

/**
 * Removes inline markdown: emphasis (`*`, `_`, `**`, `__`), code-span backticks, backslash
 * escapes, links and images (`[t](u)` to `t`, `![a](u)` to `a`) and autolinks (`<u>` to `u`).
 */
function stripInlineMarkdown(source: string): string {
  const pieces: Array<string | DelimiterRun> = [];
  const runs: DelimiterRun[] = [];
  let backtickRuns: BacktickRuns | null = null;
  let text = '';
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);
    if (char === '\\' && next.length > 0 && ASCII_PUNCTUATION.test(next)) {
      text += next;
      index += 2;
      continue;
    }
    if (char === '`') {
      const runEnd = endOfRun(source, index);
      const length = runEnd - index;
      if (backtickRuns === null) backtickRuns = new BacktickRuns(source);
      const close = backtickRuns.next(length, runEnd);
      if (close < 0) {
        text += source.slice(index, runEnd);
        index = runEnd;
      } else {
        text += codeSpanContent(source.slice(runEnd, close));
        index = close + length;
      }
      continue;
    }
    if (char === '[' || (char === '!' && next === '[')) {
      INLINE_LINK.lastIndex = index;
      const link = INLINE_LINK.exec(source);
      if (link !== null) {
        index += link[0].length;
        text += stripInlineMarkdown(link[1] ?? '');
        continue;
      }
    }
    if (char === '<') {
      AUTOLINK.lastIndex = index;
      const autolink = AUTOLINK.exec(source);
      if (autolink !== null) {
        index += autolink[0].length;
        text += autolink[1] ?? '';
        continue;
      }
    }
    if (char === '*' || char === '_') {
      const runEnd = endOfRun(source, index);
      if (text.length > 0) pieces.push(text);
      text = '';
      const run = delimiterRun(source, index, runEnd, char, runs.length);
      pieces.push(run);
      runs.push(run);
      index = runEnd;
      continue;
    }
    text += char;
    index += 1;
  }
  if (text.length > 0) pieces.push(text);
  pairDelimiterRuns(runs);
  return pieces
    .map((piece) =>
      typeof piece === 'string' ? piece : piece.matched ? '' : piece.marker.repeat(piece.length),
    )
    .join('');
}

/** Strips up to `maxDepth` blockquote markers (`>`) from the start of a line. */
function stripQuoteMarkers(
  line: string,
  maxDepth = Number.POSITIVE_INFINITY,
): { depth: number; content: string } {
  let start = 0;
  let depth = 0;
  while (depth < maxDepth) {
    QUOTE_MARKER.lastIndex = start;
    const marker = QUOTE_MARKER.exec(line);
    if (marker === null) break;
    start += marker[0].length;
    depth += 1;
  }
  return { depth, content: line.slice(start) };
}

/**
 * Heading content without its closing sequence: a final run of `#` that follows a space, a tab
 * or nothing, together with the spaces and tabs before it.
 */
function withoutClosingHashes(content: string): string {
  const trimmed = content.trimEnd();
  let hashes = trimmed.length;
  while (hashes > 0 && trimmed.charAt(hashes - 1) === '#') hashes -= 1;
  if (hashes === trimmed.length) return trimmed;
  let end = hashes;
  while (end > 0 && (trimmed.charAt(end - 1) === ' ' || trimmed.charAt(end - 1) === '\t')) {
    end -= 1;
  }
  return end === hashes && hashes > 0 ? trimmed : trimmed.slice(0, end);
}

function stripIndent(line: string, indent: number): string {
  let start = 0;
  while (start < indent && start < line.length && line.charAt(start) === ' ') start += 1;
  return line.slice(start);
}

/** The cells of a table row, trimmed; `\|` is a literal pipe inside a cell. */
function splitTableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < row.length; index += 1) {
    const char = row.charAt(index);
    if (char === '\\' && row.charAt(index + 1) === '|') {
      cell += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Paragraph lines joined by one space; a trailing backslash (a hard line break) is dropped. */
function joinLines(lines: readonly string[]): string {
  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      return index < lines.length - 1 && trimmed.endsWith('\\') ? trimmed.slice(0, -1) : trimmed;
    })
    .join(' ');
}

class MarkdownBlockReader {
  readonly blocks: MarkdownBlock[] = [];
  private paragraph: string[] = [];
  private listItem: string[] | null = null;
  private tableColumns = 0;

  closeOpenBlocks(): void {
    if (this.paragraph.length > 0) {
      this.blocks.push({
        kind: 'paragraph',
        level: 0,
        text: this.inlineText(joinLines(this.paragraph)),
      });
      this.paragraph = [];
    }
    if (this.listItem !== null) {
      const text = this.inlineText(joinLines(this.listItem));
      // A bare marker with no text is no item.
      if (text.length > 0) this.blocks.push({ kind: 'list-item', level: 0, text });
      this.listItem = null;
    }
    this.tableColumns = 0;
  }

  inParagraph(): boolean {
    return this.paragraph.length > 0;
  }

  addHeading(level: number, content: string): void {
    this.closeOpenBlocks();
    const text = this.inlineText(withoutClosingHashes(content));
    this.blocks.push({ kind: 'heading', level, text });
  }

  startListItem(text: string): void {
    this.closeOpenBlocks();
    this.listItem = [text];
  }

  addCode(lines: readonly string[]): void {
    this.closeOpenBlocks();
    this.blocks.push({ kind: 'code', level: 0, text: lines.join('\n') });
  }

  inTable(): boolean {
    return this.tableColumns > 0;
  }

  addTableRow(line: string): void {
    const cells = splitTableCells(line).slice(0, this.tableColumns);
    const text = cells
      .map((cell) => this.inlineText(cell))
      .filter((cell) => cell.length > 0)
      .join(' ');
    this.blocks.push({ kind: 'table-row', level: 0, text });
  }

  /** Opens a table when `line` is a header row and `next` its delimiter row. */
  startsTable(line: string, next: string): boolean {
    if (!line.includes('|') || !next.includes('|')) return false;
    const header = splitTableCells(line);
    const delimiter = splitTableCells(next);
    if (delimiter.length !== header.length) return false;
    if (!delimiter.every((cell) => TABLE_DELIMITER_CELL.test(cell))) return false;
    this.closeOpenBlocks();
    this.tableColumns = header.length;
    this.addTableRow(line);
    return true;
  }

  addText(line: string): void {
    if (this.listItem !== null) this.listItem.push(line);
    else this.paragraph.push(line);
  }

  private inlineText(source: string): string {
    return collapseWhitespace(stripInlineMarkdown(source));
  }
}

/**
 * The blocks of a markdown document, in order: a line-based CommonMark subset with ATX headings,
 * list items (nested items each count), GFM tables, paragraphs and fenced code. Blockquote
 * markers are transparent.
 */
function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.split(MARKDOWN_LINE_BREAK);
  const reader = new MarkdownBlockReader();
  let fence: OpenFence | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (fence !== null) {
      const content = stripQuoteMarkers(raw, fence.quoteDepth).content;
      const close = FENCE_CLOSE.exec(content);
      if (close !== null && close[1].startsWith(fence.marker) && close[1].length >= fence.length) {
        reader.addCode(fence.lines);
        fence = null;
      } else {
        fence.lines.push(stripIndent(content, fence.indent));
      }
      continue;
    }
    const { depth, content: line } = stripQuoteMarkers(raw);
    if (line.trim().length === 0) {
      reader.closeOpenBlocks();
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null && !(open[2].startsWith('`') && open[3].includes('`'))) {
      reader.closeOpenBlocks();
      fence = {
        marker: open[2].charAt(0),
        length: open[2].length,
        indent: open[1].length,
        quoteDepth: depth,
        lines: [],
      };
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      reader.closeOpenBlocks();
      continue;
    }
    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      reader.addHeading(heading[1].length, heading[2] ?? '');
      continue;
    }
    const listItem = LIST_ITEM.exec(line);
    // As in CommonMark, an item interrupts a paragraph only when it has text and, if ordered,
    // starts at 1: a wrapped line opening with "2025." or "3." continues the paragraph.
    const interrupts =
      listItem !== null &&
      (listItem[2] ?? '').trim().length > 0 &&
      (listItem[1] === undefined || Number(listItem[1]) === 1);
    if (listItem !== null && (interrupts || !reader.inParagraph())) {
      reader.startListItem(listItem[2] ?? '');
      continue;
    }
    if (reader.inTable()) {
      reader.addTableRow(line);
      continue;
    }
    const next = index + 1 < lines.length ? stripQuoteMarkers(lines[index + 1]).content : '';
    if (reader.startsTable(line, next)) {
      index += 1;
      continue;
    }
    reader.addText(line);
  }
  if (fence !== null) reader.addCode(fence.lines);
  reader.closeOpenBlocks();
  return reader.blocks;
}

function markdownToPlainText(source: string): string {
  return plainLines(
    parseMarkdownBlocks(source).flatMap((block) =>
      block.kind === 'code' ? block.text.split('\n') : [block.text],
    ),
  );
}

const HEADING_KIND_LEVELS: ReadonlyMap<MarkdownBlockKind, number> = new Map([
  ['heading-1', 1],
  ['heading-2', 2],
  ['heading-3', 3],
  ['heading-4', 4],
  ['heading-5', 5],
  ['heading-6', 6],
]);

function selectBlocks(blocks: readonly MarkdownBlock[], kind: MarkdownBlockKind): string[] {
  const level = HEADING_KIND_LEVELS.get(kind);
  return blocks
    .filter((block) =>
      level === undefined ? block.kind === kind : block.kind === 'heading' && block.level === level,
    )
    .map((block) => block.text);
}

export class PlainTextImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext): FormulaNodeOutput {
    const markup = readText('PLAIN_TEXT', args[0]);
    if (typeof markup !== 'string') return markup;
    const format = readRequiredMode('PLAIN_TEXT', 'format', args[1], MARKUP_FORMATS);
    if (typeof format !== 'string') return format;
    const text = format === 'html' ? htmlToPlainText(markup) : markdownToPlainText(markup);
    return makeOkText('PLAIN_TEXT', text);
  }
}

export class MarkdownBlocksImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('MARKDOWN_BLOCKS', args[0]);
    if (typeof text !== 'string') return text;
    const kind = readRequiredMode('MARKDOWN_BLOCKS', 'kind', args[1], MARKDOWN_BLOCK_KINDS);
    if (typeof kind !== 'string') return kind;
    const blocks = selectBlocks(parseMarkdownBlocks(text), kind);
    return makeOkList('MARKDOWN_BLOCKS', boundedListResult(blocks, ctx.limits));
  }
}
