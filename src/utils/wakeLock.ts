/**
 * Keeps the machine awake while a long simulation runs, via the Screen Wake Lock API.
 *
 * What this can and cannot do, because the difference matters and the API's name
 * oversells it:
 *
 * - It holds the *screen* awake. Every desktop OS treats "screen must stay on" as "do not
 *   idle-sleep", so a run that takes an hour is no longer cut short by the screen saver or
 *   by the display timeout — which is the failure this exists to prevent.
 * - It cannot survive the lid closing, an explicit Sleep, or the OS deciding to sleep on
 *   low battery. There is no web API that can, by design.
 * - The lock is dropped by the browser whenever the document stops being visible, and
 *   cannot be re-taken until it is visible again. So switching tabs releases it and coming
 *   back re-takes it (see the visibility listener below). A background tab is also throttled
 *   by the browser, so a run in one is slow regardless of any lock.
 * - It needs a secure context (https, or localhost during development) and is unsupported
 *   in some browsers — Safari has no Screen Wake Lock at the time of writing. Callers get
 *   an unsupported/failed result to report rather than a thrown error, since failing to
 *   keep the screen on is never a reason to refuse to run a simulation.
 */

/** Why a wake lock request did not end up holding a lock. */
export type WakeLockFailure =
  /** No `navigator.wakeLock` — either an unsupported browser or an insecure context. */
  | 'unsupported'
  /** The browser refused: typically the document was not visible at request time. */
  | 'denied';

export interface WakeLockHandle {
  /** Releases the lock and stops re-acquiring it. Safe to call more than once. */
  release: () => Promise<void>;
  /** Whether a lock is being held right now (false while the tab is hidden). */
  isHeld: () => boolean;
}

// Minimal shape of the parts of the Screen Wake Lock API used here; `lib.dom` in the
// TypeScript version this project builds against does not declare it.
interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | null {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return wakeLock ?? null;
}

/** Whether this browser/context can hold a screen wake lock at all. */
export function isWakeLockSupported(): boolean {
  return getWakeLock() !== null;
}

/**
 * Requests a screen wake lock and keeps it for as long as the returned handle is held,
 * re-acquiring it whenever the page becomes visible again.
 *
 * Resolves to a handle on success, or to the reason it could not be taken. Never rejects.
 */
export async function requestWakeLock(): Promise<WakeLockHandle | WakeLockFailure> {
  const wakeLock = getWakeLock();
  if (!wakeLock) return 'unsupported';

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async (): Promise<boolean> => {
    if (released || sentinel) return false;
    try {
      const next = await wakeLock.request('screen');
      // Released while the request was in flight: drop what we just got rather than
      // leaking a lock nobody will ever release.
      if (released) {
        void next.release().catch(() => {});
        return false;
      }
      sentinel = next;
      // The browser drops the lock on its own when the page is hidden; forget the stale
      // sentinel so the visibility handler can take a fresh one.
      next.addEventListener('release', () => {
        if (sentinel === next) sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  };

  const onVisibilityChange = () => {
    if (!released && !document.hidden) void acquire();
  };

  if (!(await acquire())) return 'denied';

  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    release: async () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) {
        try {
          await held.release();
        } catch {
          // Already gone (navigation, tab hidden) — nothing to clean up.
        }
      }
    },
    isHeld: () => sentinel !== null,
  };
}
