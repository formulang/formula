import type {
  FunctionImplementation,
  FunctionImplementationResolver,
} from '@formulang/definitions';

export class InMemoryFunctionImplementationRegistry implements FunctionImplementationResolver {
  private readonly implementations = new Map<string, FunctionImplementation>();

  get(signatureId: string): FunctionImplementation | undefined {
    return this.implementations.get(signatureId);
  }

  register(signatureId: string, impl: FunctionImplementation): void {
    this.implementations.set(signatureId, impl);
  }
}
