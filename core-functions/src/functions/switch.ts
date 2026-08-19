import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FunctionImplementation,
} from '@formulang/definitions';
import { makeOkNull, makeOkUnknown, withWarnings } from '@formulang/definitions';
import { equalsUnknownType } from './helpers';

export class SwitchImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 + 0.00001 * args.length;
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], _ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const exprOut = call.args[0] ? await call.args[0].output() : null;
      const expr = exprOut?.value ?? null;

      const rest = call.args.slice(1);
      if (rest.length < 2) {
        outs.push(
          withWarnings(makeOkNull('SWITCH', { signatureId: this.config.signatureId }), [
            { code: 'ARGS', message: 'SWITCH expects at least one case/value pair' },
          ]),
        );
        continue;
      }

      const hasDefault = rest.length % 2 === 1;
      const pairCount = Math.floor(rest.length / 2);
      let matchedProvider = null as null | (typeof rest)[number];

      for (let i = 0; i < pairCount; i++) {
        const caseProvider = rest[i * 2];
        const valueProvider = rest[i * 2 + 1];
        const caseOut = caseProvider ? await caseProvider.output() : null;
        const caseVal = caseOut?.value ?? null;
        const eq = expr == null && caseVal == null ? true : equalsUnknownType(expr, caseVal);
        if (eq === true) {
          matchedProvider = valueProvider ?? null;
          break;
        }
      }

      if (!matchedProvider) {
        if (hasDefault) matchedProvider = rest[rest.length - 1] ?? null;
      }

      if (!matchedProvider) {
        outs.push(makeOkNull('SWITCH', { signatureId: this.config.signatureId }));
        continue;
      }

      const chosenOut = await matchedProvider.output();
      outs.push(
        makeOkUnknown('SWITCH', chosenOut?.value ?? null, { signatureId: this.config.signatureId }),
      );
    }
    return outs;
  }
}
