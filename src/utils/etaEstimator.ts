/**
 * Wall-clock "time remaining" for a run bounded by *model* time.
 *
 * The naive estimator — measure how fast model time is advancing against the wall clock and
 * extrapolate — is unusable here, because in a timed net the model clock does not advance
 * smoothly at all. Many firings share one timestamp, then the clock jumps to the next one. So
 * the per-chunk model-time delta is a spiky sequence of zeros and large jumps, and any rate
 * read off it swings by orders of magnitude, taking the estimate from "2m" to "2h30m" and back.
 *
 * Steps, on the other hand, accrue smoothly: every chunk fires some. So the estimate is
 * factored into two quantities that are each individually well behaved, and measured over the
 * horizon that suits each:
 *
 *   remaining wall time  =  remaining model time  ×  steps per model ms  ÷  steps per wall ms
 *                                                   └ event density ┘      └ throughput ┘
 *
 *   * **Event density** is a property of the model — how many firings a unit of simulated time
 *     costs. It is near-constant across a run, so it is averaged over the whole run, which
 *     makes it very stable and absorbs the clock's jumpiness entirely.
 *   * **Throughput** is a property of the machine and the current net size. It drifts (more
 *     tokens means more bindings to search), so it is measured over a trailing window rather
 *     than the whole run.
 *
 * The result is then damped asymmetrically before display: it may fall quickly, but it climbs
 * slowly, so a momentary stall cannot fling the number upwards. A genuine slowdown still gets
 * there, over about half a minute, which is the point — an estimate that reacts within one
 * chunk is noise, not information.
 */

/** Trailing window over which throughput is measured. */
const THROUGHPUT_WINDOW_MS = 10_000;

/** Shortest window that may be used; below this the cumulative average stands in. */
const MIN_WINDOW_MS = 2_000;

/** No estimate at all before this much of the run has happened. */
const MIN_ELAPSED_MS = 5_000;

/** Time constants for the asymmetric damping: quick to fall, slow to rise. */
const FALL_TAU_MS = 6_000;
const RISE_TAU_MS = 25_000;
/** Falling is capped at a fraction of the estimate, so short runs still land on zero. */
const FALL_TAU_FRACTION = 0.25;
const MIN_FALL_TAU_MS = 1_000;

/**
 * Round an estimate to a granularity nobody will notice moving, so the readout is not
 * repainted with a different value several times a second. Rounds up: quoting slightly long
 * and finishing early reads better than the reverse.
 */
export function quantiseEta(ms: number): number {
  if (ms < 10_000) return Math.ceil(ms / 1_000) * 1_000; // seconds
  if (ms < 60_000) return Math.ceil(ms / 5_000) * 5_000; // 5 seconds
  if (ms < 3_600_000) return Math.ceil(ms / 60_000) * 60_000; // minutes
  return Math.ceil(ms / 300_000) * 300_000; // 5 minutes
}

export interface EtaEstimator {
  /**
   * Feed the run's progress so far: model time covered, steps fired, and how long both took.
   * Returns the estimated wall-clock milliseconds remaining, or undefined while the run is too
   * young or too stalled to say anything honest — callers should show nothing at all then,
   * rather than a placeholder that jumps.
   */
  update(modelDone: number, stepsDone: number, wallElapsedMs: number): number | undefined;
}

/** Creates an estimator for a run that must cover `totalModelTime` milliseconds of model time. */
export function createEtaEstimator(totalModelTime: number): EtaEstimator {
  // Trailing samples of (wall time, steps fired), trimmed to the throughput window. Chunks
  // arrive every ~40ms and grow as they are timed, so the sample spacing is irregular — which
  // is the other reason a fixed-weight average over chunks would be wrong, and a window
  // measured in wall time is right.
  const samples: { wallMs: number; steps: number }[] = [];
  let damped: number | undefined;
  let lastUpdateMs = 0;

  return {
    update(modelDone: number, stepsDone: number, wallElapsedMs: number): number | undefined {
      samples.push({ wallMs: wallElapsedMs, steps: stepsDone });
      while (samples.length > 2 && wallElapsedMs - samples[0].wallMs > THROUGHPUT_WINDOW_MS) {
        samples.shift();
      }

      const remaining = totalModelTime - modelDone;
      if (wallElapsedMs < MIN_ELAPSED_MS || modelDone <= 0 || stepsDone <= 0 || remaining <= 0) {
        return undefined;
      }

      // Throughput: prefer the trailing window, fall back to the whole run until it is wide
      // enough to mean anything.
      const oldest = samples[0];
      const windowSpan = wallElapsedMs - oldest.wallMs;
      const throughput =
        windowSpan >= MIN_WINDOW_MS
          ? (stepsDone - oldest.steps) / windowSpan
          : stepsDone / wallElapsedMs;

      // A window in which nothing fired says the run is stalled, not that it is infinitely
      // slow. Hold the previous number rather than inventing one.
      if (throughput <= 0) return damped === undefined ? undefined : quantiseEta(damped);

      const density = stepsDone / modelDone; // steps per model ms, whole-run average
      const raw = (remaining * density) / throughput;
      if (!Number.isFinite(raw)) return undefined;

      if (damped === undefined) {
        damped = raw;
      } else {
        const dt = Math.max(0, wallElapsedMs - lastUpdateMs);
        // Falling is also scaled to the size of the estimate: six seconds of lag is nothing
        // against a ten-minute countdown but is most of a twenty-second one, where it would
        // leave the readout still saying "10s" as the run finishes.
        const tau =
          raw > damped
            ? RISE_TAU_MS
            : Math.min(FALL_TAU_MS, Math.max(MIN_FALL_TAU_MS, damped * FALL_TAU_FRACTION));
        // Time-aware smoothing: the weight depends on how long since the last sample, not on
        // how many samples there have been, so an adaptive chunk size cannot change how fast
        // the estimate reacts.
        const alpha = 1 - Math.exp(-dt / tau);
        damped += alpha * (raw - damped);
      }
      lastUpdateMs = wallElapsedMs;

      return quantiseEta(damped);
    },
  };
}
