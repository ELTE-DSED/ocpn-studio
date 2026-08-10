import { useSyncExternalStore } from 'react';

/**
 * What the simulator is busy with right now. "firing" covers a chunk of the run itself —
 * the WASM engine searching bindings and firing, plus folding the resulting events into
 * the markings and the event log. "analyzing" is the pass after the last step, where the
 * monitors, Declare constraints and enabled-transition list are recomputed; on a large
 * net that is its own noticeable wait, so it gets its own label rather than looking like
 * the run has hung at 100%.
 */
export type RunPhase = 'firing' | 'analyzing';

export interface RunProgress {
  phase: RunPhase;
  /** Steps completed so far in this run. */
  current: number;
  /** Steps requested for this run. */
  total: number;
  /** Recent throughput, smoothed — 0 until the first chunk has been timed. */
  stepsPerSecond: number;
  /** Name of the most recently fired transition, if any. */
  lastTransitionName?: string;
  /**
   * Replaces the `current/total` step counts in the readout. A run bounded by model time
   * rather than by a step count measures its progress in simulation time, and "4h / 30d"
   * says far more there than the number of steps that happen to have fired.
   */
  countsLabel?: string;
  /**
   * No knowable total — an open-ended run stops on a deadlock or on Stop, and neither
   * has a distance to it. The bar animates rather than filling.
   */
  indeterminate?: boolean;
}

// Deliberately NOT React context and NOT the zustand store. Progress ticks several times
// a second during a run: through the simulation context it would re-render every consumer
// (canvas included) on each tick, and a zustand write would run the undo middleware's
// equality check over the whole model. This store is read only by the components that
// display progress, so a tick costs a repaint of the toolbar readout and nothing else.
let currentProgress: RunProgress | null = null;
const listeners = new Set<() => void>();

export function setRunProgress(progress: RunProgress | null): void {
  currentProgress = progress;
  for (const listener of listeners) listener();
}

/** Merges a partial update into the current progress; no-op if no run is in flight. */
export function patchRunProgress(patch: Partial<RunProgress>): void {
  if (!currentProgress) return;
  setRunProgress({ ...currentProgress, ...patch });
}

export function getRunProgress(): RunProgress | null {
  return currentProgress;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes a component to the live progress of the running simulation. */
export function useRunProgress(): RunProgress | null {
  return useSyncExternalStore(subscribe, getRunProgress, getRunProgress);
}
