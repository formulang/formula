import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FunctionImplementation,
} from '@formulang/definitions';

/**
 * Shared implementation for the common "eager args" pattern:
 * - eagerly resolve all argument providers via `.value()`
 * - call a per-function `evaluate()` that returns a `FormulaNodeOutput`
 */
export abstract class AbstractEagerBatchImplementation<
  TConfig extends BaseFunctionConfig = BaseFunctionConfig,
> implements FunctionImplementation {
  protected constructor(protected readonly config: TConfig) {}

  async evaluateMultiple(
    calls: BatchEvaluationCall[],
    ctx: FormulaExecutionContext,
  ): Promise<FormulaNodeOutput[]> {
    const outs: FormulaNodeOutput[] = [];
    for (const call of calls) {
      const argValues = await Promise.all(call.args.map((p) => p.value()));
      outs.push(await this.evaluate(argValues, ctx));
    }
    return outs;
  }

  protected abstract evaluate(
    args: unknown[],
    ctx: FormulaExecutionContext,
  ): FormulaNodeOutput | Promise<FormulaNodeOutput>;
}
