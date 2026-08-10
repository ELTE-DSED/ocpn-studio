/**
 * Locale-aware time formatting utilities.
 *
 * All functions use the browser's default locale, which respects the user's
 * OS-level language / region / 12h-vs-24h settings automatically.
 */

/** Pad a number to a given width with leading zeros. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Format the local UTC offset as ±HH:MM (e.g. "+01:00", "-05:00").
 */
function formatTZOffset(date: Date): string {
  const offset = -date.getTimezoneOffset(); // minutes east of UTC
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const h = Math.floor(absOffset / 60);
  const m = absOffset % 60;
  return `${sign}${pad(h, 2)}:${pad(m, 2)}`;
}

/**
 * Format a Date as `YYYY-MM-DD - HH:mm:ss.SSS ±HH:MM`.
 *
 * Example: `2026-02-14 - 14:45:12.347 +01:00`
 */
export function formatDateTimeFull(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1, 2);
  const d = pad(date.getDate(), 2);
  const h = pad(date.getHours(), 2);
  const mi = pad(date.getMinutes(), 2);
  const s = pad(date.getSeconds(), 2);
  const ms = pad(date.getMilliseconds(), 3);
  return `${y}-${mo}-${d} - ${h}:${mi}:${s}.${ms} ${formatTZOffset(date)}`;
}

/**
 * Format a Date as a short date string (e.g. "Feb 16, 2026" or "16 Feb 2026").
 */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a Date as a time string with seconds (e.g. "14:07:29" or "2:07:29 PM"
 * depending on the user's locale/OS preference).
 */
export function formatTimeHMS(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format a Date as "Mon DD, HH:MM:SS" respecting the user's locale.
 * Used for compact displays like token timestamps on place nodes.
 */
export function formatDateTimeCompact(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format a simulation time value (milliseconds since epoch/start) for display:
 * an absolute datetime if a simulation epoch is set, otherwise the plain
 * integer model time. Shared so every place that surfaces simulation time
 * (status panel, toasts, etc.) renders it the same way.
 */
export function formatSimulationTime(timeMs: number, epoch: Date | null): string {
  if (epoch) {
    return formatDateTimeFull(new Date(epoch.getTime() + timeMs));
  }
  return String(timeMs);
}

/**
 * Format a span of model time as a short duration ("3d 4h", "2h 15m", "45s", "120ms").
 *
 * Two units at most: this reads at a glance in a progress readout, where the point is
 * roughly how far a run has got, not the exact millisecond. Rounds down, so a span never
 * reads as already finished.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  const abs = Math.max(0, Math.floor(ms));
  if (abs < 1000) return `${abs}ms`;

  const totalSeconds = Math.floor(abs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
