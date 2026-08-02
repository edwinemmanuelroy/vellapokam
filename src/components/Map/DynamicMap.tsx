"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { FloodReport, SosRequest } from "@/types/database";
import type { DamStation, RiverStation } from "@/types/hydromet";
import { Loader2 } from "lucide-react";

/* ── Dynamic import disables SSR for Leaflet (it requires `window`) ──────── */
const MapContent = dynamic(() => import("./MapContent"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-xl border border-surface-700/40 bg-surface-900/60">
      <div className="flex flex-col items-center gap-3 text-surface-500">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="text-sm">Loading map…</span>
      </div>
    </div>
  ),
});

/* ════════════════════════════════════════════════════════════════════════════
   DynamicMap — SSR-safe wrapper
   ════════════════════════════════════════════════════════════════════════════ */

interface DynamicMapProps {
  reports: FloodReport[];
  sosRequests: SosRequest[];
  dams?: DamStation[];
  rivers?: RiverStation[];
}

export default function DynamicMap({ reports, sosRequests, dams = [], rivers = [] }: DynamicMapProps) {
  return (
    <MapContent reports={reports} sosRequests={sosRequests} dams={dams} rivers={rivers} />
  );
}
