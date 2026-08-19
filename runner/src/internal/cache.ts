import type { FormulaLimits, FormulaType } from '@formulang/definitions';
import { resolveFormulaLimits } from '@formulang/definitions';

export function isCacheableByArgs(args: unknown[], limits: FormulaLimits): boolean {
  const maxDepth = 2;
  const maxArrayScan = 200;

  const scan = (v: unknown, depth: number, scanned: { count: number }): boolean => {
    if (typeof v === 'string') return v.length <= limits.maxCacheableStringLength;
    if (!v || depth > maxDepth) return true;
    if (!Array.isArray(v)) return true;

    for (const item of v) {
      scanned.count++;
      if (scanned.count > maxArrayScan) return true;
      if (!scan(item, depth + 1, scanned)) return false;
    }
    return true;
  };

  for (const a of args) {
    if (!scan(a, 0, { count: 0 })) return false;
  }
  return true;
}

const cacheObjectIds = new WeakMap<object, number>();
let nextCacheObjectId = 1;
function getCacheObjectId(obj: object): number {
  const existing = cacheObjectIds.get(obj);
  if (existing) return existing;
  const id = nextCacheObjectId++;
  cacheObjectIds.set(obj, id);
  return id;
}

function stableKeyForValue(
  value: unknown,
  limits: FormulaLimits,
  depth = 0,
  visited?: WeakSet<object>,
): string {
  if (value == null) return 'null';
  switch (typeof value) {
    case 'string':
      // maxCacheableStringLength is enforced separately.
      return `s:${JSON.stringify(value)}`;
    case 'number':
      // Keep stable for -0 and NaN.
      if (Number.isNaN(value)) return 'n:NaN';
      if (Object.is(value, -0)) return 'n:-0';
      return `n:${value}`;
    case 'boolean':
      return value ? 'b:1' : 'b:0';
    case 'bigint':
      return `bi:${value.toString()}`;
    case 'undefined':
      return 'u';
    case 'symbol':
      return 'sym';
    case 'function':
      return `obj#${getCacheObjectId(value as unknown as object)}`;
    case 'object': {
      const obj = value as object;
      const seen = visited ?? new WeakSet<object>();
      if (seen.has(obj)) return `obj#${getCacheObjectId(obj)}`;
      seen.add(obj);

      // Prefer value-based keys for small primitive arrays to keep caching effective
      // for common list operators (while avoiding huge keys).
      if (Array.isArray(value) && depth <= 2 && value.length <= 50) {
        const parts: string[] = [];
        for (const item of value) {
          if (typeof item === 'string' && item.length > limits.maxCacheableStringLength) {
            return `obj#${getCacheObjectId(obj)}`;
          }
          if (
            item == null ||
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean' ||
            typeof item === 'undefined'
          ) {
            parts.push(stableKeyForValue(item, limits, depth + 1, seen));
            continue;
          }
          // Complex values are keyed by identity.
          return `obj#${getCacheObjectId(obj)}`;
        }
        return `arr:[${parts.join(',')}]`;
      }

      // Objects are keyed by identity to avoid unstable/large serialization.
      return `obj#${getCacheObjectId(obj)}`;
    }
    default:
      return 'unk';
  }
}

export function cacheKey(
  signatureId: string,
  args: unknown[],
  expectedCast?: FormulaType,
  limits?: FormulaLimits,
): string {
  let key = `${signatureId}|`;
  if (expectedCast) key += `cast:${expectedCast.kind}:${expectedCast.nullable ? '1' : '0'}|`;

  const l = limits ?? resolveFormulaLimits(undefined);
  key += args.map((a) => stableKeyForValue(a, l)).join(';');
  return key;
}
