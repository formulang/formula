const ASSUMED_TEXT_LENGTH = 50;
const ASSUMED_LIST_LENGTH = 10;

type DynamicCostValue = { __formula_dynamic_cost?: true; kind?: string };

export function assumedTextLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  const dyn = value as DynamicCostValue;
  if (dyn && dyn.__formula_dynamic_cost && dyn.kind === 'text') return ASSUMED_TEXT_LENGTH;
  return ASSUMED_TEXT_LENGTH;
}

export function assumedListLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const dyn = value as DynamicCostValue;
  if (dyn && dyn.__formula_dynamic_cost && dyn.kind === 'list') return ASSUMED_LIST_LENGTH;
  return ASSUMED_LIST_LENGTH;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** A letter, mark or number: the characters a word is made of. */
const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}]$/u;

/** Whether the character ending just before `index` is a letter, mark or number. */
export function isWordCharacterBefore(text: string, index: number): boolean {
  if (index <= 0 || index > text.length) return false;
  const last = text.charCodeAt(index - 1);
  const first = index >= 2 ? text.charCodeAt(index - 2) : 0;
  const isPair = last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff;
  const codePoint = text.codePointAt(isPair ? index - 2 : index - 1);
  return codePoint !== undefined && WORD_CHARACTER.test(String.fromCodePoint(codePoint));
}

/** Whether the character starting at `index` is a letter, mark or number. */
export function isWordCharacterAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const codePoint = text.codePointAt(index);
  return codePoint !== undefined && WORD_CHARACTER.test(String.fromCodePoint(codePoint));
}

function readOwnProperty(obj: object, property: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(obj, property)) return null;
  return (obj as any)[property] ?? null;
}

export function readNestedProperty(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const part of path) {
    if (cur == null) return null;
    if (typeof cur !== 'object') return null;
    cur = readOwnProperty(cur as object, part);
  }
  return cur ?? null;
}

export function deepFlatten(value: unknown, maxItems = 10_000): unknown[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const out: unknown[] = [];
  const stack: Array<{ arr: unknown[]; idx: number }> = [{ arr: value, idx: 0 }];
  while (stack.length > 0) {
    if (out.length > maxItems) return null;
    const frame = stack[stack.length - 1];
    if (!frame) break;
    if (frame.idx >= frame.arr.length) {
      stack.pop();
      continue;
    }
    const next = frame.arr[frame.idx++];
    if (Array.isArray(next)) {
      stack.push({ arr: next, idx: 0 });
      continue;
    }
    out.push(next);
  }
  return out;
}

export function toComparableKey(value: unknown): any {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function coerceComparisonPair(a: unknown, b: unknown): [unknown, unknown] {
  // Coerce empty string to null.
  const na = a === '' ? null : a;
  const nb = b === '' ? null : b;

  // Coerce number-like strings for numeric comparisons.
  const coerceNumberLike = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (t.length === 0) return v;
    const n = Number(t);
    return Number.isFinite(n) ? n : v;
  };

  const ca = coerceNumberLike(na);
  const cb = coerceNumberLike(nb);

  // Coerce obvious boolean-like strings when at least one side is boolean.
  const coerceBooleanLike = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
    return v;
  };
  const ba = typeof ca === 'boolean' ? ca : coerceBooleanLike(ca);
  const bb = typeof cb === 'boolean' ? cb : coerceBooleanLike(cb);
  if (typeof ba === 'boolean' || typeof bb === 'boolean') {
    return [ba, bb];
  }

  // If one side is list and the other is number-like, compare by list length.
  if (Array.isArray(ca) && typeof cb === 'number') return [ca.length, cb];
  if (Array.isArray(cb) && typeof ca === 'number') return [ca, cb.length];

  return [ca, cb];
}

/**
 * Equality check for values where the type is not known (mirrors EQ semantics).
 *
 * Returns:
 * - `true` / `false` when a comparison can be made
 * - `null` when either side is considered empty/unknown after coercion
 */
export function equalsUnknownType(a: unknown, b: unknown): boolean | null {
  const [ca, cb] = coerceComparisonPair(a, b);
  if (ca == null || cb == null) return null;
  if (typeof ca === 'number' && typeof cb === 'number') return ca === cb;
  if (typeof ca === 'string' && typeof cb === 'string') return ca === cb;
  if (typeof ca === 'boolean' && typeof cb === 'boolean') return ca === cb;
  return ca === cb;
}
