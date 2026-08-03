import { NextResponse } from "next/server";
import { fetchOfficialDamBulletin, type OfficialDamRow } from "@/lib/ksdma";
import type { DamStation } from "@/types/hydromet";

export const revalidate = 900; // 15-minute revalidation cache

// Vercel's default function timeout is 10s. This route is network-bound
// against Indian government / weather endpoints from a US-region function,
// so it is given the full Hobby-tier headroom rather than risking a
// timeout during an event. 60s is the Hobby maximum.
export const maxDuration = 60;

interface Dam {
  id: string;
  name: string;
  river: string;
  district: string;
  lat: number;
  lng: number;
  frl: number; // Full Reservoir Level
  unit: string; // ft or m
  dangerLevel: number;
}

/**
 * Static registry for map placement and model fallback. Dams present in the
 * daily KSDMA bulletin get official gauge readings; the rest (and every dam
 * on days the bulletin is unreachable) fall back to the rainfall estimate.
 */
const DAMS: Dam[] = [
  { id: "idukki", name: "Idukki Arch Dam", river: "Periyar River", district: "Idukki", lat: 9.8458, lng: 76.9736, frl: 2403.0, unit: "ft", dangerLevel: 2395.0 },
  { id: "mullaperiyar", name: "Mullaperiyar Dam", river: "Periyar River", district: "Idukki", lat: 9.5292, lng: 77.1436, frl: 142.0, unit: "ft", dangerLevel: 140.0 },
  { id: "idamalayar", name: "Idamalayar Dam", river: "Periyar River", district: "Ernakulam", lat: 10.2183, lng: 76.7022, frl: 169.0, unit: "m", dangerLevel: 165.0 },
  { id: "banasurasagar", name: "Banasurasagar Dam", river: "Kabini River", district: "Wayanad", lat: 11.6706, lng: 75.9556, frl: 775.6, unit: "m", dangerLevel: 773.0 },
  { id: "malampuzha", name: "Malampuzha Dam", river: "Bharatapuzha River", district: "Palakkad", lat: 10.8322, lng: 76.6853, frl: 115.06, unit: "m", dangerLevel: 113.0 },
  { id: "neyyar", name: "Neyyar Dam", river: "Neyyar River", district: "Thiruvananthapuram", lat: 8.5358, lng: 77.1481, frl: 84.75, unit: "m", dangerLevel: 82.0 },
  { id: "peechi", name: "Peechi Dam", river: "Manali River", district: "Thrissur", lat: 10.5317, lng: 76.3683, frl: 79.25, unit: "m", dangerLevel: 77.0 },
  { id: "kakki", name: "Kakki Dam", river: "Pamba River", district: "Pathanamthitta", lat: 9.3172, lng: 77.1408, frl: 981.46, unit: "m", dangerLevel: 978.0 },
  { id: "peringalkuthu", name: "Peringalkuthu Dam", river: "Chalakkudy River", district: "Thrissur", lat: 10.3117, lng: 76.6358, frl: 424.0, unit: "m", dangerLevel: 420.0 },
  { id: "sholayar", name: "Lower Sholayar Dam", river: "Chalakkudy River", district: "Thrissur", lat: 10.2989, lng: 76.7725, dangerLevel: 2658.0, frl: 2663.0, unit: "ft" },
  { id: "kanjirapuzha", name: "Kanjirapuzha Dam", river: "Kanjirapuzha River", district: "Palakkad", lat: 10.9786, lng: 76.5414, frl: 97.5, unit: "m", dangerLevel: 95.0 },
  { id: "walayar", name: "Walayar Dam", river: "Walayar River", district: "Palakkad", lat: 10.8406, lng: 76.8406, frl: 203.0, unit: "m", dangerLevel: 200.0 },
  { id: "thumboormuzhi", name: "Thumboormuzhi Weir", river: "Chalakkudy River", district: "Thrissur", lat: 10.3183, lng: 76.4383, frl: 30.5, unit: "m", dangerLevel: 29.5 },
  { id: "neyyar_weir", name: "Aruvikkara Dam", river: "Karamana River", district: "Thiruvananthapuram", lat: 8.5683, lng: 76.9933, frl: 46.6, unit: "m", dangerLevel: 45.0 },
];

/**
 * Catchment rainfall for a dam: yesterday's and today's precipitation totals.
 * Used only for the rainfall-model fallback and the inflow trend.
 * Returns null instead of throwing so one unreachable station cannot take down
 * the whole endpoint.
 */
async function fetchCatchmentRain(
  dam: Dam
): Promise<{ yesterday: number; today: number } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${dam.lat}&longitude=${dam.lng}&daily=precipitation_sum&timezone=Asia%2FKolkata&past_days=1&forecast_days=1`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    const data = await res.json();
    const sums = data?.daily?.precipitation_sum;
    if (!Array.isArray(sums) || sums.length === 0) return null;
    return {
      yesterday: sums[0] ?? 0,
      today: sums[sums.length - 1] ?? 0,
    };
  } catch {
    return null;
  }
}

/** Build a station from today's official KSDMA gauge row. */
function officialStation(
  row: OfficialDamRow,
  base: Dam | undefined,
  bulletinDate: string | null
): DamStation {
  const { alertLevels } = row;

  // Alert colour from the bulletin's own staged levels when defined,
  // else from storage percentage.
  let alertColor: DamStation["alertColor"] = "green";
  if (alertLevels) {
    if (row.currentLevel >= alertLevels.red) alertColor = "red";
    else if (row.currentLevel >= alertLevels.orange) alertColor = "orange";
    else if (row.currentLevel >= alertLevels.blue) alertColor = "blue";
  } else if (row.capacityPct !== null) {
    if (row.capacityPct >= 95) alertColor = "red";
    else if (row.capacityPct >= 90) alertColor = "orange";
    else if (row.capacityPct >= 80) alertColor = "blue";
  }
  // A controlled release with no staged warning still deserves "elevated".
  if (row.spilling && alertColor === "green") alertColor = "blue";

  const status: DamStation["status"] = row.spilling
    ? "spill"
    : alertColor === "red" || alertColor === "orange"
    ? "alert"
    : "normal";

  const shutterStatus = row.spilling
    ? row.spillCumecs && row.spillCumecs > 0
      ? `Spilling · ${row.spillCumecs.toFixed(0)} m³/s`
      : "Shutters open"
    : alertColor === "red"
    ? "Red alert level"
    : alertColor === "orange"
    ? "Orange alert level"
    : alertColor === "blue"
    ? "Blue alert level"
    : "Gates closed";

  return {
    id: row.id,
    name: base?.name ?? row.name,
    river: base?.river ?? row.river,
    district: base?.district ?? row.district,
    lat: base?.lat ?? row.lat,
    lng: base?.lng ?? row.lng,
    frl: row.frl,
    unit: row.unit,
    dangerLevel: alertLevels?.red ?? base?.dangerLevel ?? row.frl * 0.98,
    currentLevel: row.currentLevel,
    capacityPct: row.capacityPct ?? (row.currentLevel / row.frl) * 100,
    status,
    alertColor,
    shutterStatus,
    remarks: row.remarks || undefined,
    trend: "steady",
    catchmentRain24h: 0,
    source: "KSDMA",
    officialDate: bulletinDate,
    available: true,
    updatedAt: new Date().toISOString(),
  };
}

/** Rainfall-model fallback — the pre-official behaviour, clearly labelled. */
async function estimatedStation(dam: Dam): Promise<DamStation> {
  const rain = await fetchCatchmentRain(dam);

  const common = {
    id: dam.id,
    name: dam.name,
    river: dam.river,
    district: dam.district,
    lat: dam.lat,
    lng: dam.lng,
    frl: dam.frl,
    unit: dam.unit,
    dangerLevel: dam.dangerLevel,
    source: "estimated" as const,
    updatedAt: new Date().toISOString(),
  };

  // No live catchment data — report the dam as unavailable rather than
  // inventing a level for it.
  if (!rain) {
    return {
      ...common,
      currentLevel: 0,
      capacityPct: 0,
      status: "normal",
      alertColor: "green",
      shutterStatus: "Data unavailable",
      trend: "steady",
      catchmentRain24h: 0,
      available: false,
    };
  }

  // Storage estimate: normal pool ~86% of FRL, adjusted by catchment rain.
  const basePct = 86.2 + Math.max(0, rain.today) * 0.15;
  const capacityPct = Math.min(100, Math.max(30, basePct));
  const currentLevel = (capacityPct / 100) * dam.frl;

  let status: DamStation["status"] = "normal";
  let alertColor: DamStation["alertColor"] = "green";
  let shutterStatus = "Closed";

  if (currentLevel >= dam.dangerLevel) {
    status = "spill";
    alertColor = "red";
    shutterStatus = "Likely spilling";
  } else if (currentLevel >= dam.frl * 0.95) {
    status = "alert";
    alertColor = "red";
    shutterStatus = "Red alert (est.)";
  } else if (currentLevel >= dam.frl * 0.92) {
    status = "alert";
    alertColor = "orange";
    shutterStatus = "Orange alert (est.)";
  } else if (currentLevel >= dam.frl * 0.88) {
    status = "normal";
    alertColor = "blue";
    shutterStatus = "Blue alert (est.)";
  }

  let trend: DamStation["trend"] = "steady";
  const diff = rain.today - rain.yesterday;
  if (diff > 5) trend = "rising";
  else if (diff < -5) trend = "falling";

  return {
    ...common,
    currentLevel,
    capacityPct,
    status,
    alertColor,
    shutterStatus,
    trend,
    catchmentRain24h: rain.today,
    available: true,
  };
}

export async function GET() {
  // 1. Today's official KSDMA bulletin (KSEB + Irrigation PDFs).
  const bulletin = await fetchOfficialDamBulletin();
  const officialById = new Map<string, OfficialDamRow>(
    (bulletin?.rows ?? []).map((r) => [r.id, r])
  );
  const staticIds = new Set(DAMS.map((d) => d.id));

  // 2. Static registry: official reading when present, model otherwise.
  const stations = await Promise.all(
    DAMS.map((dam) => {
      const row = officialById.get(dam.id);
      return row
        ? Promise.resolve(officialStation(row, dam, bulletin?.date ?? null))
        : estimatedStation(dam);
    })
  );

  // 3. Official-only dams from the bulletin (mapped when coordinates are
  //    known, list-only otherwise).
  for (const row of bulletin?.rows ?? []) {
    if (!staticIds.has(row.id)) {
      stations.push(officialStation(row, undefined, bulletin?.date ?? null));
    }
  }

  // Highest-concern first: spilling, then alert, then storage percentage.
  const statusRank: Record<string, number> = { spill: 0, alert: 1, normal: 2 };
  stations.sort(
    (a, b) =>
      (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) ||
      b.capacityPct - a.capacityPct
  );

  const officialCount = stations.filter((s) => s.source === "KSDMA").length;

  return NextResponse.json({
    success: true,
    officialCount,
    officialDate: bulletin?.date ?? null,
    // True when at least one dam still relies on the rainfall model.
    estimated: stations.some((s) => s.source === "estimated"),
    dams: stations,
  });
}
