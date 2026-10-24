/**
 * A count of the work the text functions' own loops do, for the spec that bounds it on their real
 * code paths: one unit per step of a loop, and per code unit that one of the code's own scans
 * reads with the runtime's `indexOf`. What the runtime does inside a regular expression, its
 * substring search or `Intl.Segmenter` is not counted. Production code feeds the count only while
 * a spec observes an evaluation (`observeWork`); every other evaluation counts nothing, and the
 * module is not part of the package's entry point.
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
