import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaLimits,
  FormulaNodeOutput,
  FormulaWarning,
} from '@formulang/definitions';
import {
  DEFAULT_FORMULA_LIMITS,
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkList,
  makeOkNull,
  makeOkNumber,
  makeOkText,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedTextLength, isEmptyValue, isWordCharacterBefore } from './helpers';
import { compileSafeRegex, type RegexCompileFailure } from './regex';

/** How `WORDS`, `WORD_COUNT` and `LEADING_WORDS` find the words of a text. */
export type WordSplitMode = 'whitespace' | 'letters' | 'locale' | 'pattern';

/** How `SENTENCES` finds the sentences of a text. */
export type SentenceSplitMode = 'punctuation' | 'terminators';

/** Which lines `LINES` and `LINE_COUNT` keep. */
export type LineSplitMode = 'non-blank' | 'all';

/** The `mode` literals of the word functions, as the definitions declare them; the first is the default. */
export const WORD_SPLIT_MODES: readonly WordSplitMode[] = [
  'whitespace',
  'letters',
  'locale',
  'pattern',
];

/** The `mode` literals of `SENTENCES`; the first is the default. */
export const SENTENCE_SPLIT_MODES: readonly SentenceSplitMode[] = ['punctuation', 'terminators'];

/** The `mode` literals of `LINES` and `LINE_COUNT`; the first is the default. */
export const LINE_SPLIT_MODES: readonly LineSplitMode[] = ['non-blank', 'all'];

/** `whitespace` mode: a maximal run of characters that are not whitespace. */
const NON_WHITESPACE_RUN = /\S+/gu;

/**
 * `letters` mode: runs of letters, marks and numbers, joined into one word by an apostrophe
 * (`'`, U+2019) or a hyphen (`-`, U+2010, U+2011, soft hyphen U+00AD) between two runs, and by
 * `.` or `,` between two digits.
 */
const LETTER_WORD =
  /[\p{L}\p{M}\p{N}]+(?:(?:['\u2019\u2010\u2011\u00AD-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*/gu;

/** `punctuation` mode: a whitespace run directly after `.`, `!` or `?` ends a sentence. */
const PUNCTUATION_BREAK = /(?<=[.!?])\s+/gu;

/** `terminators` mode: every run of `.`, `!`, `?` and their full-width forms ends a sentence. */
const TERMINATOR_RUN = /[.!?\u3002\uFF01\uFF1F]+/gu;

/** A character of a `terminators` piece that is neither whitespace nor a terminator. */
const SENTENCE_CONTENT = /[^\s.!?\u3002\uFF01\uFF1F]/u;

/** The Unicode mandatory line breaks; `\r\n` is one break. */
const LINE_BREAK = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/u;

/** `pattern` mode admits the flags `MATCH_EXPRESSION` admits; `g` is implied. */
const PATTERN_FLAGS = /^[imsu]*$/;

type Refusal = { code: 'TYPE' | 'REGEX'; message: string };
type WordScan = { words: Iterable<string> } | { refusal: Refusal };
type WordCall = { text: string; mode: WordSplitMode; option: string | null };

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function nullWithWarning(fn: string, warning: FormulaWarning): FormulaNodeOutput {
  return withWarnings(makeOkNull(fn), [warning]);
}

function typeWarning(fn: string, message: string): FormulaNodeOutput {
  return nullWithWarning(fn, { code: 'TYPE', message });
}

function listTooLarge(): FormulaRuntimeError {
  return new FormulaRuntimeError(FormulaErrorCodes.LIST_TOO_LARGE, 'List is too large', 'security');
}

function textCost(text: unknown, factor = 1): number {
  return Math.min(0.05, 0.00001 + 0.000001 * assumedTextLength(text) * factor);
}

function countOf(items: Iterable<unknown>): number {
  const iterator = items[Symbol.iterator]();
  let count = 0;
  while (iterator.next().done !== true) count += 1;
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

/** A word segmenter for a tag the runtime holds segmentation data for; `null` otherwise. */
function createWordSegmenter(tag: string): Intl.Segmenter | null {
  try {
    // An unsupported tag would silently fall back to the host's default locale.
    if (Intl.Segmenter.supportedLocalesOf([tag]).length === 0) return null;
    return new Intl.Segmenter(tag, { granularity: 'word' });
  } catch {
    // RangeError: not a structurally valid BCP 47 language tag.
    return null;
  }
}

function regexRefusal(fn: string, failure: RegexCompileFailure | undefined): Refusal {
  switch (failure) {
    case 'invalid_flags':
      return { code: 'REGEX', message: `${fn} has invalid regex flags` };
    case 'backreferences':
      return { code: 'REGEX', message: `${fn} does not allow backreferences` };
    case 'lookbehind':
      return { code: 'REGEX', message: `${fn} does not allow lookbehind assertions` };
    case 'invalid_pattern':
    case undefined:
      return { code: 'REGEX', message: `${fn} has an invalid regex pattern` };
  }
}

/**
 * The words of `text` under `mode`. `option` is the language tag (`locale`) or the token pattern
 * (`pattern`), `null` when absent. A mode/option combination that cannot be honoured comes back
 * as a refusal; a pattern beyond the safe-regex limits throws a security error.
 */
function scanWords(
  fn: string,
  text: string,
  mode: WordSplitMode,
  option: string | null,
  limits: FormulaLimits,
): WordScan {
  switch (mode) {
    case 'whitespace':
    case 'letters':
      if (option !== null) {
        return {
          refusal: {
            code: 'TYPE',
            message: `${fn} accepts an option only in the locale and pattern modes`,
          },
        };
      }
      return {
        words: nonEmptyMatches(text, mode === 'whitespace' ? NON_WHITESPACE_RUN : LETTER_WORD),
      };
    case 'locale': {
      if (option === null) {
        return {
          refusal: { code: 'TYPE', message: `${fn} needs a BCP 47 language tag in locale mode` },
        };
      }
      const segmenter = createWordSegmenter(option);
      if (segmenter === null) {
        return {
          refusal: {
            code: 'TYPE',
            message: `${fn} has no word segmentation for the language tag ${JSON.stringify(option)}`,
          },
        };
      }
      return { words: wordLikeSegments(segmenter, text) };
    }
    case 'pattern': {
      if (option === null) {
        return { refusal: { code: 'TYPE', message: `${fn} needs a pattern in pattern mode` } };
      }
      const { re, failure } = compileSafeRegex({
        text,
        patternRaw: option,
        limits,
        allowSlashSyntax: true,
        allowedFlags: PATTERN_FLAGS,
        forceGlobal: true,
      });
      if (re === null) return { refusal: regexRefusal(fn, failure) };
      return { words: nonEmptyMatches(text, re) };
    }
  }
}

/**
 * The split positions a `keep` token protects: every position inside or at the end of an
 * occurrence that starts at a word boundary. `null` when no token occurs.
 */
function protectedPositions(text: string, keep: readonly string[]): Uint8Array | null {
  let depth: Int32Array | null = null;
  for (const token of keep) {
    if (token.length === 0) continue;
    for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
      if (isWordCharacterBefore(text, at)) continue;
      if (depth === null) depth = new Int32Array(text.length + 2);
      depth[at + 1] += 1;
      depth[at + token.length + 1] -= 1;
    }
  }
  if (depth === null) return null;
  const marks = new Uint8Array(text.length + 1);
  let open = 0;
  for (let position = 0; position <= text.length; position++) {
    open += depth[position];
    marks[position] = open > 0 ? 1 : 0;
  }
  return marks;
}

function sentencePieces(text: string, mode: SentenceSplitMode, keep: readonly string[]): string[] {
  const protectedAt = keep.length > 0 ? protectedPositions(text, keep) : null;
  const pieces: string[] = [];
  let start = 0;
  if (mode === 'punctuation') {
    for (const match of text.matchAll(PUNCTUATION_BREAK)) {
      if (protectedAt !== null && protectedAt[match.index] === 1) continue;
      const piece = text.slice(start, match.index).trim();
      if (piece.length > 0) pieces.push(piece);
      start = match.index + match[0].length;
    }
    const last = text.slice(start).trim();
    if (last.length > 0) pieces.push(last);
    return pieces;
  }
  for (const match of text.matchAll(TERMINATOR_RUN)) {
    const end = match.index + match[0].length;
    if (protectedAt !== null && protectedAt[end] === 1) continue;
    const piece = text.slice(start, end).trim();
    if (SENTENCE_CONTENT.test(piece)) pieces.push(piece);
    start = end;
  }
  const last = text.slice(start).trim();
  if (SENTENCE_CONTENT.test(last)) pieces.push(last);
  return pieces;
}

function splitLines(text: string, mode: LineSplitMode): string[] {
  const lines = text.split(LINE_BREAK);
  // A final line break ends the last line rather than starting an empty one.
  if (lines[lines.length - 1] === '') lines.pop();
  return mode === 'all' ? lines : lines.filter((line) => line.trim().length > 0);
}

/**
 * The words of `text`, found exactly as `WORDS` finds them, for embedders that count outside a
 * formula and must count the same words. `option` is the BCP 47 language tag in `locale` mode
 * and the token pattern in `pattern` mode, where the default safe-regex limits apply. The result
 * is not bounded by `maxWildcardOutputLength`.
 *
 * @throws TypeError when the arguments do not fit the mode: an option outside the `locale` and
 *   `pattern` modes, a missing or unsupported language tag, a missing or refused pattern.
 * @throws FormulaRuntimeError (`REGEX_UNSAFE`, `REGEX_INPUT_TOO_LONG`) for a pattern or text
 *   beyond the safe-regex limits.
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
  const scan = scanWords(
    'splitWords',
    text,
    mode,
    option === undefined || option.length === 0 ? null : option,
    DEFAULT_FORMULA_LIMITS,
  );
  if ('refusal' in scan) throw new TypeError(scan.refusal.message);
  return Array.from(scan.words);
}

/**
 * The sentences of `text`, split exactly as `SENTENCES` splits them, for embedders that count
 * outside a formula. `keep` lists tokens that never end a sentence. The result is not bounded by
 * `maxWildcardOutputLength`.
 *
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
  return sentencePieces(text, mode, keep);
}

/** Reads an optional mode literal: absent or empty selects the first (default) mode. */
function readMode<M extends string>(
  fn: string,
  raw: unknown,
  modes: readonly M[],
): M | FormulaNodeOutput {
  if (isEmptyValue(raw)) return modes[0];
  if (isOneOf(modes, raw)) return raw;
  return typeWarning(
    fn,
    `${fn} mode must be one of ${modes.map((mode) => JSON.stringify(mode)).join(', ')}`,
  );
}

function readText(fn: string, raw: unknown): string | FormulaNodeOutput {
  if (typeof raw === 'string') return raw;
  return isEmptyValue(raw) ? makeOkNull(fn) : typeWarning(fn, `${fn} expects text`);
}

/** Reads `(text, mode?, option?)` of a word function; an output when the call answers null. */
function readWordCall(
  fn: string,
  rawText: unknown,
  rawMode: unknown,
  hasOption: boolean,
  rawOption: unknown,
): { call: WordCall } | { output: FormulaNodeOutput } {
  const text = readText(fn, rawText);
  if (typeof text !== 'string') return { output: text };
  const mode = readMode(fn, rawMode, WORD_SPLIT_MODES);
  if (typeof mode !== 'string') return { output: mode };
  if (!hasOption || isEmptyValue(rawOption)) {
    // An empty language tag or pattern is an empty input: null in, null out.
    if (hasOption && (mode === 'locale' || mode === 'pattern')) return { output: makeOkNull(fn) };
    return { call: { text, mode, option: null } };
  }
  if (typeof rawOption !== 'string')
    return { output: typeWarning(fn, `${fn} option must be text`) };
  return { call: { text, mode, option: rawOption } };
}

/** Reads an optional list of text tokens; empty entries are skipped. */
function readTokenList(
  fn: string,
  param: string,
  raw: unknown,
  limits: FormulaLimits,
): string[] | FormulaNodeOutput {
  if (isEmptyValue(raw)) return [];
  if (!Array.isArray(raw)) return typeWarning(fn, `${fn} ${param} must be a list of text`);
  if (raw.length > limits.maxListLength) throw listTooLarge();
  const tokens: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.length > 0) tokens.push(item);
    } else if (!isEmptyValue(item)) {
      return typeWarning(fn, `${fn} ${param} must be a list of text`);
    }
  }
  return tokens;
}

/** Collects words, refusing more than the output limit allows. */
function boundedWords(words: Iterable<string>, limits: FormulaLimits): string[] {
  const out: string[] = [];
  for (const word of words) {
    if (out.length === limits.maxWildcardOutputLength) throw listTooLarge();
    out.push(word);
  }
  return out;
}

export class WordsImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readWordCall('WORDS', args[0], args[1], args.length >= 3, args[2]);
    if ('output' in read) return read.output;
    const { text, mode, option } = read.call;
    const scan = scanWords('WORDS', text, mode, option, ctx.limits);
    if ('refusal' in scan) return nullWithWarning('WORDS', scan.refusal);
    return makeOkList('WORDS', boundedWords(scan.words, ctx.limits));
  }
}

export class WordCountImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readWordCall('WORD_COUNT', args[0], args[1], args.length >= 3, args[2]);
    if ('output' in read) return read.output;
    const { text, mode, option } = read.call;
    const scan = scanWords('WORD_COUNT', text, mode, option, ctx.limits);
    if ('refusal' in scan) return nullWithWarning('WORD_COUNT', scan.refusal);
    // Counted without building a list, so a long text is countable past the output limit.
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

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readWordCall('LEADING_WORDS', args[0], args[2], args.length >= 4, args[3]);
    if ('output' in read) return read.output;
    const rawCount = args[1];
    if (isEmptyValue(rawCount)) return makeOkNull('LEADING_WORDS');
    const count = asNumber(rawCount);
    if (count === null || !Number.isInteger(count) || count < 1) {
      return typeWarning('LEADING_WORDS', 'LEADING_WORDS count must be a positive whole number');
    }
    const { text, mode, option } = read.call;
    const scan = scanWords('LEADING_WORDS', text, mode, option, ctx.limits);
    if ('refusal' in scan) return nullWithWarning('LEADING_WORDS', scan.refusal);
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
    return textCost(args[0], 1 + (Array.isArray(args[2]) ? args[2].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('SENTENCES', args[0]);
    if (typeof text !== 'string') return text;
    const mode = readMode('SENTENCES', args[1], SENTENCE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    const keep = readTokenList('SENTENCES', 'keep', args[2], ctx.limits);
    if (!Array.isArray(keep)) return keep;
    const sentences = sentencePieces(text, mode, keep);
    if (sentences.length > ctx.limits.maxWildcardOutputLength) throw listTooLarge();
    return makeOkList('SENTENCES', sentences);
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
    const mode = readMode('LINES', args[1], LINE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    const lines = splitLines(text, mode);
    if (lines.length > ctx.limits.maxWildcardOutputLength) throw listTooLarge();
    return makeOkList('LINES', lines);
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
    const mode = readMode('LINE_COUNT', args[1], LINE_SPLIT_MODES);
    if (typeof mode !== 'string') return mode;
    return makeOkNumber('LINE_COUNT', splitLines(text, mode).length);
  }
}
