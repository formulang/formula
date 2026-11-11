import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
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

type RegexCompileFailure = 'invalid_flags' | 'backreferences' | 'lookbehind' | 'invalid_pattern';

function isProbablySafeRegex(pattern: string): boolean {
  // Conservative heuristics to reduce ReDoS risk.
  // Disallow nested quantifiers like (a+)+, (?:.*)*, (x{1,3})+
  if (/\([^)]*[+*{][^)]*\)[+*{]/.test(pattern)) return false;
  // Disallow alternation inside a quantified group: (a|aa)+
  if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern)) return false;
  return true;
}

function parseSlashRegex(patternRaw: string): { source: string; flags: string } {
  // Accept either /.../flags or raw pattern (no flags).
  const m = /^\/(.*)\/([a-z]*)$/.exec(patternRaw);
  if (m) return { source: m[1] ?? '', flags: m[2] ?? '' };
  return { source: patternRaw, flags: '' };
}

function compileSafeRegex(args: {
  text: string;
  patternRaw: string;
  ctx: FormulaExecutionContext;
  allowSlashSyntax: boolean;
  flagsFromCall?: string;
  allowedFlags: RegExp;
  forceGlobal?: boolean;
}): { re: RegExp | null; failure?: RegexCompileFailure } {
  const { text, patternRaw, ctx } = args;

  const limits = ctx.limits;
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

  let flags = args.flagsFromCall ?? parts.flags;
  if (args.forceGlobal && !flags.includes('g')) flags = `${flags}g`;

  if (!args.allowedFlags.test(flags)) return { re: null, failure: 'invalid_flags' };
  if (/\\[1-9]/.test(pattern)) return { re: null, failure: 'backreferences' };
  if (/(\(\?<=|\(\?<!)/.test(pattern)) return { re: null, failure: 'lookbehind' };

  if (!isProbablySafeRegex(pattern)) {
    throw new FormulaRuntimeError(
      FormulaErrorCodes.REGEX_UNSAFE,
      'Regex pattern is not allowed',
      'security',
    );
  }

  try {
    return { re: new RegExp(pattern, flags) };
  } catch {
    return { re: null, failure: 'invalid_pattern' };
  }
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
      ctx,
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
      ctx,
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
      ctx,
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
