import type { MarkdownBlockKind } from './definitions';
import { collapseWhitespace, plainLines } from './text-lines';

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
/** A setext heading underline: `=`s (level 1) or `-`s (level 2), with no space between. */
const SETEXT_UNDERLINE = /^ {0,3}([=-])\1*[ \t]*$/;
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

type Marker = '*' | '_';

type DelimiterRun = {
  marker: Marker;
  /** The run's length as written. */
  length: number;
  /** The delimiters no emphasis has used: they stay in the text. */
  remaining: number;
  canOpen: boolean;
  canClose: boolean;
  /** The run's position among the delimiter runs of its text. */
  order: number;
};

/**
 * The character (a whole code point) ending just before `index`, an index inside the text or at
 * its end; `null` at the start.
 */
function characterBefore(text: string, index: number): string | null {
  if (index <= 0) return null;
  const last = text.charCodeAt(index - 1);
  // NaN before the first code unit, which none of the ranges below holds.
  const first = text.charCodeAt(index - 2);
  const isPair = last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff;
  return text.slice(isPair ? index - 2 : index - 1, index);
}

/** The character (a whole code point) starting at `index`; `null` outside the text. */
function characterAt(text: string, index: number): string | null {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? null : String.fromCodePoint(codePoint);
}

function endOfRun(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  let end = start;
  while (source.charCodeAt(end) === marker) end += 1;
  return end;
}

/** The emphasis delimiter run `[start, end)`, classified by the characters on either side. */
function delimiterRun(
  source: string,
  start: number,
  end: number,
  marker: Marker,
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
    remaining: end - start,
    order,
  };
}

/**
 * CommonMark's "rule of 3": when either run can both open and close, the two pair only if their
 * lengths as written do not add up to a multiple of 3, or both are multiples of 3.
 */
function canPair(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (!opener.canClose && !closer.canOpen) return true;
  const sum = opener.length + closer.length;
  return sum % 3 !== 0 || (opener.length % 3 === 0 && closer.length % 3 === 0);
}

/**
 * Pairs delimiter runs as CommonMark's emphasis algorithm does: each closing run pairs with the
 * nearest open run of its marker that the rule of 3 allows, a pair uses two delimiters of each
 * when both have two left (strong emphasis) and one otherwise, and a closing run with delimiters
 * left pairs again. The open runs between the two pair no more. What a run has left stays in the
 * text: `**foo*` keeps one `*`.
 *
 * One stack per marker. A failed search records where it stopped, per marker and per what the
 * rule of 3 reads of the closing run, so no open run is searched twice in vain: the work is
 * linear in the number of runs.
 */
function pairDelimiterRuns(runs: readonly DelimiterRun[]): void {
  const open: Record<Marker, DelimiterRun[]> = { '*': [], _: [] };
  // The stack index below which a search finds nothing, by closing-run key (see `searchKey`).
  const bottoms: Record<Marker, number[]> = { '*': [0, 0, 0, 0, 0, 0], _: [0, 0, 0, 0, 0, 0] };
  const truncate = (marker: Marker, length: number): void => {
    open[marker].length = length;
    const bottom = bottoms[marker];
    for (let key = 0; key < bottom.length; key += 1) bottom[key] = Math.min(bottom[key], length);
  };
  // Which open runs `canPair` admits depends on these two properties of the closing run only.
  const searchKey = (run: DelimiterRun): number => (run.canOpen ? 3 : 0) + (run.length % 3);

  for (const closer of runs) {
    const own = open[closer.marker];
    const bottom = bottoms[closer.marker];
    const key = searchKey(closer);
    while (closer.canClose && closer.remaining > 0) {
      let at = own.length - 1;
      while (at >= bottom[key] && !canPair(own[at], closer)) at -= 1;
      if (at < bottom[key]) {
        bottom[key] = own.length;
        break;
      }
      const opener = own[at];
      const used = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
      opener.remaining -= used;
      closer.remaining -= used;
      truncate(closer.marker, opener.remaining > 0 ? at + 1 : at);
      const otherMarker: Marker = closer.marker === '*' ? '_' : '*';
      const other = open[otherMarker];
      let keep = other.length;
      while (keep > 0 && other[keep - 1].order > opener.order) keep -= 1;
      truncate(otherMarker, keep);
    }
    if (closer.canOpen && closer.remaining > 0) own.push(closer);
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
    .map((piece) => (typeof piece === 'string' ? piece : piece.marker.repeat(piece.remaining)))
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
  /** The quote depth of the paragraph's last line. */
  private paragraphQuoteDepth = 0;
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

  /**
   * Makes the open paragraph a setext heading of `level` when the underline, at quote depth
   * `quoteDepth`, continues it: a paragraph at another depth, a list item or a table has no
   * underline.
   */
  underlineParagraph(level: number, quoteDepth: number): boolean {
    if (this.paragraph.length === 0 || quoteDepth !== this.paragraphQuoteDepth) return false;
    const text = this.inlineText(joinLines(this.paragraph));
    this.paragraph = [];
    this.closeOpenBlocks();
    this.blocks.push({ kind: 'heading', level, text });
    return true;
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

  addText(line: string, quoteDepth: number): void {
    if (this.listItem !== null) {
      this.listItem.push(line);
    } else {
      this.paragraph.push(line);
      this.paragraphQuoteDepth = quoteDepth;
    }
  }

  private inlineText(source: string): string {
    return collapseWhitespace(stripInlineMarkdown(source));
  }
}

/**
 * The blocks of a markdown document, in order, read line by line: ATX and setext headings, list
 * items (nested items each count), pipe tables, paragraphs and fenced code. Quote markers are
 * read through. Not read: indented code (its lines are paragraph text), reference links and
 * their definitions, and HTML (both stay as written).
 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
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
    const underline = SETEXT_UNDERLINE.exec(line);
    if (underline !== null && reader.underlineParagraph(underline[1] === '=' ? 1 : 2, depth)) {
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
    // An item interrupts a paragraph only when it has text and, if ordered, starts at 1: a
    // wrapped line opening with "2025." or "3." continues the paragraph.
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
    reader.addText(line, depth);
  }
  if (fence !== null) reader.addCode(fence.lines);
  reader.closeOpenBlocks();
  return reader.blocks;
}

export function markdownToPlainText(source: string): string {
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

export function selectBlocks(blocks: readonly MarkdownBlock[], kind: MarkdownBlockKind): string[] {
  const level = HEADING_KIND_LEVELS.get(kind);
  return blocks
    .filter((block) =>
      level === undefined ? block.kind === kind : block.kind === 'heading' && block.level === level,
    )
    .map((block) => block.text);
}
