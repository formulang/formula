import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FormulaValueProvider,
  FunctionImplementation,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkList,
  makeOkNull,
  makeOkNumber,
  makeOkUnknown,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { listTooLarge, typeWarning } from './argument-readers';
import {
  asNumber,
  asText,
  assumedListLength,
  equalsUnknownType,
  isEmptyValue,
  readNestedProperty,
} from './helpers';

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

function sortKey(value: unknown): [number, any] {
  if (value == null) return [4, null];
  if (typeof value === 'number') return Number.isFinite(value) ? [0, value] : [4, null];
  if (typeof value === 'string') return [1, value.toLowerCase()];
  if (typeof value === 'boolean') return [2, value ? 1 : 0];
  return [3, null];
}

function compareKeys(a: [number, any], b: [number, any]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] === b[1]) return 0;
  return a[1] < b[1] ? -1 : 1;
}

function resolveOperatorImpl(ctx: FormulaExecutionContext, opName: string) {
  const op = ctx.registry.getOperator(opName);
  if (op) return ctx.resolver.get(op.functionSignatureId) ?? null;
  const candidates = ctx.registry.listFunctionsByName(opName);
  if (candidates.length === 0) return null;
  const withImpl = candidates.find((c) => ctx.resolver.get(c.signatureId) != null);
  const chosen = withImpl ?? candidates[0];
  return ctx.resolver.get(chosen.signatureId) ?? null;
}

export class ReduceImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0004 + 0.00005 * (Array.isArray(args[1]) ? args[1].length : 10);
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const initial = (await call.args[0]?.output())?.value ?? null;
      const list = (await call.args[1]?.output())?.value;
      const opName = (await call.args[2]?.output())?.value;

      if (list == null) {
        outs.push(makeOkNull('REDUCE', { signatureId: this.config.signatureId }));
        continue;
      }
      if (!Array.isArray(list) || typeof opName !== 'string' || opName.length === 0) {
        outs.push(
          withWarnings(makeOkNull('REDUCE', { signatureId: this.config.signatureId }), [
            { code: 'TYPE', message: 'REDUCE expects (initial, list, operator)' },
          ]),
        );
        continue;
      }

      if (list.length > ctx.limits.maxListLength) {
        throw new FormulaRuntimeError(
          FormulaErrorCodes.LIST_TOO_LARGE,
          'List is too large',
          'security',
        );
      }

      const impl = resolveOperatorImpl(ctx, opName);
      if (!impl) {
        outs.push(makeOkNull('REDUCE', { signatureId: this.config.signatureId }));
        continue;
      }

      let acc: unknown = initial;
      for (let i = 0; i < list.length; i++) {
        ctx.budget.consume(1);
        const item = list[i];
        const nextOuts = await impl.evaluateMultiple(
          [{ args: [constProvider(acc), constProvider(item)], callId: `${i}` }],
          ctx,
        );
        const next = nextOuts[0];
        acc = next?.value ?? null;
      }

      outs.push(makeOkUnknown('REDUCE', acc, { signatureId: this.config.signatureId }));
    }
    return outs;
  }
}

export class SortImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    const len = Array.isArray(args[0]) ? args[0].length : 10;
    return 0.0002 + 0.00003 * len;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const list = args[0];
    const rawDesc = args.length >= 2 ? args[1] : false;
    if (list == null) return makeOkNull('SORT');
    if (!Array.isArray(list)) {
      if (!isEmptyValue(list)) {
        return withWarnings(makeOkNull('SORT'), [{ code: 'TYPE', message: 'SORT expects a list' }]);
      }
      return makeOkNull('SORT');
    }

    let descending = false;
    if (rawDesc != null) {
      if (typeof rawDesc === 'boolean') descending = rawDesc;
      else if (!isEmptyValue(rawDesc)) {
        return withWarnings(makeOkNull('SORT'), [
          { code: 'TYPE', message: 'SORT descending must be a boolean' },
        ]);
      }
    }

    const indexed = list.map((v, idx) => ({ v, idx, k: sortKey(v) }));
    indexed.sort((a, b) => {
      const cmp = compareKeys(a.k, b.k);
      if (cmp !== 0) return descending ? -cmp : cmp;
      return a.idx - b.idx;
    });
    return makeOkList(
      'SORT',
      indexed.map((x) => x.v),
    );
  }
}

export class SortByPropertyImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    const len = Array.isArray(args[0]) ? args[0].length : 10;
    return 0.0003 + 0.00004 * len;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const list = args[0];
    const prop = asText(args[1]);
    const rawDesc = args.length >= 3 ? args[2] : false;

    if (list == null) return makeOkNull('SORT_BY_PROPERTY');
    if (!Array.isArray(list) || prop == null || prop.length === 0) {
      return makeOkNull('SORT_BY_PROPERTY');
    }

    let descending = false;
    if (rawDesc != null) {
      if (typeof rawDesc === 'boolean') descending = rawDesc;
      else if (!isEmptyValue(rawDesc)) {
        return withWarnings(makeOkNull('SORT_BY_PROPERTY'), [
          { code: 'TYPE', message: 'SORT_BY_PROPERTY descending must be a boolean' },
        ]);
      }
    }

    const path = prop.split('.').filter(Boolean);
    const indexed = list.map((v, idx) => {
      const propVal = readNestedProperty(v, path);
      return { v, idx, k: sortKey(propVal) };
    });
    indexed.sort((a, b) => {
      const cmp = compareKeys(a.k, b.k);
      if (cmp !== 0) return descending ? -cmp : cmp;
      return a.idx - b.idx;
    });
    return makeOkList(
      'SORT_BY_PROPERTY',
      indexed.map((x) => x.v),
    );
  }
}

export class IndexImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const list = args[0];
    const idxRaw = args[1];
    if (list == null) return makeOkNull('INDEX');
    if (!Array.isArray(list)) {
      if (!isEmptyValue(list)) {
        return withWarnings(makeOkNull('INDEX'), [
          { code: 'TYPE', message: 'INDEX expects a list' },
        ]);
      }
      return makeOkNull('INDEX');
    }
    const idxNum = asNumber(idxRaw);
    if (idxNum == null) {
      if (!isEmptyValue(idxRaw)) {
        return withWarnings(makeOkNull('INDEX'), [
          { code: 'TYPE', message: 'INDEX expects a numeric index' },
        ]);
      }
      return makeOkNull('INDEX');
    }
    const idx = Math.trunc(idxNum);
    if (idx !== idxNum) {
      return withWarnings(makeOkNull('INDEX'), [
        { code: 'TYPE', message: 'INDEX expects an integer index' },
      ]);
    }
    if (idx <= 0) return makeOkNull('INDEX');
    const v = list[idx - 1];
    return makeOkUnknown('INDEX', v ?? null);
  }
}

/**
 * The list argument of `TAKE`, `INDEX_OF`, `DISTINCT` and `GROUP_COUNTS`, refused over
 * `maxListLength`; `null` when the argument is not a list (see `notAList`).
 */
function readList(raw: unknown, ctx: FormulaExecutionContext): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > ctx.limits.maxListLength) throw listTooLarge();
  return raw;
}

/** An empty value answers null; any other non-list value null with `TYPE`. */
function notAList(fn: string, raw: unknown): FormulaNodeOutput {
  return isEmptyValue(raw) ? makeOkNull(fn) : typeWarning(fn, `${fn} expects a list`);
}

function listCost(list: unknown): number {
  return 0.00002 + 0.00002 * assumedListLength(list);
}

/**
 * A key that is equal exactly for equal values: by value for text, numbers and booleans (with no
 * conversion between them), by structure for lists and objects.
 */
function valueKey(value: unknown, ancestors: readonly unknown[] = []): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `t${JSON.stringify(value)}`;
  if (typeof value === 'number') return `n${value}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  // A value that contains itself has no finite structure; its repetition gets one marker.
  if (ancestors.includes(value)) return 'cycle';
  const path = [...ancestors, value];
  if (Array.isArray(value)) return `[${value.map((item) => valueKey(item, path)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${valueKey(record[key], path)}`);
  return `{${fields.join(',')}}`;
}

/** The distinct non-empty members of a list, in first-occurrence order, and how often each occurs. */
function groupMembers(list: readonly unknown[]): { members: unknown[]; counts: number[] } {
  const positions = new Map<string, number>();
  const members: unknown[] = [];
  const counts: number[] = [];
  for (const item of list) {
    if (isEmptyValue(item)) continue;
    const key = valueKey(item);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, members.length);
      members.push(item);
      counts.push(1);
    } else {
      counts[position] += 1;
    }
  }
  return { members, counts };
}

export class TakeImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return listCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const list = readList(args[0], ctx);
    if (list === null) return notAList('TAKE', args[0]);
    const rawCount = args[1];
    if (isEmptyValue(rawCount)) return makeOkNull('TAKE');
    const count = asNumber(rawCount);
    if (count === null || !Number.isInteger(count) || count < 0) {
      return typeWarning('TAKE', 'TAKE count must be a whole number of 0 or more');
    }
    const rawStart = args.length >= 3 ? args[2] : null;
    const start = isEmptyValue(rawStart) ? 1 : asNumber(rawStart);
    if (start === null || !Number.isInteger(start) || start < 1) {
      return typeWarning('TAKE', 'TAKE start must be a whole number of 1 or more');
    }
    return makeOkList('TAKE', list.slice(start - 1, start - 1 + count));
  }
}

export class IndexOfImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return listCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const list = readList(args[0], ctx);
    if (list === null) return notAList('INDEX_OF', args[0]);
    const value = args[1];
    if (isEmptyValue(value)) return makeOkNull('INDEX_OF');
    // The coerced equality INCLUDES uses.
    const index = list.findIndex((item) => equalsUnknownType(item, value) === true);
    return index < 0 ? makeOkNull('INDEX_OF') : makeOkNumber('INDEX_OF', index + 1);
  }
}

export class DistinctImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return listCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const list = readList(args[0], ctx);
    if (list === null) return notAList('DISTINCT', args[0]);
    return makeOkList('DISTINCT', groupMembers(list).members);
  }
}

export class GroupCountsImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return listCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const list = readList(args[0], ctx);
    if (list === null) return notAList('GROUP_COUNTS', args[0]);
    return makeOkList('GROUP_COUNTS', groupMembers(list).counts);
  }
}
