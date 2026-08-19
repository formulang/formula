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
});
