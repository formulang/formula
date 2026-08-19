import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  type RuleNode,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { parseFormula, parseVariableReference } from './index';

function collectNodeIds(node: RuleNode): string[] {
  const out: string[] = [];
  const visit = (n: RuleNode) => {
    out.push(n.id);
    if (n.kind === 'call') n.args.forEach(visit);
    if (n.kind === 'property' || n.kind === 'wildcard') visit(n.object);
  };
  visit(node);
  return out;
}

describe('parseVariableReference', () => {
  function makeRegistry() {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      type: FormulaTypes.object(
        'Value',
        {
          a: FormulaTypes.object('A', { b: FormulaTypes.any(true) }, true),
          snake_name: FormulaTypes.any(true),
        },
        true,
      ),
    });
    registry.registerVariable({
      name: 'list',
      type: FormulaTypes.list(
        FormulaTypes.object(
          'Item',
          { name: FormulaTypes.any(true), snake_name: FormulaTypes.any(true) },
          true,
        ),
        true,
      ),
    });
    registry.registerVariable({
      name: 'snake_name',
      type: FormulaTypes.any(true),
    });
    registerCoreFormulaDefinitions(registry);
    return registry;
  }

  it('parses a plain variable reference', () => {
    const registry = makeRegistry();
    const r = parseVariableReference('value', { registry });
    expect(r.errors).toStrictEqual([]);
    expect(r.root.kind).toBe('variable');
    if (r.root.kind !== 'variable') throw new Error('expected variable');
    expect(r.root.name).toBe('value');
    expect(r.requirements.variablesRead).toStrictEqual(['value']);
  });

  it('accepts lower_snake_case variable names', () => {
    const registry = makeRegistry();
    const r = parseVariableReference('snake_name', { registry });
    expect(r.errors).toStrictEqual([]);
    expect(r.root.kind).toBe('variable');
    if (r.root.kind !== 'variable') throw new Error('expected variable');
    expect(r.root.name).toBe('snake_name');
    expect(r.requirements.variablesRead).toStrictEqual(['snake_name']);
  });

  it('parses property access and wildcard expansion', () => {
    const registry = makeRegistry();
    const r = parseVariableReference('list.*.name', { registry });
    expect(r.errors).toStrictEqual([]);
    expect(r.root.kind).toBe('wildcard');
    if (r.root.kind !== 'wildcard') throw new Error('expected wildcard');
    expect(r.root.property).toBe('name');
    expect(r.requirements.variablesRead).toStrictEqual(['list.*.name']);
  });

  it('accepts lower_snake_case properties (including wildcard paths)', () => {
    const registry = makeRegistry();
    const a = parseVariableReference('value.snake_name', { registry });
    const b = parseVariableReference('list.*.snake_name', { registry });
    expect(a.errors).toStrictEqual([]);
    expect(b.errors).toStrictEqual([]);
    expect(a.requirements.variablesRead).toStrictEqual(['value.snake_name']);
    expect(b.requirements.variablesRead).toStrictEqual(['list.*.snake_name']);
  });

  it('is structurally consistent with parseFormula for variable paths', () => {
    const registry = makeRegistry();
    const a = parseFormula('value.a.b', { registry });
    const b = parseVariableReference('value.a.b', { registry });
    expect(a.errors).toStrictEqual([]);
    expect(b.errors).toStrictEqual([]);
    expect(a.root.kind).toBe(b.root.kind);
    expect(collectNodeIds(a.root)).toStrictEqual(collectNodeIds(b.root));
    expect(a.requirements.variablesRead).toStrictEqual(b.requirements.variablesRead);
  });

  it('is structurally consistent with parseFormula for wildcard paths', () => {
    const registry = makeRegistry();
    const a = parseFormula('list.*.name', { registry });
    const b = parseVariableReference('list.*.name', { registry });
    expect(a.errors).toStrictEqual([]);
    expect(b.errors).toStrictEqual([]);
    expect(collectNodeIds(a.root)).toStrictEqual(collectNodeIds(b.root));
    expect(a.requirements.variablesRead).toStrictEqual(['list.*.name']);
    expect(b.requirements.variablesRead).toStrictEqual(['list.*.name']);
  });

  it('rejects operators and extra tokens', () => {
    const registry = makeRegistry();
    const r = parseVariableReference('value + 1', { registry });
    expect(r.errors.some((e) => e.code === FormulaErrorCodes.UNEXPECTED_TOKEN)).toBe(true);
  });

  it('rejects function calls (does not parse them)', () => {
    const registry = makeRegistry();
    const r = parseVariableReference('FOO(1)', { registry });
    expect(r.errors.some((e) => e.code === FormulaErrorCodes.UNEXPECTED_TOKEN)).toBe(true);
  });

  it('rejects boolean literals (true/false) as non-variable references', () => {
    const registry = makeRegistry();
    const r1 = parseVariableReference('true', { registry });
    const r2 = parseVariableReference('FALSE', { registry });
    expect(r1.errors.some((e) => e.code === FormulaErrorCodes.UNKNOWN_VARIABLE)).toBe(true);
    expect(r2.errors.some((e) => e.code === FormulaErrorCodes.UNKNOWN_VARIABLE)).toBe(true);
  });

  it('rejects denylisted property names in property and wildcard access', () => {
    const registry = makeRegistry();
    const a = parseVariableReference('value.__proto__', { registry });
    const b = parseVariableReference('list.*.__proto__', { registry });
    expect(a.errors.some((e) => e.code === FormulaErrorCodes.DENYLISTED_PROPERTY)).toBe(true);
    expect(b.errors.some((e) => e.code === FormulaErrorCodes.DENYLISTED_PROPERTY)).toBe(true);
  });

  it('rejects non-snake-case variable and property names', () => {
    const registry = makeRegistry();

    const v = parseVariableReference('camelCase', { registry });
    expect(v.errors.some((e) => e.code === FormulaErrorCodes.INVALID_VARIABLE_NAME)).toBe(true);

    const p = parseVariableReference('value.camelCase', { registry });
    expect(p.errors.some((e) => e.code === FormulaErrorCodes.INVALID_PROPERTY_NAME)).toBe(true);

    const w = parseVariableReference('list.*.camelCase', { registry });
    expect(w.errors.some((e) => e.code === FormulaErrorCodes.INVALID_PROPERTY_NAME)).toBe(true);
  });
});
