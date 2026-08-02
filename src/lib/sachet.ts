import type { OfficialAlert } from "@/types/hydromet";
import { DISTRICT_NAMES } from "./districts";

/**
 * SACHET — NDMA's Common Alerting Protocol feed (sachet.ndma.gov.in).
 *
 * This is the official multi-agency alert pipeline for India: IMD weather
 * warnings, CWC flood forecasts, and State DMA advisories all publish through
 * it. The public endpoint returns a flat JSON array of active alerts.
 *
 * Everything here is defensive: the schema is undocumented, so every field is
 * treated as optional and a malformed entry is dropped rather than crashing
 * the feed.
 */

const SACHET_URL =
  "https://sachet.ndma.gov.in/cap_public_website/FetchAllAlertDetails";

/** Re-exported for callers that already import district names from here. */
export const KERALA_DISTRICTS = DISTRICT_NAMES;

/** River-name variants seen in official alert text, keyed by our station ids. */
const RIVER_KEYWORDS: Record<string, string[]> = {
  periyar: ["periyar"],
  bharatapuzha: ["bharatapuzha", "bharathapuzha"],
  pamba: ["pamba", "pampa"],
  chaliyar: ["chaliyar"],
  kadalundipuzha: ["kadalundi"],
  achencovil: ["achencovil", "achankovil"],
  valapattanam: ["valapattanam"],
  muvattupuzha: ["muvattupuzha", "moovattupuzha"],
  chalakkudy: ["chalakudy", "chalakkudy"],
  meenachil: ["meenachil"],
  kallada: ["kallada"],
  karamana: ["karamana"],
  manimala: ["manimala"],
  chandragiri: ["chandragiri"],
};

/**
 * SACHET timestamps come in Java `Date.toString()` form:
 * "Sun Aug 02 23:00:00 IST 2026". JS `Date.parse` does not understand the
 * "IST" token, so parse manually and pin the +05:30 offset.
 */
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseSachetDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(
    /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+(\d{4})$/
  );
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const [, mon, day, time, year] = m;
  const month = MONTHS[mon];
  if (!month) return null;
  const iso = `${year}-${month}-${day.padStart(2, "0")}T${time}+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeSeverity(entry: Record<string, unknown>): "red" | "orange" | "yellow" {
  const color = String(entry.severity_color ?? "").toLowerCase();
  if (color === "red" || color === "orange" || color === "yellow") return color;
  const sev = String(entry.severity ?? "").toLowerCase();
  if (sev.includes("red")) return "red";
  if (sev.includes("orange") || sev === "warning") return "orange";
  return "yellow";
}

const SEVERITY_RANK: Record<string, number> = { red: 0, orange: 1, yellow: 2 };

/**
 * Fetch active official alerts for Kerala. Returns null when the feed itself
 * is unreachable (distinct from "reachable but no Kerala alerts" = []).
 */
export async function fetchKeralaAlerts(): Promise<OfficialAlert[] | null> {
  try {
    const res = await fetch(SACHET_URL, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const raw = await res.json();
    if (!Array.isArray(raw)) return null;

    const now = Date.now();
    const alerts: OfficialAlert[] = [];

    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;

      const area = String(e.area_description ?? "");
      const message = String(e.warning_message ?? "");
      const haystack = `${area} ${message}`.toLowerCase();

      // Kerala scope: state name or any district name in the area/message text.
      const districts = KERALA_DISTRICTS.filter((d) =>
        haystack.includes(d.toLowerCase())
      );
      if (districts.length === 0 && !haystack.includes("kerala")) continue;

      // Skip alerts that have already expired.
      const end = parseSachetDate(e.effective_end_time);
      if (end && new Date(end).getTime() < now) continue;

      const rivers = Object.entries(RIVER_KEYWORDS)
        .filter(([, kws]) => kws.some((kw) => haystack.includes(kw)))
        .map(([id]) => id);

      alerts.push({
        id: String(e.identifier ?? e.alert_id_sdma_autoinc ?? alerts.length),
        severity: normalizeSeverity(e),
        event: String(e.disaster_type ?? "Alert"),
        message: message || area,
        areaDescription: area,
        source: String(e.alert_source ?? "SACHET"),
        districts: [...districts],
        rivers,
        start: parseSachetDate(e.effective_start_time),
        end,
      });
    }

    alerts.sort((a, b) => {
      const bySeverity =
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
      if (bySeverity !== 0) return bySeverity;
      return (b.start ?? "").localeCompare(a.start ?? "");
    });

    return alerts.slice(0, 30);
  } catch {
    return null;
  }
}
