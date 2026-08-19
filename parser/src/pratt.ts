import type { Token } from './tokens';

export class TokenStream {
  private idx = 0;
  /** Lightweight stream wrapper used by the Pratt-style parser. */
  constructor(private readonly tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.idx];
  }

  peekN(n: number): Token {
    return this.tokens[this.idx + n] ?? this.tokens[this.tokens.length - 1];
  }

  next(): Token {
    const t = this.tokens[this.idx] ?? this.tokens[this.tokens.length - 1];
    this.idx++;
    return t;
  }

  match(kind: Token['kind'], value?: string): Token | null {
    const t = this.peek();
    if (t.kind !== kind) return null;
    if (value !== undefined && t.value !== value) return null;
    this.idx++;
    return t;
  }

  expect(kind: Token['kind'], value?: string): Token {
    const t = this.next();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Expected ${kind}${value ? `(${value})` : ''} but got ${t.kind}(${t.value ?? ''})`,
      );
    }
    return t;
  }
}
