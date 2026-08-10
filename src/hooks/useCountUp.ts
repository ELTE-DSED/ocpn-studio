import { useEffect, useRef, useState } from 'react';

/** How long a value change takes to roll over, in milliseconds. */
const COUNT_UP_DURATION_MS = 700;

/** Ease-out cubic: fast first, settling into the final digits. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animates a whole number towards `value`, returning the figure to display right now.
 *
 * The log's stat tiles jump in one step — during a run their source is deliberately not
 * recomputed, so a long run lands thousands of events at once when it ends. Rolling the
 * digits up makes that jump readable as "this went up a lot" instead of a value blinking
 * into something unrelated.
 *
 * Honours `prefers-reduced-motion`, and never animates the first value it is given:
 * mounting a panel that already holds a full log should show the total, not count to it.
 */
export function useCountUp(value: number): number {
  // null means "nothing in flight, show the real value". Only ever set from inside an
  // animation frame, so a value that needs no animation costs no extra render at all.
  const [animated, setAnimated] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  // What the digits currently read. A value that changes again mid-roll retargets from
  // here rather than from the old figure, so successive runs read as one continuous climb.
  const fromRef = useRef(value);
  const isFirstRef = useRef(true);

  useEffect(() => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      fromRef.current = value;
      return;
    }

    const reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || value === fromRef.current) {
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / COUNT_UP_DURATION_MS);
      if (progress === 1) {
        fromRef.current = value;
        frameRef.current = null;
        setAnimated(null); // Settled — fall back to the real value.
        return;
      }
      const current = Math.round(from + (value - from) * easeOutCubic(progress));
      fromRef.current = current;
      setAnimated(current);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [value]);

  return animated ?? value;
}
