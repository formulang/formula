import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaNodeOutput,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkBoolean,
  makeOkList,
  makeOkNull,
  makeOkText,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import {
  readOptionalMode,
  readText,
  readTextList,
  textCost,
  typeWarning,
} from './argument-readers';
import { isWordCharacterAt, isWordCharacterBefore } from './helpers';
import { someOccurrence } from './text-search';
import { chargeWork } from './work-meter';

/**
 * The longest phrase, in code units as searched for, that the phrase functions take. Each phrase
 * goes to the runtime's own substring search, which V8 builds its Boyer-Moore tables for over a
 * needle's last 250 code units: up to that length they cover the whole phrase, while a longer one
 * whose mismatch lies before them is compared afresh at almost every place in the text. A longer
 * phrase is refused, as an over-long regular expression is.
 */
const LONGEST_PHRASE = 250;

/** Refuses the phrases when one, as searched for, is longer than `LONGEST_PHRASE`. */
function checkPhraseLengths(fn: string, needles: readonly string[]): void {
  if (needles.some((needle) => needle.length > LONGEST_PHRASE)) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.PHRASE_TOO_LONG,
      `${fn} takes phrases of at most ${LONGEST_PHRASE} code units`,
      'security',
    );
  }
}

/** How `FIRST_CONTAINED` and `CONTAINS_ANY` match a phrase. */
export type PhraseMatchMode = 'substring' | 'word';

/** How `MISSING_FROM` normalises both sides before comparing. */
export type PhraseNormalisation = 'whitespace' | 'exact' | 'loose';

/** The `match` literals; the first is the default. */
export const PHRASE_MATCH_MODES: readonly PhraseMatchMode[] = ['substring', 'word'];

/** The `normalise` literals; the first is the default. */
export const PHRASE_NORMALISATIONS: readonly PhraseNormalisation[] = [
  'whitespace',
  'exact',
  'loose',
];

const WHITESPACE_RUN = /\s+/gu;

/** Typographic single quotes and guillemets that `loose` folds to `'`. */
const TYPOGRAPHIC_SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2039\u203A]/gu;

/** Typographic double quotes and guillemets that `loose` folds to `"`. */
const TYPOGRAPHIC_DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u00AB\u00BB]/gu;

/** Hyphens, dashes and the minus sign that `loose` folds to `-`. */
const TYPOGRAPHIC_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu;

function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim();
}

function normalise(value: string, mode: PhraseNormalisation): string {
  switch (mode) {
    case 'exact':
      return value;
    case 'whitespace':
      return collapseWhitespace(value);
    case 'loose':
      return collapseWhitespace(
        value
          .replace(TYPOGRAPHIC_SINGLE_QUOTES, "'")
          .replace(TYPOGRAPHIC_DOUBLE_QUOTES, '"')
          .replace(TYPOGRAPHIC_DASHES, '-')
          .toLowerCase(),
      );
  }
}

/**
 * Whether `phrase` occurs in `text` with no letter, mark or number directly on either side: one
 * Knuth-Morris-Pratt search, linear in their lengths however often the occurrences overlap.
 */
function containsAsWord(text: string, phrase: string): boolean {
  return someOccurrence(
    text,
    phrase,
    (at) => !isWordCharacterBefore(text, at) && !isWordCharacterAt(text, at + phrase.length),
  );
}

/**
 * The first phrase, in list order, that the text contains; `null` when none does: per phrase, the
 * runtime's substring search (`"substring"`) or one `"word"` search. `needles` are the phrases as
 * searched for, lower-cased when `ignoreCase` is set.
 */
function firstContained(
  text: string,
  phrases: readonly string[],
  needles: readonly string[],
  match: PhraseMatchMode,
  ignoreCase: boolean,
): string | null {
  const haystack = ignoreCase ? text.toLowerCase() : text;
  for (let index = 0; index < phrases.length; index++) {
    const needle = needles[index];
    if (match === 'word') {
      if (containsAsWord(haystack, needle)) return phrases[index];
      continue;
    }
    // The runtime's own search: one unit for each code unit of the text handed to it.
    chargeWork(haystack.length);
    if (haystack.includes(needle)) return phrases[index];
  }
  return null;
}

type PhraseCall = {
  text: string;
  phrases: string[];
  needles: string[];
  match: PhraseMatchMode;
  ignoreCase: boolean;
};

/** Reads `(text, phrases, match?, ignoreCase?)`; an output when the call answers null. */
function readPhraseCall(
  fn: string,
  args: unknown[],
  ctx: FormulaExecutionContext,
): { call: PhraseCall } | { output: FormulaNodeOutput } {
  const text = readText(fn, args[0]);
  if (typeof text !== 'string') return { output: text };
  if (args[1] == null) return { output: makeOkNull(fn) };
  const phrases = readTextList(fn, 'phrases', args[1], ctx.limits);
  if (!Array.isArray(phrases)) return { output: phrases };
  const match = readOptionalMode(fn, 'match', args[2], PHRASE_MATCH_MODES);
  if (typeof match !== 'string') return { output: match };
  const rawIgnoreCase = args[3];
  if (rawIgnoreCase != null && typeof rawIgnoreCase !== 'boolean') {
    return { output: typeWarning(fn, `${fn} ignoreCase must be a boolean`) };
  }
  const ignoreCase = rawIgnoreCase === true;
  const needles = ignoreCase ? phrases.map((phrase) => phrase.toLowerCase()) : phrases;
  checkPhraseLengths(fn, needles);
  return { call: { text, phrases, needles, match, ignoreCase } };
}

export class FirstContainedImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0], 1 + (Array.isArray(args[1]) ? args[1].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readPhraseCall('FIRST_CONTAINED', args, ctx);
    if ('output' in read) return read.output;
    const { text, phrases, needles, match, ignoreCase } = read.call;
    const phrase = firstContained(text, phrases, needles, match, ignoreCase);
    return phrase === null ? makeOkNull('FIRST_CONTAINED') : makeOkText('FIRST_CONTAINED', phrase);
  }
}

export class ContainsAnyImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0], 1 + (Array.isArray(args[1]) ? args[1].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readPhraseCall('CONTAINS_ANY', args, ctx);
    if ('output' in read) return read.output;
    const { text, phrases, needles, match, ignoreCase } = read.call;
    const phrase = firstContained(text, phrases, needles, match, ignoreCase);
    return makeOkBoolean('CONTAINS_ANY', phrase !== null);
  }
}

export class MissingFromImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[1], 1 + (Array.isArray(args[0]) ? args[0].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    if (args[0] == null) return makeOkNull('MISSING_FROM');
    const items = readTextList('MISSING_FROM', 'items', args[0], ctx.limits);
    if (!Array.isArray(items)) return items;
    const text = readText('MISSING_FROM', args[1]);
    if (typeof text !== 'string') return text;
    const mode = readOptionalMode('MISSING_FROM', 'normalise', args[2], PHRASE_NORMALISATIONS);
    if (typeof mode !== 'string') return mode;

    const needles = items.map((item) => normalise(item, mode));
    checkPhraseLengths('MISSING_FROM', needles);
    const haystack = normalise(text, mode);
    const missing = items.filter((_item, index) => {
      if (needles[index].length === 0) return false;
      // The runtime's own search: one unit for each code unit of the text handed to it.
      chargeWork(haystack.length);
      return !haystack.includes(needles[index]);
    });
    return makeOkList('MISSING_FROM', missing);
  }
}
