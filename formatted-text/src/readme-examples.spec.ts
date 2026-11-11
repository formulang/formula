import { readFileSync } from 'node:fs';
import { evalOk } from './test-helpers/eval-formula';

/**
 * Runs the examples in this package's README: every line of the form
 * `await evalOk('<formula>'); // <result>` whose result is JSON.
 */
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const EXAMPLE = /^await evalOk\((['"])(.*)\1\);\s*\/\/\s*(.+)$/;

function examples(): Array<{ source: string; expected: unknown }> {
  const found: Array<{ source: string; expected: unknown }> = [];
  for (const line of README.split(/\r?\n/)) {
    const match = EXAMPLE.exec(line.trim());
    if (!match) continue;
    const [, quote, body = '', comment = ''] = match;
    // Undo the escaping of the quote character the example is written in.
    found.push({ source: body.split(`\\${quote}`).join(quote), expected: JSON.parse(comment) });
  }
  return found;
}

const ALL = examples();

describe('the examples in formatted-text/README.md', () => {
  it('finds examples to run', () => {
    expect(ALL.length).toBe(6);
  });

  it.each(ALL.map((example) => [example.source, example] as const))(
    '%s',
    async (_source, { expected }) => {
      expect(await evalOk(_source)).toStrictEqual(expected);
    },
  );
});
