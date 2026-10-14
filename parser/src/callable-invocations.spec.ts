import type { FormulaType, FunctionDefinition } from '@formulang/definitions';
import {
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import { INVOCATIONS_BY_NAME, invocationOf, invokedArguments } from './callable-invocations';

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
  it('knows the invocation of every core function with a callable parameter, from one source', () => {
    const higherOrder = coreHigherOrderFunctions();
    const byName = [
      ...new Set(higherOrder.filter(inOneZeroZero).map((def) => def.name.toUpperCase())),
    ].sort();
    // Not vacuous: EACH, FILTER, FILTER_PROPERTY and REDUCE from 1.0.0, and FILTER_BY since.
    expect(byName.length).toBeGreaterThanOrEqual(4);
    expect([...INVOCATIONS_BY_NAME.keys()].sort()).toStrictEqual(byName);
    const declaring = higherOrder.filter((def) => def.callableInvocation !== undefined);
    expect(declaring.length).toBeGreaterThanOrEqual(1);
    // The functions 1.0.0 had are keyed by name and declare nothing; every one added since
    // declares its invocation.
    expect(declaring.filter(inOneZeroZero)).toStrictEqual([]);
    expect(declaring.map((def) => def.signatureId).sort()).toStrictEqual(
      higherOrder
        .filter((def) => !inOneZeroZero(def))
        .map((def) => def.signatureId)
        .sort(),
    );
  });

  it('keeps the invocation for a copy under another signature id, never for a host function', () => {
    let byName = 0;
    let declared = 0;
    for (const def of coreHigherOrderFunctions()) {
      expect(invocationOf(def), def.signatureId).toBeDefined();
      // The documented way to change a function: the same definition under the next version.
      const reversioned: FunctionDefinition = { ...def, signatureId: `${def.name}/v9` };
      expect(invocationOf(reversioned), def.signatureId).toBe(invocationOf(def));
      // A function a host registered under the name, which declares no invocation.
      const { callableInvocation, ...hosts } = { ...def, signatureId: `HOST_${def.name}/v1` };
      void callableInvocation;
      if (inOneZeroZero(def)) {
        // 1.0.0 gave the name its invocation, whatever the definition.
        expect(invocationOf(hosts), def.signatureId).toBe(invocationOf(def));
        byName++;
      } else {
        expect(invocationOf(hosts), def.signatureId).toBeUndefined();
        declared++;
      }
    }
    expect(byName).toBeGreaterThan(0);
    expect(declared).toBeGreaterThan(0);
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
    const core = coreHigherOrderFunctions();
    const invoke = (name: string, argTypes: FormulaType[]) => {
      const def = core.find((candidate) => candidate.name === name);
      const invocation = def && invocationOf(def);
      return (
        invocation && invokedArguments(invocation, argTypes).map((arg) => arg.forwards ?? null)
      );
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
      const invocation = invocationOf(def) ?? [];
      for (let count = def.params.length - 1; count <= def.params.length + 3; count++) {
        const argTypes = Array.from({ length: count }, () => FormulaTypes.any(true));
        const forwards = invokedArguments(invocation, argTypes)
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
