import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { parseFormula } from './index';

describe('parseFormula failures', () => {
  function makeRegistry() {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    return registry;
  }

  it('IDENTIFIER_TOO_LONG', () => {
    const registry = makeRegistry();
    const rule = parseFormula('abcd', { registry, limits: { maxIdentifierLength: 3 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.IDENTIFIER_TOO_LONG)).toBe(true);
  });

  it('INVALID_FUNCTION_NAME', () => {
    const registry = makeRegistry();
    const rule = parseFormula('foo(1)', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.INVALID_FUNCTION_NAME)).toBe(true);
  });

  it('INVALID_VARIABLE_NAME', () => {
    const registry = makeRegistry();
    const rule = parseFormula('Foo', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.INVALID_VARIABLE_NAME)).toBe(true);
  });

  it('INVALID_PROPERTY_NAME', () => {
    const registry = makeRegistry();
    const rule = parseFormula('value.Bad', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.INVALID_PROPERTY_NAME)).toBe(true);
  });

  it('EXPECTED_PROPERTY', () => {
    const registry = makeRegistry();
    const rule = parseFormula('value.', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.EXPECTED_PROPERTY)).toBe(true);
  });

  it('EXPECTED_RPAREN', () => {
    const registry = makeRegistry();
    const rule = parseFormula('(1 + 2', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.EXPECTED_RPAREN)).toBe(true);
  });

  it('UNEXPECTED_TOKEN (trailing token)', () => {
    const registry = makeRegistry();
    const rule = parseFormula('1 2', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.UNEXPECTED_TOKEN)).toBe(true);
  });

  it('TOO_MANY_AST_NODES', () => {
    const registry = makeRegistry();
    const rule = parseFormula('1 + 2 + 3 + 4', { registry, limits: { maxAstNodes: 2 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.TOO_MANY_AST_NODES)).toBe(true);
  });

  it('PARSER_CRASH (registry throws during parse)', () => {
    const registry: any = makeRegistry();
    const original = registry.getOperator.bind(registry);
    registry.getOperator = (token: string) => {
      if (token === '+') throw new Error('boom');
      return original(token);
    };

    const rule = parseFormula('1 + 2', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.PARSER_CRASH)).toBe(true);
  });

  it('UNKNOWN_VARIABLE', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('missing', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.UNKNOWN_VARIABLE)).toBe(true);
  });

  it('UNKNOWN_FUNCTION', () => {
    const registry = makeRegistry();
    const rule = parseFormula('NOPE(1)', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.UNKNOWN_FUNCTION)).toBe(true);
  });

  it('WILDCARD_TARGET_NOT_LIST', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input number.',
      type: FormulaTypes.number(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('value.*.id', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.WILDCARD_TARGET_NOT_LIST)).toBe(
      true,
    );
  });

  it('PROPERTY_TARGET_NOT_OBJECT', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input number.',
      type: FormulaTypes.number(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('value.id', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.PROPERTY_TARGET_NOT_OBJECT)).toBe(
      true,
    );
  });

  it('DENYLISTED_PROPERTY (parse-time)', () => {
    const registry = makeRegistry();
    const rule = parseFormula('value.__proto__', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.DENYLISTED_PROPERTY)).toBe(true);
  });

  it('SOURCE_TOO_LONG', () => {
    const registry = makeRegistry();
    const rule = parseFormula('1234', { registry, limits: { maxSourceLength: 3 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.SOURCE_TOO_LONG)).toBe(true);
  });

  it('TOO_MANY_TOKENS', () => {
    const registry = makeRegistry();
    const rule = parseFormula('1', { registry, limits: { maxTokens: 1 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.TOO_MANY_TOKENS)).toBe(true);
    expect(rule.errors.some((e) => e.kind === 'security')).toBe(true);
  });

  it('PARENS_TOO_DEEP', () => {
    const registry = makeRegistry();
    const rule = parseFormula('(1)', { registry, limits: { maxParenDepth: 0 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.PARENS_TOO_DEEP)).toBe(true);
    expect(rule.errors.some((e) => e.kind === 'security')).toBe(true);
  });

  it('STRING_LITERAL_TOO_LONG', () => {
    const registry = makeRegistry();
    const rule = parseFormula('"ab"', { registry, limits: { maxStringLiteralLength: 1 } });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.STRING_LITERAL_TOO_LONG)).toBe(
      true,
    );
    expect(rule.errors.some((e) => e.kind === 'security')).toBe(true);
  });

  it('EXPECTED_STRING_LITERAL_REFERENCE (literalOnly param)', () => {
    const registry = makeRegistry();
    const rule = parseFormula('FILTER(LIST(1;2); value; 1)', { registry });
    expect(
      rule.errors.some((e) => e.code === FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE),
    ).toBe(true);
  });

  it('ARGUMENT_TYPE_MISMATCH (callable return type mismatch)', () => {
    const registry = makeRegistry();
    // LEN(text) -> number, but FILTER expects a boolean-returning check.
    const rule = parseFormula('FILTER(LIST("a";"bb"); "LEN")', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
  });

  it('NO_MATCHING_OVERLOAD (callable arity mismatch)', () => {
    const registry = makeRegistry();
    // LEN only accepts one argument; EACH will invoke it with (item, 1).
    const rule = parseFormula('EACH(LIST("a"); "LEN"; 1)', { registry });
    expect(rule.errors.some((e) => e.code === FormulaErrorCodes.NO_MATCHING_OVERLOAD)).toBe(true);
  });

  describe('enumerated literal values (literalValues)', () => {
    function makeModeRegistry() {
      const registry = makeRegistry();
      registry.registerFunction({
        signatureId: 'SHOUT/v1',
        name: 'SHOUT',
        category: 'core',
        description: 'Test function with an optional enumerated mode.',
        params: [
          { name: 'text', type: FormulaTypes.text(true) },
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            optional: true,
            literalOnly: true,
            literalValues: ['upper', 'lower'],
          },
        ],
        returnType: FormulaTypes.text(true),
        purity: 'pure',
      });
      return registry;
    }

    it('compiles a listed literal and an omitted optional mode', () => {
      const registry = makeModeRegistry();
      expect(parseFormula('SHOUT("a"; "lower")', { registry }).errors).toStrictEqual([]);
      expect(parseFormula('SHOUT("a")', { registry }).errors).toStrictEqual([]);
    });

    it('EXPECTED_STRING_LITERAL_REFERENCE (non-literal mode)', () => {
      const rule = parseFormula('SHOUT("a"; value)', { registry: makeModeRegistry() });
      expect(
        rule.errors.some((e) => e.code === FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE),
      ).toBe(true);
      expect(rule.errors.some((e) => e.code === FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED)).toBe(
        false,
      );
    });

    it('LITERAL_VALUE_NOT_ALLOWED names the admitted values', () => {
      const source = 'SHOUT("a"; "uper")';
      const rule = parseFormula(source, { registry: makeModeRegistry() });
      expect(rule.errors).toHaveLength(1);
      const error = rule.errors[0];
      expect(error?.code).toBe(FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED);
      expect(error?.kind).toBe('type');
      expect(error?.message).toBe(`Parameter 'mode' must be one of "upper", "lower"; got "uper"`);
      expect(error?.path).toStrictEqual(['call', 'SHOUT/v1', 'arg', '1']);
      expect(source.slice(error?.span?.start, error?.span?.end)).toBe('"uper"');
    });

    it('matches admitted values exactly (case-sensitive)', () => {
      const rule = parseFormula('SHOUT("a"; "Upper")', { registry: makeModeRegistry() });
      expect(rule.errors.map((e) => e.code)).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
    });
  });

  describe('literal-only arguments: variadic parameters and higher-order calls', () => {
    function makeTagRegistry() {
      const registry = makeRegistry();
      registry.registerFunction({
        signatureId: 'TAG/v1',
        name: 'TAG',
        category: 'core',
        description: 'Test function with a variadic enumerated mode.',
        params: [
          { name: 'text', type: FormulaTypes.text(true) },
          {
            name: 'modes',
            type: FormulaTypes.text(false),
            optional: true,
            variadic: true,
            literalOnly: true,
            literalValues: ['a', 'b'],
          },
        ],
        returnType: FormulaTypes.text(true),
        purity: 'pure',
      });
      registry.registerFunction({
        signatureId: 'IS_MODE/v1',
        name: 'IS_MODE',
        category: 'core',
        description: 'Test predicate with an enumerated mode.',
        params: [
          { name: 'value', type: FormulaTypes.any(true) },
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            literalValues: ['upper', 'lower'],
          },
        ],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
      return registry;
    }

    const errorsOf = (source: string) =>
      parseFormula(source, { registry: makeTagRegistry() }).errors;
    const codesOf = (source: string) => errorsOf(source).map((e) => e.code);

    it('checks every argument a variadic literal-only parameter takes', () => {
      expect(codesOf('TAG("x")')).toStrictEqual([]);
      expect(codesOf('TAG("x"; "a"; "b"; "a")')).toStrictEqual([]);
      const [notAdmitted, ...rest] = errorsOf('TAG("x"; "a"; "zzz")');
      expect(rest).toStrictEqual([]);
      expect(notAdmitted?.code).toBe(FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED);
      expect(notAdmitted?.path).toStrictEqual(['call', 'TAG/v1', 'arg', '2']);
      expect(codesOf('TAG("x"; "a"; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
    });

    it('checks only the first argument of a variadic literal-only parameter that lists no values', () => {
      // 1.0.0 behaviour: a variadic literal-only parameter without literalValues is validated at
      // its own position only; the extra arguments it takes are not re-checked.
      const registry = makeRegistry();
      registry.registerFunction({
        signatureId: 'JOIN_MODES/v1',
        name: 'JOIN_MODES',
        category: 'core',
        description: 'Test function with a variadic literal-only parameter and no admitted values.',
        params: [
          { name: 'text', type: FormulaTypes.text(true) },
          {
            name: 'parts',
            type: FormulaTypes.text(false),
            optional: true,
            variadic: true,
            literalOnly: true,
          },
        ],
        returnType: FormulaTypes.text(true),
        purity: 'pure',
      });
      const codes = (source: string) =>
        parseFormula(source, { registry }).errors.map((e) => e.code);
      expect(codes('JOIN_MODES("x")')).toStrictEqual([]);
      expect(codes('JOIN_MODES("x"; "a"; value; value)')).toStrictEqual([]);
      expect(codes('JOIN_MODES("x"; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
    });

    it("applies the callable's literal rules to every argument a higher-order call forwards", () => {
      const source = 'EACH(LIST("a b"; "c d e"); "WORD_COUNT"; "whitespce")';
      const errors = errorsOf(source);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe(FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED);
      expect(errors[0]?.message).toBe(
        `Parameter 'mode' of WORD_COUNT must be one of "whitespace", "letters", "locale", "pattern"; got "whitespce"`,
      );
      expect(errors[0]?.path).toStrictEqual(['call', 'EACH/v1', 'arg', '2']);
      expect(source.slice(errors[0]?.span?.start, errors[0]?.span?.end)).toBe('"whitespce"');

      const nonLiteral = 'EACH(LIST("a b"); "WORD_COUNT"; value)';
      const [notLiteral, ...others] = errorsOf(nonLiteral);
      expect(others).toStrictEqual([]);
      expect(notLiteral?.code).toBe(FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE);
      expect(nonLiteral.slice(notLiteral?.span?.start, notLiteral?.span?.end)).toBe('value');

      for (const misspelt of [
        'EACH(LIST("a b"); "LEADING_WORDS"; 2; "whitspace")',
        'EACH(LIST("a b"); "FIRST_CONTAINED"; LIST("a"); "wrd")',
        'EACH(LIST("a b"); "PLAIN_TEXT"; "htm")',
        'EACH(LIST("x"); "TAG"; "a"; "zzz")',
        'FILTER(LIST("x"); "IS_MODE"; "uper")',
        'FILTER_PROPERTY(value; "p"; "IS_MODE"; "uper")',
        'FILTER_BY(LIST(1); LIST("x"); "IS_MODE"; "uper")',
      ]) {
        expect(codesOf(misspelt), misspelt).toStrictEqual([
          FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        ]);
      }
      for (const admitted of [
        'EACH(LIST("a b"; "c d e"); "WORD_COUNT"; "letters")',
        'EACH(LIST("x"); "TAG"; "a"; "b")',
        'FILTER(LIST("x"); "IS_MODE"; "upper")',
        'FILTER_BY(LIST(1); LIST("x"); "IS_MODE"; "lower")',
      ]) {
        expect(codesOf(admitted), admitted).toStrictEqual([]);
      }
    });

    it('refuses a literal-only parameter that a higher-order call fills at run time', () => {
      const errors = errorsOf('REDUCE("x"; LIST("a"); "TAG")');
      expect(errors.map((e) => e.code)).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
      expect(errors[0]?.message).toBe(
        `Parameter 'modes' of TAG must be a string literal; REDUCE passes it a value at run time`,
      );
    });

    it('applies the passed-on rule only to parameters that list admitted values', () => {
      // These parameters are literal-only but list no admitted values; what a higher-order call
      // passes them is parsed as in 1.0.0.
      expect(codesOf('EACH(value; "SORT_BY_PROPERTY"; "name")')).toStrictEqual([]);
      expect(codesOf('EACH(value; "SORT_BY_PROPERTY"; value)')).toStrictEqual([]);
      expect(codesOf('REDUCE(value; LIST("name"); "SORT_BY_PROPERTY")')).toStrictEqual([]);
      expect(codesOf('EACH(value; "FILTER_PROPERTY"; value; ">"; 1)')).toStrictEqual([]);
      expect(codesOf('EACH(LIST(LIST(1)); "FILTER"; ">"; 0)')).toStrictEqual([]);
      expect(codesOf('EACH(LIST(LIST(1)); "FILTER"; value; 0)')).toStrictEqual([]);
      // Written directly in the call, the argument is required to be a literal, as in 1.0.0.
      expect(codesOf('SORT_BY_PROPERTY(value; "name")')).toStrictEqual([]);
      expect(codesOf('SORT_BY_PROPERTY(value; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
    });

    it('holds an argument to the admitted values of every overload the name has', () => {
      // EACH invokes the first PICK that has an implementation, whichever overload the parser
      // chose, so PICK(text; mode)'s enumerated mode binds the argument PICK(list; key) takes too.
      const registry = makeTagRegistry();
      registry.registerFunction({
        signatureId: 'PICK/v1',
        name: 'PICK',
        category: 'core',
        description: 'Test overload with an enumerated mode.',
        params: [
          { name: 'text', type: FormulaTypes.text(true) },
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            literalValues: ['a', 'b'],
          },
        ],
        returnType: FormulaTypes.text(true),
        purity: 'pure',
      });
      registry.registerFunction({
        signatureId: 'PICK_LIST/v1',
        name: 'PICK',
        category: 'core',
        description: 'Test overload whose second parameter lists no admitted values.',
        params: [
          { name: 'list', type: FormulaTypes.list(FormulaTypes.text(true), true) },
          { name: 'key', type: FormulaTypes.text(true) },
        ],
        returnType: FormulaTypes.text(true),
        purity: 'pure',
      });
      const codes = (source: string) =>
        parseFormula(source, { registry }).errors.map((e) => e.code);
      // Whichever item type selects which overload, a non-admitted literal at the mode position is
      // refused and an admitted one compiles.
      expect(codes('EACH(LIST("x"); "PICK"; "a")')).toStrictEqual([]);
      expect(codes('EACH(LIST(LIST("x")); "PICK"; "a")')).toStrictEqual([]);
      expect(codes('EACH(LIST("x"); "PICK"; "zzz")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(codes('EACH(LIST(LIST("x")); "PICK"; "zzz")')).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(codes('EACH(LIST(LIST("x")); "PICK"; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
      expect(codes('EACH(LIST(LIST(LIST("x"))); "EACH"; "PICK"; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
    });

    it('resolves a function name passed on when the call runs, so an unknown one compiles', () => {
      // The nested FILTER invokes nothing for "NOPE" and yields null, as it always has; only the
      // name written as a higher-order function's own argument is checked against the registry.
      expect(codesOf('EACH(LIST(LIST(1)); "FILTER"; "NOPE")')).toStrictEqual([]);
      expect(codesOf('EACH(value; "EACH"; "WORD_CONT"; "whitespce")')).toStrictEqual([]);
      expect(codesOf('FILTER(LIST(1); "NOPE")')).toStrictEqual([
        FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
      ]);
    });

    it('follows a nested higher-order call to the callable it names, at any depth', () => {
      const source = 'EACH(value; "EACH"; "WORD_COUNT"; "whitespce")';
      const errors = errorsOf(source);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe(FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED);
      expect(errors[0]?.message).toBe(
        `Parameter 'mode' of WORD_COUNT must be one of "whitespace", "letters", "locale", "pattern"; got "whitespce"`,
      );
      expect(errors[0]?.path).toStrictEqual(['call', 'EACH/v1', 'arg', '3']);
      expect(source.slice(errors[0]?.span?.start, errors[0]?.span?.end)).toBe('"whitespce"');

      const twoDeep = 'EACH(value; "EACH"; "WORD_COUNT"; value)';
      const [notLiteral, ...others] = errorsOf(twoDeep);
      expect(others).toStrictEqual([]);
      expect(notLiteral?.code).toBe(FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE);
      expect(notLiteral?.message).toBe(`Parameter 'mode' of WORD_COUNT must be a string literal`);
      expect(twoDeep.slice(notLiteral?.span?.start, notLiteral?.span?.end)).toBe('value');

      const filled = errorsOf('EACH(value; "REDUCE"; LIST("a"); "TAG")');
      expect(filled.map((e) => e.message)).toStrictEqual([
        `Parameter 'modes' of TAG must be a string literal; REDUCE passes it a value at run time`,
      ]);

      for (const misspelt of [
        'EACH(value; "EACH"; "MARKDOWN_BLOCKS"; "heding-2")',
        'EACH(value; "EACH"; "PLAIN_TEXT"; "htm")',
        'EACH(value; "EACH"; "SENTENCES"; "punctuaton")',
        'EACH(value; "EACH"; "LEADING_WORDS"; 2; "whitspace")',
        'EACH(value; "EACH"; "TAG"; "a"; "zzz")',
        'EACH(value; "EACH"; "EACH"; "WORD_COUNT"; "whitespce")',
        'EACH(value; "EACH"; "EACH"; "EACH"; "WORD_COUNT"; "whitespce")',
        'EACH(value; "FILTER"; "IS_MODE"; "uper")',
        'EACH(value; "FILTER_PROPERTY"; "p"; "IS_MODE"; "uper")',
        'EACH(value; "FILTER_BY"; LIST("x"); "IS_MODE"; "uper")',
        'COUNT(FLAT(EACH(value; "EACH"; "WORD_COUNT"; "whitespce")))',
      ]) {
        expect(codesOf(misspelt), misspelt).toStrictEqual([
          FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        ]);
      }
      // A non-literal reaching an enumerated parameter, however deep, is refused.
      expect(codesOf('EACH(value; "EACH"; "EACH"; "WORD_COUNT"; value)')).toStrictEqual([
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ]);
      // A non-literal reaching a value-less literal-only parameter, or naming a nested callable,
      // keeps 1.0.0 behaviour and compiles.
      for (const compiles of [
        'EACH(value; "EACH"; value; "whitespace")',
        'EACH(value; "EACH"; "SORT_BY_PROPERTY"; value)',
        'EACH(value; "EACH"; "WORD_COUNT"; "whitespace")',
        'EACH(value; "EACH"; "EACH"; "WORD_COUNT"; "letters")',
        'EACH(value; "FILTER"; "IS_MODE"; "upper")',
        'EACH(value; "EACH"; "SORT_BY_PROPERTY"; "name")',
      ]) {
        expect(codesOf(compiles), compiles).toStrictEqual([]);
      }
    });
  });
});
