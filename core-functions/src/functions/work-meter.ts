/**
 * A count of the work the text functions do on their input, for the spec that bounds it on their
 * real code paths: one unit per step of each loop that walks the input or carries a position
 * across it (the scans of the HTML and of the inline markdown, the lines of a markdown document,
 * the runs of backticks and of emphasis markers, the Knuth-Morris-Pratt searches, the `keep`
 * tokens `SENTENCES` searches for, and the matches, segments, positions and lines the segmentation
 * reads), and per code unit that one of those scans hands to the runtime to search (`indexOf`, an
 * end tag's expression). The short loops inside one tag name, run, cell or line are not counted,
 * each running once for an element a counted loop reaches; nor is what the runtime does inside a
 * regular expression, its substring search or `Intl.Segmenter`. Production code feeds the count
 * only while a spec observes an evaluation (`observeWork`); every other evaluation counts nothing,
 * and the module is not part of the package's entry point.
 */

/** Thrown by `chargeWork` once an observed evaluation counts more than its observation allows. */
export class WorkLimitExceeded extends Error {
  constructor(readonly units: number) {
    super(`more than the observed limit of work: ${units} units`);
  }
}

let observed: { units: number; limit: number } | undefined;

/**
 * Runs `run` and counts the units of work that the loops it reaches report until it settles.
 * Past `limit` units the loop that reports the next one stops with `WorkLimitExceeded`, which the
 * runner reports as the evaluation's error, so a loop that works far beyond its bound ends at once.
 */
export async function observeWork<T>(
  run: () => Promise<T>,
  limit = Number.POSITIVE_INFINITY,
): Promise<{ result: T; units: number }> {
  const outer = observed;
  const count = { units: 0, limit };
  observed = count;
  try {
    return { result: await run(), units: count.units };
  } finally {
    observed = outer;
  }
}

/** Adds `units` units of work to the count of the evaluation being observed. */
export function chargeWork(units: number): void {
  if (observed === undefined) return;
  observed.units += units;
  if (observed.units > observed.limit) throw new WorkLimitExceeded(observed.units);
}
