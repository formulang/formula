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

/**
 * `indexOf` for a scanner that only moves forward: a hit is reused while the scan has not passed
 * it and a miss is final, so all searches over one text take linear time together.
 */
class ForwardSearch {
  private hitFrom = -1;
  private hit = -1;
  private missFrom = Number.POSITIVE_INFINITY;

  constructor(
    private readonly text: string,
    private readonly needle: string,
  ) {}

  next(from: number): number {
    if (from >= this.missFrom) return -1;
    if (from >= this.hitFrom && from <= this.hit) return this.hit;
    const at = this.text.indexOf(this.needle, from);
    if (at < 0) {
      this.missFrom = from;
      return -1;
    }
    this.hitFrom = from;
    this.hit = at;
    return at;
  }
}

// HTML

/** Elements dropped together with their content. */
const RAW_CONTENT_CLOSING_TAGS: ReadonlyMap<string, RegExp> = new Map([
  ['script', /<\/script(?![A-Za-z0-9:-])/gi],
  ['style', /<\/style(?![A-Za-z0-9:-])/gi],
  ['head', /<\/head(?![A-Za-z0-9:-])/gi],
]);

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

const TAG_NAME = /[A-Za-z][A-Za-z0-9:-]*/y;
const CHARACTER_REFERENCE =
  /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;
const SOURCE_LINE_BREAK = /\r\n|\r|\n/g;
const REPLACEMENT_CHARACTER = '\uFFFD';

type HtmlTag = { name: string; closing: boolean; end: number };

type HtmlSearches = {
  gt: ForwardSearch;
  doubleQuote: ForwardSearch;
  singleQuote: ForwardSearch;
};

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

function earliestBefore(limit: number, first: number, second: number): number {
  const candidates = [first, second].filter((at) => at >= 0 && at < limit);
  return candidates.length === 0 ? -1 : Math.min(...candidates);
}

/**
 * Reads the tag that starts at the `<` at `lt`: its lower-cased name and the index after its
 * closing `>`, skipping `>` inside quoted attribute values. Declarations and processing
 * instructions (`<!DOCTYPE html>`, `<?xml ...?>`) come back named `!`. `null` when no tag starts
 * at `lt`.
 */
function readTag(markup: string, lt: number, searches: HtmlSearches): HtmlTag | null {
  const first = markup.charAt(lt + 1);
  if (first === '!' || first === '?') {
    const end = searches.gt.next(lt + 2);
    return end < 0 ? null : { name: '!', closing: false, end: end + 1 };
  }
  const closing = first === '/';
  TAG_NAME.lastIndex = closing ? lt + 2 : lt + 1;
  const nameMatch = TAG_NAME.exec(markup);
  if (nameMatch === null) return null;
  const name = nameMatch[0].toLowerCase();
  let position = TAG_NAME.lastIndex;
  for (;;) {
    const close = searches.gt.next(position);
    if (close < 0) return null;
    const quote = earliestBefore(
      close,
      searches.doubleQuote.next(position),
      searches.singleQuote.next(position),
    );
    if (quote < 0) return { name, closing, end: close + 1 };
    const quoteSearch = markup.charAt(quote) === '"' ? searches.doubleQuote : searches.singleQuote;
    const quoteEnd = quoteSearch.next(quote + 1);
    // An unterminated quoted value: the tag ends at the first `>`.
    if (quoteEnd < 0) return { name, closing, end: close + 1 };
    position = quoteEnd + 1;
  }
}

/**
 * The text of an HTML document: comments and the content of `script`, `style` and `head`
 * dropped, the line-ending elements ending a line, every other tag removed, character references
 * decoded, whitespace collapsed within each line (inside `pre`, each source line break ends a
 * line) and blank lines dropped.
 */
function htmlToPlainText(markup: string): string {
  const searches: HtmlSearches = {
    gt: new ForwardSearch(markup, '>'),
    doubleQuote: new ForwardSearch(markup, '"'),
    singleQuote: new ForwardSearch(markup, "'"),
  };
  const lessThan = new ForwardSearch(markup, '<');
  const commentEnd = new ForwardSearch(markup, '-->');
  const out: string[] = [];
  let inPre = false;
  let index = 0;

  const appendText = (raw: string): void => {
    if (raw.length === 0) return;
    const decoded = decodeCharacterReferences(raw);
    out.push(
      inPre ? decoded.replace(SOURCE_LINE_BREAK, '\n') : decoded.replace(WHITESPACE_RUN, ' '),
    );
  };

  while (index < markup.length) {
    const lt = lessThan.next(index);
    if (lt < 0) {
      appendText(markup.slice(index));
      break;
    }
    appendText(markup.slice(index, lt));
    if (markup.startsWith('<!--', lt)) {
      const end = commentEnd.next(lt + 4);
      index = end < 0 ? markup.length : end + 3;
      continue;
    }
    const tag = readTag(markup, lt, searches);
    if (tag === null) {
      appendText('<');
      index = lt + 1;
      continue;
    }
    index = tag.end;
    const rawContentClose = tag.closing ? undefined : RAW_CONTENT_CLOSING_TAGS.get(tag.name);
    if (rawContentClose !== undefined) {
      rawContentClose.lastIndex = tag.end;
      const closeTag = rawContentClose.exec(markup);
      const closeEnd =
        closeTag === null ? -1 : searches.gt.next(closeTag.index + closeTag[0].length);
      index = closeEnd < 0 ? markup.length : closeEnd + 1;
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

const MARKDOWN_LINE_BREAK = /\r\n|\r|\n/;
const QUOTE_MARKER = /^ {0,3}> ?/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const CLOSING_HASHES = /(?:^|[ \t]+)#+$/;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]+(.*))?$/;
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
};

function endOfRun(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  let end = start;
  while (source.charCodeAt(end) === marker) end += 1;
  return end;
}

/** The emphasis delimiter run `[start, end)`, classified by the CommonMark flanking rules. */
function delimiterRun(source: string, start: number, end: number, marker: '*' | '_'): DelimiterRun {
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
  };
}

/** Pairs each closing delimiter run with the nearest open run of the same marker. */
function pairDelimiterRuns(runs: readonly DelimiterRun[]): void {
  const openers: DelimiterRun[] = [];
  for (const run of runs) {
    if (run.canClose) {
      let index = openers.length - 1;
      while (index >= 0 && openers[index].marker !== run.marker) index -= 1;
      if (index >= 0) {
        openers[index].matched = true;
        run.matched = true;
        openers.length = index;
        continue;
      }
    }
    if (run.canOpen) openers.push(run);
  }
}

/** The start of the next backtick run of exactly `length` at or after `from`; -1 when none. */
function closingBacktickRun(
  source: string,
  from: number,
  length: number,
  misses: Map<number, number>,
): number {
  const missFrom = misses.get(length);
  if (missFrom !== undefined && from >= missFrom) return -1;
  for (let at = source.indexOf('`', from); at >= 0;) {
    const end = endOfRun(source, at);
    if (end - at === length) return at;
    at = source.indexOf('`', end);
  }
  misses.set(length, from);
  return -1;
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
  const backtickMisses = new Map<number, number>();
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
      const close = closingBacktickRun(source, runEnd, length, backtickMisses);
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
      const run = delimiterRun(source, index, runEnd, char);
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

function inlineText(source: string): string {
  return collapseWhitespace(stripInlineMarkdown(source));
}

/** Strips up to `maxDepth` blockquote markers (`>`) from the start of a line. */
function stripQuoteMarkers(
  line: string,
  maxDepth = Number.POSITIVE_INFINITY,
): { depth: number; content: string } {
  let content = line;
  let depth = 0;
  while (depth < maxDepth) {
    const marker = QUOTE_MARKER.exec(content);
    if (marker === null) break;
    content = content.slice(marker[0].length);
    depth += 1;
  }
  return { depth, content };
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
        text: inlineText(joinLines(this.paragraph)),
      });
      this.paragraph = [];
    }
    if (this.listItem !== null) {
      this.blocks.push({ kind: 'list-item', level: 0, text: inlineText(joinLines(this.listItem)) });
      this.listItem = null;
    }
    this.tableColumns = 0;
  }

  addHeading(level: number, content: string): void {
    this.closeOpenBlocks();
    const text = inlineText(content.trimEnd().replace(CLOSING_HASHES, ''));
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
      .map(inlineText)
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
    if (listItem !== null) {
      reader.startListItem(listItem[1] ?? '');
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
