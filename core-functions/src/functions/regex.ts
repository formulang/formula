import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaLimits,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkBoolean,
  makeOkNull,
  makeOkText,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedTextLength, isEmptyValue } from './helpers';
import { regexSafetyRefusal } from './regex-safety';

export type RegexCompileFailure =
  'invalid_flags' | 'backreferences' | 'lookbehind' | 'invalid_pattern';

/** A numbered (`\1`) or named (`\k<name>`) backreference. */
const BACKREFERENCE = /\\[1-9]|\\k</;
const LOOKBEHIND = /\(\?<[=!]/;

function parseSlashRegex(patternRaw: string): { source: string; flags: string } {
  // Accept either /.../flags or raw pattern (no flags).
  const m = /^\/(.*)\/([a-z]*)$/.exec(patternRaw);
  if (m) return { source: m[1] ?? '', flags: m[2] ?? '' };
  return { source: patternRaw, flags: '' };
}

/**
 * Compiles an author-supplied regular expression under the safety rules every regex built-in
 * shares: the text and pattern lengths are bounded by `limits` (security errors), a pattern
 * whose backtracking can grow faster than quadratically in the text length is refused
 * (`REGEX_UNSAFE`, see `regexSafetyRefusal`), and flags outside `allowedFlags`, backreferences,
 * lookbehind and invalid patterns come back as a `failure` for the caller to report.
 *
 * `allowedFlags` is tested against the flags the author wrote; `forceGlobal` then adds `g`.
 */
export function compileSafeRegex(args: {
  text: string;
  patternRaw: string;
  limits: FormulaLimits;
  allowSlashSyntax: boolean;
  flagsFromCall?: string;
  allowedFlags: RegExp;
  forceGlobal?: boolean;
}): { re: RegExp | null; failure?: RegexCompileFailure } {
  const { text, patternRaw, limits } = args;

  if (text.length > limits.maxRegexTextLength) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.REGEX_INPUT_TOO_LONG,
      'Regex input text is too long',
      'security',
    );
  }
  if (patternRaw.length > limits.maxRegexPatternLength) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.REGEX_UNSAFE,
      'Regex pattern is too long',
      'security',
    );
  }

  const parts = args.allowSlashSyntax
    ? parseSlashRegex(patternRaw)
    : { source: patternRaw, flags: '' };
  const pattern = parts.source;

  const authoredFlags = args.flagsFromCall ?? parts.flags;
  if (!args.allowedFlags.test(authoredFlags)) return { re: null, failure: 'invalid_flags' };
  const flags =
    args.forceGlobal && !authoredFlags.includes('g') ? `${authoredFlags}g` : authoredFlags;
  if (BACKREFERENCE.test(pattern)) return { re: null, failure: 'backreferences' };
  if (LOOKBEHIND.test(pattern)) return { re: null, failure: 'lookbehind' };

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    return { re: null, failure: 'invalid_pattern' };
  }
  const refusal = regexSafetyRefusal(pattern, flags, limits.maxRegexTextLength);
  if (refusal !== null) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.REGEX_UNSAFE,
      `Regex pattern is not allowed: ${refusal}`,
      'security',
    );
  }
  return { re };
}

export class MatchExpressionImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.02, 0.000001 * assumedTextLength(args[0]));
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const rawText = args[0];
    const rawPattern = args[1];
    const rawFlags = args[2];

    const text = asText(rawText);
    const pattern = asText(rawPattern);
    const flagsRaw = rawFlags == null ? '' : asText(rawFlags);

    if (text == null || pattern == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawText) && text == null)
        warnings.push({
          code: 'TYPE',
          message: 'MATCH_EXPRESSION expects text',
          meta: { arg: 'text' },
        });
      if (!isEmptyValue(rawPattern) && pattern == null)
        warnings.push({
          code: 'TYPE',
          message: 'MATCH_EXPRESSION expects text',
          meta: { arg: 'pattern' },
        });
      const out = makeOkNull('MATCH_EXPRESSION');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }

    const { re, failure } = compileSafeRegex({
      text,
      patternRaw: pattern,
      limits: ctx.limits,
      allowSlashSyntax: false,
      flagsFromCall: flagsRaw ?? '',
      allowedFlags: /^[imsu]*$/,
    });

    if (!re) {
      if (failure === 'invalid_flags') {
        return withWarnings(makeOkNull('MATCH_EXPRESSION'), [
          { code: 'REGEX', message: 'MATCH_EXPRESSION has invalid regex flags' },
        ]);
      }
      if (failure === 'backreferences') {
        return withWarnings(makeOkNull('MATCH_EXPRESSION'), [
          { code: 'REGEX', message: 'MATCH_EXPRESSION does not allow backreferences' },
        ]);
      }
      if (failure === 'lookbehind') {
        return withWarnings(makeOkNull('MATCH_EXPRESSION'), [
          {
            code: 'REGEX',
            message: 'MATCH_EXPRESSION does not allow lookbehind assertions',
          },
        ]);
      }
      return withWarnings(makeOkNull('MATCH_EXPRESSION'), [
        { code: 'REGEX', message: 'MATCH_EXPRESSION has an invalid regex pattern' },
      ]);
    }

    return makeOkBoolean('MATCH_EXPRESSION', re.test(text));
  }
}

export class RegexExtractImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00008;
  }
  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const text = asText(args[0]);
    const pattern = asText(args[1]);
    if (text == null || pattern == null) return makeOkNull('REGEXEXTRACT');

    const { re } = compileSafeRegex({
      text,
      patternRaw: pattern,
      limits: ctx.limits,
      allowSlashSyntax: true,
      allowedFlags: /^[gimsu]*$/,
    });

    if (!re)
      return withWarnings(makeOkNull('REGEXEXTRACT'), [
        { code: 'REGEX', message: 'REGEXEXTRACT has an invalid or disallowed regex pattern' },
      ]);
    const m = re.exec(text);
    if (!m) return makeOkNull('REGEXEXTRACT');
    if (m.length >= 2) return makeOkText('REGEXEXTRACT', m[1] ?? '');
    return makeOkText('REGEXEXTRACT', m[0] ?? '');
  }
}

export class RegexReplaceImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.0001;
  }
  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const text = asText(args[0]);
    const pattern = asText(args[1]);
    const replacement = asText(args[2]);
    if (text == null || pattern == null || replacement == null) return makeOkNull('REGEXREPLACE');

    const { re } = compileSafeRegex({
      text,
      patternRaw: pattern,
      limits: ctx.limits,
      allowSlashSyntax: true,
      allowedFlags: /^[gimsu]*$/,
      forceGlobal: true,
    });

    if (!re)
      return withWarnings(makeOkNull('REGEXREPLACE'), [
        { code: 'REGEX', message: 'REGEXREPLACE has an invalid or disallowed regex pattern' },
      ]);
    try {
      return makeOkText('REGEXREPLACE', text.replace(re, replacement));
    } catch {
      return makeOkNull('REGEXREPLACE');
    }
  }
}
