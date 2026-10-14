import type { FormulaType } from '@formulang/definitions';
import {
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { CALLABLE_INVOCATIONS, invocationOf } from './callable-invocations';

function coreHigherOrderFunctions() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  return registry
    .listFunctions()
    .filter((def) => def.params.some((param) => stripNullability(param.type).kind === 'callable'));
}

describe('callable invocations', () => {
  it('declares the invocation of every core function with a callable parameter, and only those', () => {
    // Keyed by name, as 1.0.0 keyed the callable validation.
    const higherOrder = [
      ...new Set(coreHigherOrderFunctions().map((def) => def.name.toUpperCase())),
    ].sort();
    // The core set is not empty: EACH, FILTER, FILTER_PROPERTY, FILTER_BY and REDUCE at least.
    expect(higherOrder.length).toBeGreaterThanOrEqual(5);
    expect([...CALLABLE_INVOCATIONS.keys()].sort()).toStrictEqual(higherOrder);
  });

  it('finds the invocation by name, so a definition re-registered under a new id keeps it', () => {
    for (const def of coreHigherOrderFunctions()) {
      const reversioned = { ...def, signatureId: `${def.name}/v9` };
      expect(invocationOf(reversioned), def.name).toBe(invocationOf(def));
      expect(invocationOf(def), def.name).toBeDefined();
    }
    expect(invocationOf({ name: 'LEN' })).toBeUndefined();
  });

  it('reaches every callable parameter through the literal-only check', () => {
    // The parser validates a callable (and its invocation) only for a literal-only parameter.
    for (const def of coreHigherOrderFunctions()) {
      for (const param of def.params) {
        if (stripNullability(param.type).kind !== 'callable') continue;
        expect(param.literalOnly, `${def.signatureId} ${param.name}`).toBe(true);
      }
    }
  });

  it('forwards the call arguments each higher-order function passes on', () => {
    const text = FormulaTypes.text(false);
    const texts = FormulaTypes.list(text, false);
    const number = FormulaTypes.number(false);
    const invoke = (name: string, argTypes: FormulaType[]) =>
      CALLABLE_INVOCATIONS.get(name)?.(argTypes).map((arg) => arg.forwards ?? null);

    expect(invoke('EACH', [texts, text, number, text])).toStrictEqual([null, 2, 3]);
    expect(invoke('FILTER', [texts, text, text])).toStrictEqual([null, 2]);
    expect(invoke('FILTER', [texts, text])).toStrictEqual([null]);
    expect(invoke('FILTER_PROPERTY', [texts, text, text, number])).toStrictEqual([null, 3]);
    expect(invoke('FILTER_BY', [texts, texts, text, number])).toStrictEqual([null, 3]);
    expect(invoke('REDUCE', [number, texts, text])).toStrictEqual([null, null]);
  });
});
