/*
 * The portable half of the formatted-text functions: plain data, no executable code. It imports
 * only `@formulang/definitions`, so an editor or validation service can register these
 * definitions (from `@formulang/formatted-text/definitions`) without loading the readers.
 */
import { FormulaTypes, type MutableFormulaRegistry } from '@formulang/definitions';

/** The signature ids of the formatted-text functions. */
export const FormattedTextSignatureIds = {
  PLAIN_TEXT: 'PLAIN_TEXT/v1',
  MARKDOWN_BLOCKS: 'MARKDOWN_BLOCKS/v1',
} as const;

/** The markup `PLAIN_TEXT` reads. */
export type MarkupFormat = 'html' | 'markdown';

/** The block kinds `MARKDOWN_BLOCKS` selects. */
export type MarkdownBlockKind =
  | 'heading'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'list-item'
  | 'table-row'
  | 'paragraph'
  | 'code';

/** The `format` literals of `PLAIN_TEXT`. */
export const MARKUP_FORMATS: readonly MarkupFormat[] = ['html', 'markdown'];

/** The `kind` literals of `MARKDOWN_BLOCKS`. */
export const MARKDOWN_BLOCK_KINDS: readonly MarkdownBlockKind[] = [
  'heading',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'list-item',
  'table-row',
  'paragraph',
  'code',
];

/** Registers the definitions of `PLAIN_TEXT` and `MARKDOWN_BLOCKS`. */
export function registerFormattedTextDefinitions(registry: MutableFormulaRegistry): void {
  registry.registerFunction({
    signatureId: FormattedTextSignatureIds.PLAIN_TEXT,
    name: 'PLAIN_TEXT',
    category: 'formatted-text',
    description: 'The text of HTML or markdown markup, one line per block.',
    params: [
      { name: 'markup', type: FormulaTypes.text(true) },
      {
        name: 'format',
        description: 'The markup language: "html" or "markdown".',
        type: FormulaTypes.text(false),
        literalOnly: true,
        literalValues: [...MARKUP_FORMATS],
      },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: FormattedTextSignatureIds.MARKDOWN_BLOCKS,
    name: 'MARKDOWN_BLOCKS',
    category: 'formatted-text',
    description: 'The text of the markdown blocks of one kind, in order.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'kind',
        description:
          'The block kind: "heading", "heading-1" to "heading-6", "list-item", "table-row", "paragraph" or "code".',
        type: FormulaTypes.text(false),
        literalOnly: true,
        literalValues: [...MARKDOWN_BLOCK_KINDS],
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });
}
