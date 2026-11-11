import { createCoreFormulaRuntime } from '@formulang/core-functions';
import {
  createRegistry,
  FormulaTypes,
  registerCoreFormulaDefinitions,
} from '@formulang/definitions';
import { registerFormattedTextDefinitions as fromSubpath } from '@formulang/formatted-text/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';
import { readFileSync } from 'node:fs';
import {
  FormattedTextSignatureIds,
  registerFormattedTextDefinitions,
  registerFormattedTextFunctions,
  registerFormattedTextImplementations,
} from './index';

describe('opting in to the formatted-text functions', () => {
  it('is not part of the core runtime', () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    for (const id of Object.values(FormattedTextSignatureIds)) {
      expect(registry.getFunction(id), id).toBeUndefined();
      expect(implementations.get(id), id).toBeUndefined();
    }
    expect(parseFormula('PLAIN_TEXT("x"; "html")', { registry }).errors.length).toBeGreaterThan(0);
  });

  it('adds both halves to a runtime in one call', async () => {
    const runtime = createCoreFormulaRuntime();
    registerFormattedTextFunctions(runtime);
    const rule = parseFormula('UPPER(PLAIN_TEXT("<b>Hi</b> there"; "html"))', {
      registry: runtime.registry,
    });
    expect(rule.errors).toStrictEqual([]);
    const res = await evaluateRuleAsync(rule, {
      registry: runtime.registry,
      resolver: runtime.implementations,
    });
    expect(res.value).toBe('HI THERE');
  });

  it('parses with the definitions alone, which fail to run without implementations', async () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    registerFormattedTextDefinitions(registry);
    const rule = parseFormula('MARKDOWN_BLOCKS("# a"; "heading")', { registry });
    expect(rule.errors).toStrictEqual([]);
    expect(rule.returnType).toStrictEqual(FormulaTypes.list(FormulaTypes.text(false), true));
    const { implementations } = createCoreFormulaRuntime();
    const res = await evaluateRuleAsync(rule, { registry, resolver: implementations });
    expect(res.errors.map((error) => error.code)).toStrictEqual(['UNBOUND_FUNCTION']);
    // Registering the implementations makes it run.
    registerFormattedTextImplementations(implementations);
    const bound = await evaluateRuleAsync(rule, { registry, resolver: implementations });
    expect(bound.value).toStrictEqual(['a']);
  });

  it('exports the same definitions from @formulang/formatted-text/definitions', () => {
    expect(fromSubpath).toBe(registerFormattedTextDefinitions);
  });

  it('keeps the definitions module free of executable imports', () => {
    const source = readFileSync(new URL('./definitions.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports).toStrictEqual(['@formulang/definitions']);
  });
});
