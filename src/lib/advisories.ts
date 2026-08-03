/**
 * Shared model for everything that can appear as an advisory: official SACHET
 * alerts (IMD / CWC / SDMA) and operator-published advisories.
 *
 * The dashboard ticker and the full listing on /hotlines render the same
 * items — one rotating a line at a time, one expanded in full — so the mapping
 * lives here rather than being written twice and drifting. A reader who sees a
 * warning scroll past on the dashboard and then opens the hotlines page must
 * find the same warning there, worded identically.
 */

import type { Advisory } from "@/types/database";
import type { DamStation, OfficialAlert, RiverStation } from "@/types/hydromet";

export type AdvisoryTone = "critical" | "warning" | "info";

/**
 * Where an item came from. This drives the chip on every card, and it is the
 * most important field here: the difference between a government warning and a
 * number this app derived from a rainfall model is the difference between
 * "evacuate" and "keep an eye on it".
 *
 * `none` is for synthetic placeholder items, which carry no provenance chip
 * because they are not warnings at all.
 */
export type AdvisoryProvenance =
  | "official"
  | "operator"
  | "bulletin"
  | "modelled"
  | "none";

export const PROVENANCE_LABEL: Record<AdvisoryProvenance, string | null> = {
  official: "Official",
  operator: "Operator",
  bulletin: "KSDMA bulletin",
  modelled: "Modelled",
  none: null,
};

/** Shape returned by `/api/advisories`. */
export interface AdvisoriesResponse {
  success: boolean;
  advisories: Advisory[];
}

export interface AdvisoryItem {
  key: string;
  title: string;
  message: string;
  tone: AdvisoryTone;
  createdAt: string | null;
  provenance: AdvisoryProvenance;
  /**
   * Line printed under the card spelling out exactly where the reading came
   * from — the bulletin timestamp, or the fact that a number is modelled and
   * not a government warning.
   */
  sourceNote: string | null;
  /** Official alerts: issuing agency as reported by SACHET, e.g. "IMD". */
  source: string | null;
  /** Official alerts: the area text the agency published. */
  area: string | null;
  /** Official alerts: Kerala districts matched in the area text. */
  districts: string[];
  /** Official alerts: validity window. */
  start: string | null;
  end: string | null;
  /** Operator advisories: optional source link, http(s) only. */
  link: string | null;
}

/**
 * Only http(s) links are ever rendered into an `href`. Advisory links are
 * operator-entered free text, so without this an advisory row could inject a
 * `javascript:` URI into the page.
 */
export function safeHttpLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function officialToItem(a: OfficialAlert): AdvisoryItem {
  return {
    key: `official-${a.id}`,
    title: `${a.source} · ${a.event}`,
    message: a.message,
    tone: a.severity === "red" ? "critical" : "warning",
    createdAt: a.start,
    provenance: "official",
    sourceNote: null,
    source: a.source,
    area: a.areaDescription || null,
    districts: a.districts ?? [],
    start: a.start,
    end: a.end,
    link: null,
  };
}

export function advisoryToItem(a: Advisory): AdvisoryItem {
  return {
    key: `advisory-${a.id}`,
    title: a.title,
    message: a.message,
    tone: a.type === "critical" ? "critical" : a.type === "warning" ? "warning" : "info",
    createdAt: a.created_at,
    provenance: "operator",
    sourceNote: null,
    source: null,
    area: null,
    districts: [],
    start: null,
    end: null,
    link: safeHttpLink(a.link),
  };
}

/* ── Dams ─────────────────────────────────────────────────────────────────── */

/**
 * Dams from today's official KSDMA gauge bulletin that are at orange or red.
 *
 * Two filters carry all the weight here, and neither is negotiable:
 *
 *  - `source === "KSDMA"` — a dam absent from today's bulletin is rainfall
 *    MODELLED by this app. Mullaperiyar is currently one of those, and it is
 *    modelled as "likely spilling" at red. Promoting that to a warning card
 *    would put an invented dam-spill notice in front of people downstream of
 *    Mullaperiyar. Estimates stay in the dam panel, labelled EST, forever.
 *  - `available` — a gauge we could not read is not a gauge reading zero.
 *
 * Blue and green rows are deliberately excluded: blue includes routine states
 * like "all gates are closed" and shutters cracked open 2cm, which is a normal
 * operating day, not a warning.
 */
export function officialDamWarnings(dams: DamStation[]): DamStation[] {
  return dams
    .filter(
      (d) =>
        d.available &&
        d.source === "KSDMA" &&
        (d.alertColor === "red" || d.alertColor === "orange")
    )
    .sort((a, b) => {
      const rank = (c: string) => (c === "red" ? 0 : 1);
      const bySeverity = rank(a.alertColor) - rank(b.alertColor);
      if (bySeverity !== 0) return bySeverity;
      return b.capacityPct - a.capacityPct;
    });
}

export function damToItem(d: DamStation, bulletinDate: string | null): AdvisoryItem {
  const level = `Reservoir at ${d.capacityPct.toFixed(1)}% of FRL (${d.currentLevel.toFixed(
    2
  )} / ${d.frl} ${d.unit}). Status: ${d.shutterStatus}.`;

  return {
    key: `dam-${d.id}`,
    title: d.name,
    // Bulletin remarks are the operator's own words about shutter positions —
    // the most actionable sentence on the card. Kept verbatim, on its own line.
    message: d.remarks ? `${level}\n${d.remarks}` : level,
    tone: d.alertColor === "red" ? "critical" : "warning",
    createdAt: d.updatedAt,
    provenance: "bulletin",
    sourceNote: `Official KSDMA gauge bulletin${
      d.officialDate ?? bulletinDate ? ` · ${d.officialDate ?? bulletinDate}` : ""
    }`,
    source: "KSDMA",
    area: d.river,
    districts: d.district ? [d.district] : [],
    start: null,
    end: null,
    link: null,
  };
}

/* ── Rivers ───────────────────────────────────────────────────────────────── */

/**
 * River gauges reading above normal whose warning is NOT already in the list.
 *
 * A station carrying an `officialAlert` is skipped: that alert came from the
 * same SACHET fetch feeding the official cards above, so including it here
 * would print the same government warning twice under two different labels —
 * which reads as two separate warnings.
 *
 * What is left is model output, and it is chipped as such. The discharge comes
 * from Open-Meteo, not from a gauge reading published by CWC.
 */
export function modelledRiverWarnings(stations: RiverStation[]): RiverStation[] {
  return stations
    .filter((s) => s.available && s.status !== "normal" && !s.officialAlert)
    .sort((a, b) => (a.status === "danger" ? 0 : 1) - (b.status === "danger" ? 0 : 1));
}

export function riverToItem(s: RiverStation): AdvisoryItem {
  return {
    key: `river-${s.id}`,
    title: `${s.river} · ${s.name}`,
    message: `Modelled discharge ${s.discharge.toFixed(
      1
    )} m³/s against a danger level of ${s.dangerLevel} m³/s, and ${s.trend}.`,
    tone: s.status === "danger" ? "critical" : "warning",
    createdAt: s.updatedAt,
    provenance: "modelled",
    sourceNote:
      "Derived from Open-Meteo discharge modelling — this is not a government warning. Confirm with CWC / KSDMA before acting on it.",
    source: null,
    area: s.name,
    districts: [],
    start: null,
    end: null,
    link: null,
  };
}

/** Fields every synthetic (non-feed) item has to fill in. */
const SYNTHETIC = {
  createdAt: null,
  provenance: "none" as AdvisoryProvenance,
  sourceNote: null,
  source: null,
  area: null,
  districts: [] as string[],
  start: null,
  end: null,
  link: null,
} as const;

/**
 * Shown only when neither the official feed nor operators have anything live.
 *
 * This deliberately contains no invented alert content — placeholder text must
 * never be mistakable for a real government warning.
 */
export const PLACEHOLDER: AdvisoryItem = {
  ...SYNTHETIC,
  key: "placeholder",
  title: "No Active Advisory",
  message:
    "No official alert or operator advisory is currently live. For warnings check KSDMA / IMD directly, or dial 1077 for your district control room.",
  tone: "info",
};

/**
 * Shown when the advisory feed could not be reached. Distinct from
 * PLACEHOLDER on purpose: "we found no warnings" and "we could not check for
 * warnings" must never look the same.
 */
export const FEED_UNAVAILABLE: AdvisoryItem = {
  ...SYNTHETIC,
  key: "feed-unavailable",
  title: "Advisory Feed Unavailable",
  message:
    "Could not reach the alert feed — there may be active warnings this page cannot show. Check KSDMA / IMD directly, or dial 1077 for your district control room.",
  tone: "warning",
};

/**
 * Format an official alert's validity window in IST.
 *
 * Returns null when neither end of the window is usable — a half-parsed
 * "Valid until Invalid Date" is worse than showing no window at all.
 */
export function formatValidityWindow(
  start: string | null,
  end: string | null
): string | null {
  const fmt = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  };

  const from = fmt(start);
  const to = fmt(end);
  if (from && to) return `Valid ${from} → ${to} IST`;
  if (to) return `Valid until ${to} IST`;
  if (from) return `Issued ${from} IST`;
  return null;
}
