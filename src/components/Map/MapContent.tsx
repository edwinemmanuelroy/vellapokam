"use client";

import React, { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { FloodReport, SosRequest } from "@/types/database";
import type { DamStation, RiverStation } from "@/types/hydromet";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MIN_ZOOM,
  TILE_MAX_ZOOM,
  KERALA_BOUNDS,
} from "@/lib/mapConfig";
import { buildDirectionsUrl, buildDispatchMessage, formatRelativeTime } from "@/lib/format";
import { Crosshair } from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════════════════════════════════ */

const KERALA_CENTER: [number, number] = [10.8505, 76.2711];
const DEFAULT_ZOOM = 8;

/* Signal palette — the only colors on the map besides grayscale.
   red = danger/SOS/spill · amber = warning · bright gray = elevated · gray = normal */
const SIGNAL = {
  danger: "#fa5252",   // emergency-500
  warning: "#fcc419",  // warning-500
  elevated: "#dee2e6", // surface-200
  normal: "#868e96",   // surface-500
} as const;

function damColor(alertColor: string): string {
  switch (alertColor) {
    case "red": return SIGNAL.danger;
    case "orange": return SIGNAL.warning;
    case "blue": return SIGNAL.elevated;
    default: return SIGNAL.normal;
  }
}

function riverColor(status: string): string {
  switch (status) {
    case "danger": return SIGNAL.danger;
    case "warning": return SIGNAL.warning;
    default: return SIGNAL.normal;
  }
}

function floodColor(waterLevel: string): string {
  switch (waterLevel) {
    case "roof": return SIGNAL.danger;
    case "waist": return SIGNAL.warning;
    case "knee": return SIGNAL.elevated;
    default: return SIGNAL.normal;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   Geometric marker icons — monochrome + signal color, no emoji

   Each factory is memoised on its inputs. A fresh DivIcon instance makes
   react-leaflet tear the marker down and re-add it, so rebuilding icons every
   render caused the whole marker layer to churn on each realtime update.

   Shape language: teardrop pin = flood report · pulsing dot = SOS ·
   square = dam · circle = river gauge.
   ════════════════════════════════════════════════════════════════════════════ */

function memoizeIcon<A extends unknown[]>(
  key: (...args: A) => string,
  build: (...args: A) => L.DivIcon
): (...args: A) => L.DivIcon {
  const cache = new Map<string, L.DivIcon>();
  return (...args: A) => {
    const k = key(...args);
    const hit = cache.get(k);
    if (hit) return hit;
    const icon = build(...args);
    cache.set(k, icon);
    return icon;
  };
}

function buildFloodIcon(waterLevel: string): L.DivIcon {
  const fill = floodColor(waterLevel);
  return L.divIcon({
    className: "flood-marker",
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32" fill="none">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z"
              fill="${fill}" stroke="#0d0e10" stroke-width="1.5"/>
        <circle cx="12" cy="11.5" r="4" fill="#0d0e10"/>
      </svg>
    `,
  });
}

function buildSosIcon(peopleCount: number): L.DivIcon {
  return L.divIcon({
    className: "sos-marker",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -24],
    html: `
      <div style="
        position: relative;
        width: 40px; height: 40px;
        display: flex; align-items: center; justify-content: center;
      ">
        <div style="
          position: absolute; inset: 0;
          border-radius: 50%;
          background: rgba(250, 82, 82, 0.25);
          animation: sos-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>
        <div style="
          position: absolute; inset: 4px;
          border-radius: 50%;
          background: rgba(250, 82, 82, 0.35);
          animation: sos-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.3s;
        "></div>
        <div style="
          position: relative; z-index: 2;
          width: 26px; height: 26px;
          border-radius: 50%;
          background: #e03131;
          border: 1.5px solid #0d0e10;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          font-family: ui-monospace, monospace;
          line-height: 1;
        ">${peopleCount > 9 ? "9+" : peopleCount}</div>
      </div>
    `,
  });
}

function buildDamIcon(alertColor: string, capacityPct: number): L.DivIcon {
  const c = damColor(alertColor);
  return L.divIcon({
    className: "dam-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
    html: `
      <div style="
        position: relative;
        width: 24px; height: 24px;
        border-radius: 4px;
        background: #141517;
        border: 2px solid ${c};
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      ">
        <div style="
          position: absolute; bottom: 0; left: 0; right: 0;
          height: ${Math.min(100, Math.max(10, capacityPct))}%;
          background: ${c}; opacity: 0.4;
        "></div>
      </div>
    `,
  });
}

function buildRiverIcon(status: string, trend: string): L.DivIcon {
  const color = riverColor(status);
  const arrow = trend === "rising" ? "▲" : trend === "falling" ? "▼" : "•";
  return L.divIcon({
    className: "river-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
    html: `
      <div style="
        width: 24px; height: 24px;
        border-radius: 50%;
        background: #141517;
        border: 2px solid ${color};
        display: flex; align-items: center; justify-content: center;
        color: ${color};
        font-size: 9px; font-weight: 700;
        font-family: ui-monospace, monospace;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      ">${arrow}</div>
    `,
  });
}

const createFloodIcon = memoizeIcon((level: string) => level, buildFloodIcon);

const createSosIcon = memoizeIcon(
  (count: number) => String(Math.min(count, 10)), // 10+ all render as "9+"
  buildSosIcon
);

const createDamIcon = memoizeIcon(
  (color: string, pct: number) => `${color}:${Math.round(pct)}`,
  buildDamIcon
);

const createRiverIcon = memoizeIcon(
  (status: string, trend: string) => `${status}:${trend}`,
  buildRiverIcon
);

/* ════════════════════════════════════════════════════════════════════════════
   Scroll gate
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Give the page back its scroll.
 *
 * Leaflet's `scrollWheelZoom` swallows every wheel event over the map, so a
 * two-finger trackpad scroll aimed at the page zoomed the map instead — and
 * because the map is 520px tall on desktop, it is very hard to scroll past.
 *
 * The map now only zooms on a deliberate gesture: a trackpad pinch, or
 * ctrl/⌘ + wheel. Both arrive as a wheel event with `ctrlKey` set (macOS and
 * Windows both synthesise pinch this way), and a plain scroll does not — so
 * one flag separates "I want to move down the page" from "I want to zoom".
 * The +/− control and double-click still zoom as before.
 *
 * Two details this depends on:
 *
 *  - The listener is on `document` in the capture phase, so it runs before
 *    Leaflet's own handler on the container and can decide whether that
 *    handler should be live for this event at all.
 *  - `preventDefault` on the zoom path is load-bearing: ctrl + wheel is the
 *    browser's own page-zoom shortcut, and a listener enabled mid-dispatch
 *    does not fire for the event that enabled it. Without this the first
 *    pinch would zoom the whole browser window instead of the map.
 */
function ScrollZoomGate() {
  const map = useMap();

  React.useEffect(() => {
    const container = map.getContainer();

    const onWheelCapture = (e: WheelEvent) => {
      if (!container.contains(e.target as Node)) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
      } else if (map.scrollWheelZoom.enabled()) {
        map.scrollWheelZoom.disable();
      }
    };

    document.addEventListener("wheel", onWheelCapture, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", onWheelCapture, { capture: true });
      map.scrollWheelZoom.disable();
    };
  }, [map]);

  return null;
}

/* ════════════════════════════════════════════════════════════════════════════
   Recenter helper
   ════════════════════════════════════════════════════════════════════════════ */

function RecenterButton() {
  const map = useMap();
  const ref = React.useRef<HTMLButtonElement>(null);

  // The button lives inside the Leaflet container, so without this a click also
  // reaches the map and starts a drag / double-click zoom underneath it.
  React.useEffect(() => {
    if (ref.current) L.DomEvent.disableClickPropagation(ref.current);
  }, []);

  return (
    <button
      ref={ref}
      onClick={() => map.flyTo(KERALA_CENTER, DEFAULT_ZOOM)}
      aria-label="Re-center map on Kerala"
      className="absolute bottom-6 right-3 z-[1000] flex h-8 w-8 items-center justify-center rounded border border-surface-700 bg-surface-950/90 text-surface-400 transition hover:text-surface-100"
      title="Re-center on Kerala"
    >
      <Crosshair className="h-4 w-4" />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Popup building blocks — text-only, mono numerals
   ════════════════════════════════════════════════════════════════════════════ */

function PopupAction({
  href,
  label,
  danger = false,
}: {
  href: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center rounded-sm border px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider transition ${
        danger
          ? "border-emergency-600/60 text-emergency-400 hover:bg-emergency-950/60"
          : "border-surface-600 text-surface-200 hover:bg-surface-800"
      }`}
    >
      {label}
    </a>
  );
}

function StatusTag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{ color, borderColor: color }}
      className="rounded-sm border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider"
    >
      {children}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MapContent — war-room Leaflet map
   ════════════════════════════════════════════════════════════════════════════ */

const LEVEL_LABELS: Record<string, string> = {
  ankle: "Ankle",
  knee: "Knee",
  waist: "Waist",
  roof: "Roof",
};

interface MapContentProps {
  reports: FloodReport[];
  sosRequests: SosRequest[];
  dams?: DamStation[];
  rivers?: RiverStation[];
}

export default function MapContent({ reports, sosRequests, dams = [], rivers = [] }: MapContentProps) {
  /* ── Layer Toggles ────────────────────────────────────────────────────── */
  const [showSos, setShowSos] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [showDams, setShowDams] = useState(true);
  const [showRivers, setShowRivers] = useState(true);

  // Stations whose upstream feed failed carry placeholder zeroes; plotting them
  // would put a confident "0% / normal" marker on the map for a level nobody
  // actually knows. Official-only dams without verified coordinates are
  // list-only — a wrong pin on a rescue map is worse than no pin.
  const plottableDams = React.useMemo(
    () =>
      dams.filter(
        (d): d is DamStation & { lat: number; lng: number } =>
          d.available !== false && d.lat !== null && d.lng !== null
      ),
    [dams]
  );
  const plottableRivers = React.useMemo(() => rivers.filter((r) => r.available !== false), [rivers]);

  const layerChip = (active: boolean) =>
    `flex-shrink-0 whitespace-nowrap px-2 py-1 rounded-sm border font-mono text-[10px] font-bold uppercase tracking-wider transition ${
      active
        ? "border-surface-500 bg-surface-800 text-surface-100"
        : "border-surface-800 bg-transparent text-surface-600 hover:text-surface-400"
    }`;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-surface-800">
      {/* ── Layer control: text-only chips ──────────────────────────────────
          Offset left of Leaflet's zoom control (top-left) and right of the
          maximize button (top-right) — at 375px it previously sat underneath
          the zoom buttons and got clipped. Scrolls horizontally rather than
          wrapping, so it stays one row on any width. */}
      <div className="no-scrollbar absolute top-3 left-14 right-14 z-[1000] flex items-center gap-1 overflow-x-auto rounded border border-surface-800 bg-surface-950/95 p-1 sm:right-auto">
        <span className="hidden flex-shrink-0 px-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-surface-500 sm:inline">
          Layers
        </span>
        <button onClick={() => setShowSos((prev) => !prev)} className={layerChip(showSos)}>
          SOS{" "}
          <span className={sosRequests.length > 0 && showSos ? "text-emergency-400" : ""}>
            {sosRequests.length}
          </span>
        </button>
        <button onClick={() => setShowReports((prev) => !prev)} className={layerChip(showReports)}>
          RPT {reports.length}
        </button>
        <button onClick={() => setShowDams((prev) => !prev)} className={layerChip(showDams)}>
          DAM {plottableDams.length}
        </button>
        <button onClick={() => setShowRivers((prev) => !prev)} className={layerChip(showRivers)}>
          RIV {plottableRivers.length}
        </button>
      </div>

      <MapContainer
        center={KERALA_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={TILE_MIN_ZOOM}
        maxZoom={TILE_MAX_ZOOM}
        maxBounds={KERALA_BOUNDS}
        maxBoundsViscosity={1.0}
        /* Off by default — `ScrollZoomGate` turns it on only for a pinch or
           ctrl/⌘ + wheel, so a plain scroll moves the page. */
        scrollWheelZoom={false}
        className="h-full w-full"
        style={{ background: "#dee2e6" }}
      >
        {/* OSM tiles in their standard colors — the monochrome mandate covers
            the UI chrome, not the basemap. updateWhenIdle waits for pan-end
            before requesting tiles — fewer wasted requests (OSMF tile policy)
            and lighter on congested 4G. */}
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          updateWhenIdle={true}
        />

        <ScrollZoomGate />
        <RecenterButton />

        {/* ── Flood report markers ────────────────────────────────────────── */}
        {showReports &&
          reports.map((report) => (
            <Marker
              key={`flood-${report.id}`}
              position={[report.latitude, report.longitude]}
              icon={createFloodIcon(report.water_level)}
            >
              <Popup maxWidth={280} minWidth={220}>
                <div className="space-y-2 p-1">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                    <span className="text-sm font-bold text-surface-100">
                      {LEVEL_LABELS[report.water_level] ?? "Unknown"} Level
                    </span>
                    <StatusTag
                      color={report.verified ? SIGNAL.elevated : SIGNAL.normal}
                    >
                      {report.verified ? "Verified" : "Unverified"}
                    </StatusTag>
                  </div>

                  {/* Description */}
                  {report.description && (
                    <p className="text-xs leading-relaxed text-surface-300">
                      {report.description}
                    </p>
                  )}

                  {/* Image */}
                  {report.image_url && (
                    <img
                      src={report.image_url}
                      alt="Flood photo"
                      className="w-full rounded border border-surface-700 object-cover"
                      style={{ maxHeight: 140 }}
                    />
                  )}

                  {/* Meta + actions */}
                  <div className="flex items-center justify-between gap-2 border-t border-surface-800 pt-1.5">
                    <span className="font-mono text-[10px] text-surface-500">
                      {formatRelativeTime(report.created_at)}
                    </span>
                    <PopupAction
                      href={buildDirectionsUrl(report.latitude, report.longitude)}
                      label="Directions"
                    />
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

        {/* ── SOS request markers ─────────────────────────────────────────── */}
        {showSos &&
          sosRequests.map((sos) => {
            const googleNavUrl = buildDirectionsUrl(sos.latitude, sos.longitude);
            const whatsappText = encodeURIComponent(buildDispatchMessage(sos));
            const whatsappUrl = `https://wa.me/?text=${whatsappText}`;
            const isPending = sos.status === "pending";

            return (
              <Marker
                key={`sos-${sos.id}`}
                position={[sos.latitude, sos.longitude]}
                icon={createSosIcon(sos.people_count)}
                /* A trapped person's beacon must never hide under a dam or
                   gauge marker — force SOS to the top of the stack. */
                zIndexOffset={1000}
              >
                <Popup maxWidth={300} minWidth={240}>
                  <div className="space-y-2.5 p-1">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                      <span className="text-sm font-bold text-surface-100">
                        {sos.name}
                      </span>
                      <StatusTag color={isPending ? SIGNAL.danger : SIGNAL.normal}>
                        {sos.status}
                      </StatusTag>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-xs text-surface-300">
                      <span>
                        {sos.people_count}{" "}
                        {sos.people_count === 1 ? "person" : "people"}
                      </span>
                      <a
                        href={`tel:${sos.phone}`}
                        className="inline-block rounded-sm py-2 font-bold text-surface-100 hover:underline"
                      >
                        {sos.phone}
                      </a>
                    </div>

                    {/* Needs */}
                    {sos.needs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {sos.needs.map((need) => (
                          <span
                            key={need}
                            className="rounded-sm border border-surface-700 bg-surface-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-surface-300"
                          >
                            {need}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Rescue actions */}
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <PopupAction href={googleNavUrl} label="Directions" />
                      <PopupAction href={whatsappUrl} label="Dispatch WA" danger />
                    </div>

                    {/* Meta */}
                    <div className="flex items-center justify-between border-t border-surface-800 pt-1.5 font-mono text-[9px] text-surface-500">
                      <span>{formatRelativeTime(sos.created_at)}</span>
                      <span>
                        {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* ── Dam Reservoir Markers ───────────────────────────────────────── */}
        {showDams &&
          plottableDams.map((dam) => (
            <Marker
              key={`dam-${dam.id}`}
              position={[dam.lat, dam.lng]}
              icon={createDamIcon(dam.alertColor, dam.capacityPct)}
            >
              <Popup maxWidth={260} minWidth={200}>
                <div className="space-y-2 p-1">
                  <div className="flex items-center justify-between gap-1 border-b border-surface-800 pb-1.5">
                    <div>
                      <span className="block text-xs font-bold text-surface-100">{dam.name}</span>
                      <span className="block text-[9px] text-surface-500">{dam.river}</span>
                    </div>
                    <StatusTag color={damColor(dam.alertColor)}>{dam.status}</StatusTag>
                  </div>

                  <div className="space-y-1 text-[11px] text-surface-300">
                    <div className="flex justify-between">
                      <span>Shutters</span>
                      <span className="font-semibold text-surface-100">{dam.shutterStatus}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Capacity</span>
                      <span className="font-mono font-bold text-surface-100">{dam.capacityPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-surface-500">
                      <span>{dam.currentLevel.toFixed(1)} / {dam.frl} {dam.unit}</span>
                      {dam.source === "estimated" && (
                        <span>24h rain {dam.catchmentRain24h.toFixed(1)}mm</span>
                      )}
                    </div>
                  </div>

                  {dam.remarks && (
                    <p className="text-[10px] leading-snug text-surface-400">{dam.remarks}</p>
                  )}

                  <p className="border-t border-surface-800 pt-1 text-[9px] uppercase tracking-wider text-surface-600">
                    {dam.source === "KSDMA"
                      ? `Official KSDMA bulletin${dam.officialDate ? ` · ${dam.officialDate}` : ""}`
                      : "Estimated from catchment rainfall"}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

        {/* ── River Gauge Markers ────────────────────────────────────────── */}
        {showRivers &&
          plottableRivers.map((st) => (
            <Marker
              key={`river-${st.id}`}
              position={[st.lat, st.lng]}
              icon={createRiverIcon(st.status, st.trend)}
            >
              <Popup maxWidth={240} minWidth={180}>
                <div className="space-y-1.5 p-1">
                  <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
                    <div>
                      <span className="block text-xs font-bold text-surface-100">{st.name}</span>
                      <span className="block text-[9px] text-surface-500">{st.river}</span>
                    </div>
                    <StatusTag color={riverColor(st.status)}>{st.status}</StatusTag>
                  </div>

                  <div className="space-y-1 text-[11px] text-surface-300">
                    <div className="flex items-center justify-between">
                      <span>Discharge</span>
                      <span className="font-mono font-bold text-surface-100">{st.discharge.toFixed(1)} m³/s</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-surface-500">
                      <span>Danger {st.dangerLevel} m³/s</span>
                      <span className="uppercase">{st.trend}</span>
                    </div>
                  </div>

                  {st.officialAlert && (
                    <div className="border-t border-surface-800 pt-1.5">
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: st.officialAlert.severity === "yellow" ? SIGNAL.warning : SIGNAL.danger }}
                      >
                        Official alert · {st.officialAlert.source}
                      </span>
                      <p className="mt-0.5 text-[10px] leading-snug text-surface-300">
                        {st.officialAlert.message}
                      </p>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}
