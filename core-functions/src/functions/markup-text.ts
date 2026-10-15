import type { FormulaExecutionContext, FormulaNodeOutput } from '@formulang/definitions';
import { makeOkList, makeOkText } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { boundedListResult, readRequiredMode, readText, textCost } from './argument-readers';
import { HTML_NAMED_CHARACTER_REFERENCES, WINDOWS_1252_NUMERIC_REFERENCES } from './html-entities';
import { CountedText, workOf, type WorkCount, type WorkCountingConfig } from './work-count';

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
function endOfTag(markup: CountedText, from: number): number {
  let state: TagState = 'before-attribute-name';
  for (let index = from; index < markup.length; index += 1) {
    const char = markup.char(index);
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
function readTag(markup: CountedText, nameStart: number, closing: boolean): HtmlTag {
  let nameEnd = nameStart;
  while (nameEnd < markup.length) {
    const char = markup.char(nameEnd);
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
function endOfComment(markup: CountedText, from: number): number {
  if (markup.startsWith('>', from)) return from + 1;
  if (markup.startsWith('->', from)) return from + 2;
  for (let search = from; ;) {
    const dashes = markup.indexOf('--', search);
    if (dashes < 0) return markup.length;
    if (markup.startsWith('>', dashes + 2)) return dashes + 3;
    if (markup.startsWith('!>', dashes + 2)) return dashes + 4;
    search = dashes + 1;
  }
}

/**
 * The index after the `>` that ends a declaration (`<!DOCTYPE html>`), a processing instruction
 * (`<?xml ...?>`) or another bogus comment; the end of the markup when no `>` follows.
 */
function endOfBogusComment(markup: CountedText, from: number): number {
  const close = markup.indexOf('>', from);
  return close < 0 ? markup.length : close + 1;
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

/** The code unit `code` with the ASCII capitals lower-cased. */
function asciiLower(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/**
 * The index after the end tag that closes the dropped element `name` whose content starts at
 * `from`: the first `</` followed by the name, in any ASCII case, and by whitespace, `/` or `>`;
 * the end of the markup when no end tag follows.
 */
function endOfHiddenContent(markup: CountedText, name: string, from: number): number {
  for (let at = markup.indexOf('</', from); at >= 0; at = markup.indexOf('</', at + 1)) {
    let offset = 0;
    while (
      offset < name.length &&
      asciiLower(markup.code(at + 2 + offset)) === name.charCodeAt(offset)
    ) {
      offset += 1;
    }
    if (offset < name.length) continue;
    const nameEnd = at + 2 + name.length;
    const after = markup.char(nameEnd);
    if (!isHtmlSpace(after) && after !== '/' && after !== '>') continue;
    const end = endOfTag(markup, nameEnd);
    return end < 0 ? markup.length : end;
  }
  return markup.length;
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
function htmlToPlainText(markup: CountedText): string {
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
    const next = markup.char(lt + 1);
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
      const afterSlash = markup.char(lt + 2);
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
const QUOTE_MARKER = / {0,3}> ?/y;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*))?$/;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})([\s\S]*)/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
/** A list marker: a bullet, or the start number of an ordered item (group 1); the text in group 2. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|([0-9]{1,9})[.)])(?:[ \t]+([\s\S]*))?$/;
const TABLE_DELIMITER_CELL = /^:?-+:?$/;

const ASCII_PUNCTUATION = /^[!-\/:-@[-`{-~]$/;
const UNICODE_WHITESPACE = /^\s$/u;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
/** `<scheme:...>` or `<name@host>`. */
const AUTOLINK =
  /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]{0,2000}|[^\s<>@]{1,256}@[^\s<>@]{1,256})>/y;

/** The fields of an emphasis delimiter run. */
type DelimiterFields = {
  marker: '*' | '_';
  length: number;
  canOpen: boolean;
  canClose: boolean;
  matched: boolean;
  /** The run's position among the delimiter runs of its text. */
  order: number;
};

/**
 * An emphasis delimiter run, whose every field read is charged one step, as a character read is:
 * the pairing of runs cannot walk them without its count growing.
 */
class DelimiterRun {
  constructor(
    private readonly fields: DelimiterFields,
    private readonly work: WorkCount,
  ) {}

  private read<K extends keyof DelimiterFields>(key: K): DelimiterFields[K] {
    this.work.steps += 1;
    return this.fields[key];
  }

  get marker(): '*' | '_' {
    return this.read('marker');
  }

  get length(): number {
    return this.read('length');
  }

  get canOpen(): boolean {
    return this.read('canOpen');
  }

  get canClose(): boolean {
    return this.read('canClose');
  }

  get order(): number {
    return this.read('order');
  }

  get matched(): boolean {
    return this.read('matched');
  }

  set matched(value: boolean) {
    this.fields.matched = value;
  }
}

/** The index after the run of the code unit at `start`. */
function endOfRun(source: CountedText, start: number): number {
  const marker = source.code(start);
  let end = start + 1;
  while (source.code(end) === marker) end += 1;
  return end;
}

/** The emphasis delimiter run `[start, end)`, classified by the CommonMark flanking rules. */
function delimiterRun(
  source: CountedText,
  start: number,
  end: number,
  marker: '*' | '_',
  order: number,
  work: WorkCount,
): DelimiterRun {
  const before = source.characterBefore(start);
  const after = source.characterAt(end);
  const spaceBefore = before === null || UNICODE_WHITESPACE.test(before);
  const spaceAfter = after === null || UNICODE_WHITESPACE.test(after);
  const punctuationBefore = before !== null && UNICODE_PUNCTUATION.test(before);
  const punctuationAfter = after !== null && UNICODE_PUNCTUATION.test(after);
  const leftFlanking = !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore);
  const rightFlanking = !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter);
  return new DelimiterRun(
    {
      marker,
      length: end - start,
      canOpen:
        marker === '*' ? leftFlanking : leftFlanking && (!rightFlanking || punctuationBefore),
      canClose:
        marker === '*' ? rightFlanking : rightFlanking && (!leftFlanking || punctuationAfter),
      matched: false,
      order,
    },
    work,
  );
}

/**
 * Pairs each closing delimiter run with the nearest open run of the same marker; the open runs
 * of the other marker between the two can then no longer pair. One stack per marker, so each run
 * is pushed and popped at most once.
 */
function pairDelimiterRuns(runs: readonly DelimiterRun[]): void {
  const open: Record<'*' | '_', DelimiterRun[]> = { '*': [], _: [] };
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
    while (other.length > 0 && (other[other.length - 1] as DelimiterRun).order > opener.order) {
      other.pop();
    }
  }
}

/**
 * The maximal backtick runs of a text by length, for finding the run that closes a code span:
 * one pass builds it, and one forward cursor per length answers, as the inline scan only moves
 * forward. Every start the cursors read is charged one step.
 */
class BacktickRuns {
  private readonly starts = new Map<number, number[]>();
  private readonly cursors = new Map<number, number>();

  constructor(
    source: CountedText,
    private readonly work: WorkCount,
  ) {
    for (let at = source.indexOf('`'); at >= 0;) {
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
    while (cursor < starts.length && this.startAt(starts, cursor) < from) cursor += 1;
    this.cursors.set(length, cursor);
    return cursor < starts.length ? this.startAt(starts, cursor) : -1;
  }

  private startAt(starts: readonly number[], cursor: number): number {
    this.work.steps += 1;
    return starts[cursor] as number;
  }
}

/** Code span content: one surrounding space is stripped when both ends have one. */
function codeSpanContent(content: string): string {
  const padded = content.length >= 2 && content.startsWith(' ') && content.endsWith(' ');
  return padded && content.trim().length > 0 ? content.slice(1, -1) : content;
}

/**
 * The end of a bracketed stretch that starts at `from` (after the opening bracket): at most
 * `items` items, each a code unit other than `open`, `close` or a line feed, or a nested
 * `open ... close` of at most 500 such code units; the index where the items stop.
 */
function endOfBracketed(
  source: CountedText,
  from: number,
  open: number,
  close: number,
  items: number,
): number {
  let at = from;
  for (let item = 0; item < items; item += 1) {
    const code = source.code(at);
    if (code === open) {
      let inner = at + 1;
      for (let count = 0; count < 500; count += 1) {
        const unit = source.code(inner);
        if (unit === open || unit === close || unit === 0x0a || Number.isNaN(unit)) break;
        inner += 1;
      }
      if (source.code(inner) !== close) break;
      at = inner + 1;
    } else if (code === close || code === 0x0a || Number.isNaN(code)) {
      break;
    } else {
      at += 1;
    }
  }
  return at;
}

/**
 * The link or image that starts at `index`, `[text](destination)` or `![alt](destination)`, with
 * one level of nested brackets in the text (at most 1,000 items, a nested pair holding at most 500
 * code units) and of parentheses in the destination (at most 2,000 items): the index after its
 * `)` and its text; null when none starts there.
 */
function inlineLink(source: CountedText, index: number): { end: number; text: string } | null {
  let at = index;
  if (source.code(at) === 0x21) at += 1;
  if (source.code(at) !== 0x5b) return null;
  const textStart = at + 1;
  const textEnd = endOfBracketed(source, textStart, 0x5b, 0x5d, 1_000);
  if (source.code(textEnd) !== 0x5d || source.code(textEnd + 1) !== 0x28) return null;
  const destinationEnd = endOfBracketed(source, textEnd + 2, 0x28, 0x29, 2_000);
  if (source.code(destinationEnd) !== 0x29) return null;
  return { end: destinationEnd + 1, text: source.slice(textStart, textEnd) };
}

/**
 * Removes inline markdown: emphasis (`*`, `_`, `**`, `__`), code-span backticks, backslash
 * escapes, links and images (`[t](u)` to `t`, `![a](u)` to `a`) and autolinks (`<u>` to `u`).
 */
function stripInlineMarkdown(source: CountedText, work: WorkCount): string {
  const pieces: Array<string | DelimiterRun> = [];
  const runs: DelimiterRun[] = [];
  let backtickRuns: BacktickRuns | null = null;
  let text = '';
  let index = 0;
  while (index < source.length) {
    const char = source.char(index);
    const next = source.char(index + 1);
    if (char === '\\' && next.length > 0 && ASCII_PUNCTUATION.test(next)) {
      text += next;
      index += 2;
      continue;
    }
    if (char === '`') {
      const runEnd = endOfRun(source, index);
      const length = runEnd - index;
      if (backtickRuns === null) backtickRuns = new BacktickRuns(source, work);
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
      const link = inlineLink(source, index);
      if (link !== null) {
        index = link.end;
        text += stripInlineMarkdown(new CountedText(link.text, work), work);
        continue;
      }
    }
    if (char === '<') {
      const autolink = source.stickyMatch(AUTOLINK, index);
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
      const run = delimiterRun(source, index, runEnd, char, runs.length, work);
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

/** Whether the code unit `code` is a space or a tab. */
function isSpaceOrTab(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/**
 * Heading content without its closing sequence: a final run of `#` that follows a space, a tab
 * or nothing, together with the spaces and tabs before it.
 */
function withoutClosingHashes(content: string, work: WorkCount): string {
  const trimmed = new CountedText(content.trimEnd(), work);
  let hashes = trimmed.length;
  while (hashes > 0 && trimmed.code(hashes - 1) === 0x23) hashes -= 1;
  if (hashes === trimmed.length) return trimmed.slice(0);
  let end = hashes;
  while (end > 0 && isSpaceOrTab(trimmed.code(end - 1))) end -= 1;
  return trimmed.slice(0, end === hashes && hashes > 0 ? trimmed.length : end);
}

/** `line` without up to `indent` leading spaces. */
function stripIndent(line: string, indent: number, work: WorkCount): string {
  const text = new CountedText(line, work);
  let start = 0;
  while (start < indent && start < text.length && text.code(start) === 0x20) start += 1;
  return text.slice(start);
}

/** The cells of a table row, trimmed; `\|` is a literal pipe inside a cell. */
function splitTableCells(line: string, work: WorkCount): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const text = new CountedText(row, work);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text.char(index);
    if (char === '\\' && text.char(index + 1) === '|') {
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

/**
 * Whether `line` is a thematic break: up to three spaces, then three or more of one of `-`, `*`
 * and `_`, with nothing but spaces and tabs between and after them.
 */
function isThematicBreak(line: string, work: WorkCount): boolean {
  const text = new CountedText(line, work);
  let at = 0;
  while (at < 3 && text.code(at) === 0x20) at += 1;
  const marker = text.code(at);
  if (marker !== 0x2d && marker !== 0x2a && marker !== 0x5f) return false;
  let markers = 0;
  for (; at < text.length; at += 1) {
    const code = text.code(at);
    if (code === marker) markers += 1;
    else if (!isSpaceOrTab(code)) return false;
  }
  return markers >= 3;
}

/**
 * The lines of a markdown source, split at `\r\n`, `\r` and `\n`: every code unit is read once and
 * copied once.
 */
function markdownLines(source: CountedText): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.code(index);
    if (code !== 0x0a && code !== 0x0d) continue;
    lines.push(source.slice(start, index));
    if (code === 0x0d && index + 1 < source.length && source.code(index + 1) === 0x0a) {
      index += 1;
    }
    start = index + 1;
  }
  lines.push(source.slice(start));
  return lines;
}

class MarkdownBlockReader {
  readonly blocks: MarkdownBlock[] = [];
  private paragraph: string[] = [];
  private listItem: string[] | null = null;
  private tableColumns = 0;

  constructor(private readonly work: WorkCount) {}

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
    const text = this.inlineText(withoutClosingHashes(content, this.work));
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
    const cells = splitTableCells(line, this.work).slice(0, this.tableColumns);
    const text = cells
      .map((cell) => this.inlineText(cell))
      .filter((cell) => cell.length > 0)
      .join(' ');
    this.blocks.push({ kind: 'table-row', level: 0, text });
  }

  /** Opens a table when `line` is a header row and `next` its delimiter row. */
  startsTable(line: string, next: string): boolean {
    if (new CountedText(line, this.work).indexOf('|') < 0) return false;
    if (new CountedText(next, this.work).indexOf('|') < 0) return false;
    const header = splitTableCells(line, this.work);
    const delimiter = splitTableCells(next, this.work);
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
    return collapseWhitespace(stripInlineMarkdown(new CountedText(source, this.work), this.work));
  }
}

/**
 * The blocks of a markdown document, in order: a line-based CommonMark subset with ATX headings,
 * list items (nested items each count), GFM tables, paragraphs and fenced code. Blockquote
 * markers are transparent.
 */
function parseMarkdownBlocks(source: CountedText, work: WorkCount): MarkdownBlock[] {
  const lines = markdownLines(source);
  const reader = new MarkdownBlockReader(work);
  let fence: OpenFence | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    if (fence !== null) {
      const content = stripQuoteMarkers(raw, fence.quoteDepth).content;
      const close = FENCE_CLOSE.exec(content);
      if (close !== null && close[1].startsWith(fence.marker) && close[1].length >= fence.length) {
        reader.addCode(fence.lines);
        fence = null;
      } else {
        fence.lines.push(stripIndent(content, fence.indent, work));
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
    if (isThematicBreak(line, work)) {
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
    const next =
      index + 1 < lines.length ? stripQuoteMarkers(lines[index + 1] as string).content : '';
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

function markdownToPlainText(source: CountedText, work: WorkCount): string {
  return plainLines(
    parseMarkdownBlocks(source, work).flatMap((block) =>
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

export class PlainTextImplementation extends AbstractEagerBatchImplementation<WorkCountingConfig> {
  constructor(config: WorkCountingConfig) {
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
    const work = workOf(this.config);
    const counted = new CountedText(markup, work);
    const text = format === 'html' ? htmlToPlainText(counted) : markdownToPlainText(counted, work);
    return makeOkText('PLAIN_TEXT', text);
  }
}

export class MarkdownBlocksImplementation extends AbstractEagerBatchImplementation<WorkCountingConfig> {
  constructor(config: WorkCountingConfig) {
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
    const work = workOf(this.config);
    const blocks = selectBlocks(parseMarkdownBlocks(new CountedText(text, work), work), kind);
    return makeOkList('MARKDOWN_BLOCKS', boundedListResult(blocks, ctx.limits));
  }
}
