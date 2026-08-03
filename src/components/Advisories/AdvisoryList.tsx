"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Advisory } from "@/types/database";
import type {
  AlertsResponse,
  DamResponse,
  OfficialAlert,
  RiverResponse,
} from "@/types/hydromet";
import {
  advisoryToItem,
  damToItem,
  formatValidityWindow,
  modelledRiverWarnings,
  officialDamWarnings,
  officialToItem,
  riverToItem,
  PROVENANCE_LABEL,
  type AdvisoriesResponse,
  type AdvisoryItem,
  type AdvisoryTone,
} from "@/lib/advisories";
import { formatRelativeTime, formatSyncAge } from "@/lib/format";
import { Loader2 } from "lucide-react";

/**
 * Same cadence as /api/alerts' own `revalidate = 600` — polling faster than
 * the route's cache only costs the reader bandwidth for an identical payload.
 */
const REFRESH_MS = 10 * 60 * 1000;

/**
 * Coarse clock, ticking every minute.
 *
 * "4m ago" and the sync stamp are computed at render, and this component only
 * re-renders when a fetch lands — ten minutes apart. Without a tick the page
 * would still read "sync now" long after it stopped being true, which is the
 * one thing a staleness indicator must never do.
 */
function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

const TONE: Record<
  AdvisoryTone,
  { label: string; card: string; rail: string; chip: string; body: string }
> = {
  critical: {
    label: "Critical",
    card: "border-emergency-700/60 bg-emergency-950/40",
    rail: "bg-emergency-500",
    chip: "border-emergency-600/60 text-emergency-300",
    body: "text-emergency-100",
  },
  warning: {
    label: "Warning",
    card: "border-warning-700/50 bg-warning-950/20",
    rail: "bg-warning-500",
    chip: "border-warning-600/60 text-warning-300",
    body: "text-surface-100",
  },
  info: {
    label: "Info",
    card: "border-surface-800 bg-surface-900",
    rail: "bg-surface-500",
    chip: "border-surface-600 text-surface-300",
    body: "text-surface-200",
  },
};

/** One advisory, rendered whole — no truncation, no scrolling, no link-out. */
function AdvisoryCard({ item }: { item: AdvisoryItem }) {
  const tone = TONE[item.tone];
  const window = formatValidityWindow(item.start, item.end);
  const age = item.createdAt ? formatRelativeTime(item.createdAt) : "";

  return (
    <article
      className={`relative overflow-hidden rounded-lg border p-4 pl-5 ${tone.card}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${tone.rail}`} />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${tone.chip}`}
        >
          {tone.label}
        </span>
        {PROVENANCE_LABEL[item.provenance] && (
          <span className="source-chip">{PROVENANCE_LABEL[item.provenance]}</span>
        )}
        {age && (
          <span className="ml-auto font-mono text-[10px] text-surface-500">{age}</span>
        )}
      </div>

      <h3 className="text-sm font-bold leading-snug text-surface-50">{item.title}</h3>

      {/* The whole message, verbatim. `whitespace-pre-line` keeps the line
          breaks an operator typed — bulletins are often written as lists. */}
      <p
        className={`mt-2 whitespace-pre-line text-[13px] leading-relaxed ${tone.body}`}
      >
        {item.message}
      </p>

      {(item.area || item.districts.length > 0 || window) && (
        <dl className="mt-3 space-y-1 border-t border-surface-800/80 pt-2.5 text-[11px] leading-relaxed text-surface-400">
          {item.districts.length > 0 && (
            <div className="flex gap-2">
              <dt className="panel-label flex-shrink-0 pt-px">Districts</dt>
              <dd className="text-surface-300">{item.districts.join(", ")}</dd>
            </div>
          )}
          {item.area && (
            <div className="flex gap-2">
              <dt className="panel-label flex-shrink-0 pt-px">Area</dt>
              <dd>{item.area}</dd>
            </div>
          )}
          {window && (
            <div className="flex gap-2">
              <dt className="panel-label flex-shrink-0 pt-px">Window</dt>
              <dd className="font-mono text-[10px]">{window}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Where the numbers came from. On a modelled card this is the line that
          stops a rainfall estimate being read as a government warning, so it
          is never truncated or hidden behind a tooltip. */}
      {item.sourceNote && (
        <p
          className={`mt-2.5 text-[10px] leading-relaxed ${
            item.provenance === "modelled"
              ? "rounded-sm border border-warning-700/40 bg-warning-950/20 px-2 py-1.5 text-warning-300"
              : "text-surface-500"
          }`}
        >
          {item.sourceNote}
        </p>
      )}

      {/* Operator advisories may cite a source. The advisory itself is already
          readable above — this is a citation, not the content. */}
      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-sm border border-surface-700 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-surface-300 transition hover:bg-surface-800"
        >
          Source ↗
        </a>
      )}
    </article>
  );
}

/**
 * Every live advisory, in full.
 *
 * The dashboard ticker shows these one at a time, scrolling — fine for
 * catching that something is happening, useless for reading a four-sentence
 * IMD bulletin. This is the same data with nothing hidden.
 *
 * It is a client component on purpose: /hotlines stays a static server page so
 * the phone numbers render even when Supabase and every upstream feed are
 * down, and this list hydrates in beside them without holding them up.
 */
export default function AdvisoryList() {
  const [officialAlerts, setOfficialAlerts] = useState<OfficialAlert[]>([]);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [dams, setDams] = useState<DamResponse | null>(null);
  const [rivers, setRivers] = useState<RiverResponse | null>(null);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const [advisoriesFailed, setAdvisoriesFailed] = useState(false);
  const [damsFailed, setDamsFailed] = useState(false);
  const [riversFailed, setRiversFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Keeps "sync 4m" and each card's "2h ago" honest between fetches.
  useMinuteTick();

  /** Returns false when the feed could not be read. */
  const fetchAlerts = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error(String(res.status));
      const data: AlertsResponse = await res.json();
      if (!data.success) throw new Error("feed reported failure");
      setOfficialAlerts(data.alerts);
      setAlertsFailed(false);
      return true;
    } catch {
      // Keep the last known alerts on screen; the banner below says the feed
      // is unreachable rather than implying an all-clear.
      setAlertsFailed(true);
      return false;
    }
  }, []);

  /** Returns false when the feed could not be read. */
  const fetchAdvisories = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/advisories", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data: AdvisoriesResponse = await res.json();
      if (!data.success) throw new Error("feed reported failure");
      setAdvisories(data.advisories ?? []);
      setAdvisoriesFailed(false);
      return true;
    } catch {
      // Keep whatever was last shown — see the banner below. Blanking the list
      // on a failed refresh would read as "the warnings were withdrawn".
      setAdvisoriesFailed(true);
      return false;
    }
  }, []);

  /** Returns false when the feed could not be read. */
  const fetchDams = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/dams");
      if (!res.ok) throw new Error(String(res.status));
      const data: DamResponse = await res.json();
      if (!data.success) throw new Error("feed reported failure");
      setDams(data);
      setDamsFailed(false);
      return true;
    } catch {
      setDamsFailed(true);
      return false;
    }
  }, []);

  /** Returns false when the feed could not be read. */
  const fetchRivers = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/river-discharge");
      if (!res.ok) throw new Error(String(res.status));
      const data: RiverResponse = await res.json();
      if (!data.success) throw new Error("feed reported failure");
      setRivers(data);
      setRiversFailed(false);
      return true;
    } catch {
      setRiversFailed(true);
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [alertsOk, advisoriesOk, damsOk, riversOk] = await Promise.all([
      fetchAlerts(),
      fetchAdvisories(),
      fetchDams(),
      fetchRivers(),
    ]);
    // Only stamp a sync that actually happened. A partial refresh leaves the
    // age climbing, which is the truth: some of this list is older than it
    // looks, and the banner above says which part.
    if (alertsOk && advisoriesOk && damsOk && riversOk) setSyncedAt(Date.now());
    setRefreshing(false);
    setLoading(false);
  }, [fetchAlerts, fetchAdvisories, fetchDams, fetchRivers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // No realtime subscription here, unlike the dashboard ticker: the Supabase
  // client is ~70 kB, and this page has to render its advisories over a
  // congested network. A poll, a refresh when the tab comes back, and the
  // manual button cover the same ground for a page you read and act on.
  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Coming back to a backgrounded tab is exactly when the list is most likely
  // to be stale — and when someone is about to act on it.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /**
   * Ordered by how much authority stands behind each item, not by severity: a
   * government warning outranks a dam bulletin, which outranks a number this
   * app modelled. Sorting the whole list by tone would float a modelled red
   * above a real IMD orange, which is precisely the wrong reading.
   */
  const items = useMemo<AdvisoryItem[]>(
    () => [
      ...officialAlerts.map(officialToItem),
      ...advisories.map(advisoryToItem),
      ...officialDamWarnings(dams?.dams ?? []).map((d) =>
        damToItem(d, dams?.officialDate ?? null)
      ),
      ...modelledRiverWarnings(rivers?.stations ?? []).map(riverToItem),
    ],
    [officialAlerts, advisories, dams, rivers]
  );

  const anyFeedFailed = alertsFailed || advisoriesFailed || damsFailed || riversFailed;
  const failedNames = [
    alertsFailed ? "the official alert feed (SACHET)" : null,
    advisoriesFailed ? "the operator advisory feed" : null,
    damsFailed ? "the KSDMA dam bulletin" : null,
    riversFailed ? "the river gauge feed" : null,
  ].filter(Boolean) as string[];

  return (
    <section id="advisories" className="scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-bold uppercase tracking-wider text-surface-50">
            Live warnings
            {items.length > 0 && (
              <span className="ml-1.5 font-mono text-surface-400">{items.length}</span>
            )}
          </h2>
          {!loading && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-surface-600">
              sync {formatSyncAge(syncedAt)}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-sm border border-surface-700 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-surface-400 transition hover:text-surface-100 disabled:opacity-60"
        >
          {refreshing && <Loader2 className="h-3 w-3 animate-spin" />}
          Refresh
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-surface-500">
        Every live IMD / CWC / SDMA alert and operator advisory in full, plus
        dams at orange or red on today&apos;s official KSDMA bulletin and river
        gauges running above normal. Each card says where its numbers came from
        — <strong className="text-surface-400">Modelled</strong> is this
        app&apos;s own estimate, not a government warning.
      </p>

      {/* A feed we could not reach is never allowed to look like an all-clear. */}
      {anyFeedFailed && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-warning-700/50 bg-warning-950/20 p-3 text-[11px] leading-relaxed text-warning-300"
        >
          <strong className="font-bold uppercase tracking-wider">
            Incomplete:
          </strong>{" "}
          could not reach {failedNames.join(" and ")}. There may be active
          warnings missing from this list. Check KSDMA / IMD directly, or dial
          1077 for your district control room.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-surface-800 py-10 text-xs text-surface-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading advisories…
        </div>
      ) : items.length === 0 ? (
        anyFeedFailed ? null : (
          <div className="rounded-lg border border-dashed border-surface-800 px-4 py-8 text-center">
            <p className="text-xs font-bold text-surface-300">
              No active advisory
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-surface-500">
              No official alert or operator advisory is currently live. This is a
              real all-clear from both feeds, not a loading state.
            </p>
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.key}>
              <AdvisoryCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
