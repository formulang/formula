import type {
  BaseFunctionConfig,
  FormulaExecutionContext,
  FormulaNodeOutput,
} from '@formulang/definitions';
import { makeOkList, makeOkText } from '@formulang/definitions';
import { boundedItems, markupCost, readRequiredMode, readText } from './argument-readers';
import { MARKDOWN_BLOCK_KINDS, MARKUP_FORMATS } from './definitions';
import { EagerBatchImplementation } from './eager-batch-implementation';
import { htmlToPlainText } from './html-text';
import { markdownToPlainText, parseMarkdownBlocks, selectBlocks } from './markdown';

export class PlainTextImplementation extends EagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return markupCost(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext): FormulaNodeOutput {
    const markup = readText('PLAIN_TEXT', args[0]);
    if (typeof markup !== 'string') return markup;
    const format = readRequiredMode('PLAIN_TEXT', 'format', args[1], MARKUP_FORMATS);
    if (typeof format !== 'string') return format;
    const text = format === 'html' ? htmlToPlainText(markup) : markdownToPlainText(markup);
    return makeOkText('PLAIN_TEXT', text);
  }
}

export class MarkdownBlocksImplementation extends EagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return markupCost(args[0]);
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext): FormulaNodeOutput {
    const text = readText('MARKDOWN_BLOCKS', args[0]);
    if (typeof text !== 'string') return text;
    const kind = readRequiredMode('MARKDOWN_BLOCKS', 'kind', args[1], MARKDOWN_BLOCK_KINDS);
    if (typeof kind !== 'string') return kind;
    const blocks = selectBlocks(parseMarkdownBlocks(text), kind);
    return makeOkList('MARKDOWN_BLOCKS', boundedItems(blocks, ctx.limits));
  }
}
