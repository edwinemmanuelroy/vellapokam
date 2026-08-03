import { NextResponse } from "next/server";
import { fetchKeralaAlerts } from "@/lib/sachet";
import type { OfficialAlert } from "@/types/hydromet";

export const revalidate = 900; // 15-minute revalidation cache

// Vercel's default function timeout is 10s. This route is network-bound
// against Indian government / weather endpoints from a US-region function,
// so it is given the full Hobby-tier headroom rather than risking a
// timeout during an event. 60s is the Hobby maximum.
export const maxDuration = 60;

interface Station {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  dangerLevel: number; // m3/s danger threshold
}

const STATIONS: Station[] = [
  { id: "periyar", name: "Aluva Station", river: "Periyar River", lat: 10.1076, lng: 76.3508, dangerLevel: 1200 },
  { id: "bharatapuzha", name: "Shoranur Station", river: "Bharatapuzha River", lat: 10.7601, lng: 76.2801, dangerLevel: 1500 },
  { id: "pamba", name: "Chengannur Station", river: "Pamba River", lat: 9.3175, lng: 76.6111, dangerLevel: 800 },
  { id: "chaliyar", name: "Nilambur Station", river: "Chaliyar River", lat: 11.2758, lng: 76.2294, dangerLevel: 1000 },
  { id: "kadalundipuzha", name: "Kadalundi Station", river: "Kadalundipuzha River", lat: 11.1234, lng: 75.8345, dangerLevel: 700 },
  { id: "achencovil", name: "Pathanamthitta Station", river: "Achencovil River", lat: 9.2624, lng: 76.7865, dangerLevel: 600 },
  { id: "valapattanam", name: "Kannur Station", river: "Valapattanam River", lat: 11.9056, lng: 75.3678, dangerLevel: 900 },
  { id: "muvattupuzha", name: "Muvattupuzha Station", river: "Muvattupuzha River", lat: 9.9822, lng: 76.5822, dangerLevel: 850 },
  { id: "chalakkudy", name: "Chalakudy Station", river: "Chalakkudy River", lat: 10.3069, lng: 76.3353, dangerLevel: 1100 },
  { id: "meenachil", name: "Kottayam Station", river: "Meenachil River", lat: 9.5931, lng: 76.5218, dangerLevel: 550 },
  { id: "kallada", name: "Kallada Station", river: "Kallada River", lat: 8.9950, lng: 76.6570, dangerLevel: 750 },
  { id: "karamana", name: "Thiruvananthapuram Station", river: "Karamana River", lat: 8.4831, lng: 76.9632, dangerLevel: 500 },
  { id: "manimala", name: "Thiruvalla Station", river: "Manimala River", lat: 9.3900, lng: 76.5700, dangerLevel: 650 },
  { id: "chandragiri", name: "Kasaragod Station", river: "Chandragiri River", lat: 12.4969, lng: 75.0022, dangerLevel: 800 },
];

interface StationReading {
  discharge: number;
  trend: "rising" | "falling" | "steady";
  available: boolean;
}

const UNAVAILABLE: StationReading = { discharge: 0, trend: "steady", available: false };

/**
 * Daily river discharge for a station.
 *
 * `past_days=1` is required — without it the series starts at today, the
 * lookup for yesterday falls back to today's own index, and the computed
 * trend is permanently "steady".
 *
 * Never throws: a single unreachable station must not fail the whole endpoint.
 */
async function fetchDischarge(station: Station): Promise<StationReading> {
  try {
    const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${station.lat}&longitude=${station.lng}&daily=river_discharge&timezone=Asia%2FKolkata&past_days=1&forecast_days=1&models=seamless_v4`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return UNAVAILABLE;
    const data = await res.json();

    const times = data?.daily?.time as string[] | undefined;
    const discharges = data?.daily?.river_discharge as (number | null)[] | undefined;
    if (!Array.isArray(times) || !Array.isArray(discharges) || times.length === 0) {
      return UNAVAILABLE;
    }

    // Local (Asia/Kolkata) date strings in YYYY-MM-DD form
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata" });
    const todayStr = fmt.format(new Date());
    const yesterdayStr = fmt.format(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let todayIndex = times.indexOf(todayStr);
    let yesterdayIndex = times.indexOf(yesterdayStr);
    if (todayIndex === -1) todayIndex = times.length - 1;
    if (yesterdayIndex === -1) yesterdayIndex = Math.max(0, todayIndex - 1);

    const currentDischarge = discharges[todayIndex] ?? 0;
    const pastDischarge = discharges[yesterdayIndex] ?? 0;

    // Trend from the day-over-day percentage change (±2% threshold).
    // Identical indices (single-day series) yield 0% → "steady".
    let trend: "rising" | "falling" | "steady" = "steady";
    if (yesterdayIndex !== todayIndex && pastDischarge > 0) {
      const pctChange = ((currentDischarge - pastDischarge) / pastDischarge) * 100;
      if (pctChange > 2) {
        trend = "rising";
      } else if (pctChange < -2) {
        trend = "falling";
      }
    }

    return { discharge: currentDischarge, trend, available: true };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * The official flood alert covering a station, if any. Alerts arrive via
 * SACHET (CWC flood forecasts relayed by IMD/SDMA) and name the river in
 * their area text; `alert.rivers` holds our matched station ids.
 */
function officialAlertFor(
  station: Station,
  alerts: OfficialAlert[] | null
): OfficialAlert | null {
  if (!alerts) return null;
  const floodish = alerts.filter(
    (a) => /flood|river|dam/i.test(a.event) || a.rivers.length > 0
  );
  return floodish.find((a) => a.rivers.includes(station.id)) ?? null;
}

export async function GET() {
  // Official flood alerts overlay the model — an active CWC/SDMA river alert
  // outranks anything the discharge model says about that river.
  const alerts = await fetchKeralaAlerts();

  const results = await Promise.all(
    STATIONS.map(async (station) => {
      const reading = await fetchDischarge(station);

      let status: "normal" | "warning" | "danger" = "normal";
      if (reading.available) {
        if (reading.discharge >= station.dangerLevel) {
          status = "danger";
        } else if (reading.discharge >= station.dangerLevel * 0.7) {
          status = "warning";
        }
      }

      const alert = officialAlertFor(station, alerts);
      if (alert) {
        // Escalate only — never let the model downgrade an official warning.
        const officialStatus =
          alert.severity === "red" || alert.severity === "orange"
            ? "danger"
            : "warning";
        if (officialStatus === "danger" || status === "normal") {
          status = officialStatus;
        }
      }

      return {
        ...station,
        discharge: reading.discharge,
        trend: reading.trend,
        status,
        available: reading.available,
        officialAlert: alert
          ? {
              source: alert.source,
              severity: alert.severity,
              message: alert.message.slice(0, 280),
            }
          : null,
        updatedAt: new Date().toISOString(),
      };
    })
  );

  return NextResponse.json({ success: true, stations: results });
}
