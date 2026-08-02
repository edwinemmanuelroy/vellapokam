"use client";

import React from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { FloodReport, SosRequest } from "@/types/database";
import {
  Clock,
  MapPin,
  Users,
  Phone,
  ShieldCheck,
  Eye,
  Waves,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════════════════════════════════ */

const KERALA_CENTER: [number, number] = [10.8505, 76.2711];
const DEFAULT_ZOOM = 8;

/* ════════════════════════════════════════════════════════════════════════════
   Custom SVG marker icons
   ════════════════════════════════════════════════════════════════════════════ */

function createFloodIcon(waterLevel: string): L.DivIcon {
  const colorMap: Record<string, { fill: string; ring: string }> = {
    ankle: { fill: "#fbbf24", ring: "#fde68a" },  // yellow
    knee:  { fill: "#f97316", ring: "#fdba74" },   // orange
    waist: { fill: "#ea580c", ring: "#fb923c" },   // dark orange
    roof:  { fill: "#b91c1c", ring: "#fca5a5" },   // dark red
  };
  const c = colorMap[waterLevel] ?? colorMap.ankle;

  return L.divIcon({
    className: "flood-marker",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" fill="none">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z"
              fill="${c.fill}" stroke="${c.ring}" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="5" fill="white" opacity="0.9"/>
        <path d="M11 14.5 C12 11, 16 11, 17 14.5" stroke="${c.fill}" stroke-width="1.8"
              stroke-linecap="round" fill="none"/>
      </svg>
    `,
  });
}

function createSosIcon(peopleCount: number): L.DivIcon {
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
          background: rgba(220, 38, 38, 0.25);
          animation: sos-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>
        <div style="
          position: absolute; inset: 4px;
          border-radius: 50%;
          background: rgba(220, 38, 38, 0.35);
          animation: sos-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.3s;
        "></div>
        <div style="
          position: relative; z-index: 2;
          width: 26px; height: 26px;
          border-radius: 50%;
          background: #dc2626;
          border: 2px solid #fca5a5;
          display: flex; align-items: center; justify-content: center;
          color: white;
          font-size: 10px;
          font-weight: 800;
          font-family: system-ui, sans-serif;
          line-height: 1;
        ">${peopleCount > 9 ? "9+" : peopleCount}</div>
      </div>
    `,
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   Recenter helper
   ════════════════════════════════════════════════════════════════════════════ */

function RecenterButton() {
  const map = useMap();
  return (
    <button
      onClick={() => map.flyTo(KERALA_CENTER, DEFAULT_ZOOM)}
      className="absolute bottom-4 right-4 z-[1000] flex h-9 w-9 items-center justify-center rounded-lg border border-surface-600 bg-surface-900/90 text-surface-300 shadow-lg backdrop-blur-sm transition hover:bg-surface-800 hover:text-white"
      title="Re-center on Kerala"
    >
      <MapPin className="h-4 w-4" />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Utility
   ════════════════════════════════════════════════════════════════════════════ */

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

const LEVEL_LABELS: Record<string, string> = {
  ankle: "Ankle",
  knee: "Knee",
  waist: "Waist",
  roof: "Roof",
};

/* ════════════════════════════════════════════════════════════════════════════
   MapContent — the actual Leaflet map (client-only)
   ════════════════════════════════════════════════════════════════════════════ */

interface MapContentProps {
  reports: FloodReport[];
  sosRequests: SosRequest[];
}

export default function MapContent({ reports, sosRequests }: MapContentProps) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-surface-700/40">
      {/* Global SOS pulse animation injected once */}
      <style jsx global>{`
        @keyframes sos-ping {
          0%   { transform: scale(1);   opacity: 0.7; }
          75%  { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        /* Remove Leaflet's default marker icon background artifacts */
        .flood-marker, .sos-marker {
          background: transparent !important;
          border: none !important;
        }
        /* Style popups to match our dark theme */
        .leaflet-popup-content-wrapper {
          background: #1a1d21 !important;
          color: #e9ecef !important;
          border-radius: 12px !important;
          border: 1px solid rgba(52, 58, 64, 0.5) !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
        }
        .leaflet-popup-tip {
          background: #1a1d21 !important;
          border: 1px solid rgba(52, 58, 64, 0.5) !important;
          box-shadow: none !important;
        }
        .leaflet-popup-close-button {
          color: #868e96 !important;
          font-size: 18px !important;
        }
        .leaflet-popup-close-button:hover {
          color: #e9ecef !important;
        }
      `}</style>

      <MapContainer
        center={KERALA_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ background: "#141517" }}
      >
        {/* Dark map tiles */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <RecenterButton />

        {/* ── Flood report markers ────────────────────────────────────────── */}
        {reports.map((report) => (
          <Marker
            key={`flood-${report.id}`}
            position={[report.latitude, report.longitude]}
            icon={createFloodIcon(report.water_level)}
          >
            <Popup maxWidth={280} minWidth={200}>
              <div className="space-y-2 p-1">
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Waves className="h-4 w-4" style={{ color: "#60a5fa" }} />
                    <span className="text-sm font-bold">
                      {LEVEL_LABELS[report.water_level] ?? "Unknown"} Level
                    </span>
                  </div>
                  {report.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/40 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                      <ShieldCheck className="h-3 w-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-800/60 px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                      <Eye className="h-3 w-3" /> Unverified
                    </span>
                  )}
                </div>

                {/* Description */}
                {report.description && (
                  <p className="text-xs leading-relaxed text-gray-300">
                    {report.description}
                  </p>
                )}

                {/* Image */}
                {report.image_url && (
                  <img
                    src={report.image_url}
                    alt="Flood photo"
                    className="w-full rounded-lg border border-gray-700 object-cover"
                    style={{ maxHeight: 140 }}
                  />
                )}

                {/* Meta */}
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(report.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* ── SOS request markers ─────────────────────────────────────────── */}
        {sosRequests.map((sos) => (
          <Marker
            key={`sos-${sos.id}`}
            position={[sos.latitude, sos.longitude]}
            icon={createSosIcon(sos.people_count)}
          >
            <Popup maxWidth={280} minWidth={200}>
              <div className="space-y-2 p-1">
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-red-400">
                    🆘 SOS — {sos.name}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      sos.status === "pending"
                        ? "bg-red-900/40 text-red-400"
                        : "bg-emerald-900/40 text-emerald-400"
                    }`}
                  >
                    {sos.status}
                  </span>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-300">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3 text-gray-500" />
                    {sos.people_count}{" "}
                    {sos.people_count === 1 ? "person" : "people"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3 text-gray-500" />
                    {sos.phone}
                  </span>
                </div>

                {/* Needs */}
                {sos.needs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sos.needs.map((need) => (
                      <span
                        key={need}
                        className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-300"
                      >
                        {need}
                      </span>
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(sos.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
