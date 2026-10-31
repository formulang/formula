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
  makeError,
  makeOkList,
  makeOkNull,
  makeOkUnknown,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { listTooLarge, typeWarning } from './argument-readers';

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

/**
 * The implementation `FILTER_BY` calls, with its signature id, found as `FILTER` finds its
 * operator's: the function behind an operator token, otherwise the first function of that name
 * that has an implementation. That need not be the overload the parser checked for the types of
 * the keys and of the operator value, which is why the parser checks a literal the call passes on
 * against every overload of the name.
 */
function resolveCallable(
  ctx: FormulaExecutionContext,
  name: string,
): { signatureId: string; implementation: FunctionImplementation } | undefined {
  const operator = ctx.registry.getOperator(name);
  if (operator) {
    const implementation = ctx.resolver.get(operator.functionSignatureId);
    return implementation && { signatureId: operator.functionSignatureId, implementation };
  }
  for (const def of ctx.registry.listFunctionsByName(name)) {
    const implementation = ctx.resolver.get(def.signatureId);
    if (implementation) return { signatureId: def.signatureId, implementation };
  }
}

/**
 * `FILTER_BY(list, keys, operator, operatorValue?)`: keeps the items of `list` whose key at the
 * same position in `keys` satisfies `operator(key)` or `operator(key, operatorValue)`.
 */
export class FilterByImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0003 + 0.00005 * (Array.isArray(args[0]) ? args[0].length : 10);
  }

  protected async evaluate(
    args: unknown[],
    ctx: FormulaExecutionContext,
  ): Promise<FormulaNodeOutput> {
    const [target, keys, opName, opValue] = args;
    // The arguments in order, each in full: null, then the type, then the bound.
    if (target == null) return makeOkNull('FILTER_BY');
    if (!Array.isArray(target)) return typeWarning('FILTER_BY', 'FILTER_BY expects a list');
    if (target.length > ctx.limits.maxListLength) throw listTooLarge();
    if (keys == null) return makeOkNull('FILTER_BY');
    if (!Array.isArray(keys)) return typeWarning('FILTER_BY', 'FILTER_BY expects a list of keys');
    if (keys.length > ctx.limits.maxListLength) throw listTooLarge();
    if (typeof opName !== 'string') {
      return typeWarning('FILTER_BY', 'FILTER_BY expects the name of an operator');
    }
    if (target.length !== keys.length) {
      return typeWarning('FILTER_BY', 'FILTER_BY expects as many keys as list items');
    }
    const chosen = resolveCallable(ctx, opName);
    if (!chosen) {
      return typeWarning(
        'FILTER_BY',
        `FILTER_BY found no implementation of ${JSON.stringify(opName)}`,
      );
    }

    // A null operatorValue counts as omitted, as a null optional argument does in every rules
    // section: the operator is then called with the key alone. Each call of the operator is
    // charged as the runner charges a call of a formula, and takes one step.
    const opValueProvider = opValue == null ? undefined : constProvider(opValue);
    const predicateCalls: BatchEvaluationCall[] = keys.map((key, idx) => {
      ctx.budget.consume(1);
      ctx.chargeCall?.(chosen.signatureId, opValueProvider ? [key, opValue] : [key]);
      return {
        args: opValueProvider ? [constProvider(key), opValueProvider] : [constProvider(key)],
        callId: `${idx}`,
      };
    });
    const predicateOuts = await chosen.implementation.evaluateMultiple(predicateCalls, ctx);
    // An operator's output for a key that is not ok is an error of the call, the first in the
    // order of the keys, read as the runner reads the output of a call it makes itself: its
    // error, or EVAL_CRASH where it carries none, and an output that is missing fails alike.
    const failed = keys.findIndex((_key, i) => !predicateOuts[i]?.ok);
    if (failed >= 0) {
      const error = predicateOuts[failed]?.error;
      return makeError('FILTER_BY', {
        kind: error?.kind ?? 'runtime',
        code: error?.code ?? FormulaErrorCodes.EVAL_CRASH,
        message: error?.message ?? 'Evaluation error',
        meta: error?.meta,
      });
    }
    return makeOkList(
      'FILTER_BY',
      target.filter((_item, i) => predicateOuts[i]?.value === true),
    );
  }
}
