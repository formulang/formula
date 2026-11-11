import type { FunctionImplementation, MutableFormulaRegistry } from '@formulang/definitions';
import { FormattedTextSignatureIds, registerFormattedTextDefinitions } from './definitions';
import { MarkdownBlocksImplementation, PlainTextImplementation } from './functions';

export {
  FormattedTextSignatureIds,
  MARKDOWN_BLOCK_KINDS,
  MARKUP_FORMATS,
  registerFormattedTextDefinitions,
  type MarkdownBlockKind,
  type MarkupFormat,
} from './definitions';
export { MarkdownBlocksImplementation, PlainTextImplementation } from './functions';

/**
 * Where implementations are registered by signature id: the resolver `createCoreFormulaRuntime()`
 * returns satisfies it, as does any registry with this method.
 */
export interface FunctionImplementationRegistrar {
  register(signatureId: string, impl: FunctionImplementation): void;
}

/** Registers the executable implementations of `PLAIN_TEXT` and `MARKDOWN_BLOCKS` (backend only). */
export function registerFormattedTextImplementations(
  implementations: FunctionImplementationRegistrar,
): void {
  implementations.register(
    FormattedTextSignatureIds.PLAIN_TEXT,
    new PlainTextImplementation({ signatureId: FormattedTextSignatureIds.PLAIN_TEXT }),
  );
  implementations.register(
    FormattedTextSignatureIds.MARKDOWN_BLOCKS,
    new MarkdownBlocksImplementation({ signatureId: FormattedTextSignatureIds.MARKDOWN_BLOCKS }),
  );
}

/**
 * Adds the formatted-text functions to a runtime, definitions and implementations both, such as
 * the one `createCoreFormulaRuntime()` returns.
 */
export function registerFormattedTextFunctions(runtime: {
  registry: MutableFormulaRegistry;
  implementations: FunctionImplementationRegistrar;
}): void {
  registerFormattedTextDefinitions(runtime.registry);
  registerFormattedTextImplementations(runtime.implementations);
}
