/**
 * A count of the work the text functions do on their input, for the spec that bounds it on their
 * real code paths: one unit per step of each loop that walks the input or carries a position
 * across it (the scans of the HTML and of the inline markdown, the lines of a markdown document,
 * the runs of backticks and of emphasis markers, the Knuth-Morris-Pratt searches, and the matches,
 * segments, positions and lines the segmentation reads), and per code unit that one of those scans
 * hands to the runtime to search (`indexOf`, an end tag's expression). The short loops inside one
 * tag name, run, cell or line are not counted, each running once for an element a counted loop
 * reaches; nor is what the runtime does inside a regular expression, its substring search or
 * `Intl.Segmenter`. Production code feeds the count only while a spec observes an evaluation
 * (`observeWork`); every other evaluation counts nothing, and the module is not part of the
 * package's entry point.
 */

let observed: { units: number } | undefined;

/** Runs `run` and counts the units of work that the loops it reaches report until it settles. */
export async function observeWork<T>(run: () => Promise<T>): Promise<{ result: T; units: number }> {
  const outer = observed;
  const count = { units: 0 };
  observed = count;
  try {
    return { result: await run(), units: count.units };
  } finally {
    observed = outer;
  }
}

/** Adds `units` units of work to the count of the evaluation being observed. */
export function chargeWork(units: number): void {
  if (observed !== undefined) observed.units += units;
}
