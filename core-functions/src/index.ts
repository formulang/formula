import {
  createRegistry,
  registerCoreFormulaDefinitions,
  type MutableFormulaRegistry,
} from '@formulang/definitions';
import { registerPrimitiveFormulaImplementations } from './functions/register-primitive-implementations';
import { InMemoryFunctionImplementationRegistry } from './implementation-registry';

export type FormulaRuntime = {
  registry: MutableFormulaRegistry;
  implementations: InMemoryFunctionImplementationRegistry;
};

/**
 * Backend-only factory that registers core function definitions + executable implementations.
 */
export function createCoreFormulaRuntime(): FormulaRuntime {
  const registry = createRegistry();
  // Portable, data-only registry entries (safe for editor/embedding reuse).
  registerCoreFormulaDefinitions(registry);
  const implementations = new InMemoryFunctionImplementationRegistry();

  // Backend-only wiring: register executable implementations by signature id.
  registerPrimitiveFormulaImplementations(implementations);

  return { registry, implementations };
}
