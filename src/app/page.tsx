"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { FloodReport, SosRequest } from "@/types/database";
import type {
  AlertsResponse,
  DamResponse,
  NewsResponse,
  OfficialAlert,
  RiverResponse,
  WeatherResponse,
} from "@/types/hydromet";
import {
  buildDirectionsUrl,
  buildDispatchMessage,
  formatRelativeTime,
  formatSyncAge,
} from "@/lib/format";
// Shared with the server-side push routes — single source of truth for
// distance maths and the district list.
import { getDistanceKm, formatDistance } from "@/lib/geo";
import { DISTRICTS } from "@/lib/districts";
import DynamicMap from "@/components/Map/DynamicMap";
import ReportModal from "@/components/ReportModal/ReportModal";
import GovtAlertsTicker from "@/components/GovtAlertsTicker/GovtAlertsTicker";
import NotificationConsent from "@/components/Notifications/NotificationConsent";
import { useToast } from "@/components/Toast/ToastProvider";
import { Loader2, Maximize2, Menu, Minimize2, X } from "lucide-react";

/** Radius within which a new SOS is treated as "near you". */
const NEARBY_RADIUS_KM = 25;

const RIVER_DISTRICTS: Record<string, string[]> = {
  periyar: ["Ernakulam", "Idukki"],
  bharatapuzha: ["Palakkad", "Thrissur", "Malappuram"],
  pamba: ["Pathanamthitta", "Alappuzha"],
  chaliyar: ["Malappuram", "Kozhikode", "Wayanad"],
  kadalundipuzha: ["Malappuram", "Kozhikode"],
  achencovil: ["Pathanamthitta", "Alappuzha"],
  valapattanam: ["Kannur"],
  muvattupuzha: ["Ernakulam", "Kottayam"],
  chalakkudy: ["Thrissur", "Ernakulam"],
  meenachil: ["Kottayam"],
  kallada: ["Kollam"],
  karamana: ["Thiruvananthapuram"],
  manimala: ["Kottayam", "Pathanamthitta", "Alappuzha"],
  chandragiri: ["Kasaragod"],
};

/* Signal semantics: gray = normal, bright gray = elevated, amber = warning,
   red = danger. The only colors on the page. */
const LEVEL_META: Record<
  string,
  { label: string; color: string; bg: string; pct: string }
> = {
  ankle: { label: "Ankle", color: "text-surface-400", bg: "bg-surface-500", pct: "w-1/4" },
  knee: { label: "Knee", color: "text-surface-200", bg: "bg-surface-300", pct: "w-2/4" },
  waist: { label: "Waist", color: "text-warning-400", bg: "bg-warning-500", pct: "w-3/4" },
  roof: { label: "Roof", color: "text-emergency-400", bg: "bg-emergency-500", pct: "w-full" },
};

const WEATHER_ALERT_STYLES: Record<string, string> = {
  red: "border-emergency-600/50 bg-emergency-950/40 text-emergency-300",
  orange: "border-warning-600/50 bg-warning-950/30 text-warning-300",
  yellow: "border-warning-600/40 text-warning-400",
  green: "border-surface-700 text-surface-400",
};

function damStatusClasses(alertColor: string): { text: string; bg: string } {
  switch (alertColor) {
    case "red":
      return { text: "text-emergency-400 border-emergency-600/50", bg: "bg-emergency-500" };
    case "orange":
      return { text: "text-warning-400 border-warning-600/50", bg: "bg-warning-500" };
    case "blue":
      return { text: "text-surface-200 border-surface-500", bg: "bg-surface-300" };
    default:
      return { text: "text-surface-400 border-surface-700", bg: "bg-surface-500" };
  }
}

function riverStatusClasses(status: string): { text: string; bg: string } {
  switch (status) {
    case "danger":
      return { text: "text-emergency-400 border-emergency-600/50", bg: "bg-emergency-500" };
    case "warning":
      return { text: "text-warning-400 border-warning-600/50", bg: "bg-warning-500" };
    default:
      return { text: "text-surface-400 border-surface-700", bg: "bg-surface-500" };
  }
}

/* ── Small presentational helpers ────────────────────────────────────────── */

const StatCard = React.memo(function StatCard({
  label,
  value,
  accent = "text-surface-100",
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <span className="panel-label">{label}</span>
      <span className={`font-mono text-2xl font-bold tabular-nums ${accent}`}>
        {value}
      </span>
    </div>
  );
});

function PanelHeader({
  title,
  chip,
  syncedAt,
  right,
}: {
  title: string;
  chip?: string;
  syncedAt?: number | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="panel-label text-surface-300">{title}</h3>
        {chip && <span className="source-chip">{chip}</span>}
      </div>
      <div className="flex items-center gap-2">
        {syncedAt !== undefined && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-surface-600">
            sync {formatSyncAge(syncedAt)}
          </span>
        )}
        {right}
      </div>
    </div>
  );
}

function StatusChip({ classes, children }: { classes: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${classes}`}>
      {children}
    </span>
  );
}

function TrendGlyph({ trend }: { trend: string }) {
  if (trend === "rising") return <span className="font-mono text-[10px] text-surface-300">▲</span>;
  if (trend === "falling") return <span className="font-mono text-[10px] text-surface-500">▼</span>;
  return <span className="font-mono text-[10px] text-surface-600">•</span>;
}

const FloodReportCard = React.memo(function FloodReportCard({ report }: { report: FloodReport }) {
  const meta = LEVEL_META[report.water_level] ?? LEVEL_META.ankle;
  const timeAgo = formatRelativeTime(report.created_at);

  return (
    <div className="card-glass animate-slide-up p-4 transition duration-200 hover:border-surface-700">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <span className={`text-xs font-bold ${meta.color}`}>
          {meta.label} Level
        </span>
        <StatusChip
          classes={
            report.verified
              ? "text-surface-200 border-surface-500"
              : "text-surface-500 border-surface-700"
          }
        >
          {report.verified ? "Verified" : "Unverified"}
        </StatusChip>
      </div>

      <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
        <div className={`h-full rounded-full ${meta.bg} ${meta.pct}`} />
      </div>

      {report.description && (
        <p className="mb-2.5 text-xs leading-relaxed text-surface-300">
          {report.description}
        </p>
      )}

      {report.image_url && (
        <img
          src={report.image_url}
          alt="Flood photo"
          className="mb-2.5 h-24 w-full rounded border border-surface-700 object-cover"
        />
      )}

      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-surface-500">
        <span>
          {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
        </span>
        <span>{timeAgo}</span>
      </div>
    </div>
  );
});

const SosCard = React.memo(function SosCard({
  sos,
  onResolve,
  highlighted = false,
}: {
  sos: SosRequest;
  onResolve?: (id: string) => void;
  highlighted?: boolean;
}) {
  const isPending = sos.status === "pending";
  const isReported = Boolean(sos.rescue_reported_at) && isPending;
  // Ticks every 30s so the waiting time keeps climbing and the 60-minute
  // escalation actually fires even on a silent realtime channel.
  const now = useNowTick();
  const timeAgo = formatRelativeTime(sos.created_at);
  const waitMinutes = Math.floor((now - new Date(sos.created_at).getTime()) / 60000);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { showToast } = useToast();

  /**
   * Public users REPORT a rescue; they no longer close it. The request stays
   * in the queue, flagged, until an operator confirms — so a mistaken or
   * malicious tap can never make a trapped family disappear from the list.
   * Migration 00008 enforces this at the database level too.
   */
  const handleReportRescued = async () => {
    setResolving(true);
    setResolveError(null);
    try {
      // `.select()` matters: an update blocked by RLS (already confirmed, or
      // already flagged by someone else between render and tap) returns zero
      // rows and NO error. Without checking the row count we would tell the
      // reporter their report landed when nothing was written.
      const { data, error } = await supabase
        .from("sos_requests")
        .update({ rescue_reported_at: new Date().toISOString() })
        .eq("id", sos.id)
        .select("id");

      if (error) {
        setResolveError("Could not send the report: " + error.message);
      } else if (!data || data.length === 0) {
        setResolveError(
          "This request was already updated by someone else. Refresh to see its current state."
        );
      } else {
        setConfirming(false);
        onResolve?.(sos.id);
        showToast({
          title: "Rescue reported",
          message: "An operator will confirm it. The request stays active until then.",
          tone: "success",
        });
      }
    } catch {
      setResolveError("An error occurred while sending the report");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div
      data-sos-id={sos.id}
      className={`card-glass animate-slide-up relative overflow-hidden p-4 transition duration-200 hover:border-surface-700 ${
        highlighted ? "ring-2 ring-emergency-500 ring-offset-2 ring-offset-surface-950 " : ""
      }${
        isReported
          ? "border-warning-700/60"
          : isPending
          ? "border-emergency-800/60"
          : "opacity-60"
      }`}
    >
      {isPending && (
        <div
          className={`absolute inset-y-0 left-0 w-0.5 ${
            isReported ? "bg-warning-500" : "animate-pulse-emergency bg-emergency-500"
          }`}
        />
      )}

      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-xs font-bold text-surface-100">{sos.name}</span>
          {/* Waiting time is the triage signal: red past the first hour. */}
          {isPending && (
            <span
              className={`font-mono text-[9px] font-bold uppercase tracking-wider ${
                waitMinutes >= 60 ? "text-emergency-400" : "text-warning-400"
              }`}
            >
              waiting {timeAgo === "just now" ? "<1m" : timeAgo.replace(" ago", "")}
            </span>
          )}
        </div>
        {isReported ? (
          <StatusChip classes="text-warning-400 border-warning-600/60">
            Rescue reported
          </StatusChip>
        ) : isPending ? (
          <span className="badge-sos">SOS</span>
        ) : (
          <StatusChip classes="text-surface-400 border-surface-700">
            Rescued
          </StatusChip>
        )}
      </div>

      {isReported && (
        <p className="mb-2.5 rounded-sm border border-warning-700/40 bg-warning-950/20 px-2 py-1 text-[10px] leading-relaxed text-warning-300">
          Someone reported this rescue as complete. It stays active until an operator
          confirms.
        </p>
      )}

      <div className="mb-2.5 grid grid-cols-2 gap-2 font-mono text-[11px] text-surface-300">
        <a
          href={`tel:${sos.phone}`}
          className="min-w-0 truncate rounded-sm py-2 hover:underline"
        >
          {sos.phone}
        </a>
        <span>
          {sos.people_count} {sos.people_count === 1 ? "person" : "people"}
        </span>
      </div>

      {sos.needs.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {sos.needs.map((need) => (
            <span
              key={need}
              className="rounded-sm border border-surface-800 bg-surface-850 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-surface-400"
            >
              {need}
            </span>
          ))}
        </div>
      )}

      {/* Dispatch actions */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-t border-surface-800 pt-2">
        <a
          href={buildDirectionsUrl(sos.latitude, sos.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center rounded-sm border border-surface-600 px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-200 transition hover:bg-surface-800"
        >
          Directions
        </a>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(buildDispatchMessage(sos))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center rounded-sm border border-surface-600 px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-200 transition hover:bg-surface-800"
        >
          Dispatch WA
        </a>
        {isPending && !isReported && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-sm border border-surface-600 px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-200 transition hover:bg-surface-800"
          >
            Report rescued
          </button>
        )}
        {isPending && !isReported && confirming && (
          <div className="flex w-full items-center gap-1.5">
            <span className="flex-1 text-[10px] text-surface-400">
              Confirm this family is safe?
            </span>
            <button
              onClick={handleReportRescued}
              disabled={resolving}
              className="flex items-center gap-1 rounded-sm border border-surface-500 bg-surface-800 px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-100 transition hover:bg-surface-700 disabled:opacity-50"
            >
              {resolving && <Loader2 className="h-3 w-3 animate-spin" />}
              Yes, report
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-sm px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-500 transition hover:text-surface-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-surface-500">
        <span>
          {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
        </span>
        <span>{timeAgo}</span>
      </div>

      {resolveError && (
        <p className="mt-1.5 text-[10px] font-semibold text-emergency-400">
          {resolveError}
        </p>
      )}
    </div>
  );
});

function SkeletonCard() {
  return (
    <div className="card-glass animate-pulse space-y-3 p-4">
      <div className="h-4 w-1/3 rounded bg-surface-800" />
      <div className="h-1.5 w-full rounded-full bg-surface-850" />
      <div className="h-3 w-2/3 rounded bg-surface-850" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-surface-800 py-10 text-center">
      <p className="text-xs text-surface-500">{message}</p>
    </div>
  );
}

/**
 * Failure state for the SOS and report feeds. Deliberately unlike `EmptyState`:
 * an empty queue and an unreachable queue mean opposite things to a rescuer.
 */
function FeedError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-emergency-700/60 bg-emergency-950/40 p-4 text-center"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-emergency-300">
        Rescue queue unavailable
      </p>
      <p className="text-[11px] leading-relaxed text-emergency-200/80">
        This list may be out of date — it is <strong>not</strong> a sign that nobody
        needs help. {message}
      </p>
      <button
        onClick={onRetry}
        className="rounded-sm border border-emergency-500/60 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-emergency-300 transition hover:bg-emergency-900/40"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Shared coarse clock, ticking every 30s.
 *
 * Relative times were computed at render only, and when realtime is connected
 * the fallback poll is disabled — so on a quiet channel a card showed
 * "waiting 3m" for an hour and the 60-minute red escalation never fired.
 */
function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Merge a freshly fetched snapshot with local state, keeping any row the
 * snapshot has not caught up with yet (a realtime INSERT mid-flight, or an
 * optimistic rescue flag). Server rows win for records present in both.
 */
function mergeById<T extends { id: string }>(incoming: T[], previous: T[]): T[] {
  const seen = new Set(incoming.map((r) => r.id));
  const localOnly = previous.filter((r) => !seen.has(r.id));
  return localOnly.length === 0 ? incoming : [...localOnly, ...incoming];
}

/** IST wall clock — renders only after mount to avoid a hydration mismatch. */
function IstClock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-mono text-xs tabular-nums text-surface-300">
      {now ?? "--:--:--"} <span className="text-[9px] text-surface-500">IST</span>
    </span>
  );
}

/* ── Sync-stamp bookkeeping ──────────────────────────────────────────────── */
type SyncKey = "weather" | "rivers" | "dams" | "news" | "incidents";
type SyncMap = Record<SyncKey, number | null>;

const INITIAL_SYNC: SyncMap = {
  weather: null,
  rivers: null,
  dams: null,
  news: null,
  incidents: null,
};

export default function DashboardPage() {
  /* ── State ────────────────────────────────────────────────────────────── */
  const [reports, setReports] = useState<FloodReport[]>([]);
  const [sosRequests, setSosRequests] = useState<SosRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorIncidents, setErrorIncidents] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Which tab the report modal opens on. SOS is the product's primary action,
  // so the dedicated SOS button routes straight to it.
  const [modalTab, setModalTab] = useState<"flood" | "sos">("sos");

  const openReportModal = useCallback((tab: "flood" | "sos") => {
    setModalTab(tab);
    setModalOpen(true);
  }, []);

  /* ── Layout & Responsive States ───────────────────────────────────────── */
  // Closed by default: this only drives the mobile drawer (the panel is always
  // visible from `lg` up), and opening it on load buried the map and stats
  // behind a full-screen overlay on phones.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFullscreenMap, setIsFullscreenMap] = useState(false);
  // SOS feed is the default view — this is a rescue tool first, telemetry second.
  const [sidebarTab, setSidebarTab] = useState<"hydromet" | "dams" | "feeds" | "news">("feeds");

  /* ── Filtering States ─────────────────────────────────────────────────── */
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [geoLocated, setGeoLocated] = useState(false);

  /* ── Hydromet States ──────────────────────────────────────────────────── */
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: 9.9312, lng: 76.2673 }); // Kochi fallback
  const [locating, setLocating] = useState(false);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [rivers, setRivers] = useState<RiverResponse | null>(null);
  const [dams, setDams] = useState<DamResponse | null>(null);
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [officialAlerts, setOfficialAlerts] = useState<OfficialAlert[]>([]);
  const [alertsFeedFailed, setAlertsFeedFailed] = useState(false);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [loadingRivers, setLoadingRivers] = useState(true);
  const [loadingDams, setLoadingDams] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);
  const [errorWeather, setErrorWeather] = useState<string | null>(null);
  const [errorRivers, setErrorRivers] = useState<string | null>(null);
  const [errorDams, setErrorDams] = useState<string | null>(null);
  const [errorNews, setErrorNews] = useState<string | null>(null);

  const { showToast } = useToast();

  /* ── Queue jump ───────────────────────────────────────────────────────── */
  const sosFeedRef = React.useRef<HTMLDivElement>(null);
  const [highlightSosId, setHighlightSosId] = useState<string | null>(null);
  // Read the current queue without making the callback depend on it.
  const filteredSosRef = React.useRef<SosRequest[]>([]);

  /**
   * Take the responder to the request that needs attention.
   *
   * Previously this only set the tab and opened the drawer — but `feeds` is
   * already the default tab and the sidebar is already visible from `lg` up,
   * so on desktop the button did nothing observable at all.
   */
  const focusRescueQueue = useCallback(() => {
    setSidebarTab("feeds");
    // The drawer is only modal below lg; opening it on desktop is a no-op that
    // also hides the SOS button.
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
      setSidebarOpen(true);
    }

    const target = filteredSosRef.current.find((s) => s.status === "pending");
    setHighlightSosId(target?.id ?? null);

    // Let the tab switch and drawer transition commit before scrolling.
    window.requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sosFeedRef.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    });
  }, []);

  // Clear the highlight ring once it has done its job.
  useEffect(() => {
    if (!highlightSosId) return;
    const id = setTimeout(() => setHighlightSosId(null), 2500);
    return () => clearTimeout(id);
  }, [highlightSosId]);

  // Callable from the realtime subscription without adding it as a dependency
  // (that would resubscribe the channel on every render).
  const focusRescueQueueRef = React.useRef(focusRescueQueue);
  useEffect(() => {
    focusRescueQueueRef.current = focusRescueQueue;
  }, [focusRescueQueue]);

  /* The sidebar is a modal drawer below `lg` (it has a dismiss backdrop), so
     it should behave like one: lock the page behind it and close on Escape.
     Without the lock the page scrolled underneath, dragging the map through
     the drawer. Above `lg` it is an ordinary column — no locking there. */
  useEffect(() => {
    if (!sidebarOpen) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarOpen]);

  /* Latest location, readable from the realtime callback without making the
     subscription depend on it (a resubscribe per GPS update would drop
     events mid-flight). */
  const coordsRef = React.useRef(coords);
  const geoLocatedRef = React.useRef(geoLocated);
  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);
  useEffect(() => {
    geoLocatedRef.current = geoLocated;
  }, [geoLocated]);

  /* ── Sync stamps per feed (drives the SYNC labels in panel headers) ───── */
  const [syncedAt, setSyncedAt] = useState<SyncMap>(INITIAL_SYNC);
  const markSynced = useCallback((key: SyncKey) => {
    setSyncedAt((prev) => ({ ...prev, [key]: Date.now() }));
  }, []);

  /* ── Geolocation Detection ────────────────────────────────────────────── */
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(userCoords);
        setLocating(false);

        setDistrictFilter("all");
        setGeoLocated(true);
      },
      () => {
        setLocating(false);
        setGeoLocated(false); // Settle on Kochi fallback
      },
      { timeout: 8000 }
    );
  }, []);

  /* ── Hydromet Fetch Handlers ──────────────────────────────────────────── */
  // `silent` keeps a background refresh from replacing a populated panel with
  // a spinner every 15 minutes.
  const fetchWeather = useCallback(async (latitude: number, longitude: number, silent = false) => {
    if (!silent) setLoadingWeather(true);
    setErrorWeather(null);
    try {
      const res = await fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}`);
      if (!res.ok) throw new Error("Failed to fetch weather data");
      const data = await res.json();
      if (data.success) {
        setWeather(data);
        markSynced("weather");
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load weather";
      setErrorWeather(msg);
    } finally {
      setLoadingWeather(false);
    }
  }, [markSynced]);

  const fetchRivers = useCallback(async (silent = false) => {
    if (!silent) setLoadingRivers(true);
    setErrorRivers(null);
    try {
      const res = await fetch("/api/river-discharge");
      if (!res.ok) throw new Error("Failed to fetch river levels");
      const data = await res.json();
      if (data.success) {
        setRivers(data);
        markSynced("rivers");
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load river status";
      setErrorRivers(msg);
    } finally {
      setLoadingRivers(false);
    }
  }, [markSynced]);

  const fetchDams = useCallback(async (silent = false) => {
    if (!silent) setLoadingDams(true);
    setErrorDams(null);
    try {
      const res = await fetch("/api/dams");
      if (!res.ok) throw new Error("Failed to fetch dam levels");
      const data = await res.json();
      if (data.success) {
        setDams(data);
        markSynced("dams");
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load dam levels";
      setErrorDams(msg);
    } finally {
      setLoadingDams(false);
    }
  }, [markSynced]);

  const fetchNews = useCallback(async (silent = false) => {
    if (!silent) setLoadingNews(true);
    setErrorNews(null);
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news feed");
      const data = await res.json();
      if (data.success) {
        setNews(data);
        markSynced("news");
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load news";
      setErrorNews(msg);
    } finally {
      setLoadingNews(false);
    }
  }, [markSynced]);

  // Official SACHET alerts (IMD/SDMA/CWC) — always fetched silently; the
  // panels that consume them degrade to model data when the feed is down.
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) {
        setAlertsFeedFailed(true);
        return;
      }
      const data: AlertsResponse = await res.json();
      if (data.success) {
        setOfficialAlerts(data.alerts);
        setAlertsFeedFailed(false);
      } else {
        setAlertsFeedFailed(true);
      }
    } catch {
      // Keep the last known alerts; consumers fall back to derived bands. The
      // ticker still says the feed is unreachable rather than "all clear".
      setAlertsFeedFailed(true);
    }
  }, []);

  /* ── Fetching Supabase Incident Data ──────────────────────────────────── */
  /**
   * Load the rescue queue and report feed.
   *
   * `silent` is used by the 60s realtime-fallback poll: without it every poll
   * blanked the queue to skeleton cards, on exactly the degraded network the
   * fallback exists for.
   *
   * Failure must never look like an empty queue. A rescuer seeing "No matching
   * SOS requests" has to be able to trust that it means nobody is waiting — so
   * an error sets `errorIncidents` and the sync stamp is only updated on
   * success.
   */
  const fetchAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [reportsRes, sosRes] = await Promise.all([
          supabase
            .from("flood_reports")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("sos_requests")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100),
        ]);

        const failure = reportsRes.error ?? sosRes.error;
        if (failure) {
          setErrorIncidents(failure.message);
          return; // keep whatever we last showed; do NOT stamp a fresh sync
        }

        // Merge rather than replace: a realtime INSERT that landed while this
        // request was in flight would otherwise be overwritten by the older
        // snapshot, and an optimistic rescue flag would be reverted.
        if (reportsRes.data) setReports((prev) => mergeById(reportsRes.data, prev));
        if (sosRes.data) setSosRequests((prev) => mergeById(sosRes.data, prev));
        setErrorIncidents(null);
        markSynced("incidents");
      } catch (err) {
        setErrorIncidents(
          err instanceof Error ? err.message : "Could not reach the rescue queue"
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [markSynced]
  );

  /* ── Setup triggers on load ───────────────────────────────────────────── */
  useEffect(() => {
    detectLocation();
    fetchRivers();
    fetchDams();
    fetchNews();
    fetchAlerts();
  }, [detectLocation, fetchRivers, fetchDams, fetchNews, fetchAlerts]);

  useEffect(() => {
    fetchWeather(coords.lat, coords.lng);
  }, [coords, fetchWeather]);

  /* ── Periodic refresh ─────────────────────────────────────────────────── */
  // The API routes cache upstream data for 15 minutes; poll on the same cadence
  // so a dashboard left open through an event is not showing stale telemetry.
  useEffect(() => {
    const id = setInterval(() => {
      fetchWeather(coords.lat, coords.lng, true);
      fetchRivers(true);
      fetchDams(true);
      fetchNews(true);
      fetchAlerts();
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [coords, fetchWeather, fetchRivers, fetchDams, fetchNews, fetchAlerts]);

  /* ── Realtime fallback polling ────────────────────────────────────────── */
  // Websockets are often blocked on captive/portal networks common during
  // disasters; while the realtime channel is down, poll incidents instead so
  // the SOS feed keeps moving.
  useEffect(() => {
    if (connected) return;
    // `silent` — a background poll must not blank the queue to skeletons.
    const id = setInterval(() => {
      fetchAll(true);
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [connected, fetchAll]);

  /* ── Realtime Setup ───────────────────────────────────────────────────── */
  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel("dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "flood_reports" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setReports((prev) => {
              if (prev.some((r) => r.id === (payload.new as FloodReport).id)) return prev;
              return [payload.new as FloodReport, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setReports((prev) =>
              prev.map((r) =>
                r.id === (payload.new as FloodReport).id ? (payload.new as FloodReport) : r
              )
            );
          } else if (payload.eventType === "DELETE") {
            setReports((prev) =>
              prev.filter((r) => r.id !== (payload.old as FloodReport).id)
            );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sos_requests" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = payload.new as SosRequest;
            let isNew = false;
            setSosRequests((prev) => {
              if (prev.some((s) => s.id === incoming.id)) return prev;
              isNew = true;
              return [incoming, ...prev];
            });

            // Raise an in-app toast for anyone already watching the dashboard.
            // Push notifications cover people who are not — see /api/push.
            if (isNew) {
              const km = geoLocatedRef.current
                ? getDistanceKm(
                    coordsRef.current.lat,
                    coordsRef.current.lng,
                    incoming.latitude,
                    incoming.longitude
                  )
                : null;
              const nearby = km !== null && km <= NEARBY_RADIUS_KM;
              showToast({
                key: `sos-${incoming.id}`,
                tone: "sos",
                title: nearby ? `SOS ${formatDistance(km!)} away` : "New SOS",
                message: `${incoming.people_count} ${
                  incoming.people_count === 1 ? "person needs" : "people need"
                } rescue${incoming.needs.length ? ` · ${incoming.needs.join(", ")}` : ""}.`,
                // Nearby alerts stay until acted on; distant ones auto-clear.
                duration: nearby ? null : 10000,
                action: {
                  label: "Open queue",
                  onClick: () => focusRescueQueueRef.current(),
                },
              });
            }
          } else if (payload.eventType === "UPDATE") {
            setSosRequests((prev) =>
              prev.map((s) =>
                s.id === (payload.new as SosRequest).id ? (payload.new as SosRequest) : s
              )
            );
          } else if (payload.eventType === "DELETE") {
            setSosRequests((prev) =>
              prev.filter((s) => s.id !== (payload.old as SosRequest).id)
            );
          }
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll, showToast]);

  /* ── Feed insertions (from the report modal, post-insert) ─────────────── */
  const handleFloodCreated = useCallback((report: FloodReport) => {
    setReports((prev) => {
      if (prev.some((r) => r.id === report.id)) return prev;
      return [report, ...prev];
    });
  }, []);

  const handleSosCreated = useCallback((sos: SosRequest) => {
    setSosRequests((prev) => {
      if (prev.some((s) => s.id === sos.id)) return prev;
      return [sos, ...prev];
    });
  }, []);

  // Optimistically flag the report. Status is untouched — only an operator
  // can actually close a request now.
  const handleResolveSos = useCallback((id: string) => {
    setSosRequests((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, rescue_reported_at: new Date().toISOString() } : s
      )
    );
  }, []);

  /* ── Filter & Sorting Logic ─────────────────────────────────────────────── */
  // 1. Process Reports Feed (Filter or Sort)
  const filteredReports = React.useMemo(() => {
    let list = [...reports];
    if (districtFilter !== "all") {
      const targetDist = DISTRICTS.find((d) => d.name === districtFilter);
      if (targetDist) {
        list = list.filter((rep) => {
          const distance = getDistanceKm(rep.latitude, rep.longitude, targetDist.lat, targetDist.lng);
          return distance <= 35;
        });
      }
    } else if (geoLocated) {
      list.sort((a, b) => {
        const distA = getDistanceKm(coords.lat, coords.lng, a.latitude, a.longitude);
        const distB = getDistanceKm(coords.lat, coords.lng, b.latitude, b.longitude);
        return distA - distB;
      });
    }
    return list;
  }, [reports, districtFilter, geoLocated, coords]);

  // 2. Process SOS Feed (Filter or Sort)
  const filteredSos = React.useMemo(() => {
    let list = [...sosRequests];
    if (districtFilter !== "all") {
      const targetDist = DISTRICTS.find((d) => d.name === districtFilter);
      if (targetDist) {
        list = list.filter((sos) => {
          const distance = getDistanceKm(sos.latitude, sos.longitude, targetDist.lat, targetDist.lng);
          return distance <= 35;
        });
      }
    } else if (geoLocated) {
      list.sort((a, b) => {
        const distA = getDistanceKm(coords.lat, coords.lng, a.latitude, a.longitude);
        const distB = getDistanceKm(coords.lat, coords.lng, b.latitude, b.longitude);
        return distA - distB;
      });
    }
    // Pending rescues always surface above resolved ones. Array#sort is
    // stable, so within each group the distance/recency ordering holds.
    list.sort(
      (a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)
    );
    return list;
  }, [sosRequests, districtFilter, geoLocated, coords]);

  // Mirror for focusRescueQueue, which must not depend on the list itself.
  useEffect(() => {
    filteredSosRef.current = filteredSos;
  }, [filteredSos]);

  // 3. Process Rivers Telemetry (Filter or Sort)
  const filteredRivers = React.useMemo(() => {
    if (!rivers) return [];
    let list = [...rivers.stations];
    if (districtFilter !== "all") {
      list = list.filter((st) => {
        const dists = RIVER_DISTRICTS[st.id] || [];
        return dists.includes(districtFilter);
      });
    } else if (geoLocated) {
      list.sort((a, b) => {
        const distA = getDistanceKm(coords.lat, coords.lng, a.lat, a.lng);
        const distB = getDistanceKm(coords.lat, coords.lng, b.lat, b.lng);
        return distA - distB;
      });
    }
    return list;
  }, [rivers, districtFilter, geoLocated, coords]);

  // 4. Process Dams Telemetry (Filter or Sort)
  const filteredDams = React.useMemo(() => {
    if (!dams) return [];
    let list = [...dams.dams];
    if (districtFilter !== "all") {
      // District now comes from the API row itself (official bulletin rows
      // carry their own district), not a hardcoded id → district map.
      list = list.filter((dam) => dam.district === districtFilter);
    } else if (geoLocated) {
      list.sort((a, b) => {
        // Official-only dams without verified coordinates sort last.
        const distA =
          a.lat !== null && a.lng !== null
            ? getDistanceKm(coords.lat, coords.lng, a.lat, a.lng)
            : Infinity;
        const distB =
          b.lat !== null && b.lng !== null
            ? getDistanceKm(coords.lat, coords.lng, b.lat, b.lng)
            : Infinity;
        return distA - distB;
      });
    }
    return list;
  }, [dams, districtFilter, geoLocated, coords]);

  /* ── Derived Stats ────────────────────────────────────────────────────── */
  // Hoisted out of the sparkline's render loop, where it was recomputed over
  // the whole series once per bar.
  const sparklineMax = React.useMemo(
    () => Math.max(1, ...(weather?.sparkline ?? []).map((s) => s.rain)),
    [weather]
  );

  // Official IMD/SDMA warning for the district nearest the current focus —
  // when present it outranks the Open-Meteo-derived band in the rain panel.
  const officialWeatherAlert = React.useMemo(() => {
    if (officialAlerts.length === 0) return null;
    let nearest = DISTRICTS[0];
    let best = Infinity;
    for (const d of DISTRICTS) {
      const dist = getDistanceKm(coords.lat, coords.lng, d.lat, d.lng);
      if (dist < best) {
        best = dist;
        nearest = d;
      }
    }
    return (
      officialAlerts.find(
        (a) =>
          /rain|thunder|storm|lightning|wind/i.test(a.event) &&
          a.districts.includes(nearest.name)
      ) ?? null
    );
  }, [officialAlerts, coords]);

  const pendingSosCount = filteredSos.filter((s) => s.status === "pending").length;
  const totalPeopleWaiting = filteredSos
    .filter((s) => s.status === "pending")
    .reduce((sum, s) => sum + s.people_count, 0);
  const activeReportsCount = filteredReports.length;
  const rescuedCount = filteredSos.filter((s) => s.status === "rescued").length;

  const hasCriticalReport = filteredReports.some(
    (r) => r.water_level === "waist" || r.water_level === "roof"
  );

  const sidebarTabClass = (active: boolean) =>
    `flex-1 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider rounded-sm transition ${
      active
        ? "bg-surface-800 text-surface-100"
        : "text-surface-500 hover:text-surface-300"
    }`;

  return (
    <>
      {/* pb-24 reserves room for the fixed SOS button so it never covers the
          footer or the last feed card on small screens. */}
      <main className="mx-auto max-w-[1536px] space-y-4 px-4 py-4 pb-24 sm:px-6 lg:px-8">
        {/* ── Page Header & Action Controls ──────────────────────────────── */}
        <header className="flex flex-col gap-3 border-b border-surface-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold uppercase tracking-wider text-surface-50 md:text-xl">
              Kerala Flood Ops
            </h1>
            <p className="text-xs text-surface-500">
              Disaster monitoring &amp; SOS coordination
            </p>
          </div>

          <div className="flex items-center gap-3">
            <IstClock />

            {/* Live indicator */}
            <div className="flex items-center gap-1.5 rounded-sm border border-surface-800 bg-surface-900 px-2.5 py-1">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "animate-pulse bg-surface-100" : "bg-surface-600"
                }`}
              />
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-surface-400">
                {connected ? "Live" : "Offline"}
              </span>
            </div>

            {/* No link to /admin here — the ops console is for operators, not
                the public. The route still exists and is reachable directly. */}

            {/* Mobile Sidebar Trigger */}
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Toggle monitoring panel"
              className="flex items-center justify-center rounded-sm border border-surface-800 bg-surface-900 p-2 text-surface-300 transition hover:bg-surface-850 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ── Emergency Alerts Banner Ticker ──────────────────────────────── */}
        <GovtAlertsTicker
          officialAlerts={officialAlerts}
          officialFeedFailed={alertsFeedFailed}
        />

        {/* ── SOS command strip — the headline state of the whole system ──── */}
        {pendingSosCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emergency-600/60 bg-emergency-950/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emergency-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emergency-500" />
              </span>
              <span className="text-sm font-bold uppercase tracking-wider text-emergency-300">
                {pendingSosCount} active SOS
                <span className="ml-2 font-mono text-emergency-400">
                  {totalPeopleWaiting} people waiting
                </span>
              </span>
            </div>
            <button
              onClick={focusRescueQueue}
              className="rounded-sm border border-emergency-500/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-emergency-300 transition hover:bg-emergency-900/40"
            >
              Open rescue queue
            </button>
          </div>
        )}

        {/* ── Proximity alert consent ─────────────────────────────────────── */}
        <NotificationConsent
          coords={coords}
          hasRealLocation={geoLocated}
          onRequestLocation={detectLocation}
          variant="banner"
        />

        {/* ── Critical flooding note ──────────────────────────────────────── */}
        {hasCriticalReport && (
          <div className="rounded-lg border border-emergency-700/50 bg-emergency-950/40 px-4 py-3 text-sm text-emergency-300">
            <strong className="font-bold uppercase tracking-wider">Critical:</strong>{" "}
            waist- or roof-level flooding reported within the current filter. Rescue
            operations are prioritized here.
          </div>
        )}

        {/* ── Stats Summary Panels ────────────────────────────────────────── */}
        <section id="stats-overview" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Active SOS"
            value={pendingSosCount}
            accent={pendingSosCount > 0 ? "text-emergency-400" : "text-surface-100"}
          />
          <StatCard
            label="People Waiting"
            value={totalPeopleWaiting}
            accent={totalPeopleWaiting > 0 ? "text-warning-400" : "text-surface-100"}
          />
          <StatCard label="Flood Reports" value={activeReportsCount} />
          <StatCard label="Rescued" value={rescuedCount} accent="text-surface-300" />
        </section>

        {/* ── Filter Selection Bar ────────────────────────────────────────── */}
        <section className="card-glass flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:gap-3">
            <span className="panel-label hidden sm:inline">Filter</span>

            {/* District dropdown */}
            <select
              value={districtFilter}
              onChange={(e) => {
                setDistrictFilter(e.target.value);
                setGeoLocated(false);
                const matched = DISTRICTS.find((d) => d.name === e.target.value);
                if (matched) setCoords({ lat: matched.lat, lng: matched.lng });
              }}
              className="rounded-sm border border-surface-700 bg-surface-850 px-2 py-2.5 text-xs text-surface-200 outline-none focus:border-surface-400"
            >
              <option value="all">All Districts</option>
              {DISTRICTS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>

            {/* Locate Me button */}
            <button
              onClick={detectLocation}
              disabled={locating}
              className="rounded-sm border border-surface-700 bg-surface-850 px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-300 transition hover:bg-surface-800 hover:text-surface-100 disabled:opacity-60"
            >
              {locating ? "Locating…" : geoLocated ? "GPS Locked" : "Detect Location"}
            </button>

            {/* Location status badge */}
            {geoLocated && districtFilter === "all" && (
              <span className="rounded-sm border border-surface-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-surface-300">
                Nearest First
              </span>
            )}
          </div>

          {/* Reset Filters trigger */}
          {(districtFilter !== "all" || geoLocated) && (
            <button
              onClick={() => {
                setDistrictFilter("all");
                setGeoLocated(false);
                setCoords({ lat: 9.9312, lng: 76.2673 }); // Reset to Kochi center
              }}
              className="rounded-sm px-2 py-2.5 text-[10px] font-bold uppercase tracking-widest text-surface-500 hover:text-surface-200"
            >
              Reset
            </button>
          )}
        </section>

        {/* ── Main Layout Workspace ────────────────────────────────────────── */}
        {/* `items-start`, not `items-stretch`: stretching chained the sidebar's
            height to the map's, so shrinking the map shrank the rescue queue
            with it. Decoupled, the queue is free to be the tallest thing here. */}
        <div className="relative flex items-start gap-4">
          {/* 1. Map Area Column */}
          <div className="relative flex flex-1 flex-col gap-4">
            {/* `isolate` is load-bearing: Leaflet's own controls and the layer
                chips inside use z-index 1000, and without a stacking context
                here they are compared against the mobile drawer in the ROOT
                context — so the map painted straight over the open sidebar.
                Isolating contains every map z-index below the drawer. */}
            <div
              className={`relative isolate ${
                isFullscreenMap ? "h-[70vh]" : "h-[300px] lg:h-[420px]"
              }`}
            >
              {/* Map maximize control */}
              <button
                onClick={() => setIsFullscreenMap((prev) => !prev)}
                aria-label={isFullscreenMap ? "Exit fullscreen map" : "Maximize map"}
                className="absolute right-3 top-3 z-[999] flex h-8 w-8 items-center justify-center rounded border border-surface-700 bg-surface-950/90 text-surface-400 transition hover:text-surface-100"
                title={isFullscreenMap ? "Exit Fullscreen" : "Maximize Map"}
              >
                {isFullscreenMap ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>

              <DynamicMap
                reports={filteredReports}
                sosRequests={filteredSos}
                dams={filteredDams}
                rivers={filteredRivers}
              />
            </div>

            {/* In-Map Feed (Only visible when map is maximized/fullscreen) */}
            {isFullscreenMap && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* SOS lists */}
                <div className="space-y-3">
                  <PanelHeader title="Active SOS" chip="LIVE" syncedAt={syncedAt.incidents} />
                  <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
                    {filteredSos.length === 0 ? (
                      <EmptyState message="No SOS alerts match the current filter criteria." />
                    ) : (
                      filteredSos.map((s) => <SosCard key={s.id} sos={s} onResolve={handleResolveSos} />)
                    )}
                  </div>
                </div>

                {/* Flood Reports lists */}
                <div className="space-y-3">
                  <PanelHeader title="Active Reports" chip="LIVE" syncedAt={syncedAt.incidents} />
                  <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
                    {filteredReports.length === 0 ? (
                      <EmptyState message="No flood reports match the current filter criteria." />
                    ) : (
                      filteredReports.map((r) => <FloodReportCard key={r.id} report={r} />)
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Unified Front-Page Sidebar Panel */}
          {/* Mobile Overlay Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-[1040] bg-black/60 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Unmounted in fullscreen, not just hidden: the in-map feed below
              renders the same SOS and report lists, so a CSS-hidden aside
              mounted every card a second time. */}
          {!isFullscreenMap && (
          <aside
            className={`fixed bottom-0 right-0 top-0 z-[1050] flex w-[340px] max-w-[85vw] flex-col gap-4 overflow-y-auto border-l border-surface-800 bg-surface-950 p-4 transition-transform duration-300 lg:sticky lg:top-16 lg:z-0 lg:max-h-[calc(100vh-5rem)] lg:w-[380px] lg:max-w-none lg:border-l-0 lg:bg-transparent lg:p-0 lg:transition-none ${
              /* `lg:translate-x-0`, not `lg:hidden`: hiding the closed drawer at
                 lg made the desktop panel disappear permanently once a mobile
                 user closed it and widened the viewport, because the only
                 re-open button is itself `lg:hidden`. */
              sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
            }`}
            aria-label="Monitoring panel"
          >
            {/* Mobile close sidebar panel */}
            <div className="flex items-center justify-between border-b border-surface-800 pb-2.5 lg:hidden">
              <span className="panel-label text-surface-200">Monitoring Panel</span>
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Close monitoring panel"
                className="rounded-sm bg-surface-850 p-2.5 text-surface-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Persistent alert control — always reachable, unlike the
                dismissible banner above the fold. */}
            <NotificationConsent
              coords={coords}
              hasRealLocation={geoLocated}
              onRequestLocation={detectLocation}
              variant="panel"
            />

            {/* Sidebar Tab Switcher */}
            <div className="flex rounded-md border border-surface-800 bg-surface-900 p-1">
              {/* SOS first — the rescue queue is the primary view. */}
              <button onClick={() => setSidebarTab("feeds")} className={sidebarTabClass(sidebarTab === "feeds")}>
                SOS
                {pendingSosCount > 0 && (
                  <span className="ml-1 text-emergency-400">{pendingSosCount}</span>
                )}
              </button>
              <button onClick={() => setSidebarTab("hydromet")} className={sidebarTabClass(sidebarTab === "hydromet")}>
                WX
              </button>
              <button onClick={() => setSidebarTab("dams")} className={sidebarTabClass(sidebarTab === "dams")}>
                Dams
              </button>
              <button onClick={() => setSidebarTab("news")} className={sidebarTabClass(sidebarTab === "news")}>
                News
              </button>
            </div>

            {/* Hydromet Tab Render */}
            {sidebarTab === "hydromet" ? (
              <div className="space-y-4">
                {/* Geolocation Weather & Sparkline */}
                <div className="card-glass space-y-4 p-4">
                  <PanelHeader
                    title="Rain Monitor"
                    chip="MODEL"
                    syncedAt={syncedAt.weather}
                    right={
                      <button
                        onClick={detectLocation}
                        disabled={locating}
                        className="rounded-sm px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-surface-400 hover:text-surface-100 disabled:opacity-60"
                      >
                        {locating ? "Locating…" : "Locate"}
                      </button>
                    }
                  />

                  {loadingWeather ? (
                    <div className="flex h-28 items-center justify-center text-surface-500">
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      <span className="text-xs">Updating weather forecast…</span>
                    </div>
                  ) : errorWeather ? (
                    <div className="flex h-28 flex-col items-center justify-center gap-1 text-center text-xs text-emergency-400">
                      <span>{errorWeather}</span>
                    </div>
                  ) : weather ? (
                    <div className="space-y-3">
                      {/* Warning banner — official IMD/SDMA alert when one
                          covers the nearest district, else the derived band */}
                      {officialWeatherAlert ? (
                        <div
                          className={`rounded-sm border px-2.5 py-1.5 text-[11px] ${
                            WEATHER_ALERT_STYLES[officialWeatherAlert.severity] ??
                            WEATHER_ALERT_STYLES.yellow
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold uppercase tracking-wide">
                              {officialWeatherAlert.source} · {officialWeatherAlert.event}
                            </span>
                            <span className="source-chip flex-shrink-0">Official</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug opacity-90">
                            {officialWeatherAlert.message}
                          </p>
                        </div>
                      ) : (
                        <div
                          className={`flex items-center justify-between rounded-sm border px-2.5 py-1.5 text-[11px] ${
                            WEATHER_ALERT_STYLES[weather.current.alertLevel] ?? WEATHER_ALERT_STYLES.green
                          }`}
                        >
                          <span className="font-bold">{weather.current.alertLabel}</span>
                          <span className="source-chip flex-shrink-0">Derived</span>
                        </div>
                      )}

                      {/* Info grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-sm border border-surface-800 bg-surface-850/50 p-2.5">
                          <span className="block text-[9px] font-bold uppercase text-surface-500">Rainfall</span>
                          <span className="font-mono text-sm font-bold tabular-nums text-surface-100">
                            {weather.current.rain.toFixed(1)}{" "}
                            <span className="text-[10px] font-normal text-surface-500">mm/h</span>
                          </span>
                        </div>
                        <div className="rounded-sm border border-surface-800 bg-surface-850/50 p-2.5">
                          <span className="block text-[9px] font-bold uppercase text-surface-500">Temp</span>
                          <span className="font-mono text-sm font-bold tabular-nums text-surface-100">
                            {weather.current.temperature.toFixed(1)}°C
                          </span>
                        </div>
                      </div>

                      {/* Sparkline chart */}
                      <div className="space-y-2">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-surface-500">
                          Next 24h Rain
                        </span>
                        <div className="flex h-14 items-end justify-between border-b border-surface-800 pb-0.5 pt-1.5">
                          {weather.sparkline.map((s, i) => {
                            const heightPct = Math.min(100, Math.max(5, (s.rain / sparklineMax) * 100));
                            return (
                              <div key={i} className="group relative flex flex-1 flex-col items-center">
                                <div className="pointer-events-none absolute bottom-full z-50 mb-1 scale-0 whitespace-nowrap rounded-sm border border-surface-700 bg-surface-950 px-1.5 py-0.5 font-mono text-[9px] font-bold text-surface-100 transition-all group-hover:scale-100">
                                  {s.time}: {s.rain.toFixed(1)} mm
                                </div>
                                <div
                                  style={{ height: `${heightPct}%` }}
                                  className={`w-[60%] rounded-t-sm transition-all duration-300 ${
                                    s.rain > 10
                                      ? "bg-emergency-500"
                                      : s.rain > 2
                                      ? "bg-warning-500"
                                      : "bg-surface-500"
                                  }`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 5-day list */}
                      <div className="space-y-1.5">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-surface-500">
                          5-Day Outlook
                        </span>
                        <div className="grid grid-cols-5 gap-1">
                          {weather.forecast.map((f, i) => (
                            <div
                              key={i}
                              className="flex h-12 flex-col justify-between rounded-sm border border-surface-800 bg-surface-850/40 p-1 text-center"
                            >
                              <span className="block text-[8px] font-bold text-surface-400">{f.day.split(",")[0]}</span>
                              <span className="block font-mono text-[9px] font-bold tabular-nums text-surface-200">
                                {f.rainSum.toFixed(0)}mm
                              </span>
                              <span
                                className={`block h-1 w-full rounded-sm ${
                                  f.alert === "red"
                                    ? "bg-emergency-500"
                                    : f.alert === "orange" || f.alert === "yellow"
                                    ? "bg-warning-500"
                                    : "bg-surface-700"
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* River telemetry list */}
                <div className="space-y-2">
                  <PanelHeader title="River Gauges" chip="MODEL" syncedAt={syncedAt.rivers} />

                  {loadingRivers ? (
                    <div className="flex h-36 items-center justify-center text-surface-500">
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      <span className="text-xs">Updating water telemetry…</span>
                    </div>
                  ) : errorRivers ? (
                    <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                      <span>{errorRivers}</span>
                    </div>
                  ) : rivers ? (
                    <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                      {filteredRivers.length === 0 ? (
                        <div className="rounded-lg border border-surface-800 py-8 text-center text-xs text-surface-500">
                          No monitored rivers in this district
                        </div>
                      ) : (
                        filteredRivers.map((st) => {
                          const pct = Math.min(100, (st.discharge / st.dangerLevel) * 100);

                          // A gauge we could not read is not a gauge reading 0.
                          if (!st.available) {
                            return (
                              <div key={st.id} className="card-glass space-y-1 p-3 opacity-60">
                                <div className="flex items-start justify-between">
                                  <div>
                                    <span className="text-[11px] font-bold text-surface-100">{st.river}</span>
                                    <span className="block text-[9px] font-semibold text-surface-500">{st.name}</span>
                                  </div>
                                  <StatusChip classes="text-surface-500 border-surface-700">No data</StatusChip>
                                </div>
                                <p className="text-[9px] font-semibold text-surface-500">
                                  Gauge feed unreachable — discharge unknown
                                </p>
                              </div>
                            );
                          }

                          const c = riverStatusClasses(st.status);
                          return (
                            <div key={st.id} className="card-glass space-y-2 p-3 transition duration-150 hover:border-surface-700">
                              <div className="flex items-start justify-between">
                                <div>
                                  <span className="text-[11px] font-bold text-surface-100">{st.river}</span>
                                  <span className="block text-[9px] font-semibold text-surface-500">{st.name}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {st.officialAlert && <span className="source-chip">Official</span>}
                                  <TrendGlyph trend={st.trend} />
                                  <StatusChip classes={c.text}>{st.status}</StatusChip>
                                </div>
                              </div>

                              {/* Bar */}
                              <div className="space-y-1">
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-850">
                                  <div style={{ width: `${pct}%` }} className={`h-full rounded-full ${c.bg}`} />
                                </div>
                                <div className="flex justify-between font-mono text-[9px] text-surface-400">
                                  <span>{st.discharge.toFixed(1)} m³/s</span>
                                  <span>danger {st.dangerLevel} m³/s</span>
                                </div>
                              </div>

                              {/* Active official flood alert for this river */}
                              {st.officialAlert && (
                                <p className="text-[9px] leading-snug text-surface-400">
                                  <span
                                    className={`font-bold uppercase tracking-wider ${
                                      st.officialAlert.severity === "yellow"
                                        ? "text-warning-400"
                                        : "text-emergency-400"
                                    }`}
                                  >
                                    {st.officialAlert.source}:
                                  </span>{" "}
                                  {st.officialAlert.message}
                                </p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : sidebarTab === "dams" ? (
              /* Dam Levels Tab Render */
              <div className="space-y-3">
                <PanelHeader
                  title="Reservoir Matrix"
                  chip={dams && dams.officialCount > 0 ? "KSDMA" : "EST"}
                  syncedAt={syncedAt.dams}
                />

                {/* Bulletin provenance line for official readings */}
                {dams && dams.officialCount > 0 && (
                  <p className="font-mono text-[9px] uppercase tracking-wider text-surface-500">
                    {dams.officialCount} gauges · official KSDMA bulletin
                    {dams.officialDate ? ` · ${dams.officialDate}` : ""}
                  </p>
                )}

                {/* Dams absent from today's bulletin are rainfall-modelled.
                    Saying so is not optional on a dashboard people may
                    evacuate on. */}
                {dams?.estimated && (
                  <div className="rounded-sm border border-warning-600/40 bg-warning-950/20 px-2.5 py-2 text-[10px] leading-relaxed text-warning-300">
                    <strong className="font-bold">
                      {dams.officialCount > 0
                        ? "Dams marked EST are estimates."
                        : "Estimated, not official."}
                    </strong>{" "}
                    {dams.officialCount > 0
                      ? "They are missing from today's official bulletin, so their levels are modelled from catchment rainfall."
                      : "The official KSDMA bulletin is unreachable; levels are modelled from catchment rainfall."}{" "}
                    Always confirm with KSEB / the Irrigation Department before acting.
                  </div>
                )}

                {loadingDams ? (
                  <div className="flex h-36 items-center justify-center text-surface-500">
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    <span className="text-xs">Updating reservoir telemetry…</span>
                  </div>
                ) : errorDams ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                    <span>{errorDams}</span>
                  </div>
                ) : dams ? (
                  <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                    {filteredDams.length === 0 ? (
                      <div className="rounded-lg border border-surface-800 py-8 text-center text-xs text-surface-500">
                        No monitored reservoirs in this district
                      </div>
                    ) : (
                      filteredDams.map((dam) => {
                        // Never render 0% as though it were a real reading.
                        if (!dam.available) {
                          return (
                            <div key={dam.id} className="card-glass space-y-1 p-3 opacity-60">
                              <div className="flex items-start justify-between">
                                <div>
                                  <span className="text-[11px] font-bold text-surface-100">{dam.name}</span>
                                  <span className="block text-[9px] font-semibold text-surface-500">{dam.river}</span>
                                </div>
                                <StatusChip classes="text-surface-500 border-surface-700">No data</StatusChip>
                              </div>
                              <p className="text-[9px] font-semibold text-surface-500">
                                Catchment feed unreachable — level unknown
                              </p>
                            </div>
                          );
                        }

                        const c = damStatusClasses(dam.alertColor);
                        return (
                          <div key={dam.id} className="card-glass space-y-2 p-3 transition duration-150 hover:border-surface-700">
                            <div className="flex items-start justify-between">
                              <div>
                                <span className="text-[11px] font-bold text-surface-100">{dam.name}</span>
                                <span className="block text-[9px] font-semibold text-surface-500">
                                  {dam.river} · {dam.district}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="source-chip">
                                  {dam.source === "KSDMA" ? "KSDMA" : "EST"}
                                </span>
                                {dam.source === "estimated" && <TrendGlyph trend={dam.trend} />}
                                <StatusChip classes={c.text}>{dam.shutterStatus}</StatusChip>
                              </div>
                            </div>

                            {/* Capacity bar */}
                            <div className="space-y-1">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-850">
                                <div style={{ width: `${dam.capacityPct}%` }} className={`h-full rounded-full ${c.bg}`} />
                              </div>
                              <div className="flex justify-between font-mono text-[9px] text-surface-400">
                                <span>
                                  {dam.currentLevel.toFixed(1)} / {dam.frl} {dam.unit}
                                </span>
                                <span>{dam.capacityPct.toFixed(1)}%</span>
                              </div>
                            </div>

                            {/* Official bulletin remarks (shutter positions etc.) */}
                            {dam.remarks && (
                              <p className="text-[9px] leading-snug text-surface-500">
                                {dam.remarks}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            ) : sidebarTab === "news" ? (
              /* News Tab Render */
              <div className="space-y-3">
                <PanelHeader title="Media Updates" chip="RSS" syncedAt={syncedAt.news} />

                {loadingNews ? (
                  <div className="flex h-36 items-center justify-center text-surface-500">
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    <span className="text-xs">Updating news feed…</span>
                  </div>
                ) : errorNews ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                    <span>{errorNews}</span>
                  </div>
                ) : news && news.news.length === 0 ? (
                  <div className="rounded-lg border border-surface-800 py-8 text-center text-xs text-surface-500">
                    No live media updates available right now
                  </div>
                ) : news ? (
                  <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                    {news.news.map((item, i) => {
                      const relativeTime = formatRelativeTime(item.pubDate);
                      return (
                        <a
                          key={i}
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block card-glass space-y-2 p-3.5 transition duration-150 hover:border-surface-700"
                        >
                          <span className="block text-[11px] font-bold leading-snug text-surface-200 transition group-hover:text-surface-50">
                            {item.title}
                          </span>
                          <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-surface-500">
                            <span>{item.source}</span>
                            <span>{relativeTime}</span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              /* Emergency Feeds Tab Render */
              <div className="flex flex-1 flex-col gap-4">
                {/* SOS Requests list feed */}
                <div ref={sosFeedRef} id="sos-feed" className="scroll-mt-20 space-y-3">
                  <PanelHeader
                    title={`SOS Feed (${filteredSos.length})`}
                    chip="LIVE"
                    syncedAt={syncedAt.incidents}
                  />
                  <div className="max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
                    {loading ? (
                      Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
                    ) : errorIncidents ? (
                      /* Never fall through to the empty state on failure — an
                         empty rescue queue must mean nobody is waiting. */
                      <FeedError message={errorIncidents} onRetry={() => fetchAll()} />
                    ) : filteredSos.length === 0 ? (
                      <EmptyState message="No matching SOS requests." />
                    ) : (
                      filteredSos.map((sos) => (
                        <SosCard
                          key={sos.id}
                          sos={sos}
                          onResolve={handleResolveSos}
                          highlighted={sos.id === highlightSosId}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Flood Reports list feed */}
                <div className="space-y-3 border-t border-surface-800 pt-4">
                  <PanelHeader
                    title={`Flood Reports (${filteredReports.length})`}
                    chip="LIVE"
                    syncedAt={syncedAt.incidents}
                  />
                  <div className="max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
                    {loading ? (
                      Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
                    ) : errorIncidents ? (
                      <FeedError message={errorIncidents} onRetry={() => fetchAll()} />
                    ) : filteredReports.length === 0 ? (
                      <EmptyState message="No matching flood reports." />
                    ) : (
                      filteredReports.map((report) => (
                        <FloodReportCard key={report.id} report={report} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-surface-800 pt-4 text-center text-[11px] text-surface-600">
          Kerala Emergency Management &copy; {new Date().getFullYear()} — Real-time public
          emergency platform · Map data ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            className="underline hover:text-surface-400"
          >
            OpenStreetMap
          </a>{" "}
          contributors
        </footer>
      </main>

      {/* One floating action, and it is the SOS.
          Flood reporting lives on the modal's second tab — a separate FAB only
          competed for the tap that matters and, on a 375px screen, crowded the
          one control someone in danger is reaching for. */}
      <button
        id="fab-report"
        onClick={() => openReportModal("sos")}
        aria-label="Send an SOS — request rescue"
        /* Hidden while the mobile drawer is open — the drawer is modal (it has
           a dismiss backdrop), so a button floating over it just obscured the
           rescue queue. On lg the drawer is a static column, so it stays. */
        className={`fixed bottom-5 right-4 z-[999] max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md bg-emergency-600 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-black/50 transition-transform hover:bg-emergency-500 active:scale-95 sm:bottom-8 sm:right-8 sm:px-6 sm:py-3.5 sm:text-base ${
          sidebarOpen ? "hidden lg:flex" : "flex"
        }`}
      >
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        <span className="truncate">SOS — Need Help</span>
      </button>

      {/* Incident reporting modal */}
      <ReportModal
        open={modalOpen}
        initialTab={modalTab}
        onClose={() => setModalOpen(false)}
        onFloodReportCreated={handleFloodCreated}
        onSosCreated={handleSosCreated}
      />
    </>
  );
}
