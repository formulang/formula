import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, makeOkText, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, asText, assumedTextLength, isEmptyValue } from './helpers';

function nullType(fn: string, message: string) {
  return withWarnings(makeOkNull(fn), [{ code: 'TYPE', message }]);
}

function toTextValue(value: unknown): string | null {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const v: any = value;
    const kind = v?.__formula_object_kind;
    if ((kind === 'date' || kind === 'time' || kind === 'datetime') && typeof v?.iso === 'string') {
      return v.iso;
    }
  }
  return null;
}

export class ToTextImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.005, 0.000001 * assumedTextLength(args[0]));
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    if (raw == null) return makeOkNull('TO_TEXT');
    const out = toTextValue(raw);
    return out == null ? makeOkNull('TO_TEXT') : makeOkText('TO_TEXT', out);
  }
}

export class CharImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const n = asNumber(raw);
    if (n == null) {
      if (!isEmptyValue(raw)) return nullType('CHAR', 'CHAR expects a number');
      return makeOkNull('CHAR');
    }
    const code = Math.trunc(n);
    // Don't allow 0 or out-of-range code points.
    if (code <= 0 || code > 0x10ffff) return makeOkNull('CHAR');
    try {
      return makeOkText('CHAR', String.fromCodePoint(code));
    } catch {
      return makeOkNull('CHAR');
    }
  }
}

export class LeftImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const textRaw = args[0];
    const text = asText(textRaw);
    const nRaw = args.length >= 2 ? args[1] : 1;
    if (text == null) {
      if (!isEmptyValue(textRaw)) return nullType('LEFT', 'LEFT expects text');
      return makeOkNull('LEFT');
    }
    const n = nRaw == null ? 1 : asNumber(nRaw);
    if (n == null) {
      if (!isEmptyValue(nRaw))
        return nullType('LEFT', 'LEFT number_of_characters must be a number');
      return makeOkNull('LEFT');
    }
    const k = Math.max(0, Math.trunc(n));
    return makeOkText('LEFT', text.slice(0, k));
  }
}

export class RightImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const textRaw = args[0];
    const text = asText(textRaw);
    const nRaw = args.length >= 2 ? args[1] : 1;
    if (text == null) {
      if (!isEmptyValue(textRaw)) return nullType('RIGHT', 'RIGHT expects text');
      return makeOkNull('RIGHT');
    }
    const n = nRaw == null ? 1 : asNumber(nRaw);
    if (n == null) {
      if (!isEmptyValue(nRaw))
        return nullType('RIGHT', 'RIGHT number_of_characters must be a number');
      return makeOkNull('RIGHT');
    }
    const k = Math.max(0, Math.trunc(n));
    return makeOkText('RIGHT', k === 0 ? '' : text.slice(-k));
  }
}

export class MidImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00004;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const textRaw = args[0];
    const text = asText(textRaw);
    const startRaw = args[1];
    const lenRaw = args[2];
    if (text == null) {
      if (!isEmptyValue(textRaw)) return nullType('MID', 'MID expects text');
      return makeOkNull('MID');
    }
    const start = asNumber(startRaw);
    const len = asNumber(lenRaw);
    if (start == null || len == null) {
      if (!isEmptyValue(startRaw) || !isEmptyValue(lenRaw))
        return nullType('MID', 'MID expects (text, starting_at, extract_length)');
      return makeOkNull('MID');
    }
    const s = Math.max(1, Math.trunc(start));
    const l = Math.max(0, Math.trunc(len));
    return makeOkText('MID', text.substr(s - 1, l));
  }
}

export class ReplaceImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00005;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const textRaw = args[0];
    const text = asText(textRaw);
    const posRaw = args[1];
    const lenRaw = args[2];
    const newTextRaw = args[3];
    const newText = asText(newTextRaw);

    if (text == null || newText == null) {
      if (!isEmptyValue(textRaw) || !isEmptyValue(newTextRaw))
        return nullType('REPLACE', 'REPLACE expects text inputs');
      return makeOkNull('REPLACE');
    }
    const pos = asNumber(posRaw);
    const len = asNumber(lenRaw);
    if (pos == null || len == null) {
      if (!isEmptyValue(posRaw) || !isEmptyValue(lenRaw))
        return nullType('REPLACE', 'REPLACE expects (text, position, length, new_text)');
      return makeOkNull('REPLACE');
    }
    const p = Math.max(1, Math.trunc(pos));
    const l = Math.max(0, Math.trunc(len));
    const startIdx = p - 1;
    return makeOkText('REPLACE', text.slice(0, startIdx) + newText + text.slice(startIdx + l));
  }
}

export class SubstituteImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00006;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const text = asText(args[0]);
    const searchFor = asText(args[1]);
    const replaceWith = asText(args[2]);
    const occurrenceRaw = args.length >= 4 ? args[3] : null;

    if (text == null || searchFor == null || replaceWith == null) {
      return makeOkNull('SUBSTITUTE');
    }

    if (occurrenceRaw == null || isEmptyValue(occurrenceRaw)) {
      if (searchFor.length === 0) return makeOkText('SUBSTITUTE', text);
      return makeOkText('SUBSTITUTE', text.split(searchFor).join(replaceWith));
    }

    const occ = asNumber(occurrenceRaw);
    if (occ == null || !Number.isInteger(occ) || occ <= 0) return makeOkNull('SUBSTITUTE');
    if (searchFor.length === 0) return makeOkText('SUBSTITUTE', text);

    let idx = -1;
    let from = 0;
    for (let i = 0; i < occ; i++) {
      idx = text.indexOf(searchFor, from);
      if (idx < 0) return makeOkText('SUBSTITUTE', text);
      from = idx + searchFor.length;
    }
    return makeOkText(
      'SUBSTITUTE',
      text.slice(0, idx) + replaceWith + text.slice(idx + searchFor.length),
    );
  }
}

export class TrimImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00004;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) return nullType('TRIM', 'TRIM expects text');
      return makeOkNull('TRIM');
    }
    const out = t.trim().replace(/[ \t\r\n]+/g, ' ');
    return makeOkText('TRIM', out);
  }
}

export class EncodeUrlImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) return nullType('ENCODEURL', 'ENCODEURL expects text');
      return makeOkNull('ENCODEURL');
    }
    return makeOkText('ENCODEURL', encodeURIComponent(t));
  }
}

export class IsUrlImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }

  private isValidHostname(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host.length === 0 || host.length > 253) return false;
    if (host.startsWith('.') || host.endsWith('.')) return false;
    const labels = host.split('.');
    if (labels.length < 2) return false;
    const tld = labels[labels.length - 1] ?? '';
    if (!/^[a-z]{2,63}$/.test(tld)) return false;
    for (const label of labels) {
      if (label.length === 0 || label.length > 63) return false;
      if (!/^[a-z0-9-]+$/.test(label)) return false;
      if (label.startsWith('-') || label.endsWith('-')) return false;
    }
    return true;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) return makeOkBoolean('ISURL', false);

    const s = t.trim();
    if (s.length === 0) return makeOkBoolean('ISURL', false);
    const allowedSchemes = new Set([
      'http',
      'https',
      'ftp',
      'gopher',
      'mailto',
      'news',
      'telnet',
      'aim',
    ]);

    const schemeMatch = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(s);
    if (schemeMatch) {
      const scheme = (schemeMatch[1] ?? '').toLowerCase();
      if (!allowedSchemes.has(scheme)) return makeOkBoolean('ISURL', false);
      const rest = schemeMatch[2] ?? '';
      if (rest.length === 0) return makeOkBoolean('ISURL', false);

      // Try to validate host-based schemes via URL parsing.
      if (scheme === 'http' || scheme === 'https' || scheme === 'ftp' || scheme === 'gopher') {
        try {
          const u = new URL(s);
          return makeOkBoolean('ISURL', this.isValidHostname(u.hostname));
        } catch {
          return makeOkBoolean('ISURL', false);
        }
      }

      // For non-host schemes, basic structural validation is enough.
      if (scheme === 'mailto') {
        return makeOkBoolean('ISURL', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest));
      }
      return makeOkBoolean('ISURL', true);
    }

    // Scheme-less URL: accept domains with valid TLD (optionally with path/query/fragment and port).
    const cut = s.search(/[/?#]/);
    const authority = (cut >= 0 ? s.slice(0, cut) : s).trim();
    if (authority.length === 0) return makeOkBoolean('ISURL', false);
    const host = authority.replace(/^\/\//, '').replace(/\s+/g, '');
    const hostNoPort = host.includes(':') ? (host.split(':')[0] ?? '') : host;
    return makeOkBoolean('ISURL', this.isValidHostname(hostNoPort));
  }
}
