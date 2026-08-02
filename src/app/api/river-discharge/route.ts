import { NextResponse } from "next/server";

export const revalidate = 900; // 15-minute revalidation cache

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

export async function GET() {
  try {
    const results = await Promise.all(
      STATIONS.map(async (station) => {
        const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${station.lat}&longitude=${station.lng}&daily=river_discharge&timezone=Asia%2FKolkata&models=seamless_v4`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch data for ${station.name}`);
        const data = await res.json();

        const times = data.daily?.time as string[];
        const discharges = data.daily?.river_discharge as number[];

        if (!times || !discharges || times.length === 0) {
          return {
            ...station,
            discharge: 0,
            trend: "steady",
            status: "normal",
            updatedAt: new Date().toISOString(),
          };
        }

        // Get local date string for today and yesterday in YYYY-MM-DD format
        const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata" }).format(new Date());
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata" }).format(yesterday);

        // Find matching indices
        let todayIndex = times.indexOf(todayStr);
        let yesterdayIndex = times.indexOf(yesterdayStr);

        // Fallbacks if current date is not present in prediction series
        if (todayIndex === -1) todayIndex = times.length - 1; // latest forecast
        if (yesterdayIndex === -1) yesterdayIndex = Math.max(0, todayIndex - 1);

        const currentDischarge = discharges[todayIndex] ?? 0;
        const pastDischarge = discharges[yesterdayIndex] ?? 0;

        // Compute trend
        let trend: "rising" | "falling" | "steady" = "steady";
        const difference = currentDischarge - pastDischarge;
        // Significant difference threshold (e.g. > 2.0% change)
        const pctChange = pastDischarge > 0 ? (difference / pastDischarge) * 100 : 0;
        
        if (pctChange > 2) {
          trend = "rising";
        } else if (pctChange < -2) {
          trend = "falling";
        }

        // Compute status based on danger level
        let status: "normal" | "warning" | "danger" = "normal";
        if (currentDischarge >= station.dangerLevel) {
          status = "danger";
        } else if (currentDischarge >= station.dangerLevel * 0.7) {
          status = "warning";
        }

        return {
          ...station,
          discharge: currentDischarge,
          trend,
          status,
          updatedAt: new Date().toISOString(),
        };
      })
    );

    return NextResponse.json({ success: true, stations: results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch river discharge warning metrics";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
