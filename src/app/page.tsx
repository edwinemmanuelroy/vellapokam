"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { FloodReport, SosRequest } from "@/types/database";
import DynamicMap from "@/components/Map/DynamicMap";
import ReportModal from "@/components/ReportModal/ReportModal";
import GovtAlertsTicker from "@/components/GovtAlertsTicker/GovtAlertsTicker";
import {
  AlertTriangle,
  Droplets,
  LifeBuoy,
  Users,
  Phone,
  MapPin,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Waves,
  Eye,
  CheckCircle2,
  Plus,
  Filter,
  Maximize2,
  Minimize2,
  Menu,
  X,
  ListFilter,
  Compass,
  CloudRain,
  TrendingUp,
  TrendingDown,
  Loader2,
  Navigation,
  Layers,
  Newspaper,
} from "lucide-react";

/* ── Hydromet TS Types ──────────────────────────────────────────────────── */
interface SparklineItem {
  time: string;
  rain: number;
}

interface ForecastItem {
  day: string;
  rainSum: number;
  alert: string;
  label: string;
}

interface WeatherResponse {
  success: boolean;
  current: {
    rain: number;
    temperature: number;
    alertLevel: "green" | "yellow" | "orange" | "red";
    alertLabel: string;
  };
  sparkline: SparklineItem[];
  forecast: ForecastItem[];
}

interface RiverStation {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  dangerLevel: number;
  discharge: number;
  trend: "rising" | "falling" | "steady";
  status: "normal" | "warning" | "danger";
  updatedAt: string;
}

interface RiverResponse {
  success: boolean;
  stations: RiverStation[];
}

interface DamStation {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  frl: number;
  unit: string;
  dangerLevel: number;
  currentLevel: number;
  capacityPct: number;
  status: "normal" | "alert" | "spill";
  alertColor: "green" | "blue" | "orange" | "red";
  shutterStatus: string;
  trend: "rising" | "falling" | "steady";
  catchmentRain24h: number;
  updatedAt: string;
}

interface DamResponse {
  success: boolean;
  dams: DamStation[];
}

interface NewsItem {
  title: string;
  source: string;
  link: string;
  pubDate: string;
}

interface NewsResponse {
  success: boolean;
  news: NewsItem[];
}

/* ── Distance helper for geographical filtering ──────────────────────────── */
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const DISTRICTS = [
  { name: "Alappuzha", lat: 9.4981, lng: 76.3388 },
  { name: "Ernakulam", lat: 9.9816, lng: 76.2998 },
  { name: "Idukki", lat: 9.8500, lng: 77.1000 },
  { name: "Kannur", lat: 11.8745, lng: 75.3704 },
  { name: "Kasaragod", lat: 12.5103, lng: 74.9852 },
  { name: "Kollam", lat: 8.8932, lng: 76.6141 },
  { name: "Kottayam", lat: 9.5916, lng: 76.5224 },
  { name: "Kozhikode", lat: 11.2588, lng: 75.7804 },
  { name: "Malappuram", lat: 11.0735, lng: 76.0740 },
  { name: "Palakkad", lat: 10.7867, lng: 76.6547 },
  { name: "Pathanamthitta", lat: 9.2648, lng: 76.7870 },
  { name: "Thiruvananthapuram", lat: 8.5241, lng: 76.9366 },
  { name: "Thrissur", lat: 10.5276, lng: 76.2144 },
  { name: "Wayanad", lat: 11.6854, lng: 76.1320 },
];

const DAM_DISTRICTS: Record<string, string[]> = {
  idukki: ["Idukki"],
  mullaperiyar: ["Idukki"],
  idamalayar: ["Ernakulam"],
  banasurasagar: ["Wayanad"],
  malampuzha: ["Palakkad"],
  neyyar: ["Thiruvananthapuram"],
  peechi: ["Thrissur"],
  kakki: ["Pathanamthitta"],
  peringalkuthu: ["Thrissur"],
  sholayar: ["Thrissur"],
  kanjirapuzha: ["Palakkad"],
  walayar: ["Palakkad"],
  thumboormuzhi: ["Thrissur"],
  neyyar_weir: ["Thiruvananthapuram"],
};

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

const LEVEL_META: Record<
  string,
  { label: string; color: string; bg: string; pct: string }
> = {
  ankle: { label: "Ankle", color: "text-blue-400", bg: "bg-blue-400", pct: "w-1/4" },
  knee: { label: "Knee", color: "text-blue-500", bg: "bg-blue-500", pct: "w-2/4" },
  waist: { label: "Waist", color: "text-warning-500", bg: "bg-warning-500", pct: "w-3/4" },
  roof: { label: "Roof", color: "text-emergency-500", bg: "bg-emergency-500", pct: "w-full" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent = "text-surface-300",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-surface-400">
          {label}
        </span>
      </div>
      <span className={`text-xl font-black tracking-tight tabular-nums ${accent}`}>
        {value}
      </span>
    </div>
  );
}

function FloodReportCard({ report }: { report: FloodReport }) {
  const meta = LEVEL_META[report.water_level] ?? LEVEL_META.ankle;
  const timeAgo = formatRelativeTime(report.created_at);

  return (
    <div className="card-glass animate-slide-up p-4 hover:border-surface-600/60 transition duration-200">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Waves className={`h-4 w-4 ${meta.color}`} />
          <span className={`text-xs font-bold ${meta.color}`}>
            {meta.label} Level
          </span>
        </div>
        <div>
          {report.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-2.5 w-2.5" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-700/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-surface-400 ring-1 ring-surface-600/30">
              <Eye className="h-2.5 w-2.5" /> Unverified
            </span>
          )}
        </div>
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
          className="mb-2.5 h-24 w-full rounded-lg border border-surface-700 object-cover"
        />
      )}

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-surface-500 font-semibold">
        <span className="inline-flex items-center gap-0.5">
          <MapPin className="h-2.5 w-2.5" />
          {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
        </span>
        <span className="inline-flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          {timeAgo}
        </span>
      </div>
    </div>
  );
}

function SosCard({ sos, onResolve }: { sos: SosRequest; onResolve?: (id: string) => void }) {
  const isPending = sos.status === "pending";
  const timeAgo = formatRelativeTime(sos.created_at);
  const [resolving, setResolving] = useState(false);

  const handleResolveClick = async () => {
    setResolving(true);
    try {
      const { error } = await supabase
        .from("sos_requests")
        .update({ status: "rescued" })
        .eq("id", sos.id);
      if (error) {
        alert("Failed to mark as rescued: " + error.message);
      } else if (onResolve) {
        onResolve(sos.id);
      }
    } catch {
      alert("An error occurred while updating status");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div
      className={`card-glass animate-slide-up relative overflow-hidden p-4 hover:border-surface-600/60 transition duration-200 ${
        isPending ? "border-emergency-700/30" : "opacity-70"
      }`}
    >
      {isPending && (
        <div className="absolute inset-y-0 left-0 w-1 animate-pulse-emergency bg-emergency-500" />
      )}

      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isPending ? (
            <ShieldAlert className="h-4.5 w-4.5 text-emergency-400 animate-beacon rounded-full" />
          ) : (
            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
          )}
          <span className="text-xs font-bold text-surface-100">{sos.name}</span>
        </div>
        {isPending ? (
          <span className="badge-sos">SOS</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/30">
            Rescued
          </span>
        )}
      </div>

      <div className="mb-2.5 grid grid-cols-2 gap-2 text-[11px] text-surface-300 font-semibold">
        <span className="inline-flex items-center gap-1">
          <Phone className="h-3 w-3 text-surface-500" />
          {sos.phone}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3 text-surface-500" />
          {sos.people_count} {sos.people_count === 1 ? "person" : "people"}
        </span>
      </div>

      {sos.needs.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {sos.needs.map((need) => (
            <span
              key={need}
              className="rounded bg-surface-850 px-2 py-0.5 text-[9px] font-bold text-surface-300 border border-surface-800"
            >
              {need}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-surface-500 font-semibold">
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="h-2.5 w-2.5" />
            {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {timeAgo}
          </span>
        </div>

        {isPending && (
          <button
            onClick={handleResolveClick}
            disabled={resolving}
            className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-600/10 px-2.5 py-1 text-[10px] text-emerald-400 font-bold hover:bg-emerald-600/25 disabled:opacity-50 transition"
          >
            {resolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Rescued
          </button>
        )}
      </div>
    </div>
  );
}

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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-surface-800 py-10 text-center">
      <Activity className="h-6 w-6 text-surface-600" />
      <p className="text-xs text-surface-500">{message}</p>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
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

export default function DashboardPage() {
  /* ── State ────────────────────────────────────────────────────────────── */
  const [reports, setReports] = useState<FloodReport[]>([]);
  const [sosRequests, setSosRequests] = useState<SosRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  /* ── Layout & Responsive States ───────────────────────────────────────── */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreenMap, setIsFullscreenMap] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"hydromet" | "dams" | "feeds" | "news">("hydromet");

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
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [loadingRivers, setLoadingRivers] = useState(true);
  const [loadingDams, setLoadingDams] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);
  const [errorWeather, setErrorWeather] = useState<string | null>(null);
  const [errorRivers, setErrorRivers] = useState<string | null>(null);
  const [errorDams, setErrorDams] = useState<string | null>(null);
  const [errorNews, setErrorNews] = useState<string | null>(null);

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
  const fetchWeather = useCallback(async (latitude: number, longitude: number) => {
    setLoadingWeather(true);
    setErrorWeather(null);
    try {
      const res = await fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}`);
      if (!res.ok) throw new Error("Failed to fetch weather data");
      const data = await res.json();
      if (data.success) {
        setWeather(data);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load weather";
      setErrorWeather(msg);
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  const fetchRivers = useCallback(async () => {
    setLoadingRivers(true);
    setErrorRivers(null);
    try {
      const res = await fetch("/api/river-discharge");
      if (!res.ok) throw new Error("Failed to fetch river levels");
      const data = await res.json();
      if (data.success) {
        setRivers(data);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load river status";
      setErrorRivers(msg);
    } finally {
      setLoadingRivers(false);
    }
  }, []);

  const fetchDams = useCallback(async () => {
    setLoadingDams(true);
    setErrorDams(null);
    try {
      const res = await fetch("/api/dams");
      if (!res.ok) throw new Error("Failed to fetch dam levels");
      const data = await res.json();
      if (data.success) {
        setDams(data);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load dam levels";
      setErrorDams(msg);
    } finally {
      setLoadingDams(false);
    }
  }, []);

  const fetchNews = useCallback(async () => {
    setLoadingNews(true);
    setErrorNews(null);
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news feed");
      const data = await res.json();
      if (data.success) {
        setNews(data);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load news";
      setErrorNews(msg);
    } finally {
      setLoadingNews(false);
    }
  }, []);

  /* ── Fetching Supabase Incident Data ──────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: rData }, { data: sData }] = await Promise.all([
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
    if (rData) setReports(rData);
    if (sData) setSosRequests(sData);
    setLoading(false);
  }, []);

  /* ── Setup triggers on load ───────────────────────────────────────────── */
  useEffect(() => {
    detectLocation();
    fetchRivers();
    fetchDams();
    fetchNews();
  }, [detectLocation, fetchRivers, fetchDams, fetchNews]);

  useEffect(() => {
    fetchWeather(coords.lat, coords.lng);
  }, [coords, fetchWeather]);

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
            setSosRequests((prev) => {
              if (prev.some((s) => s.id === (payload.new as SosRequest).id)) return prev;
              return [payload.new as SosRequest, ...prev];
            });
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
  }, [fetchAll]);

  /* ── Optimistic additions ─────────────────────────────────────────────── */
  const handleFloodCreated = useCallback((report: FloodReport) => {
    setReports((prev) => [report, ...prev]);
  }, []);

  const handleSosCreated = useCallback((sos: SosRequest) => {
    setSosRequests((prev) => [sos, ...prev]);
  }, []);

  const handleResolveSos = useCallback((id: string) => {
    setSosRequests((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "rescued" as const } : s))
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
    return list;
  }, [sosRequests, districtFilter, geoLocated, coords]);

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
      list = list.filter((dam) => {
        const dists = DAM_DISTRICTS[dam.id] || [];
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
  }, [dams, districtFilter, geoLocated, coords]);

  /* ── Derived Stats ────────────────────────────────────────────────────── */
  const pendingSosCount = filteredSos.filter((s) => s.status === "pending").length;
  const totalPeopleWaiting = filteredSos
    .filter((s) => s.status === "pending")
    .reduce((sum, s) => sum + s.people_count, 0);
  const activeReportsCount = filteredReports.length;
  const rescuedCount = filteredSos.filter((s) => s.status === "rescued").length;

  const hasCriticalReport = filteredReports.some(
    (r) => r.water_level === "waist" || r.water_level === "roof"
  );

  const alertColors: Record<string, string> = {
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    green: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };

  return (
    <>
      <main className="mx-auto max-w-[1536px] px-4 py-4 sm:px-6 lg:px-8 space-y-4">
        {/* ── Page Header & Action Controls ──────────────────────────────── */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-surface-800 pb-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-surface-50 md:text-2xl">
              <AlertTriangle className="h-6 w-6 text-emergency-500 animate-pulse" />
              Kerala Flood Dashboard
            </h1>
            <p className="text-xs text-surface-400">
              Disaster Monitoring &amp; SOS Coordination Platform
            </p>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 rounded-full bg-surface-900 border border-surface-850 px-3 py-1 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-400 animate-pulse" : "bg-surface-600"
                }`}
              />
              <span className="text-surface-300 font-bold uppercase tracking-wider text-[10px]">
                {connected ? "Real-time Live" : "Offline"}
              </span>
            </div>

            {/* Mobile Sidebar Trigger */}
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="lg:hidden flex items-center justify-center p-2 rounded-lg border border-surface-700 bg-surface-900 text-surface-200 transition hover:bg-surface-850"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ── Emergency Alerts Banner Ticker ──────────────────────────────── */}
        <GovtAlertsTicker />

        {/* ── Critical Alerts ─────────────────────────────────────────────── */}
        {hasCriticalReport && (
          <div className="flex items-center gap-3 rounded-lg border border-emergency-700/50 bg-emergency-950/60 px-4 py-3 text-sm text-emergency-300 backdrop-blur-sm">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-emergency-400 animate-pulse" />
            <span>
              <strong className="text-emergency-200">Attention:</strong> Critical flooding (waist or roof level) detected in filtered coordinates. Rescue operations are prioritized here.
            </span>
          </div>
        )}

        {/* ── Stats Summary Panels ────────────────────────────────────────── */}
        <section id="stats-overview" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            icon={LifeBuoy}
            label="Active SOS Requests"
            value={pendingSosCount}
            accent="text-emergency-400"
          />
          <StatCard
            icon={Users}
            label="Trapped Individuals"
            value={totalPeopleWaiting}
            accent="text-warning-400"
          />
          <StatCard
            icon={Droplets}
            label="Filtered Flood Reports"
            value={activeReportsCount}
            accent="text-blue-400"
          />
          <StatCard
            icon={ShieldCheck}
            label="Rescues Completed"
            value={rescuedCount}
            accent="text-emerald-400"
          />
        </section>

        {/* ── Filter Selection Bar ────────────────────────────────────────── */}
        <section className="card-glass p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-surface-400 font-bold uppercase tracking-wider text-[10px]">
              <Filter className="h-3.5 w-3.5" />
              Quick Filters:
            </div>

            {/* District dropdown */}
            <div className="flex items-center gap-1.5">
              <ListFilter className="h-3.5 w-3.5 text-surface-500" />
              <select
                value={districtFilter}
                onChange={(e) => {
                  setDistrictFilter(e.target.value);
                  setGeoLocated(false);
                  const matched = DISTRICTS.find((d) => d.name === e.target.value);
                  if (matched) setCoords({ lat: matched.lat, lng: matched.lng });
                }}
                className="rounded-lg border border-surface-700 bg-surface-850 px-2 py-1.5 text-xs text-surface-200 outline-none focus:border-blue-500"
              >
                <option value="all">All Districts</option>
                {DISTRICTS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Locate Me button */}
            <button
              onClick={detectLocation}
              disabled={locating}
              className="flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-blue-400 font-bold hover:bg-surface-800 hover:text-blue-300 disabled:opacity-60 transition"
            >
              <Navigation className={`h-3.5 w-3.5 ${locating ? "animate-spin" : ""}`} />
              {locating ? "Locating..." : geoLocated ? "Located (GPS)" : "Detect Location"}
            </button>

            {/* Location status badge */}
            {geoLocated && districtFilter === "all" && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/30">
                Nearest First Active
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
              className="text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest"
            >
              Reset Location
            </button>
          )}
        </section>

        {/* ── Main Layout Workspace ────────────────────────────────────────── */}
        <div className="relative flex items-stretch gap-4 min-h-[500px]">
          {/* 1. Map Area Column */}
          <div className="flex-1 flex flex-col gap-4 relative">
            <div className="relative flex-1 min-h-[450px] lg:min-h-[560px]">
              {/* Map maximize control */}
              <button
                onClick={() => setIsFullscreenMap((prev) => !prev)}
                className="absolute top-4 right-4 z-[999] flex h-9 w-9 items-center justify-center rounded-lg border border-surface-700 bg-surface-900/90 text-surface-300 hover:text-white transition shadow-lg"
                title={isFullscreenMap ? "Exit Fullscreen" : "Maximize Map"}
              >
                {isFullscreenMap ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>

              <DynamicMap reports={filteredReports} sosRequests={filteredSos} />
            </div>

            {/* In-Map Feed (Only visible when map is maximized/fullscreen) */}
            {isFullscreenMap && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* SOS lists */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <LifeBuoy className="h-4 w-4 text-emergency-400" /> Active SOS List
                  </h3>
                  <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
                    {filteredSos.length === 0 ? (
                      <EmptyState message="No SOS alerts match the current filter criteria." />
                    ) : (
                      filteredSos.map((s) => <SosCard key={s.id} sos={s} onResolve={handleResolveSos} />)
                    )}
                  </div>
                </div>

                {/* Flood Reports lists */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <Droplets className="h-4 w-4 text-blue-400" /> Active Reports List
                  </h3>
                  <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
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
              className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside
            className={`fixed top-0 bottom-0 right-0 z-50 w-[340px] border-l border-surface-800 bg-surface-950 p-4 transition-transform duration-300 lg:static lg:z-0 lg:w-[380px] lg:border-l-0 lg:bg-transparent lg:p-0 lg:transition-none flex flex-col gap-4 overflow-y-auto ${
              sidebarOpen ? "translate-x-0" : "translate-x-full lg:hidden"
            } ${isFullscreenMap ? "hidden" : ""}`}
          >
            {/* Mobile close sidebar panel */}
            <div className="flex lg:hidden items-center justify-between border-b border-surface-800 pb-2.5">
              <span className="text-sm font-extrabold text-surface-50 uppercase tracking-wider">
                Monitoring Panel
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded bg-surface-850 text-surface-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sidebar Tab Switcher */}
            <div className="flex rounded-lg bg-surface-900 p-1 border border-surface-800">
              <button
                onClick={() => setSidebarTab("hydromet")}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded-md transition flex items-center justify-center gap-0.5 ${
                  sidebarTab === "hydromet"
                    ? "bg-surface-800 text-surface-50 shadow"
                    : "text-surface-400 hover:text-surface-200"
                }`}
              >
                <Compass className="h-3 w-3 text-blue-400" />
                Weather
              </button>
              <button
                onClick={() => setSidebarTab("dams")}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded-md transition flex items-center justify-center gap-0.5 ${
                  sidebarTab === "dams"
                    ? "bg-surface-800 text-surface-50 shadow"
                    : "text-surface-400 hover:text-surface-200"
                }`}
              >
                <Layers className="h-3 w-3 text-orange-400" />
                Dams
              </button>
              <button
                onClick={() => setSidebarTab("feeds")}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded-md transition flex items-center justify-center gap-0.5 ${
                  sidebarTab === "feeds"
                    ? "bg-surface-800 text-surface-50 shadow"
                    : "text-surface-400 hover:text-surface-200"
                }`}
              >
                <AlertTriangle className="h-3 w-3 text-emergency-400" />
                Feeds
              </button>
              <button
                onClick={() => setSidebarTab("news")}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded-md transition flex items-center justify-center gap-0.5 ${
                  sidebarTab === "news"
                    ? "bg-surface-800 text-surface-50 shadow"
                    : "text-surface-400 hover:text-surface-200"
                }`}
              >
                <Newspaper className="h-3 w-3 text-emerald-400" />
                News
              </button>
            </div>

            {/* Hydromet Tab Render */}
            {sidebarTab === "hydromet" ? (
              <div className="space-y-4">
                {/* Geolocation Weather & Sparkline */}
                <div className="card-glass p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                      <CloudRain className="h-4 w-4 text-blue-400" />
                      Live Rain Monitor
                    </h3>
                    <button
                      onClick={detectLocation}
                      disabled={locating}
                      className="flex items-center gap-1 text-[9px] font-bold text-blue-400 hover:text-blue-300 uppercase disabled:opacity-60"
                    >
                      <Navigation className={`h-2.5 w-2.5 ${locating ? "animate-spin" : ""}`} />
                      {locating ? "Locating..." : "Locate"}
                    </button>
                  </div>

                  {loadingWeather ? (
                    <div className="flex h-28 items-center justify-center text-surface-500">
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      <span className="text-xs">Updating weather forecast...</span>
                    </div>
                  ) : errorWeather ? (
                    <div className="flex h-28 flex-col items-center justify-center gap-1 text-center text-xs text-emergency-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{errorWeather}</span>
                    </div>
                  ) : weather ? (
                    <div className="space-y-3">
                      {/* Warning Banner */}
                      <div className={`rounded-md border px-2.5 py-1.5 text-[11px] flex items-center justify-between ${alertColors[weather.current.alertLevel]}`}>
                        <span className="font-bold">{weather.current.alertLabel}</span>
                        <span className="opacity-80 flex items-center gap-0.5 text-[9px]">
                          <MapPin className="h-2.5 w-2.5" />
                          {coords.lat.toFixed(2)}, {coords.lng.toFixed(2)}
                        </span>
                      </div>

                      {/* Info grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-surface-850/50 p-2.5 border border-surface-800">
                          <span className="block text-[9px] text-surface-500 uppercase font-bold">Rainfall</span>
                          <span className="text-sm font-extrabold text-surface-150 tabular-nums">
                            {weather.current.rain.toFixed(1)} <span className="text-[10px] font-normal">mm/h</span>
                          </span>
                        </div>
                        <div className="rounded-lg bg-surface-850/50 p-2.5 border border-surface-800">
                          <span className="block text-[9px] text-surface-500 uppercase font-bold">Temperature</span>
                          <span className="text-sm font-extrabold text-surface-150 tabular-nums">
                            {weather.current.temperature.toFixed(1)}°C
                          </span>
                        </div>
                      </div>

                      {/* Sparkline chart */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-surface-400">
                          <span>Next 24 Hours Rain Outlook</span>
                        </div>
                        <div className="flex items-end justify-between h-14 pt-1.5 border-b border-surface-800 pb-0.5">
                          {weather.sparkline.map((s, i) => {
                            const maxRain = Math.max(...weather.sparkline.map((sp) => sp.rain), 1);
                            const heightPct = Math.min(100, Math.max(5, (s.rain / maxRain) * 100));
                            return (
                              <div key={i} className="flex-1 group relative flex flex-col items-center">
                                <div className="absolute bottom-full mb-1 scale-0 group-hover:scale-100 transition-all rounded bg-surface-950 border border-surface-700 px-1.5 py-0.5 text-[9px] font-bold text-white z-50 whitespace-nowrap pointer-events-none">
                                  {s.time}: {s.rain.toFixed(1)} mm
                                </div>
                                <div
                                  style={{ height: `${heightPct}%` }}
                                  className={`w-[60%] rounded-t-xs transition-all duration-300 ${
                                    s.rain > 10 ? "bg-red-500" : s.rain > 2 ? "bg-warning-500" : "bg-blue-500"
                                  }`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 5-day list */}
                      <div className="space-y-1.5">
                        <span className="block text-[9px] font-bold text-surface-450 uppercase tracking-widest">5-Day Precipitation Summary</span>
                        <div className="grid grid-cols-5 gap-1">
                          {weather.forecast.map((f, i) => (
                            <div key={i} className="rounded border border-surface-850 bg-surface-850/40 p-1 text-center flex flex-col justify-between h-12">
                              <span className="block text-[8px] text-surface-400 font-bold">{f.day.split(",")[0]}</span>
                              <span className="block text-[9px] font-bold text-surface-150 tabular-nums">{f.rainSum.toFixed(0)}m</span>
                              <span className={`block w-full h-1 rounded-sm ${
                                f.alert === "red" ? "bg-red-500" :
                                f.alert === "orange" ? "bg-orange-500" :
                                f.alert === "yellow" ? "bg-yellow-500" :
                                "bg-emerald-500"
                              }`} />
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  ) : null}
                </div>

                {/* River levelsTelemetry list */}
                <div className="space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                    <Waves className="h-4 w-4 text-blue-400" />
                    River Level Gauges
                  </h3>

                  {loadingRivers ? (
                    <div className="flex h-36 items-center justify-center text-surface-500">
                      <Loader2 className="h-4.5 w-4.5 animate-spin mr-1.5" />
                      <span className="text-xs">Updating water telemetry...</span>
                    </div>
                  ) : errorRivers ? (
                    <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                      <AlertTriangle className="h-4.5 w-4.5" />
                      <span>{errorRivers}</span>
                    </div>
                  ) : rivers ? (
                    <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                      {filteredRivers.length === 0 ? (
                        <div className="text-center py-8 text-xs text-surface-500 border border-surface-850/60 rounded-xl bg-surface-900/20">
                          No monitored rivers in this district
                        </div>
                      ) : (
                        filteredRivers.map((st) => {
                          const pct = Math.min(100, (st.discharge / st.dangerLevel) * 100);
                          const isRising = st.trend === "rising";
                          const isFalling = st.trend === "falling";
                          return (
                            <div key={st.id} className="card-glass p-3 space-y-2 hover:border-surface-700/60 transition duration-150">
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="text-[11px] font-bold text-surface-100">{st.river}</span>
                                  <span className="block text-[9px] text-surface-500 font-semibold">{st.name}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {isRising && <TrendingUp className="h-3 w-3 text-red-400 animate-pulse" />}
                                  {isFalling && <TrendingDown className="h-3 w-3 text-emerald-400" />}
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border ${
                                    st.status === "danger" ? "bg-red-950/40 text-red-400 border-red-500/30" :
                                    st.status === "warning" ? "bg-warning-950/40 text-warning-400 border-warning-500/30" :
                                    "bg-emerald-950/40 text-emerald-400 border-emerald-500/30"
                                  }`}>
                                    {st.status}
                                  </span>
                                </div>
                              </div>

                              {/* Bar */}
                              <div className="space-y-1">
                                <div className="h-1.5 w-full bg-surface-850 rounded-full overflow-hidden border border-surface-800/40">
                                  <div
                                    style={{ width: `${pct}%` }}
                                    className={`h-full rounded-full ${
                                      st.status === "danger" ? "bg-red-500" :
                                      st.status === "warning" ? "bg-warning-500" :
                                      "bg-blue-500"
                                    }`}
                                  />
                                </div>
                                <div className="flex justify-between text-[9px] text-surface-400 font-semibold">
                                  <span>{st.discharge.toFixed(1)} m³/s</span>
                                  <span>Danger: {st.dangerLevel} m³/s</span>
                                </div>
                              </div>
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
                <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-orange-400" />
                  Reservoir Warning Matrix
                </h3>

                {loadingDams ? (
                  <div className="flex h-36 items-center justify-center text-surface-500">
                    <Loader2 className="h-4.5 w-4.5 animate-spin mr-1.5" />
                    <span className="text-xs">Updating reservoir telemetry...</span>
                  </div>
                ) : errorDams ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                    <AlertTriangle className="h-4.5 w-4.5" />
                    <span>{errorDams}</span>
                  </div>
                ) : dams ? (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {filteredDams.length === 0 ? (
                      <div className="text-center py-8 text-xs text-surface-500 border border-surface-850/60 rounded-xl bg-surface-900/20">
                        No monitored reservoirs in this district
                      </div>
                    ) : (
                      filteredDams.map((dam) => {
                        const isRising = dam.trend === "rising";
                        const isFalling = dam.trend === "falling";
                        return (
                          <div key={dam.id} className="card-glass p-3 space-y-2 hover:border-surface-700/60 transition duration-150">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[11px] font-bold text-surface-100">{dam.name}</span>
                                <span className="block text-[9px] text-surface-500 font-semibold">{dam.river}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {isRising && <TrendingUp className="h-3 w-3 text-red-400 animate-pulse" />}
                                {isFalling && <TrendingDown className="h-3 w-3 text-emerald-400" />}
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border ${
                                  dam.alertColor === "red" ? "bg-red-950/40 text-red-400 border-red-500/30 animate-pulse font-bold" :
                                  dam.alertColor === "orange" ? "bg-orange-950/40 text-orange-400 border-orange-500/30" :
                                  dam.alertColor === "blue" ? "bg-blue-950/40 text-blue-400 border-blue-500/30" :
                                  "bg-emerald-950/40 text-emerald-400 border-emerald-500/30"
                                }`}>
                                  {dam.shutterStatus}
                                </span>
                              </div>
                            </div>

                            {/* Capacity bar */}
                            <div className="space-y-1">
                              <div className="h-1.5 w-full bg-surface-850 rounded-full overflow-hidden border border-surface-800/40">
                                <div
                                  style={{ width: `${dam.capacityPct}%` }}
                                  className={`h-full rounded-full ${
                                    dam.alertColor === "red" ? "bg-red-500" :
                                    dam.alertColor === "orange" ? "bg-orange-500" :
                                    dam.alertColor === "blue" ? "bg-blue-500" :
                                    "bg-emerald-500"
                                  }`}
                                />
                              </div>
                              <div className="flex justify-between text-[9px] text-surface-400 font-semibold">
                                <span>Level: {dam.currentLevel.toFixed(1)} / {dam.frl} {dam.unit}</span>
                                <span>{dam.capacityPct.toFixed(1)}% Capacity</span>
                              </div>
                            </div>
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
                <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                  <Newspaper className="h-4 w-4 text-emerald-400" />
                  Live Media Updates
                </h3>

                {loadingNews ? (
                  <div className="flex h-36 items-center justify-center text-surface-500">
                    <Loader2 className="h-4.5 w-4.5 animate-spin mr-1.5" />
                    <span className="text-xs">Updating news feed...</span>
                  </div>
                ) : errorNews ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-xs text-emergency-400">
                    <AlertTriangle className="h-4.5 w-4.5" />
                    <span>{errorNews}</span>
                  </div>
                ) : news ? (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {news.news.map((item, i) => {
                      const relativeTime = formatRelativeTime(item.pubDate);
                      return (
                        <a
                          key={i}
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block card-glass p-3.5 space-y-2 hover:border-surface-700/60 hover:bg-surface-850/20 transition duration-150 group"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-[11px] font-extrabold text-surface-150 leading-snug group-hover:text-white transition">
                              {item.title}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[9px] text-surface-500 font-bold uppercase tracking-wider">
                            <span className="text-blue-400">{item.source}</span>
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
              <div className="flex-1 flex flex-col gap-4">
                {/* SOS Requests list feed */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                    <LifeBuoy className="h-4 w-4 text-emergency-400" />
                    SOS Feed ({filteredSos.length})
                  </h3>
                  <div className="max-h-[320px] overflow-y-auto space-y-2.5 pr-1">
                    {loading ? (
                      Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
                    ) : filteredSos.length === 0 ? (
                      <EmptyState message="No matching SOS requests." />
                    ) : (
                      filteredSos.map((sos) => <SosCard key={sos.id} sos={sos} onResolve={handleResolveSos} />)
                    )}
                  </div>
                </div>

                {/* Flood Reports list feed */}
                <div className="space-y-3 border-t border-surface-800 pt-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-surface-400 flex items-center gap-1.5">
                    <Droplets className="h-4 w-4 text-blue-400" />
                    Flood Reports Feed ({filteredReports.length})
                  </h3>
                  <div className="max-h-[320px] overflow-y-auto space-y-2.5 pr-1">
                    {loading ? (
                      Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
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
        </div>

        {/* Footer */}
        <footer className="border-t border-surface-800 pt-4 text-center text-[11px] text-surface-600">
          Kerala Emergency Management &copy; {new Date().getFullYear()} — Real-time public emergency platform
        </footer>
      </main>

      {/* Floating Action Button */}
      <button
        id="fab-report"
        onClick={() => setModalOpen(true)}
        className="fixed bottom-6 right-6 z-[999] flex items-center gap-2 rounded-full bg-emergency-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-emergency-900/40 hover:bg-emergency-500 transition-transform active:scale-95 sm:bottom-8 sm:right-8"
      >
        <Plus className="h-5 w-5" />
        <span className="hidden sm:inline">Report / Request Help</span>
        <span className="sm:hidden">Report</span>
      </button>

      {/* Incident reporting modal */}
      <ReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onFloodReportCreated={handleFloodCreated}
        onSosCreated={handleSosCreated}
      />
    </>
  );
}
