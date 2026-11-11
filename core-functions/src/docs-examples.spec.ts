import { readFileSync } from 'node:fs';
import { evalOk } from './test-helpers/eval-formula';

/**
 * Runs the examples in docs/functions.md: every line of the form
 * `await evalOk('<formula>'); // <result>` whose result is JSON. Examples that pass variables, or
 * whose comment is prose, are left to the reader.
 */
const DOCS = readFileSync(new URL('../../docs/functions.md', import.meta.url), 'utf8');

const EXAMPLE = /^await evalOk\((['"])(.*)\1\);\s*\/\/\s*(.+)$/;

type Example = { section: string; source: string; expected: unknown };

function examples(): Example[] {
  const found: Example[] = [];
  let section = '';
  for (const line of DOCS.split(/\r?\n/)) {
    const heading = /^### (\S+)/.exec(line);
    if (heading) section = heading[1] ?? '';
    const match = EXAMPLE.exec(line.trim());
    if (!match) continue;
    const [, quote, body = '', comment = ''] = match;
    let expected: unknown;
    try {
      expected = JSON.parse(comment);
    } catch {
      continue;
    }
    // Undo the escaping of the quote character the example is written in.
    const source = body.split(`\\${quote}`).join(quote);
    found.push({ section, source, expected });
  }
  return found;
}

const ALL = examples();

describe('the examples in docs/functions.md', () => {
  it('finds examples to run', () => {
    expect(ALL.length).toBeGreaterThan(100);
  });

  it.each(ALL.map((example) => [example.section, example.source, example] as const))(
    '%s: %s',
    async (_section, source, { expected }) => {
      expect(await evalOk(source)).toStrictEqual(expected);
    },
  );
});
