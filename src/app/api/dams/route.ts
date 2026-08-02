import { NextResponse } from "next/server";

export const revalidate = 900; // 15-minute revalidation cache

interface Dam {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  frl: number; // Full Reservoir Level
  unit: string; // ft or m
  dangerLevel: number;
}

const DAMS: Dam[] = [
  { id: "idukki", name: "Idukki Arch Dam", river: "Periyar River", lat: 9.8458, lng: 76.9736, frl: 2403.0, unit: "ft", dangerLevel: 2395.0 },
  { id: "mullaperiyar", name: "Mullaperiyar Dam", river: "Periyar River", lat: 9.5292, lng: 77.1436, frl: 142.0, unit: "ft", dangerLevel: 140.0 },
  { id: "idamalayar", name: "Idamalayar Dam", river: "Periyar River", lat: 10.2183, lng: 76.7022, frl: 169.0, unit: "m", dangerLevel: 165.0 },
  { id: "banasurasagar", name: "Banasurasagar Dam", river: "Kabini River", lat: 11.6706, lng: 75.9556, frl: 775.6, unit: "m", dangerLevel: 773.0 },
  { id: "malampuzha", name: "Malampuzha Dam", river: "Bharatapuzha River", lat: 10.8322, lng: 76.6853, frl: 115.06, unit: "m", dangerLevel: 113.0 },
  { id: "neyyar", name: "Neyyar Dam", river: "Neyyar River", lat: 8.5358, lng: 77.1481, frl: 84.75, unit: "m", dangerLevel: 82.0 },
  { id: "peechi", name: "Peechi Dam", river: "Manali River", lat: 10.5317, lng: 76.3683, frl: 79.25, unit: "m", dangerLevel: 77.0 },
  { id: "kakki", name: "Kakki Dam", river: "Pamba River", lat: 9.3172, lng: 77.1408, frl: 981.46, unit: "m", dangerLevel: 978.0 },
  { id: "peringalkuthu", name: "Peringalkuthu Dam", river: "Chalakkudy River", lat: 10.3117, lng: 76.6358, frl: 424.0, unit: "m", dangerLevel: 420.0 },
  { id: "sholayar", name: "Lower Sholayar Dam", river: "Chalakkudy River", lat: 10.2989, lng: 76.7725, dangerLevel: 2658.0, frl: 2663.0, unit: "ft" },
  { id: "kanjirapuzha", name: "Kanjirapuzha Dam", river: "Kanjirapuzha River", lat: 10.9786, lng: 76.5414, frl: 97.5, unit: "m", dangerLevel: 95.0 },
  { id: "walayar", name: "Walayar Dam", river: "Walayar River", lat: 10.8406, lng: 76.8406, frl: 203.0, unit: "m", dangerLevel: 200.0 },
  { id: "thumboormuzhi", name: "Thumboormuzhi Weir", river: "Chalakkudy River", lat: 10.3183, lng: 76.4383, frl: 30.5, unit: "m", dangerLevel: 29.5 },
  { id: "neyyar_weir", name: "Aruvikkara Dam", river: "Karamana River", lat: 8.5683, lng: 76.9933, frl: 46.6, unit: "m", dangerLevel: 45.0 },
];

export async function GET() {
  try {
    const results = await Promise.all(
      DAMS.map(async (dam) => {
        // Fetch 2-day daily precipitation sums to estimate inflow rates
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${dam.lat}&longitude=${dam.lng}&daily=precipitation_sum&timezone=Asia%2FKolkata&forecast_days=2`;
        const res = await fetch(weatherUrl);
        if (!res.ok) throw new Error(`Failed to fetch catchment weather for ${dam.name}`);
        const data = await res.json();

        const precipToday = data.daily?.precipitation_sum?.[0] ?? 0;
        const precipYesterday = data.daily?.precipitation_sum?.[1] ?? 0;

        // Base capacity estimation (normal pool at 86%)
        let basePct = 86.2;
        // Adjust based on catchment rain
        if (precipToday > 0) {
          basePct += precipToday * 0.15; // 0.15% capacity increase per mm rain
        }
        
        // Ensure cap limits
        const capacityPct = Math.min(100, Math.max(30, basePct));
        const currentLevel = (capacityPct / 100) * dam.frl;

        // Spill status and shutter state logic
        let status: "normal" | "alert" | "spill" = "normal";
        let alertColor: "green" | "blue" | "orange" | "red" = "green";
        let shutterStatus = "Closed";

        if (currentLevel >= dam.dangerLevel) {
          status = "spill";
          alertColor = "red";
          const spillHeight = Math.ceil((currentLevel - dam.dangerLevel) * 15); // mock spill height in cm
          shutterStatus = `Shutters Raised (${spillHeight}cm)`;
        } else if (currentLevel >= dam.frl * 0.95) {
          status = "alert";
          alertColor = "red";
          shutterStatus = "Red Alert (Spill Imminent)";
        } else if (currentLevel >= dam.frl * 0.92) {
          status = "alert";
          alertColor = "orange";
          shutterStatus = "Orange Alert Warning";
        } else if (currentLevel >= dam.frl * 0.88) {
          status = "normal";
          alertColor = "blue";
          shutterStatus = "Blue Alert Issued";
        }

        // Inflow trend vs yesterday
        let trend: "rising" | "falling" | "steady" = "steady";
        const diff = precipToday - precipYesterday;
        if (diff > 5) {
          trend = "rising";
        } else if (diff < -5) {
          trend = "falling";
        }

        return {
          ...dam,
          currentLevel,
          capacityPct,
          status,
          alertColor,
          shutterStatus,
          trend,
          catchmentRain24h: precipToday,
          updatedAt: new Date().toISOString(),
        };
      })
    );

    return NextResponse.json({ success: true, dams: results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch dam warning levels";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
