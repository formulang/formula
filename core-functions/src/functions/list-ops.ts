import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaValueProvider,
  FunctionImplementation,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkList,
  makeOkNull,
  makeOkUnknown,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, asText, isEmptyValue, readNestedProperty } from './helpers';

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
