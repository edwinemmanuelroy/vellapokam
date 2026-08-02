/**
 * Shared formatting helpers for the dashboard.
 */

/** "just now" / "4m ago" / "2h ago" / "3d ago" from an ISO timestamp. */
export function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/** Compact sync stamp: "now" / "4m" / "2h" — for panel headers. */
export function formatSyncAge(timestampMs: number | null): string {
  if (timestampMs === null) return "—";
  const sec = Math.floor((Date.now() - timestampMs) / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}
