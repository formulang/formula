import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaLimits,
  FormulaNodeOutput,
} from '@formulang/definitions';
import { makeOkList, makeOkNull, makeOkNumber, makeOkText } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import {
  isOneOf,
  listTooLarge,
  nullWithWarning,
  readOptionalMode,
  readText,
  readTextList,
  textCost,
  typeWarning,
} from './argument-readers';
import { asNumber, isWordCharacterAt, isWordCharacterBefore } from './helpers';
import { someOccurrence } from './text-search';

/** How `WORDS`, `WORD_COUNT` and `LEADING_WORDS` find the words of a text. */
export type WordSplitMode = 'whitespace' | 'letters' | 'locale';

/** How `SENTENCES` finds the sentences of a text. */
export type SentenceSplitMode = 'punctuation' | 'terminators';

/** Which lines `LINES` and `LINE_COUNT` keep. */
export type LineSplitMode = 'non-blank' | 'all';

/** The `mode` values of the word functions; the first is the default. */
export const WORD_SPLIT_MODES: readonly WordSplitMode[] = ['whitespace', 'letters', 'locale'];

/** The `mode` values of `SENTENCES`; the first is the default. */
export const SENTENCE_SPLIT_MODES: readonly SentenceSplitMode[] = ['punctuation', 'terminators'];

/** The `mode` values of `LINES` and `LINE_COUNT`; the first is the default. */
export const LINE_SPLIT_MODES: readonly LineSplitMode[] = ['non-blank', 'all'];

/** `whitespace` mode: a run of non-whitespace characters. */
const NON_WHITESPACE_RUN = /\S+/gu;

/**
 * `letters` mode: runs of letters, marks and numbers. An apostrophe or hyphen between two runs
 * joins them into one word, and so does `.` or `,` between two digits.
 */
const LETTER_WORD =
  /[\p{L}\p{M}\p{N}]+(?:(?:['\u2019\u2010\u2011\u00AD-]|(?<=\p{Nd})[.,](?=\p{Nd}))[\p{L}\p{M}\p{N}]+)*/gu;

/** `punctuation` mode: whitespace directly after `.`, `!` or `?` ends a sentence. */
const PUNCTUATION_BREAK = /(?<=[.!?])\s+/gu;

/** `terminators` mode: every run of `.`, `!`, `?` and their full-width forms ends a sentence. */
const TERMINATOR_RUN = /[.!?\u3002\uFF01\uFF1F]+/gu;

/** A character that is neither whitespace nor a sentence terminator. */
const SENTENCE_CONTENT = /[^\s.!?\u3002\uFF01\uFF1F]/u;

/** The Unicode mandatory line breaks; `\r\n` counts as one. */
const LINE_BREAK = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/gu;

type WordScan = { words: Iterable<string> } | { refusal: string };
type WordCall = { text: string; mode: WordSplitMode; option: string | null };

function countOf(items: Iterable<unknown>): number {
  let count = 0;
  for (const _item of items) count += 1;
  return count;
}

function* nonEmptyMatches(text: string, re: RegExp): Generator<string> {
  for (const match of text.matchAll(re)) {
    if (match[0].length > 0) yield match[0];
  }
}

function* wordLikeSegments(segmenter: Intl.Segmenter, text: string): Generator<string> {
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike === true) yield segment.segment;
  }
}

/** A word segmenter for `tag`, or `null` when the runtime has no data for it or it is invalid. */
function createWordSegmenter(tag: string): Intl.Segmenter | null {
  try {
    // Without this check an unsupported tag silently falls back to the host's default locale.
    if (Intl.Segmenter.supportedLocalesOf([tag]).length === 0) return null;
    return new Intl.Segmenter(tag, { granularity: 'word' });
  } catch {
    // RangeError: not a valid BCP 47 language tag.
    return null;
  }
}

/**
 * The words of `text` under `mode`, or a refusal message. `option` is the language tag in
 * `locale` mode and must be absent in the other modes.
 */
function scanWords(fn: string, text: string, mode: WordSplitMode, option: string | null): WordScan {
  if (mode !== 'locale') {
    if (option !== null) return { refusal: `${fn} accepts an option only in locale mode` };
    return {
      words: nonEmptyMatches(text, mode === 'whitespace' ? NON_WHITESPACE_RUN : LETTER_WORD),
    };
  }
  if (option === null || option.length === 0) {
    return { refusal: `${fn} needs a BCP 47 language tag in locale mode` };
  }
  const segmenter = createWordSegmenter(option);
  if (segmenter === null) {
    return {
      refusal: `${fn} has no word segmentation for the language tag ${JSON.stringify(option)}`,
    };
  }
  return { words: wordLikeSegments(segmenter, text) };
}

/**
 * Marks the positions a `keep` token protects from a sentence split: every position inside or at
 * the end of an occurrence that starts at a word boundary. Returns `null` when no token occurs.
 */
function protectedPositions(text: string, keep: readonly string[]): Uint8Array | null {
  // depth[p + 1] - depth[p]: how many protected ranges open (+) or close (-) at position p.
  // Held in an object: TypeScript does not track assignments made inside the callback.
  const ranges: { depth: Int32Array | null } = { depth: null };
  for (const token of keep) {
    const startsWithWordCharacter = isWordCharacterAt(token, 0);
    someOccurrence(text, token, (at) => {
      if (startsWithWordCharacter && isWordCharacterBefore(text, at)) return false;
      ranges.depth ??= new Int32Array(text.length + 2);
      ranges.depth[at + 1] += 1;
      ranges.depth[at + token.length + 1] -= 1;
      // Keep searching: every occurrence protects its range.
      return false;
    });
  }
  const depth = ranges.depth;
  if (depth === null) return null;
  const marks = new Uint8Array(text.length + 1);
  let open = 0;
  for (let position = 0; position <= text.length; position++) {
    open += depth[position];
    marks[position] = open > 0 ? 1 : 0;
  }
  return marks;
}

/** The sentences of `text`, never split inside or at the end of a `keep` token. */
function* sentencePieces(
  text: string,
  mode: SentenceSplitMode,
  keep: readonly string[],
): Generator<string> {
  const protectedAt = keep.length > 0 ? protectedPositions(text, keep) : null;
  let start = 0;
  if (mode === 'punctuation') {
    for (const match of text.matchAll(PUNCTUATION_BREAK)) {
      if (protectedAt !== null && protectedAt[match.index] === 1) continue;
      const piece = text.slice(start, match.index).trim();
      if (piece.length > 0) yield piece;
      start = match.index + match[0].length;
    }
    const last = text.slice(start).trim();
    if (last.length > 0) yield last;
    return;
  }
  for (const match of text.matchAll(TERMINATOR_RUN)) {
    const end = match.index + match[0].length;
    if (protectedAt !== null && protectedAt[end] === 1) continue;
    const piece = text.slice(start, end).trim();
    if (SENTENCE_CONTENT.test(piece)) yield piece;
    start = end;
  }
  const last = text.slice(start).trim();
  if (SENTENCE_CONTENT.test(last)) yield last;
}

/**
 * The lines of `text`. `non-blank` skips lines of whitespace only. A final line break ends the
 * last line rather than starting an empty one.
 */
function* linesOf(text: string, mode: LineSplitMode): Generator<string> {
  let start = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    const line = text.slice(start, match.index);
    if (mode === 'all' || line.trim().length > 0) yield line;
    start = match.index + match[0].length;
  }
  const last = text.slice(start);
  if (last.length > 0 && (mode === 'all' || last.trim().length > 0)) yield last;
}

/**
 * The words of `text`, found exactly as `WORDS` finds them, for code that counts outside a
 * formula. `option` is the language tag in `locale` mode. The result is not bounded by
 * `maxWildcardOutputLength`.
 *
 * @experimental May change in a minor release.
 * @throws TypeError when the arguments do not fit the mode: an option outside `locale` mode, or a
 *   missing, empty or unsupported language tag.
 */
export function splitWords(
  text: string,
  mode: WordSplitMode = 'whitespace',
  option?: string,
): string[] {
  if (typeof text !== 'string') throw new TypeError('splitWords expects text');
  if (!isOneOf(WORD_SPLIT_MODES, mode)) {
    throw new TypeError(`splitWords has no mode ${JSON.stringify(mode)}`);
  }
  if (option !== undefined && typeof option !== 'string') {
    throw new TypeError('splitWords option must be text');
  }
  const scan = scanWords('splitWords', text, mode, option ?? null);
  if ('refusal' in scan) throw new TypeError(scan.refusal);
  return Array.from(scan.words);
}

/**
 * The sentences of `text`, split exactly as `SENTENCES` splits them, for code that counts outside
 * a formula. `keep` lists tokens that never end a sentence. The result is not bounded by
 * `maxWildcardOutputLength`.
 *
 * @experimental May change in a minor release.
 * @throws TypeError for an unknown mode or a `keep` entry that is not text.
 */
export function splitSentences(
  text: string,
  mode: SentenceSplitMode = 'punctuation',
  keep: readonly string[] = [],
): string[] {
  if (typeof text !== 'string') throw new TypeError('splitSentences expects text');
  if (!isOneOf(SENTENCE_SPLIT_MODES, mode)) {
    throw new TypeError(`splitSentences has no mode ${JSON.stringify(mode)}`);
  }
  if (!Array.isArray(keep) || keep.some((token) => typeof token !== 'string')) {
    throw new TypeError('splitSentences keep must list text tokens');
  }
  return Array.from(sentencePieces(text, mode, keep));
}

/** Reads `mode?` and `option?` of a word function, or the output to answer instead. */
function readWordModeAndOption(
  fn: string,
  rawMode: unknown,
  rawOption: unknown,
): { mode: WordSplitMode; option: string | null } | { output: FormulaNodeOutput } {
  const mode = readOptionalMode(fn, 'mode', rawMode, WORD_SPLIT_MODES);
  if (typeof mode !== 'string') return { output: mode };
  // An omitted or null option is no option; any other value is one, the empty text included.
  if (rawOption == null) return { mode, option: null };
  if (typeof rawOption !== 'string') {
    return { output: typeWarning(fn, `${fn} option must be text`) };
  }
  return { mode, option: rawOption };
}

/** Reads `(text, mode?, option?)` of a word function, or the output to answer instead. */
function readWordCall(
  fn: string,
  rawText: unknown,
  rawMode: unknown,
  rawOption: unknown,
): { call: WordCall } | { output: FormulaNodeOutput } {
  const text = readText(fn, rawText);
  if (typeof text !== 'string') return { output: text };
  const read = readWordModeAndOption(fn, rawMode, rawOption);
  if ('output' in read) return read;
  return { call: { text, ...read } };
}

/** Collects items, raising `LIST_TOO_LARGE` as soon as there are more than the output limit. */
function boundedItems(items: Iterable<string>, limits: FormulaLimits): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (out.length === limits.maxWildcardOutputLength) throw listTooLarge();
    out.push(item);
  }
  return out;
}

function typeRefusal(fn: string, message: string): FormulaNodeOutput {
  return nullWithWarning(fn, { code: 'TYPE', message });
}

export class WordsImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readWordCall('WORDS', args[0], args[1], args[2]);
    if ('output' in read) return read.output;
    const { text, mode, option } = read.call;
    const scan = scanWords('WORDS', text, mode, option);
    if ('refusal' in scan) return typeRefusal('WORDS', scan.refusal);
    return makeOkList('WORDS', boundedItems(scan.words, ctx.limits));
  }
}

export class WordCountImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readWordCall('WORD_COUNT', args[0], args[1], args[2]);
    if ('output' in read) return read.output;
    const { text, mode, option } = read.call;
    const scan = scanWords('WORD_COUNT', text, mode, option);
    if ('refusal' in scan) return typeRefusal('WORD_COUNT', scan.refusal);
    // Counted without building a list, so a long text can have more words than the output limit.
    return makeOkNumber('WORD_COUNT', countOf(scan.words));
  }
}

export class LeadingWordsImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('LEADING_WORDS', args[0]);
    if (typeof text !== 'string') return text;
    const rawCount = args[1];
    if (rawCount == null) return makeOkNull('LEADING_WORDS');
    const count = asNumber(rawCount);
    if (count === null || !Number.isInteger(count) || count < 1) {
      return typeWarning('LEADING_WORDS', 'LEADING_WORDS count must be a positive whole number');
    }
    const read = readWordModeAndOption('LEADING_WORDS', args[2], args[3]);
    if ('output' in read) return read.output;
    const scan = scanWords('LEADING_WORDS', text, read.mode, read.option);
    if ('refusal' in scan) return typeRefusal('LEADING_WORDS', scan.refusal);
    const words: string[] = [];
    for (const word of scan.words) {
      words.push(word);
      if (words.length === count) break;
    }
    return words.length === count
      ? makeOkText('LEADING_WORDS', words.join(' '))
      : makeOkNull('LEADING_WORDS');
  }
}

export class SentencesImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    // One search of the text per keep token.
    return textCost(args[0], Array.isArray(args[2]) ? args[2].length : 0);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('SENTENCES', args[0]);
    if (typeof text !== 'string') return text;
    const mode = readOptionalMode('SENTENCES', 'mode', args[1], SENTENCE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    const keep = args[2] == null ? [] : readTextList('SENTENCES', 'keep', args[2], ctx.limits);
    if (!Array.isArray(keep)) return keep;
    return makeOkList('SENTENCES', boundedItems(sentencePieces(text, mode, keep), ctx.limits));
  }
}

export class LinesImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('LINES', args[0]);
    if (typeof text !== 'string') return text;
    const mode = readOptionalMode('LINES', 'mode', args[1], LINE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    return makeOkList('LINES', boundedItems(linesOf(text, mode), ctx.limits));
  }
}

export class LineCountImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('LINE_COUNT', args[0]);
    if (typeof text !== 'string') return text;
    const mode = readOptionalMode('LINE_COUNT', 'mode', args[1], LINE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    return makeOkNumber('LINE_COUNT', countOf(linesOf(text, mode)));
  }
}
