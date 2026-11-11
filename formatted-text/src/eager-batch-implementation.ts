import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FunctionImplementation,
} from '@formulang/definitions';

/**
 * The "eager args" pattern of the core functions: resolve every argument, then call `evaluate`.
 * A copy of the core-functions base class, which that package does not export.
 */
export abstract class EagerBatchImplementation implements FunctionImplementation {
  protected constructor(protected readonly config: BaseFunctionConfig) {}

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
