const WHITESPACE_RUN = /\s+/gu;

/** `value` with each whitespace run made one space, and trimmed. */
export function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim();
}

/** Each whitespace run of `value` made one space. */
export function spaceWhitespace(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ');
}

/** Non-blank lines, each with its whitespace collapsed, joined by `\n`. */
export function plainLines(lines: Iterable<string>): string {
  const out: string[] = [];
  for (const line of lines) {
    const collapsed = collapseWhitespace(line);
    if (collapsed.length > 0) out.push(collapsed);
  }
  return out.join('\n');
}
