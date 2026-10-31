import type {
  FunctionImplementation,
  FunctionImplementationResolver,
} from '@formulang/definitions';
import { readdirSync, readFileSync } from 'node:fs';
import { callChargeUnits } from './internal/state';

/**
 * The runner charges every call by one rule, `callChargeUnits`: a call written in a formula, on
 * either of its paths, and a call an implementation makes through `chargeCall`. This spec holds
 * the rule's answers, and holds the runner's sources to having no second place that computes a
 * charge: every `addCostOrThrow` call is given `callChargeUnits(...)`, and no other module reads
 * an estimate or states the flat charge.
 */

function resolver(
  implementation?: Partial<FunctionImplementation>,
): FunctionImplementationResolver {
  return {
    get: () => implementation as FunctionImplementation | undefined,
  } as unknown as FunctionImplementationResolver;
}

describe('the charge of a call', () => {
  it('is a flat 0.05 for a control-flow function, whatever its estimate and its arguments', () => {
    const estimating = resolver({ estimateCostsInSeconds: () => 0.0001 });
    expect(callChargeUnits({ controlFlow: true }, estimating, 'AND/v1', [true, true])).toBe(0.05);
    expect(callChargeUnits({ controlFlow: true }, estimating, 'AND/v1', [])).toBe(0.05);
    expect(callChargeUnits({ controlFlow: false }, estimating, 'ADD/v1', [1, 2])).toBe(0.0001);
    expect(callChargeUnits(undefined, estimating, 'HOST/v1', [1])).toBe(0.0001);
  });

  it('is the estimate for any other function, or 0.05 where the estimate is unusable', () => {
    expect(
      callChargeUnits({}, resolver({ estimateCostsInSeconds: (args) => args.length }), 'X', [1, 2]),
    ).toBe(2);
    expect(callChargeUnits({}, resolver({}), 'X', [])).toBe(0.05);
    expect(callChargeUnits({}, resolver(undefined), 'X', [])).toBe(0.05);
    for (const raw of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(
        callChargeUnits({}, resolver({ estimateCostsInSeconds: () => raw }), 'X', []),
        String(raw),
      ).toBe(0.05);
    }
  });

  it('is computed in one place: every charge the runner makes goes through it', () => {
    const sources = ['./', './internal/'].flatMap((path) => {
      const directory = new URL(path, import.meta.url);
      return readdirSync(directory)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
        .map((name) => ({
          name: `${path}${name}`,
          text: readFileSync(new URL(name, directory), 'utf8'),
        }));
    });
    let charges = 0;
    for (const { name, text } of sources) {
      // Each call of addCostOrThrow but its definition, up to its closing parenthesis.
      for (const match of text.matchAll(/addCostOrThrow\(/g)) {
        const start = match.index ?? 0;
        if (text.slice(Math.max(0, start - 16), start).includes('function ')) continue;
        let depth = 0;
        let end = start + 'addCostOrThrow'.length;
        do {
          if (text[end] === '(') depth += 1;
          if (text[end] === ')') depth -= 1;
          end += 1;
        } while (depth > 0 && end < text.length);
        const call = text.slice(start, end);
        expect(call, `${name}: ${call}`).toMatch(/^addCostOrThrow\(\s*state,\s*callChargeUnits\(/);
        charges += 1;
      }
      if (name !== './internal/state.ts') {
        expect(text, `${name} reads an estimate`).not.toMatch(/estimateCostsInSeconds/);
        expect(text, `${name} states a charge`).not.toMatch(/\b0\.05\b/);
      }
    }
    // The cached call, the uncached calls and chargeCall: three charges, all through the rule.
    expect(charges).toBe(3);
  });
});
