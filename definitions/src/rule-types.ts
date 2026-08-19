import { RuleTypeSeed } from './rule-types-core';
import { FormulaTypes, type FormulaType } from './types';

export interface ExtendedRuleTypeSeed extends RuleTypeSeed {
  primitives: {
    Any: FormulaType;
    Boolean: FormulaType;
    Number: FormulaType;
    Text: FormulaType;
    Null: FormulaType;
  };

  taxonomy: {
    Taxonomy: FormulaType;
    Tag: FormulaType;
    TagAssignment: FormulaType;
    TaxonomyType: FormulaType;
    Priority: FormulaType;
  };

  pages: {
    Page: FormulaType;
    PageContent: FormulaType;
    PageMarkup: FormulaType;
    MarkupElement: FormulaType;
    MarkupTree: FormulaType;
    MarkupLink: FormulaType;
    LinkAttributes: FormulaType;
    UrlParts: FormulaType;
    MarkupImage: FormulaType;
    ImageAttributes: FormulaType;
  };

  content: {
    Content: FormulaType;
  };
}

export function createExtendedRuleTypes(): ExtendedRuleTypeSeed {
  const Priority = FormulaTypes.number(false, 'A priority number.');
  const TaxonomyType = FormulaTypes.text(false, 'A taxonomy type name.');

  const Tag = FormulaTypes.object('Tag', undefined, false, 'A tag on a page.');
  const Taxonomy = FormulaTypes.object(
    'Taxonomy',
    undefined,
    false,
    'A collection of related tags.',
  );
  const TagAssignment = FormulaTypes.object(
    'TagAssignment',
    undefined,
    false,
    'A link between a page and a tag.',
  );

  const UrlParts = FormulaTypes.object(
    'UrlParts',
    {
      domain: FormulaTypes.text(true, 'The website domain.'),
      path: FormulaTypes.text(true, 'The URL path.'),
    },
    false,
    'Parts of a URL.',
  );
  const LinkAttributes = FormulaTypes.object(
    'LinkAttributes',
    {
      href: FormulaTypes.text(true, 'The link address.'),
    },
    false,
    'Extra link details.',
  );
  const ImageAttributes = FormulaTypes.object(
    'ImageAttributes',
    {
      alt: FormulaTypes.text(true, 'Text shown when the image cannot load.'),
    },
    false,
    'Extra image details.',
  );

  const MarkupElement = FormulaTypes.object(
    'MarkupElement',
    {
      tag: FormulaTypes.text(true, 'The HTML tag name.'),
      name: FormulaTypes.text(true, 'The element name.'),
      attributes: FormulaTypes.object(
        'MarkupAttributes',
        undefined,
        true,
        'Extra details about the element.',
      ),
    },
    false,
    'A single markup element.',
  );

  const MarkupTree = FormulaTypes.object('MarkupTree', undefined, true, 'A tree of markup.');

  const MarkupLink = FormulaTypes.object(
    'MarkupLink',
    {
      text: FormulaTypes.text(true, 'The link text.'),
      rel: FormulaTypes.text(true, 'The link relationship type.'),
      attributes: LinkAttributes,
      url: UrlParts,
    },
    false,
    'A link found in markup.',
  );

  const MarkupImage = FormulaTypes.object(
    'MarkupImage',
    {
      src: FormulaTypes.text(true, 'The image address.'),
      attributes: ImageAttributes,
    },
    false,
    'An image found in markup.',
  );

  const PageMarkup = FormulaTypes.object(
    'PageMarkup',
    {
      elements: FormulaTypes.list(MarkupElement, true, 'The markup elements.'),
      tree: MarkupTree,
      links: FormulaTypes.list(MarkupLink, true, 'The links on the page.'),
      images: FormulaTypes.list(MarkupImage, true, 'The images on the page.'),
    },
    false,
    'Markup extracted from a page.',
  );

  const PageContent = FormulaTypes.object(
    'PageContent',
    {
      text: FormulaTypes.text(true, 'The page text content.'),
      markdown: FormulaTypes.text(true, 'The page content as Markdown.'),
      markup: PageMarkup,
      sections: FormulaTypes.list(FormulaTypes.any(true), true, 'The page content sections.'),
    },
    false,
    'Content for a page.',
  );

  const Page = FormulaTypes.object(
    'Page',
    {
      title: FormulaTypes.text(true, 'The page title.'),
      description: FormulaTypes.text(true, 'A short summary of the page.'),
      canonicalUrl: FormulaTypes.text(true, 'The main URL for the page.'),
      displayUrl: FormulaTypes.text(true, 'The URL shown to people.'),
      slug: FormulaTypes.text(true, 'A short URL-friendly name.'),
      content: PageContent,
      markup: PageMarkup,
    },
    false,
    'A webpage with content and metadata.',
  );

  // Fill in self-references now that the base objects exist.
  (Tag as any).properties = {
    name: FormulaTypes.text(true, 'The tag name.'),
    priority: Priority,
  };
  (Taxonomy as any).properties = {
    name: FormulaTypes.text(true, 'The taxonomy name.'),
    tags: FormulaTypes.list(Tag, true, 'The tags in this taxonomy.'),
    type: TaxonomyType,
  };
  (TagAssignment as any).properties = {
    confidence: FormulaTypes.number(true, 'How confident the assignment is.'),
    page: Page,
    tag: Tag,
  };

  return {
    primitives: {
      Any: FormulaTypes.any(false, 'Any value.'),
      Boolean: FormulaTypes.boolean(false, 'True or false.'),
      Number: FormulaTypes.number(false, 'A number.'),
      Text: FormulaTypes.text(false, 'Text.'),
      Null: FormulaTypes.null('No value.'),
    },

    taxonomy: {
      Taxonomy,
      Tag,
      TagAssignment,
      TaxonomyType,
      Priority,
    },

    pages: {
      Page,
      PageContent,
      PageMarkup,
      MarkupElement,
      MarkupTree,
      MarkupLink,
      LinkAttributes,
      UrlParts,
      MarkupImage,
      ImageAttributes,
    },

    content: {
      Content: FormulaTypes.object(
        'Content',
        {
          sections: FormulaTypes.list(FormulaTypes.any(true), true, 'The content sections.'),
        },
        false,
        'Content made of sections.',
      ),
    },
  };
}
