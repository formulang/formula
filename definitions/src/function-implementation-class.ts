import type { FunctionImplementation } from './registry';

/**
 * Base config passed to backend implementation classes.
 *
 * The key constraint is that portable definitions live in `definitions/*`,
 * while backend code only wires signature-id → implementation.
 */
export interface BaseFunctionConfig {
  signatureId: string;
}

/**
 * Typed class contract for backend-only formula implementations.
 *
 * Instances must satisfy the runtime `FunctionImplementation` contract.
 */
export interface FunctionImplementationClass<
  TConfig extends BaseFunctionConfig = BaseFunctionConfig,
> {
  new (config: TConfig): FunctionImplementation;
}
