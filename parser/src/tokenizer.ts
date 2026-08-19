import type { FormulaLimits } from '@formulang/definitions';
import { FormulaErrorCodes, FormulaLimitError } from '@formulang/definitions';
import type { FormulaSyntax } from './syntax';
import { DEFAULT_FORMULA_SYNTAX } from './syntax';
import type { Token } from './tokens';

function isWhitespace(ch: string): boolean {
  // Fast path for ASCII whitespace.
  // Note: we intentionally don't treat all Unicode whitespace as whitespace.
  // Keeping the lexer conservative reduces odd parsing edge cases.
  const code = ch.charCodeAt(0);
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x0b ||
    code === 0x0c
  );
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

const TWO_CHAR_OPERATORS = new Set(['<=', '>=', '<>']);
const ONE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '^', '=', '<', '>', '&']);

/**
 * Convert a formula string into a token stream.
 *
 * Enforces basic resource limits early (token count, nesting depth,
 * overly long identifiers/strings) so the parser remains predictable.
 */
export function tokenize(
  source: string,
  limits: FormulaLimits,
  syntax: FormulaSyntax = DEFAULT_FORMULA_SYNTAX,
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let parenDepth = 0;

  const argumentSeparator = syntax.argumentSeparator;
  const decimalSeparator = syntax.decimalSeparator;

  const pushToken = (t: Token): void => {
    tokens.push(t);
    if (tokens.length > limits.maxTokens) {
      throw new FormulaLimitError(FormulaErrorCodes.TOO_MANY_TOKENS, 'Formula has too many tokens');
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      if (parenDepth > limits.maxParenDepth) {
        throw new FormulaLimitError(
          FormulaErrorCodes.PARENS_TOO_DEEP,
          'Formula nesting is too deep',
        );
      }
      pushToken({ kind: 'lparen', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      pushToken({ kind: 'rparen', start: i, end: i + 1 });
      i++;
      continue;
    }
    // Function argument separator
    if (ch === argumentSeparator) {
      pushToken({ kind: 'arg_separator', start: i, end: i + 1 });
      i++;
      continue;
    }

    // String literal: only double quotes are supported.
    if (ch === '"') {
      const start = i;
      i++; // opening quote
      const parts: string[] = [];
      while (i < source.length) {
        const c = source[i];
        if (c === '"') {
          i++;
          break;
        }
        if (c === '\\') {
          const next = source[i + 1];
          if (next === undefined) break;
          // Minimal escapes
          if (next === '"' || next === '\\') {
            parts.push(next);
            i += 2;
            continue;
          }
          if (next === 'n') {
            parts.push('\n');
            i += 2;
            continue;
          }
          parts.push(next);
          i += 2;
          continue;
        }
        parts.push(c);
        i++;
        if (parts.length > limits.maxStringLiteralLength) {
          throw new FormulaLimitError(
            FormulaErrorCodes.STRING_LITERAL_TOO_LONG,
            'String literal is too long',
          );
        }
      }
      pushToken({ kind: 'string', value: parts.join(''), start, end: i });
      continue;
    }

    // Number literal
    // Support negative number literals in primary-expression positions.
    // Examples: -1, -0.5, 1 + -2, (-3)
    // Note: this does not introduce a general unary-minus operator; it only
    // affects numeric literals.
    const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    const canStartPrimary =
      !prev || prev.kind === 'lparen' || prev.kind === 'arg_separator' || prev.kind === 'operator';

    const isDecimalStart = (pos: number): boolean => {
      return source[pos] === decimalSeparator && isDigit(source[pos + 1] ?? '');
    };

    const isNegativeNumberStart =
      ch === '-' && canStartPrimary && (isDigit(source[i + 1] ?? '') || isDecimalStart(i + 1));

    if (isNegativeNumberStart || isDigit(ch) || isDecimalStart(i)) {
      const start = i;
      let str = '';
      if (isNegativeNumberStart) {
        str += '-';
        i++;
      }
      let seenDecimal = false;
      while (i < source.length) {
        const c = source[i];
        if (isDigit(c)) {
          str += c;
          i++;
          continue;
        }
        if (c === decimalSeparator && !seenDecimal) {
          seenDecimal = true;
          // Normalize to '.' so downstream numeric parsing is stable.
          str += '.';
          i++;
          continue;
        }
        break;
      }
      pushToken({ kind: 'number', value: str, start, end: i });
      continue;
    }

    // Member access
    if (ch === '.') {
      pushToken({ kind: 'member_access', start: i, end: i + 1 });
      i++;
      continue;
    }

    // Identifier
    if (isIdentifierStart(ch)) {
      const start = i;
      let ident = '';
      while (i < source.length && isIdentifierPart(source[i])) {
        ident += source[i];
        i++;
        if (ident.length > limits.maxIdentifierLength) {
          throw new FormulaLimitError(
            FormulaErrorCodes.IDENTIFIER_TOO_LONG,
            'Identifier is too long',
          );
        }
      }
      pushToken({ kind: 'identifier', value: ident, start, end: i });
      continue;
    }

    // Operators
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      pushToken({ kind: 'operator', value: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPERATORS.has(ch)) {
      pushToken({ kind: 'operator', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Unknown character
    // Treat unknown characters as operators so parsing can surface a structured error
    // instead of crashing the tokenizer on unexpected Unicode/control chars.
    pushToken({ kind: 'operator', value: ch, start: i, end: i + 1 });
    i++;
  }

  pushToken({ kind: 'eof', start: source.length, end: source.length });
  return tokens;
}
