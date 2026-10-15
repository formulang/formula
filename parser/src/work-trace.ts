/**
 * A record of the work the parser does, for the specs that bound it on its real code paths: the
 * walk's queue and visits in order, and units of work by kind. Production code feeds the record
 * only while a spec observes a parse (`observeWork`); every other parse records nothing, and the
 * module is not part of the package's entry point.
 */

/** One event of a walk through the callables a call names, in the order the walk makes them. */
export type WalkEvent =
  /** A walk started for a call written in the formula, with its bound. */
  | {
      kind: 'walk';
      walk: number;
      signatureId: string;
      start: number | undefined;
      args: number;
      limit: number;
    }
  /**
   * A state joined the walk's queue, with the positions it has to visit; seeds, the callables the
   * call itself names, at depth 0.
   */
  | { kind: 'queued'; walk: number; depth: number; state: string; positions: number }
  /** The walk visited one position of a state that has `positions` to visit. */
  | {
      kind: 'visited';
      walk: number;
      depth: number;
      state: string;
      position: number;
      positions: number;
    };

/**
 * A unit of work: `arguments`, one argument type read by the checks of a call (choosing its
 * overload, checking its arguments, binding its templates, building what it passes its callables,
 * choosing a callable's overload).
 */
export type WorkKind = 'arguments';

/** What an observed parse did. */
export type WorkRecord = {
  readonly events: WalkEvent[];
  readonly units: Record<WorkKind, number>;
  walks: number;
};

let observed: WorkRecord | undefined;

/** Runs `run`, recording the work of every parse it makes. */
export function observeWork<T>(run: () => T): { result: T; work: WorkRecord } {
  const outer = observed;
  const work: WorkRecord = { events: [], units: { arguments: 0 }, walks: 0 };
  observed = work;
  try {
    return { result: run(), work };
  } finally {
    observed = outer;
  }
}

/** The record of the parse being observed, or undefined: then nothing is recorded. */
export function workRecord(): WorkRecord | undefined {
  return observed;
}

/** Adds `units` units of work of `kind` to the record of the parse being observed. */
export function chargeWork(kind: WorkKind, units: number): void {
  if (observed !== undefined) observed.units[kind] += units;
}
