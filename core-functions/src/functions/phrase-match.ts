import type { FormulaExecutionContext, FormulaNodeOutput } from '@formulang/definitions';
import { makeOkBoolean, makeOkList, makeOkNull, makeOkText } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import {
  readOptionalMode,
  readText,
  readTextList,
  textCost,
  typeWarning,
} from './argument-readers';
import { isWordCharacter } from './helpers';
import { someOccurrence } from './text-search';
import { CountedText, workOf, type WorkCount, type WorkCountingConfig } from './work-count';

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
 * Whether `phrase` occurs in `text`, anywhere (`substring`) or with no letter, mark or number
 * directly on either side (`word`), in work linear in their lengths: both are read through their
 * counts, the characters on either side of an occurrence included.
 */
function contains(text: CountedText, phrase: CountedText, match: PhraseMatchMode): boolean {
  return someOccurrence(
    text,
    phrase,
    (at) =>
      match === 'substring' ||
      (!isWordCharacter(text.characterBefore(at)) &&
        !isWordCharacter(text.characterAt(at + phrase.length))),
  );
}

/**
 * The first phrase, in list order, that the text contains; `null` when none does. `work` counts
 * the characters the searches read.
 */
function firstContained(
  text: string,
  phrases: readonly string[],
  match: PhraseMatchMode,
  ignoreCase: boolean,
  work: WorkCount,
): string | null {
  const haystack = new CountedText(ignoreCase ? text.toLowerCase() : text, work);
  for (const phrase of phrases) {
    const needle = new CountedText(ignoreCase ? phrase.toLowerCase() : phrase, work);
    if (contains(haystack, needle, match)) return phrase;
  }
  return null;
}

type PhraseCall = {
  text: string;
  phrases: string[];
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
  if (args[1] == null || args[1] === '') return { output: makeOkNull(fn) };
  const phrases = readTextList(fn, 'phrases', args[1], ctx.limits);
  if (!Array.isArray(phrases)) return { output: phrases };
  const match = readOptionalMode(fn, 'match', args[2], PHRASE_MATCH_MODES);
  if (typeof match !== 'string') return { output: match };
  const rawIgnoreCase = args[3];
  if (rawIgnoreCase != null && typeof rawIgnoreCase !== 'boolean') {
    return { output: typeWarning(fn, `${fn} ignoreCase must be a boolean`) };
  }
  return { call: { text, phrases, match, ignoreCase: rawIgnoreCase === true } };
}

export class FirstContainedImplementation extends AbstractEagerBatchImplementation<WorkCountingConfig> {
  constructor(config: WorkCountingConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0], 1 + (Array.isArray(args[1]) ? args[1].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readPhraseCall('FIRST_CONTAINED', args, ctx);
    if ('output' in read) return read.output;
    const { text, phrases, match, ignoreCase } = read.call;
    const phrase = firstContained(text, phrases, match, ignoreCase, workOf(this.config));
    return phrase === null ? makeOkNull('FIRST_CONTAINED') : makeOkText('FIRST_CONTAINED', phrase);
  }
}

export class ContainsAnyImplementation extends AbstractEagerBatchImplementation<WorkCountingConfig> {
  constructor(config: WorkCountingConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[0], 1 + (Array.isArray(args[1]) ? args[1].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const read = readPhraseCall('CONTAINS_ANY', args, ctx);
    if ('output' in read) return read.output;
    const { text, phrases, match, ignoreCase } = read.call;
    const phrase = firstContained(text, phrases, match, ignoreCase, workOf(this.config));
    return makeOkBoolean('CONTAINS_ANY', phrase !== null);
  }
}

export class MissingFromImplementation extends AbstractEagerBatchImplementation<WorkCountingConfig> {
  constructor(config: WorkCountingConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return textCost(args[1], 1 + (Array.isArray(args[0]) ? args[0].length : 0));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    if (args[0] == null || args[0] === '') return makeOkNull('MISSING_FROM');
    const items = readTextList('MISSING_FROM', 'items', args[0], ctx.limits);
    if (!Array.isArray(items)) return items;
    const text = readText('MISSING_FROM', args[1]);
    if (typeof text !== 'string') return text;
    const mode = readOptionalMode('MISSING_FROM', 'normalise', args[2], PHRASE_NORMALISATIONS);
    if (typeof mode !== 'string') return mode;

    const work = workOf(this.config);
    const haystack = new CountedText(normalise(text, mode), work);
    const missing = items.filter((item) => {
      const needle = new CountedText(normalise(item, mode), work);
      return needle.length > 0 && !contains(haystack, needle, 'substring');
    });
    return makeOkList('MISSING_FROM', missing);
  }
}
