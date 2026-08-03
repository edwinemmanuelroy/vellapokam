/**
 * Shared formatting helpers for the dashboard.
 */

/**
 * "just now" / "4m ago" / "2h ago" / "3d ago" from an ISO timestamp.
 * Returns "" for a missing or unparseable date — some feeds (RSS) publish
 * items with no usable timestamp, and "NaNd ago" is worse than nothing.
 */
export function formatRelativeTime(dateStr: string): string {
  const parsed = new Date(dateStr).getTime();
  if (Number.isNaN(parsed)) return "";
  const ms = Date.now() - parsed;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/**
 * The WhatsApp dispatch message for an SOS.
 *
 * Single source of truth: the card and the map popup previously built their own
 * payloads under the same "Dispatch WA" label, and the card's version omitted
 * the victim's phone number — so which button a responder happened to press
 * decided whether the rescue team could call ahead.
 */
export function buildDispatchMessage(sos: {
  name: string;
  phone: string;
  people_count: number;
  needs: string[];
  latitude: number;
  longitude: number;
}): string {
  return [
    "*KERALA FLOOD EMERGENCY DISPATCH*",
    `Name: ${sos.name}`,
    `Phone: ${sos.phone}`,
    `People: ${sos.people_count}`,
    `Needs: ${sos.needs.join(", ") || "Immediate rescue"}`,
    `GPS: https://maps.google.com/?q=${sos.latitude},${sos.longitude}`,
  ].join("\n");
}

/** Turn-by-turn directions to an SOS location. */
export function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
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
