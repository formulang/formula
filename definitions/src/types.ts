export type FormulaTypeKind =
  | 'any'
  | 'null'
  | 'boolean'
  | 'number'
  | 'text'
  | 'template'
  | 'callable'
  | 'list'
  | 'object'
  | 'union';

export interface FormulaTypeBase {
  kind: FormulaTypeKind;
  nullable?: boolean;
  /** A short one-sentence summary for non-technical readers. */
  description?: string;
}

function defaultDescription(kind: FormulaTypeKind, clarifier?: string): string {
  switch (kind) {
    case 'any':
      return 'Any value.';
    case 'null':
      return 'No value.';
    case 'boolean':
      return 'True or false.';
    case 'number':
      return 'A number.';
    case 'text':
      return 'Text.';
    case 'template':
      return 'A value matching the other arguments.';
    case 'callable':
      return 'A function or operator name.';
    case 'list':
      return 'A list of values.';
    case 'object':
      return clarifier ? `A ${clarifier} object.` : 'An object with properties.';
    case 'union':
      return 'One of several allowed values.';
  }
}

export interface AnyType extends FormulaTypeBase {
  kind: 'any';
}

export interface NullType extends FormulaTypeBase {
  kind: 'null';
}

export interface BooleanType extends FormulaTypeBase {
  kind: 'boolean';
}

export interface NumberType extends FormulaTypeBase {
  kind: 'number';
}

export interface TextType extends FormulaTypeBase {
  kind: 'text';
}

export interface TemplateType extends FormulaTypeBase {
  kind: 'template';
  /** Template/type-variable name (e.g. "T"). */
  name: string;
  /** Optional constraint for downstream tooling. */
  constraint?: FormulaType;
}

export type CallableReferenceKind = 'function' | 'operator' | 'function_or_operator';

export interface CallableType extends FormulaTypeBase {
  kind: 'callable';
  /** What kinds of registry entries this callable can refer to. */
  reference: CallableReferenceKind;

  /**
   * Optional callable signature declaration.
   *
   * When provided, the parser can validate that the referenced function/operator
   * accepts these argument types and returns a compatible type.
   */
  paramTypes?: FormulaType[];
  returnType?: FormulaType;

  /**
   * Optional arity constraints for the referenced callable.
   * If omitted, any arity is allowed.
   */
  minArity?: number;
  maxArity?: number;
}

export interface ListType extends FormulaTypeBase {
  kind: 'list';
  of: FormulaType;
}

export interface ObjectType extends FormulaTypeBase {
  kind: 'object';
  clarifier: string;
  properties?: Record<string, FormulaType>;
}

export interface UnionType extends FormulaTypeBase {
  kind: 'union';
  of: FormulaType[];
}

export type FormulaType =
  | AnyType
  | NullType
  | BooleanType
  | NumberType
  | TextType
  | TemplateType
  | CallableType
  | ListType
  | ObjectType
  | UnionType;

export const FormulaTypes = {
  any(nullable = false, description?: string): AnyType {
    return { kind: 'any', nullable, description: description ?? defaultDescription('any') };
  },
  null(description?: string): NullType {
    return { kind: 'null', description: description ?? defaultDescription('null') };
  },
  boolean(nullable = false, description?: string): BooleanType {
    return {
      kind: 'boolean',
      nullable,
      description: description ?? defaultDescription('boolean'),
    };
  },
  number(nullable = false, description?: string): NumberType {
    return { kind: 'number', nullable, description: description ?? defaultDescription('number') };
  },
  text(nullable = false, description?: string): TextType {
    return { kind: 'text', nullable, description: description ?? defaultDescription('text') };
  },

  template(
    name: string,
    options?: { nullable?: boolean; description?: string; constraint?: FormulaType },
  ): TemplateType {
    return {
      kind: 'template',
      name,
      nullable: options?.nullable ?? false,
      description: options?.description ?? defaultDescription('template'),
      constraint: options?.constraint,
    };
  },

  callable(
    reference: CallableReferenceKind = 'function_or_operator',
    options?: {
      nullable?: boolean;
      description?: string;
      paramTypes?: FormulaType[];
      returnType?: FormulaType;
      minArity?: number;
      maxArity?: number;
    },
  ): CallableType {
    return {
      kind: 'callable',
      reference,
      nullable: options?.nullable ?? false,
      description: options?.description ?? defaultDescription('callable'),
      paramTypes: options?.paramTypes,
      returnType: options?.returnType,
      minArity: options?.minArity,
      maxArity: options?.maxArity,
    };
  },
  list(of: FormulaType, nullable = false, description?: string): ListType {
    return { kind: 'list', of, nullable, description: description ?? defaultDescription('list') };
  },
  object(
    clarifier: string,
    properties?: Record<string, FormulaType>,
    nullable = false,
    description?: string,
  ): ObjectType {
    return {
      kind: 'object',
      clarifier,
      properties,
      nullable,
      description: description ?? defaultDescription('object', clarifier),
    };
  },

  /**
   * Union type (one-of) used for stronger signatures where multiple primitives are accepted.
   *
   * Example: boolean-like values: Union<boolean, text>
   */
  union(of: FormulaType[], nullable = false, description?: string): FormulaType {
    const flat: FormulaType[] = [];
    for (const t of of) {
      if (t.kind === 'union') flat.push(...t.of);
      else flat.push(t);
    }

    // De-dupe by kind + shape (best-effort, stable enough for registry checks).
    const keyOf = (t: FormulaType): string => {
      if (t.kind === 'list') return `list<${keyOf(t.of)}>`;
      if (t.kind === 'object') return `object:${t.clarifier ?? ''}`;
      if (t.kind === 'union') return `union<${t.of.map(keyOf).join('|')}>`;
      if (t.kind === 'template') return `template:${t.name}`;
      if (t.kind === 'callable') return `callable:${t.reference}`;
      return t.kind;
    };

    const seen = new Set<string>();
    const uniq: FormulaType[] = [];
    for (const t of flat) {
      const k = keyOf(t);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(t);
    }

    if (uniq.length === 0)
      return {
        kind: 'any',
        nullable,
        description: description ?? defaultDescription('any'),
      };
    if (uniq.length === 1) {
      const only = uniq[0]!;
      // Preserve the provided nullability at the union level.
      if (only.kind === 'null') return only;
      return {
        ...only,
        nullable: nullable || only.nullable === true,
        description: description ?? only.description,
      };
    }
    return {
      kind: 'union',
      of: uniq,
      nullable,
      description: description ?? defaultDescription('union'),
    };
  },
} as const;
