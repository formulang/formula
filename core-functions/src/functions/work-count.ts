import type { BaseFunctionConfig } from '@formulang/definitions';

/**
 * The characters a search or a scan visits. The functions whose work is linear in their input
 * add every step of their searches and scans to one, so a spec can bound what an evaluation of
 * the public function costs by the length of its input.
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
