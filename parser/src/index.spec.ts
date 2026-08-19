import {
  createRegistry,
  FormulaTypes,
  registerCoreFormulaDefinitions,
  type RuleNode,
} from '@formulang/definitions';
import { parseFormula } from './index';

function collectNodeIds(node: RuleNode): string[] {
  const out: string[] = [];
  const visit = (n: RuleNode): void => {
    out.push(n.id);
    switch (n.kind) {
      case 'call':
        n.args.forEach(visit);
        return;
      case 'property':
      case 'wildcard':
        visit(n.object);
        return;
      case 'literal':
      case 'variable':
        return;
      default: {
        const _exhaustive: never = n;
        return _exhaustive;
      }
    }
  };
  visit(node);
  return out;
}

describe('parseFormula', () => {
  it('parses negative number literals', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('-1', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('literal');
    if (rule.root.kind !== 'literal') throw new Error('expected literal');
    expect(rule.root.value).toBe(-1);

    const rule2 = parseFormula('-1 + 2', { registry });
    expect(rule2.errors.length).toBe(0);
    expect(rule2.root.kind).toBe('call');
    if (rule2.root.kind !== 'call') throw new Error('expected call');
    expect(rule2.root.signatureId).toBe('ADD/v1');

    const rule3 = parseFormula('2 + -1', { registry });
    expect(rule3.errors.length).toBe(0);
    expect(rule3.root.kind).toBe('call');
    if (rule3.root.kind !== 'call') throw new Error('expected call');
    expect(rule3.root.signatureId).toBe('ADD/v1');
  });

  it('parses a basic operator expression and binds operator signature', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('1 + 2', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');
    expect(rule.root.signatureId).toBe('ADD/v1');
  });

  it('parses ampersand concat operator and binds CONCAT signature', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('"a" & "b" & "c"', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');

    expect(rule.root.signatureId).toBe('CONCAT/v1');
    expect(rule.root.args.length).toBe(2);
    expect(rule.root.args[0]?.kind).toBe('call');
    if (rule.root.args[0]?.kind !== 'call') throw new Error('expected call');
    expect(rule.root.args[0].signatureId).toBe('CONCAT/v1');
  });

  it('parses comparison operators for lower_snake_case variables', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'max_length',
      description: 'The maximum length value.',
      type: FormulaTypes.number(true),
    });
    registerCoreFormulaDefinitions(registry);

    const formulas = [
      'max_length > 0',
      'max_length >= 0',
      'max_length < 100',
      'max_length <= 100',
      'max_length = 10',
      'max_length <> 10',
    ];

    for (const source of formulas) {
      const rule = parseFormula(source, { registry });
      expect(rule.errors).toStrictEqual([]);
      expect(rule.root.kind).toBe('call');
    }
  });

  it('parses IF with comparison and snake_case variable using comma separators', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'max_length',
      description: 'The maximum length value.',
      type: FormulaTypes.number(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('IF(max_length > 0, "this", "that")', {
      registry,
      syntax: { argumentSeparator: ',' },
    });
    expect(rule.errors).toStrictEqual([]);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');
    expect(rule.root.args.length).toBe(3);
  });

  it('parses IF with no-space <> comparison between snake_case variables', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'some_variable',
      description: 'A first test value.',
      type: FormulaTypes.any(true),
    });
    registry.registerVariable({
      name: 'some_other_variable',
      description: 'A second test value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('IF(some_variable<>some_other_variable,"stuff","yes")', {
      registry,
      syntax: { argumentSeparator: ',' },
    });
    expect(rule.errors).toStrictEqual([]);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');
    expect(rule.root.args.length).toBe(3);
  });

  it('parses property access and rejects denylisted names', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('value.__proto__', { registry });
    expect(rule.errors.some((e) => e.code === 'DENYLISTED_PROPERTY')).toBe(true);
  });

  it('parses wildcard chain syntax', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('value.*.id', { registry });
    // typing will complain because value is Any, but syntax should parse
    expect(rule.root.kind === 'wildcard' || rule.root.kind === 'property').toBe(true);
  });

  it('enforces function naming conventions (UPPER_SNAKE_CASE)', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('foo(1)', { registry });
    expect(rule.errors.some((e) => e.code === 'INVALID_FUNCTION_NAME')).toBe(true);
  });

  it('enforces variable naming conventions (lower_snake_case)', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('Value', { registry });
    expect(rule.errors.some((e) => e.code === 'INVALID_VARIABLE_NAME')).toBe(true);
  });

  it('enforces property naming conventions (lower_snake_case)', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('value.Property', { registry });
    expect(rule.errors.some((e) => e.code === 'INVALID_PROPERTY_NAME')).toBe(true);
  });

  it('accepts lower_snake_case variables and properties', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'snake_name',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.object('Value', { snake_name: FormulaTypes.any(true) }, true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('snake_name', { registry });
    expect(a.errors.length).toBe(0);

    const b = parseFormula('value.snake_name', { registry });
    expect(b.errors.length).toBe(0);
  });

  it('rejects unknown functions', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('NOT_A_BUILTIN(1)', { registry });
    expect(rule.errors.some((e) => e.code === 'UNKNOWN_FUNCTION')).toBe(true);
  });

  it('parses semicolon-separated function arguments', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('LIST(1; 2; 3)', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');
    expect(rule.root.args.length).toBe(3);
  });

  it('supports configurable comma-separated function arguments', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('LIST(1, 2, 3)', { registry, syntax: { argumentSeparator: ',' } });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('call');
    if (rule.root.kind !== 'call') throw new Error('expected call');
    expect(rule.root.args.length).toBe(3);
  });

  it('emits a friendly error when using the wrong argument separator for the configured syntax', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('LIST(1; 2; 3)', { registry, syntax: { argumentSeparator: ',' } });
    expect(rule.errors.some((e) => e.code === 'UNEXPECTED_TOKEN')).toBe(true);
    expect(
      rule.errors.some((e) => e.message.includes("Use ',' to separate function arguments.")),
    ).toBe(true);
  });

  it('supports configurable comma decimal separator for numeric literals', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('1,23', { registry, syntax: { decimalSeparator: ',' } });
    expect(rule.errors.length).toBe(0);
    expect(rule.root.kind).toBe('literal');
    if (rule.root.kind !== 'literal') throw new Error('expected literal');
    expect(rule.root.value).toBeCloseTo(1.23);
  });

  it('rejects conflicting argument/decimal separators in syntax config', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('1', {
      registry,
      syntax: { argumentSeparator: ',', decimalSeparator: ',' },
    });
    expect(rule.errors.some((e) => e.code === 'INVALID_SYNTAX_CONFIG')).toBe(true);
  });

  it('chooses overloads based on argument types', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    registry.registerFunction({
      signatureId: 'FOO_NUMBER/v1',
      name: 'FOO',
      category: 'core',
      description: 'Test overload that accepts a number.',
      params: [{ name: 'x', type: FormulaTypes.number(true) }],
      returnType: FormulaTypes.text(false),
      purity: 'pure',
    });
    registry.registerFunction({
      signatureId: 'FOO_TEXT/v1',
      name: 'FOO',
      category: 'core',
      description: 'Test overload that accepts text.',
      params: [{ name: 'x', type: FormulaTypes.text(true) }],
      returnType: FormulaTypes.text(false),
      purity: 'pure',
    });

    const num = parseFormula('FOO(1)', { registry });
    expect(num.errors.length).toBe(0);
    expect(num.root.kind).toBe('call');
    if (num.root.kind === 'call') expect(num.root.signatureId).toBe('FOO_NUMBER/v1');

    const txt = parseFormula('FOO("x")', { registry });
    expect(txt.errors.length).toBe(0);
    expect(txt.root.kind).toBe('call');
    if (txt.root.kind === 'call') expect(txt.root.signatureId).toBe('FOO_TEXT/v1');
  });

  it('validates literal-only function/operator references', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('FILTER(LIST(1;2); "NOPE"; 1)', { registry });
    expect(rule.errors.some((e) => e.code === 'UNKNOWN_FUNCTION_REFERENCE')).toBe(true);
  });

  it('infers EACH return element type from the referenced callable', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('EACH(LIST("a";"bb"); "LEN")', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.returnType.kind).toBe('list');
    if (rule.returnType.kind === 'list') {
      expect(rule.returnType.of.kind).toBe('number');
      expect(rule.returnType.nullable).toBe(true);
    }
  });

  it('enforces LIST item type consistency', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    const rule = parseFormula('LIST(1; "a")', { registry });
    expect(rule.errors.some((e) => e.code === 'ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE')).toBe(true);
  });

  it('validates argument types for non-overloaded functions/operators', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const byName = parseFormula('ADD("x"; 1)', { registry });
    expect(byName.errors.some((e) => e.code === 'ARGUMENT_TYPE_MISMATCH')).toBe(true);

    const byOperator = parseFormula('1 + "x"', { registry });
    expect(byOperator.errors.some((e) => e.code === 'ARGUMENT_TYPE_MISMATCH')).toBe(true);
  });

  it('reports when no overload matches the provided argument types', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    // LEN has overloads for TEXT and LIST; NUMBER should match neither.
    const rule = parseFormula('LEN(1)', { registry });
    expect(rule.errors.some((e) => e.code === 'NO_MATCHING_OVERLOAD')).toBe(true);
  });

  it('accepts union boolean-like types for IF condition', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'cond',
      description: 'A test condition value.',
      type: FormulaTypes.union([FormulaTypes.boolean(false), FormulaTypes.text(false)], true),
    });
    registerCoreFormulaDefinitions(registry);

    const ok = parseFormula('IF(cond; 1; 2)', { registry });
    expect(ok.errors).toStrictEqual([]);

    const bad = parseFormula('IF(1; 1; 2)', { registry });
    expect(
      bad.errors.some(
        (e) =>
          e.code === 'ARGUMENT_TYPE_MISMATCH' && /condition must be boolean-like/i.test(e.message),
      ),
    ).toBe(true);
  });

  it('assigns stable node IDs independent of source spans', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('COUNT(LIST(LIST(1); LIST(2); LIST(3)))', { registry });
    const b = parseFormula('  COUNT( LIST( LIST( 1 ) ; LIST(2) ; LIST( 3 ) ) )  ', {
      registry,
    });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    expect(collectNodeIds(a.root)).toEqual(collectNodeIds(b.root));
  });

  it('assigns unique node IDs within a tree', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('LIST(1; 2; 3)', { registry });
    expect(rule.errors.length).toBe(0);

    const ids = collectNodeIds(rule.root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps node IDs stable when literal values change', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('LIST(1; 2; 3)', { registry });
    const b = parseFormula('LIST(1; 999; 3)', { registry });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    expect(collectNodeIds(a.root)).toEqual(collectNodeIds(b.root));

    // Spot-check the expected shape/indices.
    expect(a.root.id).toBe('LIST-0');
    if (a.root.kind !== 'call') throw new Error('expected call');
    expect(a.root.args[0]?.id).toBe('LIST-0/NUMBER-0');
    expect(a.root.args[1]?.id).toBe('LIST-0/NUMBER-1');
    expect(a.root.args[2]?.id).toBe('LIST-0/NUMBER-2');
  });

  it('shifts sibling indices when inserting earlier siblings', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('LIST(1; 2; 3)', { registry });
    const b = parseFormula('LIST(0; 1; 2; 3)', { registry });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    // The root remains the same.
    expect(a.root.id).toBe('LIST-0');
    expect(b.root.id).toBe('LIST-0');

    if (a.root.kind !== 'call' || b.root.kind !== 'call') throw new Error('expected call');

    // In the original formula, the '1' literal is the first number.
    expect(a.root.args[0]?.id).toBe('LIST-0/NUMBER-0');
    // After inserting a new leading number, existing numbers shift by +1.
    expect(b.root.args[1]?.id).toBe('LIST-0/NUMBER-1');
    expect(b.root.args[2]?.id).toBe('LIST-0/NUMBER-2');
    expect(b.root.args[3]?.id).toBe('LIST-0/NUMBER-3');
  });

  it('assigns stable IDs for nested functions (deep literal edits)', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('COUNT(LIST(1; AVG(LIST(2;3)); 4))', { registry });
    const b = parseFormula('COUNT(LIST(1; AVG(LIST(200;300)); 4))', { registry });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    // With type-only literal fingerprinting, changing number values should not affect IDs.
    expect(collectNodeIds(a.root)).toEqual(collectNodeIds(b.root));

    expect(a.root.id).toBe('COUNT-0');
    if (a.root.kind !== 'call') throw new Error('expected call');
    expect(a.root.args[0]?.id).toBe('COUNT-0/LIST-0');
  });

  it('handles different literal value types between parameters', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('IF(TRUE; "x"; 0)', { registry });
    expect(rule.errors.some((e) => e.code === 'ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE')).toBe(true);
    expect(rule.root.id).toBe('IF-0');
    if (rule.root.kind !== 'call') throw new Error('expected call');

    // Argument IDs are type-based and index-based for same-type siblings.
    expect(rule.root.args[0]?.id).toBe('IF-0/BOOLEAN-0');
    expect(rule.root.args[1]?.id).toBe('IF-0/TEXT-0');
    expect(rule.root.args[2]?.id).toBe('IF-0/NUMBER-0');
  });

  it('infers IF return type from then/else branches (including nullability)', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'n',
      description: 'A test number value.',
      type: FormulaTypes.number(true),
    });
    registry.registerVariable({
      name: 'nil',
      description: 'A test empty value.',
      type: FormulaTypes.null(),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('IF(TRUE; 1; n)', { registry });
    expect(a.errors.length).toBe(0);
    expect(a.returnType.kind).toBe('number');
    expect(a.returnType.nullable).toBe(true);

    const b = parseFormula('IF(TRUE; 1; nil)', { registry });
    expect(b.errors.length).toBe(0);
    expect(b.returnType.kind).toBe('number');
    expect(b.returnType.nullable).toBe(true);
  });

  it('enforces IF then/else branch type consistency across generic types', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'nums',
      description: 'A test list of numbers.',
      type: FormulaTypes.list(FormulaTypes.number(false), false),
    });
    registry.registerVariable({
      name: 'txts',
      description: 'A test list of text values.',
      type: FormulaTypes.list(FormulaTypes.text(false), false),
    });
    registry.registerVariable({
      name: 'nil',
      description: 'A test empty value.',
      type: FormulaTypes.null(),
    });
    registerCoreFormulaDefinitions(registry);

    const ok = parseFormula('IF(TRUE; nums; nums)', { registry });
    expect(ok.errors.length).toBe(0);
    expect(ok.returnType.kind).toBe('list');

    const bad = parseFormula('IF(TRUE; nums; txts)', { registry });
    expect(bad.errors.some((e) => e.code === 'ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE')).toBe(true);

    const nullableOk = parseFormula('IF(TRUE; nums; nil)', { registry });
    expect(nullableOk.errors.length).toBe(0);
    expect(nullableOk.returnType.kind).toBe('list');
    expect(nullableOk.returnType.nullable).toBe(true);
  });

  it('infers IF return type when one branch is Any', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'x',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const rule = parseFormula('IF(TRUE; x; 1)', { registry });
    expect(rule.errors.length).toBe(0);
    expect(rule.returnType.kind).toBe('number');
    expect(rule.returnType.nullable).toBe(true);
  });

  it('keeps static+computed arguments stable except where semantics change', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input object.',
      type: FormulaTypes.object(
        'Value',
        { prefix: FormulaTypes.text(true), suffix: FormulaTypes.text(true) },
        true,
      ),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('FILTER(LIST("data:a";"x"); "STARTS_WITH"; value.prefix)', {
      registry,
    });
    const b = parseFormula('FILTER(LIST("data:a";"x"); "STARTS_WITH"; value.suffix)', {
      registry,
    });
    expect(a.errors).toStrictEqual([]);
    expect(b.errors).toStrictEqual([]);

    // Root and the first two args should remain stable.
    expect(a.root.id).toBe('FILTER-0');
    expect(b.root.id).toBe('FILTER-0');
    if (a.root.kind !== 'call' || b.root.kind !== 'call') throw new Error('expected call');
    expect(a.root.args[0]?.id).toBe('FILTER-0/LIST-0');
    expect(b.root.args[0]?.id).toBe('FILTER-0/LIST-0');
    expect(a.root.args[1]?.id).toBe('FILTER-0/TEXT-0');
    expect(b.root.args[1]?.id).toBe('FILTER-0/TEXT-0');

    // The computed parameter subtree should change when the property name changes.
    expect(a.root.args[2]?.id).not.toBe(b.root.args[2]?.id);
  });

  it('assigns stable IDs for operator precedence and grouping', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('1 + 2 * 3', { registry });
    const b = parseFormula('  ( 1)  +  (2* 3 ) ', { registry });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    expect(collectNodeIds(a.root)).toEqual(collectNodeIds(b.root));

    // Spot check shape: ADD at root with MUL as one child.
    expect(a.root.id).toBe('ADD-0');
    if (a.root.kind !== 'call') throw new Error('expected call');
    expect(a.root.args[0]?.id).toBe('ADD-0/NUMBER-0');
    expect(a.root.args[1]?.id).toBe('ADD-0/MUL-0');
  });

  it('changes IDs when operator grouping changes semantics', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);

    const a = parseFormula('1 + 2 * 3', { registry });
    const b = parseFormula('(1 + 2) * 3', { registry });
    expect(a.errors.length).toBe(0);
    expect(b.errors.length).toBe(0);

    // Different AST shape => different IDs.
    expect(a.root.id).not.toBe(b.root.id);
  });
});
