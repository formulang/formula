import type { BaseFunctionConfig } from '@formulang/definitions';

/**
 * The steps a counted function's scans take: one for every character they read. The functions
 * whose work is linear in their input read their text through a `CountedText` charging this
 * count, so a spec can bound what an evaluation of the public function costs by the length of its
 * input.
 */
export type WorkCount = { steps: number };

/** The configuration of a function that counts its work. */
export interface WorkCountingConfig extends BaseFunctionConfig {
  /** Every call adds its steps here; without it, each call counts into a fresh counter. */
  work?: WorkCount;
}

/** The counter a call adds its steps to. */
export function workOf(config: WorkCountingConfig): WorkCount {
  return config.work ?? { steps: 0 };
}

/**
 * A text read through a work count: every UTF-16 code unit read through it is charged one step,
 * and the text is not handed out otherwise, so a scan cannot read it without its count growing.
 * Its searches are loops over `code`, charged as they read; `slice` charges each code unit it
 * copies. What a regular expression reads, through `stickyMatch` or over a slice, is not charged,
 * and neither is a string method run on a slice (`trim`): the expressions are listed, with why
 * each reads in linear time, in the roster `regex-roster.spec.ts` reconciles with the modules.
 */
export class CountedText {
  constructor(
    private readonly text: string,
    private readonly work: WorkCount,
  ) {}

  /** How many UTF-16 code units the text holds. */
  get length(): number {
    return this.text.length;
  }

  /** The code unit at `index`; NaN outside the text. One step. */
  code(index: number): number {
    this.work.steps += 1;
    return this.text.charCodeAt(index);
  }

  /** The code unit at `index` as a string; `''` outside the text. One step. */
  char(index: number): string {
    this.work.steps += 1;
    return this.text.charAt(index);
  }

  /** The text from `start` up to `end`, one step for each code unit copied. */
  slice(start: number, end: number = this.text.length): string {
    const piece = this.text.slice(start, end);
    this.work.steps += piece.length;
    return piece;
  }

  /**
   * The first index at or after `from` where `needle` starts; -1 when none does. For the short
   * fixed needles the scanners look for, it reads at most `needle.length` code units at each
   * position.
   */
  indexOf(needle: string, from = 0): number {
    const first = needle.charCodeAt(0);
    for (let index = Math.max(0, from); index + needle.length <= this.text.length; index += 1) {
      if (this.code(index) === first && this.startsWith(needle, index, 1)) return index;
    }
    return -1;
  }

  /** Whether `prefix` stands at `index`, reading from its code unit at `skip` on. */
  startsWith(prefix: string, index: number, skip = 0): boolean {
    for (let offset = skip; offset < prefix.length; offset += 1) {
      if (this.code(index + offset) !== prefix.charCodeAt(offset)) return false;
    }
    return true;
  }

  /**
   * The match of the sticky expression `pattern` at `index`, or null. What the expression reads
   * is not charged: each expression a counted function runs is listed, with why it reads in
   * linear time, in the roster `regex-roster.spec.ts` reconciles with the modules.
   */
  stickyMatch(pattern: RegExp, index: number): RegExpExecArray | null {
    pattern.lastIndex = index;
    return pattern.exec(this.text);
  }

  /** The character (a whole code point) starting at `index`; `null` at the end. */
  characterAt(index: number): string | null {
    if (index < 0 || index >= this.text.length) return null;
    const first = this.code(index);
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < this.text.length) {
      const second = this.code(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) return String.fromCharCode(first, second);
    }
    return String.fromCharCode(first);
  }

  /** The character (a whole code point) ending just before `index`; `null` at the start. */
  characterBefore(index: number): string | null {
    if (index <= 0 || index > this.text.length) return null;
    const last = this.code(index - 1);
    if (last >= 0xdc00 && last <= 0xdfff && index >= 2) {
      const first = this.code(index - 2);
      if (first >= 0xd800 && first <= 0xdbff) return String.fromCharCode(first, last);
    }
    return String.fromCharCode(last);
  }
}
