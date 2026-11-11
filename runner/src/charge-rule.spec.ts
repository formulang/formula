import type {
  FunctionImplementation,
  FunctionImplementationResolver,
} from '@formulang/definitions';
import { callChargeUnits } from './internal/state';

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
});
