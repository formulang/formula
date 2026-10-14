/**
 * Static safety analysis of the regular expressions the regex built-ins compile. JavaScript's
 * engine backtracks, so a pattern whose quantifiers can split one run of characters in many ways
 * takes time polynomial of high degree, or exponential, in the length of the text. The analysis
 * refuses those shapes and admits patterns whose worst case stays within a few times the cost of
 * a single unbounded quantifier: quadratic in the text length.
 */

/** A set of code points: sorted, disjoint, non-adjacent `[low, high]` ranges. */
type CodeSet = ReadonlyArray<readonly [number, number]>;

type RegexNode =
  | { kind: 'chars'; set: CodeSet }
  | { kind: 'assertion'; start: boolean; lookahead?: RegexNode }
  | { kind: 'sequence'; items: RegexNode[] }
  | { kind: 'alternation'; alternatives: RegexNode[] }
  | { kind: 'repeat'; body: RegexNode; min: number; max: number };

type ParseFlags = { unicode: boolean; ignoreCase: boolean; dotAll: boolean };

const MAX_CODE_POINT = 0x10ffff;
const EVERYTHING: CodeSet = [[0, MAX_CODE_POINT]];
const DIGITS: CodeSet = [[0x30, 0x39]];
const WORD_CHARACTERS: CodeSet = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
];
const WHITESPACE: CodeSet = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
const LINE_TERMINATORS: CodeSet = [
  [0x0a, 0x0a],
  [0x0d, 0x0d],
  [0x2028, 0x2029],
];
/** `k`, `s` and their capitals, which `iu` matching folds U+212A and U+017F onto. */
const FOLDED_ASCII_LETTERS: CodeSet = [
  [0x4b, 0x4b],
  [0x53, 0x53],
  [0x6b, 0x6b],
  [0x73, 0x73],
];
const LONG_S_AND_KELVIN: CodeSet = [
  [0x17f, 0x17f],
  [0x212a, 0x212a],
];

const COUNTED_QUANTIFIER = /\{(\d+)(,(\d*))?\}/y;
const GROUP_MODIFIERS = /\?([ims]*)(?:-([ims]*))?:/y;
const HEX_DIGITS_2 = /[0-9A-Fa-f]{2}/y;
const HEX_DIGITS_4 = /[0-9A-Fa-f]{4}/y;
const BRACED_CODE_POINT = /\{([0-9A-Fa-f]{1,6})\}/y;
const PROPERTY_NAME = /\{([^}]*)\}/y;
const OCTAL_DIGITS = /[0-7]{1,3}/y;
const ASCII_LETTER = /^[A-Za-z]$/;

/** A quantifier allowing at least this many repetitions beyond its minimum counts as unbounded. */
const LONG_QUANTIFIER_SPAN = 16;
/**
 * The work a pattern may spend per start position, in multiples of one unbounded quantifier's
 * scan of the whole text.
 */
const SCANS_PER_START = 4;
/** Patterns with more quantifiers and ambiguous alternations than this are not analysed. */
const MAX_ANALYSED_MEMBERS = 24;

function normalize(ranges: ReadonlyArray<readonly [number, number]>): CodeSet {
  const sorted = ranges
    .filter(([low, high]) => low <= high)
    .map(([low, high]): [number, number] => [low, high])
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [low, high] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else out.push([low, high]);
  }
  return out;
}

function union(a: CodeSet, b: CodeSet): CodeSet {
  return normalize([...a, ...b]);
}

function complement(set: CodeSet): CodeSet {
  const out: Array<[number, number]> = [];
  let next = 0;
  for (const [low, high] of set) {
    if (low > next) out.push([next, low - 1]);
    next = high + 1;
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
  return out;
}

function intersect(a: CodeSet, b: CodeSet): CodeSet {
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const low = Math.max(a[i][0], b[j][0]);
    const high = Math.min(a[i][1], b[j][1]);
    if (low <= high) out.push([low, high]);
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return out;
}

function overlaps(a: CodeSet, b: CodeSet): boolean {
  return intersect(a, b).length > 0;
}

/**
 * The characters a set matches under case-insensitive matching, over-approximated: both cases
 * of every ASCII letter, every non-ASCII character when the set holds one, and the two
 * characters `iu` matching folds onto `k` and `s`.
 */
function caseFolded(set: CodeSet): CodeSet {
  const extra: Array<readonly [number, number]> = [];
  for (const [low, high] of set) {
    for (const [from, to, shift] of [
      [0x41, 0x5a, 0x20],
      [0x61, 0x7a, -0x20],
    ]) {
      const lo = Math.max(low, from);
      const hi = Math.min(high, to);
      if (lo <= hi) extra.push([lo + shift, hi + shift]);
    }
    if (high >= 0x80) extra.push([0x80, MAX_CODE_POINT]);
  }
  if (overlaps(set, FOLDED_ASCII_LETTERS)) extra.push(...LONG_S_AND_KELVIN);
  if (overlaps(set, LONG_S_AND_KELVIN)) extra.push(...FOLDED_ASCII_LETTERS);
  return union(set, extra);
}

/** ASCII characters that are neither letters nor digits. */
const ASCII_NON_ALPHANUMERIC: CodeSet = [
  [0x00, 0x2f],
  [0x3a, 0x40],
  [0x5b, 0x60],
  [0x7b, 0x7f],
];
const ASCII_LETTERS: CodeSet = [
  [0x41, 0x5a],
  [0x61, 0x7a],
];
/** General categories of letters and marks (`\p{L}`, `\p{Lu}`, `\p{M}`, ...). */
const LETTER_CATEGORIES: ReadonlySet<string> = new Set([
  'L',
  'Letter',
  'LC',
  'Cased_Letter',
  'Lu',
  'Uppercase_Letter',
  'Ll',
  'Lowercase_Letter',
  'Lt',
  'Titlecase_Letter',
  'Lm',
  'Modifier_Letter',
  'Lo',
  'Other_Letter',
  'M',
  'Mark',
  'Combining_Mark',
  'Mn',
  'Nonspacing_Mark',
  'Mc',
  'Spacing_Mark',
  'Me',
  'Enclosing_Mark',
  'Alphabetic',
  'Alpha',
]);
/** General categories of numbers (`\p{N}`, `\p{Nd}`, ...). */
const NUMBER_CATEGORIES: ReadonlySet<string> = new Set([
  'N',
  'Number',
  'Nd',
  'Decimal_Number',
  'Nl',
  'Letter_Number',
  'No',
  'Other_Number',
]);

/**
 * The characters of a `\p{...}` property, over-approximated: letters, marks and numbers hold no
 * whitespace and no ASCII punctuation (letters and marks no ASCII digit, numbers no ASCII
 * letter); any other property may match any character.
 */
function propertyCharacters(property: string): CodeSet {
  const separator = property.indexOf('=');
  const name = separator < 0 ? property : property.slice(separator + 1);
  const key = separator < 0 ? 'General_Category' : property.slice(0, separator);
  if (key !== 'General_Category' && key !== 'gc') return EVERYTHING;
  if (LETTER_CATEGORIES.has(name)) {
    return complement(union(union(WHITESPACE, ASCII_NON_ALPHANUMERIC), DIGITS));
  }
  if (NUMBER_CATEGORIES.has(name)) {
    return complement(union(union(WHITESPACE, ASCII_NON_ALPHANUMERIC), ASCII_LETTERS));
  }
  return EVERYTHING;
}

/** A construct the analysis does not model; the pattern is refused. */
class Unanalysable extends Error {}

/** Reads a pattern `new RegExp` has accepted into the node tree the analysis works on. */
class PatternReader {
  private index = 0;
  multiline: boolean;

  constructor(
    private readonly source: string,
    private flags: ParseFlags,
    multiline: boolean,
  ) {
    this.multiline = multiline;
  }

  read(): RegexNode {
    const node = this.disjunction();
    if (this.index !== this.source.length) throw new Unanalysable();
    return node;
  }

  private peek(offset = 0): string {
    return this.source.charAt(this.index + offset);
  }

  private eat(text: string): boolean {
    if (!this.source.startsWith(text, this.index)) return false;
    this.index += text.length;
    return true;
  }

  private expect(text: string): void {
    if (!this.eat(text)) throw new Unanalysable();
  }

  private sticky(pattern: RegExp, at: number): RegExpExecArray | null {
    pattern.lastIndex = at;
    return pattern.exec(this.source);
  }

  private chars(set: CodeSet): RegexNode {
    return { kind: 'chars', set: this.flags.ignoreCase ? caseFolded(set) : set };
  }

  private disjunction(): RegexNode {
    const alternatives = [this.alternative()];
    while (this.eat('|')) alternatives.push(this.alternative());
    return alternatives.length === 1 ? alternatives[0] : { kind: 'alternation', alternatives };
  }

  private alternative(): RegexNode {
    const items: RegexNode[] = [];
    while (this.index < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.quantified(this.atom()));
    }
    return { kind: 'sequence', items };
  }

  private quantified(atom: RegexNode): RegexNode {
    let min: number;
    let max: number;
    const char = this.peek();
    if (char === '*' || char === '+' || char === '?') {
      min = char === '+' ? 1 : 0;
      max = char === '?' ? 1 : Number.POSITIVE_INFINITY;
      this.index += 1;
    } else if (char === '{') {
      const counted = this.sticky(COUNTED_QUANTIFIER, this.index);
      if (counted === null) return atom;
      this.index += counted[0].length;
      min = Number(counted[1]);
      if (counted[2] === undefined) max = min;
      else max = counted[3] === '' ? Number.POSITIVE_INFINITY : Number(counted[3]);
    } else {
      return atom;
    }
    this.eat('?');
    return { kind: 'repeat', body: atom, min, max };
  }

  private atom(): RegexNode {
    const char = this.peek();
    if (char === '(') return this.group();
    if (char === '[') return this.characterClass();
    if (char === '\\') return this.atomEscape();
    if (char === '.') {
      this.index += 1;
      return this.chars(this.flags.dotAll ? EVERYTHING : complement(LINE_TERMINATORS));
    }
    if (char === '^' || char === '$') {
      this.index += 1;
      return { kind: 'assertion', start: char === '^' };
    }
    const code = this.readCodePoint();
    return this.chars([[code, code]]);
  }

  private readCodePoint(): number {
    const code = this.flags.unicode
      ? (this.source.codePointAt(this.index) ?? 0)
      : this.source.charCodeAt(this.index);
    this.index += code > 0xffff ? 2 : 1;
    return code;
  }

  private group(): RegexNode {
    this.index += 1;
    if (this.eat('?:')) return this.groupBody();
    if (this.eat('?=') || this.eat('?!')) {
      return { kind: 'assertion', start: false, lookahead: this.groupBody() };
    }
    if (this.eat('?<')) {
      // Lookbehind is refused before the analysis runs; a named group is a plain group.
      if (this.peek() === '=' || this.peek() === '!') throw new Unanalysable();
      const close = this.source.indexOf('>', this.index);
      if (close < 0) throw new Unanalysable();
      this.index = close + 1;
      return this.groupBody();
    }
    if (this.peek() === '?') {
      const modifiers = this.sticky(GROUP_MODIFIERS, this.index);
      if (modifiers === null) throw new Unanalysable();
      this.index += modifiers[0].length;
      // Over-approximated: a modifier that names a flag turns it on for the group.
      const named = `${modifiers[1]}${modifiers[2] ?? ''}`;
      const outer = this.flags;
      this.flags = {
        ...outer,
        ignoreCase: outer.ignoreCase || named.includes('i'),
        dotAll: outer.dotAll || named.includes('s'),
      };
      if (named.includes('m')) this.multiline = true;
      try {
        return this.groupBody();
      } finally {
        this.flags = outer;
      }
    }
    return this.groupBody();
  }

  private groupBody(): RegexNode {
    const body = this.disjunction();
    this.expect(')');
    return body;
  }

  private characterClass(): RegexNode {
    this.index += 1;
    const negated = this.eat('^');
    const ranges: Array<readonly [number, number]> = [];
    while (this.peek() !== ']') {
      if (this.index >= this.source.length) throw new Unanalysable();
      const start = this.classAtom();
      if (typeof start === 'number' && this.peek() === '-' && this.peek(1) !== ']') {
        this.index += 1;
        const end = this.classAtom();
        if (typeof end === 'number') ranges.push([Math.min(start, end), Math.max(start, end)]);
        else ranges.push([start, start], [0x2d, 0x2d], ...end);
        continue;
      }
      if (typeof start === 'number') ranges.push([start, start]);
      else ranges.push(...start);
    }
    this.index += 1;
    const set = normalize(ranges);
    // Folding after the negation over-approximates what a negated class matches.
    return this.chars(negated ? complement(set) : set);
  }

  private classAtom(): number | CodeSet {
    if (this.peek() !== '\\') return this.readCodePoint();
    this.index += 1;
    const shorthand = this.shorthand();
    if (shorthand !== null) return shorthand;
    if (this.eat('b')) return 0x08;
    if (this.eat('-')) return 0x2d;
    return this.characterEscape();
  }

  private atomEscape(): RegexNode {
    this.index += 1;
    const char = this.peek();
    if (char === 'b' || char === 'B') {
      this.index += 1;
      return { kind: 'assertion', start: false };
    }
    if (char === 'k' && this.peek(1) === '<') throw new Unanalysable();
    const shorthand = this.shorthand();
    if (shorthand !== null) return this.chars(shorthand);
    const code = this.characterEscape();
    return this.chars([[code, code]]);
  }

  /** `\d`, `\w`, `\s`, their negations, and the property escapes of unicode mode. */
  private shorthand(): CodeSet | null {
    const char = this.peek();
    const sets: Record<string, CodeSet> = {
      d: DIGITS,
      D: complement(DIGITS),
      w: WORD_CHARACTERS,
      W: complement(WORD_CHARACTERS),
      s: WHITESPACE,
      S: complement(WHITESPACE),
    };
    if (Object.prototype.hasOwnProperty.call(sets, char)) {
      this.index += 1;
      return sets[char];
    }
    if (this.flags.unicode && (char === 'p' || char === 'P')) {
      const property = this.sticky(PROPERTY_NAME, this.index + 1);
      if (property === null) throw new Unanalysable();
      this.index += 1 + property[0].length;
      return char === 'p' ? propertyCharacters(property[1]) : EVERYTHING;
    }
    return null;
  }

  /** The code point of a character escape; the backslash is already read. */
  private characterEscape(): number {
    const char = this.peek();
    const controls: Record<string, number> = { t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d };
    if (Object.prototype.hasOwnProperty.call(controls, char)) {
      this.index += 1;
      return controls[char];
    }
    if (char === 'c') {
      const letter = this.peek(1);
      if (!ASCII_LETTER.test(letter)) return 0x5c; // A literal backslash; `c` is read next.
      this.index += 2;
      return letter.charCodeAt(0) % 32;
    }
    if (char === '0') {
      const octal = this.sticky(OCTAL_DIGITS, this.index);
      this.index += octal === null ? 1 : octal[0].length;
      return octal === null ? 0 : Number.parseInt(octal[0], 8);
    }
    if (char === 'x') {
      const hex = this.sticky(HEX_DIGITS_2, this.index + 1);
      if (hex === null) return this.readCodePoint();
      this.index += 3;
      return Number.parseInt(hex[0], 16);
    }
    if (char === 'u') {
      if (this.flags.unicode) {
        const braced = this.sticky(BRACED_CODE_POINT, this.index + 1);
        if (braced !== null) {
          this.index += 1 + braced[0].length;
          return Number.parseInt(braced[1], 16);
        }
      }
      const hex = this.sticky(HEX_DIGITS_4, this.index + 1);
      if (hex === null) return this.readCodePoint();
      this.index += 5;
      const unit = Number.parseInt(hex[0], 16);
      // In unicode mode, an escaped surrogate pair is one code point.
      const low =
        this.peek() === '\\' && this.peek(1) === 'u'
          ? this.sticky(HEX_DIGITS_4, this.index + 2)
          : null;
      if (this.flags.unicode && unit >= 0xd800 && unit <= 0xdbff && low !== null) {
        const lowUnit = Number.parseInt(low[0], 16);
        if (lowUnit >= 0xdc00 && lowUnit <= 0xdfff) {
          this.index += 6;
          return (unit - 0xd800) * 0x400 + (lowUnit - 0xdc00) + 0x10000;
        }
      }
      return unit;
    }
    // An identity escape: the character itself.
    return this.readCodePoint();
  }
}

/** A character matcher or an assertion: one node of the position graph. */
type Position = { id: number; set: CodeSet; assertion: boolean; startAnchor: boolean };

type PositionSets = { nullable: boolean; first: Position[]; last: Position[] };

/**
 * A choice point of the pattern: a quantifier with a variable count, an alternation whose
 * alternatives can start on the same character, or a fixed count long enough to be a scan.
 */
type Member = {
  kind: 'repeat' | 'alternation';
  /** How many ways the member can match one run of characters, capped by the text length. */
  ways: number;
  /** The fewest characters the member matches, capped by the text length. */
  minLength: number;
  chars: CodeSet;
  /** Its positions are those with ids `low` to `high`. */
  low: number;
  high: number;
  first: Position[];
  last: Position[];
};

function isLong(node: RegexNode): boolean {
  return node.kind === 'repeat' && node.max - node.min >= LONG_QUANTIFIER_SPAN;
}

/** The unbounded quantifiers a node can end with, looking through optional groups. */
function trailingLongRepeats(node: RegexNode): RegexNode[] {
  if (node.kind === 'sequence') {
    const last = node.items[node.items.length - 1];
    return last === undefined ? [] : trailingLongRepeats(last);
  }
  if (node.kind === 'alternation') return node.alternatives.flatMap(trailingLongRepeats);
  if (node.kind !== 'repeat') return [];
  const own = isLong(node) ? [node] : [];
  return node.max <= 1 ? [...own, ...trailingLongRepeats(node.body)] : own;
}

/** The unbounded quantifiers a node can start with, looking through optional groups. */
function leadingLongRepeats(node: RegexNode): RegexNode[] {
  if (node.kind === 'sequence') {
    const first = node.items[0];
    return first === undefined ? [] : leadingLongRepeats(first);
  }
  if (node.kind === 'alternation') return node.alternatives.flatMap(leadingLongRepeats);
  if (node.kind !== 'repeat') return [];
  const own = isLong(node) ? [node] : [];
  return node.max <= 1 ? [...own, ...leadingLongRepeats(node.body)] : own;
}

/** Every character a node can match, lookahead bodies aside. */
function charsOf(node: RegexNode): CodeSet {
  switch (node.kind) {
    case 'chars':
      return node.set;
    case 'assertion':
      return [];
    case 'sequence':
      return node.items.reduce<CodeSet>((set, item) => union(set, charsOf(item)), []);
    case 'alternation':
      return node.alternatives.reduce<CodeSet>((set, item) => union(set, charsOf(item)), []);
    case 'repeat':
      return node.max === 0 ? [] : charsOf(node.body);
  }
}

/** Whether a node holds a quantifier with a variable count or an alternation, at any depth. */
function holdsChoice(node: RegexNode): boolean {
  switch (node.kind) {
    case 'chars':
      return false;
    case 'assertion':
      return node.lookahead !== undefined && holdsChoice(node.lookahead);
    case 'sequence':
      return node.items.some(holdsChoice);
    case 'alternation':
      return true;
    case 'repeat':
      return node.min !== node.max || holdsChoice(node.body);
  }
}

/**
 * The characters a node can start (`first`) or end (`last`) with: every character it holds when
 * an assertion stands at that edge.
 */
function edgeChars(node: RegexNode, side: 'first' | 'last'): CodeSet {
  const sets = new BacktrackingBound(1).edgesOf(node);
  const positions = side === 'first' ? sets.first : sets.last;
  if (positions.some((position) => position.assertion)) return charsOf(node);
  return positions.reduce<CodeSet>((set, position) => union(set, position.set), []);
}

/** The refusal reasons that follow from the tree's shape alone. */
function structuralRefusal(node: RegexNode): string | null {
  switch (node.kind) {
    case 'chars':
      return null;
    case 'assertion':
      return node.lookahead === undefined ? null : structuralRefusal(node.lookahead);
    case 'alternation':
      for (const alternative of node.alternatives) {
        const refusal = structuralRefusal(alternative);
        if (refusal !== null) return refusal;
      }
      return null;
    case 'repeat':
      if (node.max > 1 && holdsChoice(node.body)) {
        return 'a repeated group holds a quantifier or an alternation';
      }
      return structuralRefusal(node.body);
    case 'sequence':
      for (let index = 0; index < node.items.length; index += 1) {
        const refusal = structuralRefusal(node.items[index]);
        if (refusal !== null) return refusal;
        const next = node.items[index + 1];
        if (next === undefined) continue;
        for (const before of trailingLongRepeats(node.items[index])) {
          for (const after of leadingLongRepeats(next)) {
            if (overlaps(edgeChars(before, 'last'), edgeChars(after, 'first'))) {
              return 'two unbounded quantifiers next to each other can both take the character between them';
            }
          }
        }
      }
      return null;
  }
}

/**
 * The backtracking cost bound: walks the position graph of one pattern (a lookahead body is a
 * pattern of its own) and measures, for every choice point that can fail, how many ways the
 * choice points competing for the same characters before it can split the text.
 */
class BacktrackingBound {
  private readonly positions: Position[] = [];
  private readonly follow: Position[][] = [];
  private readonly members: Member[] = [];
  readonly lookaheads: RegexNode[] = [];

  constructor(private readonly textLength: number) {}

  /** The largest per-start cost of the pattern, in characters visited. */
  measure(root: RegexNode, multiline: boolean): { cost: number; anchored: boolean } {
    const sets = this.visit(root);
    if (this.members.length > MAX_ANALYSED_MEMBERS) {
      return { cost: Number.POSITIVE_INFINITY, anchored: false };
    }
    const accepting = new Set(sets.last.map((position) => position.id));
    const anchored =
      !multiline &&
      !sets.nullable &&
      sets.first.length > 0 &&
      sets.first.every((position) => position.startAnchor);

    const ordered = [...this.members].sort((a, b) => a.low - b.low);
    const before = new Map<Member, number>();
    let cost = 0;
    for (const member of ordered) {
      let ways = 1;
      for (const earlier of ordered) {
        if (earlier.low >= member.low) break;
        // A member that holds this one does not precede it.
        if (earlier.high >= member.low) continue;
        if (this.competes(earlier, member)) {
          ways = Math.max(ways, (before.get(earlier) ?? 1) * earlier.ways);
        }
      }
      before.set(member, ways);
      const failsAfter = member.last.some((position) => !accepting.has(position.id));
      const scan = member.minLength > SCANS_PER_START ? member.minLength : 1;
      if (!failsAfter && scan === 1) continue;
      cost = Math.max(cost, ways * (failsAfter ? member.ways : 1) * scan);
    }
    return { cost, anchored };
  }

  /** The first and last positions of a node read on its own. */
  edgesOf(node: RegexNode): PositionSets {
    return this.positionSets(node);
  }

  private position(set: CodeSet, assertion: boolean, startAnchor: boolean): Position {
    const position: Position = { id: this.positions.length, set, assertion, startAnchor };
    this.positions.push(position);
    this.follow.push([]);
    return position;
  }

  private link(from: readonly Position[], to: readonly Position[]): void {
    for (const position of from) this.follow[position.id].push(...to);
  }

  private visit(node: RegexNode): PositionSets {
    const low = this.positions.length;
    const sets = this.positionSets(node);
    const high = this.positions.length - 1;
    const member = this.memberOf(node, sets, low, high);
    if (member !== null) this.members.push(member);
    return sets;
  }

  private positionSets(node: RegexNode): PositionSets {
    switch (node.kind) {
      case 'chars': {
        const position = this.position(node.set, false, false);
        return { nullable: false, first: [position], last: [position] };
      }
      case 'assertion': {
        if (node.lookahead !== undefined) this.lookaheads.push(node.lookahead);
        const position = this.position([], true, node.start);
        return { nullable: false, first: [position], last: [position] };
      }
      case 'sequence': {
        let sets: PositionSets = { nullable: true, first: [], last: [] };
        for (const item of node.items) {
          const next = this.visit(item);
          this.link(sets.last, next.first);
          sets = {
            nullable: sets.nullable && next.nullable,
            first: sets.nullable ? [...sets.first, ...next.first] : sets.first,
            last: next.nullable ? [...sets.last, ...next.last] : next.last,
          };
        }
        return sets;
      }
      case 'alternation': {
        const all = node.alternatives.map((alternative) => this.visit(alternative));
        return {
          nullable: all.some((sets) => sets.nullable),
          first: all.flatMap((sets) => sets.first),
          last: all.flatMap((sets) => sets.last),
        };
      }
      case 'repeat': {
        const body = this.visit(node.body);
        if (node.max === 0) return { nullable: true, first: [], last: [] };
        if (node.max > 1) this.link(body.last, body.first);
        return { nullable: node.min === 0 || body.nullable, first: body.first, last: body.last };
      }
    }
  }

  private minLength(node: RegexNode): number {
    switch (node.kind) {
      case 'chars':
        return 1;
      case 'assertion':
        return 0;
      case 'sequence':
        return Math.min(
          this.textLength,
          node.items.reduce((sum, item) => sum + this.minLength(item), 0),
        );
      case 'alternation':
        return Math.min(...node.alternatives.map((alternative) => this.minLength(alternative)));
      case 'repeat':
        return Math.min(this.textLength, node.min * this.minLength(node.body));
    }
  }

  private memberOf(node: RegexNode, sets: PositionSets, low: number, high: number): Member | null {
    const base = { chars: charsOf(node), low, high, first: sets.first, last: sets.last };
    if (node.kind === 'repeat' && node.max > 0) {
      const minLength = this.minLength(node);
      if (node.min === node.max) {
        // A fixed count is a member only as a scan longer than the budget allows per start.
        return minLength > SCANS_PER_START ? { kind: 'repeat', ways: 1, minLength, ...base } : null;
      }
      const span = Math.min(node.max - node.min, this.textLength);
      return { kind: 'repeat', ways: span + 1, minLength, ...base };
    }
    if (node.kind === 'alternation') {
      const starts = node.alternatives.map((alternative) => this.startChars(alternative));
      const ambiguous = starts.some(
        (start, index) =>
          start === null ||
          starts.some((other, j) => j > index && (other === null || overlaps(start, other))),
      );
      if (!ambiguous) return null;
      return {
        kind: 'alternation',
        ways: node.alternatives.length,
        minLength: this.minLength(node),
        ...base,
      };
    }
    return null;
  }

  /** The characters an alternative can start with; `null` when it can match empty or starts with an assertion. */
  private startChars(node: RegexNode): CodeSet | null {
    const sets = new BacktrackingBound(this.textLength).edgesOf(node);
    if (sets.nullable || sets.first.some((position) => position.assertion)) return null;
    return edgeChars(node, 'first');
  }

  /**
   * Whether `later` competes with `earlier` for the same characters: an alternation whose
   * alternatives overlap multiplies every choice point after it; a quantifier competes with a
   * later choice point it can reach over positions all three can match a character of.
   */
  private competes(earlier: Member, later: Member): boolean {
    const shared = intersect(earlier.chars, later.chars);
    if (earlier.kind === 'repeat' && shared.length === 0) return false;
    const passable = (position: Position): boolean =>
      earlier.kind === 'alternation' || position.assertion || overlaps(position.set, shared);
    const targets = new Set(later.first.map((position) => position.id));
    const seen = new Set<number>();
    const queue: Position[] = [];
    for (const position of earlier.last) {
      for (const next of this.follow[position.id]) {
        if (next.id >= earlier.low && next.id <= earlier.high) continue;
        if (!seen.has(next.id) && passable(next)) {
          seen.add(next.id);
          queue.push(next);
        }
      }
    }
    while (queue.length > 0) {
      const position = queue.shift() as Position;
      if (targets.has(position.id)) return true;
      for (const next of this.follow[position.id]) {
        if (!seen.has(next.id) && passable(next)) {
          seen.add(next.id);
          queue.push(next);
        }
      }
    }
    return false;
  }
}

/** Why a pattern of up to `maxTextLength` characters' text is refused; `null` to admit it. */
function refusalOf(
  root: RegexNode,
  multiline: boolean,
  maxTextLength: number,
  depth: number,
): string | null {
  const structural = structuralRefusal(root);
  if (structural !== null) return structural;
  const bound = new BacktrackingBound(maxTextLength);
  const { cost, anchored } = bound.measure(root, multiline);
  // One start position when the pattern is anchored at the text start, one per character else.
  const budget = SCANS_PER_START * (maxTextLength + 1) * (anchored ? maxTextLength : 1);
  if (cost > budget) {
    return cost === Number.POSITIVE_INFINITY
      ? 'it holds too many quantifiers and alternations to analyse'
      : 'quantifiers compete for the same characters before a part that can fail';
  }
  if (depth >= 8) return bound.lookaheads.length > 0 ? 'its lookaheads nest too deeply' : null;
  for (const lookahead of bound.lookaheads) {
    const refusal = refusalOf(lookahead, multiline, maxTextLength, depth + 1);
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * Why the regex built-ins refuse `source` (a pattern `new RegExp(source, flags)` accepts), or
 * `null` when its worst-case matching time over a text of at most `maxTextLength` characters
 * stays within a few unbounded scans per start position. Refused: a repeated group holding a
 * quantifier with a variable count or an alternation (`(a+)+`, `(a|b)*`); two unbounded
 * quantifiers next to each other that can both take the character between them (`a*a*`,
 * `\w+\w*`); and quantifiers competing for the same characters before a part that can fail
 * (`\d+\s*\d+x`, `.*foo.*bar`, `a?a?...a?aa...a`).
 */
export function regexSafetyRefusal(
  source: string,
  flags: string,
  maxTextLength: number,
): string | null {
  const parseFlags: ParseFlags = {
    unicode: flags.includes('u'),
    ignoreCase: flags.includes('i'),
    dotAll: flags.includes('s'),
  };
  let root: RegexNode;
  let reader: PatternReader;
  try {
    reader = new PatternReader(source, parseFlags, flags.includes('m'));
    root = reader.read();
  } catch (error) {
    if (error instanceof Unanalysable)
      return 'it uses a construct the safety analysis does not read';
    throw error;
  }
  return refusalOf(root, reader.multiline, maxTextLength, 0);
}
