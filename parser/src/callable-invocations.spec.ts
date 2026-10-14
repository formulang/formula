import type { FormulaType } from '@formulang/definitions';
import {
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import {
  INVOCATIONS_BY_NAME,
  INVOCATIONS_BY_SIGNATURE_ID,
  invocationOf,
} from './callable-invocations';

/** The function names 1.0.0 had, from the compatibility baseline generated from 1.0.0. */
const NAMES_IN_1_0_0: readonly string[] = baseline.functionNames;

function coreHigherOrderFunctions() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  return registry
    .listFunctions()
    .filter((def) => def.params.some((param) => stripNullability(param.type).kind === 'callable'));
}

function inOneZeroZero(def: { name: string }): boolean {
  return NAMES_IN_1_0_0.includes(def.name.toUpperCase());
}

describe('callable invocations', () => {
  it('declares the invocation of every core function with a callable parameter, and only those', () => {
    const higherOrder = coreHigherOrderFunctions();
    const byName = [
      ...new Set(higherOrder.filter(inOneZeroZero).map((def) => def.name.toUpperCase())),
    ].sort();
    const bySignatureId = higherOrder
      .filter((def) => !inOneZeroZero(def))
      .map((def) => def.signatureId)
      .sort();
    // Not vacuous: EACH, FILTER, FILTER_PROPERTY and REDUCE from 1.0.0, and FILTER_BY since.
    expect(byName.length).toBeGreaterThanOrEqual(4);
    expect(bySignatureId.length).toBeGreaterThanOrEqual(1);
    expect([...INVOCATIONS_BY_NAME.keys()].sort()).toStrictEqual(byName);
    expect([...INVOCATIONS_BY_SIGNATURE_ID.keys()].sort()).toStrictEqual(bySignatureId);
  });

  it('keys the functions 1.0.0 had by name and the ones added since by signature id', () => {
    let byName = 0;
    let bySignatureId = 0;
    for (const def of coreHigherOrderFunctions()) {
      expect(invocationOf(def), def.signatureId).toBeDefined();
      const reversioned = { ...def, signatureId: `${def.name}/v9` };
      const hosts = { ...def, signatureId: `HOST_${def.name}/v1` };
      if (inOneZeroZero(def)) {
        // A definition re-registered under a new id keeps the validation 1.0.0 gave the name.
        expect(invocationOf(reversioned), def.signatureId).toBe(invocationOf(def));
        byName++;
      } else {
        // A function a host registered under the name on 1.0.0 keeps its own validation.
        expect(invocationOf(hosts), def.signatureId).toBeUndefined();
        expect(invocationOf(reversioned), def.signatureId).toBeUndefined();
        bySignatureId++;
      }
    }
    expect(byName).toBeGreaterThan(0);
    expect(bySignatureId).toBeGreaterThan(0);
    expect(invocationOf({ name: 'LEN', signatureId: 'LEN/v1' })).toBeUndefined();
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
    const core = coreHigherOrderFunctions();
    const invoke = (name: string, argTypes: FormulaType[]) => {
      const def = core.find((candidate) => candidate.name === name);
      return def && invocationOf(def)?.(argTypes).map((arg) => arg.forwards ?? null);
    };

    expect(invoke('EACH', [texts, text, number, text])).toStrictEqual([null, 2, 3]);
    expect(invoke('FILTER', [texts, text, text])).toStrictEqual([null, 2]);
    expect(invoke('FILTER', [texts, text])).toStrictEqual([null]);
    expect(invoke('FILTER_PROPERTY', [texts, text, text, number])).toStrictEqual([null, 3]);
    expect(invoke('FILTER_BY', [texts, texts, text, number])).toStrictEqual([null, 3]);
    expect(invoke('REDUCE', [number, texts, text])).toStrictEqual([null, null]);
  });

  it('passes on only arguments after the callable, in order', () => {
    // What bounds the nested follow: each nested callable is named by an argument further right.
    let checked = 0;
    for (const def of coreHigherOrderFunctions()) {
      const callableAt = def.params.findIndex(
        (param) => stripNullability(param.type).kind === 'callable',
      );
      for (let count = def.params.length - 1; count <= def.params.length + 3; count++) {
        const argTypes = Array.from({ length: count }, () => FormulaTypes.any(true));
        const forwards = (invocationOf(def)?.(argTypes) ?? [])
          .map((arg) => arg.forwards)
          .filter((index): index is number => index !== undefined);
        let previous = callableAt;
        for (const index of forwards) {
          expect(index, `${def.signatureId} with ${count} arguments`).toBeGreaterThan(previous);
          expect(index, `${def.signatureId} with ${count} arguments`).toBeLessThan(count);
          previous = index;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
