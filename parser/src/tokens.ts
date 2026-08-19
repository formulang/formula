export type TokenKind =
  | 'number'
  | 'string'
  | 'identifier'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'arg_separator'
  | 'member_access'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value?: string;
  start: number;
  end: number;
}
